import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  createInvitation,
  INVITATION_TTL_MS,
  listPendingInvitations,
  previewInvitation,
  revokeInvitation,
} from "@/features/organizations/server/invitation-service";
import {
  getAuthorizedOrganization,
  listMembers,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { db } from "@/lib/db";
import { testOutbox } from "@/lib/email";
import { AppError } from "@/lib/errors";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });
const OPTIONS = { baseUrl: "http://localhost:3000", locale: "en" };

async function expectCode(promise: Promise<unknown>, code: AppError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof AppError && error.code === code,
  );
}

const contextFor = (slug: string, userId: string): Promise<OrganizationContext> =>
  getAuthorizedOrganization(deps(), { userId, organizationSlug: slug });

async function setup() {
  const acme = await createTestOrganization("acme", {
    admin: "ADMIN",
    manager: "MANAGER",
    member: "MEMBER",
    viewer: "VIEWER",
  });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    owner: await contextFor("acme", acme.users.owner!.id),
    admin: await contextFor("acme", acme.users.admin!.id),
    manager: await contextFor("acme", acme.users.manager!.id),
    member: await contextFor("acme", acme.users.member!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

async function newUser(email: string, emailVerified = true) {
  return db().user.create({
    data: { id: crypto.randomUUID(), name: "Invitee", email, emailVerified },
  });
}

/** Sends an invitation and returns the token the invitee would find in the email. */
async function invite(context: OrganizationContext, email: string, role = "MEMBER", now?: Date) {
  testOutbox.length = 0;
  const view = await createInvitation(deps(), context, { email, role }, { ...OPTIONS, now });
  const message = testOutbox.find((m) => m.to === email.toLowerCase())!;
  const token = /\/invite\/([A-Za-z0-9_-]{43})/.exec(message.text)![1]!;
  return { view, token, message };
}

describe("invitations", () => {
  beforeEach(resetDatabase);

  it("emails a single-use link and stores only a hash of the token", async () => {
    const { owner } = await setup();
    const { view, token, message } = await invite(owner, "Bob@Example.test", "MANAGER");

    expect(view).toMatchObject({ email: "bob@example.test", role: "MANAGER", expired: false });
    expect(message.text).toContain(`http://localhost:3000/en/invite/${token}`);
    const row = await db().invitation.findUniqueOrThrow({ where: { id: view.id } });
    expect(row.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(
      INVITATION_TTL_MS + 1000,
    );

    const audit = await db().auditLog.findMany({ where: { action: "invitation.created" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain("bob@example.test");
  });

  it("lets the invited, verified user join with the invited role exactly once", async () => {
    const { owner, acme } = await setup();
    const { token } = await invite(owner, "bob@example.test", "VIEWER");
    const bob = await newUser("bob@example.test");

    expect(await acceptInvitation(deps(), bob, token)).toEqual({ organizationSlug: "acme" });
    const member = await db().member.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: acme.organization.id, userId: bob.id } },
    });
    expect(member).toMatchObject({ role: "VIEWER", status: "ACTIVE" });
    expect(await db().auditLog.count({ where: { action: "member.joined", actorId: bob.id } })).toBe(
      1,
    );

    await expectCode(acceptInvitation(deps(), bob, token), "NOT_FOUND");
    expect((await listMembers(deps(), owner)).map((m) => m.userId)).toContain(bob.id);
    expect(await listPendingInvitations(deps(), owner)).toEqual([]);
  });

  it("creates at most one membership when accepted concurrently", async () => {
    const { owner, acme } = await setup();
    const { token } = await invite(owner, "bob@example.test");
    const bob = await newUser("bob@example.test");
    const results = await Promise.allSettled([
      acceptInvitation(deps(), bob, token),
      acceptInvitation(deps(), bob, token),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db().member.count({ where: { organizationId: acme.organization.id, userId: bob.id } }),
    ).toBe(1);
  });

  it("only accepts for the invited email, and only when it is verified", async () => {
    const { owner } = await setup();
    const { token } = await invite(owner, "bob@example.test");
    const mallory = await newUser("mallory@example.test");
    await expectCode(acceptInvitation(deps(), mallory, token), "FORBIDDEN");
    const unverified = { id: crypto.randomUUID(), email: "bob@example.test", emailVerified: false };
    await expectCode(acceptInvitation(deps(), unverified, token), "FORBIDDEN");
    // The token was not consumed by the failed attempts.
    const bob = await newUser("bob@example.test");
    await expect(acceptInvitation(deps(), bob, token)).resolves.toBeDefined();
  });

  it("rejects unknown, malformed, expired and revoked tokens identically", async () => {
    const { owner } = await setup();
    const bob = await newUser("bob@example.test");

    const expired = await invite(
      owner,
      "bob@example.test",
      "MEMBER",
      new Date(Date.now() - 8 * 24 * 3_600_000),
    );
    await expectCode(acceptInvitation(deps(), bob, expired.token), "NOT_FOUND");
    await expectCode(previewInvitation(deps(), expired.token), "NOT_FOUND");

    const revoked = await invite(owner, "bob@example.test");
    await revokeInvitation(deps(), owner, revoked.view.id);
    await expectCode(acceptInvitation(deps(), bob, revoked.token), "NOT_FOUND");

    await expectCode(acceptInvitation(deps(), bob, "x".repeat(43)), "NOT_FOUND");
    await expectCode(acceptInvitation(deps(), bob, "../../etc/passwd"), "NOT_FOUND");
    await expectCode(previewInvitation(deps(), ""), "NOT_FOUND");
  });

  it("previews with a masked email and no ids", async () => {
    const { owner } = await setup();
    const { token } = await invite(owner, "bob@example.test", "ADMIN");
    expect(await previewInvitation(deps(), token)).toEqual({
      organizationName: "acme",
      role: "ADMIN",
      maskedEmail: "b***@example.test",
    });
  });

  it("refuses duplicates, existing members and the OWNER role, but allows re-inviting after revoke or expiry", async () => {
    const { owner, acme } = await setup();
    const first = await invite(owner, "bob@example.test");
    await expectCode(
      createInvitation(deps(), owner, { email: "BOB@example.test", role: "MEMBER" }, OPTIONS),
      "CONFLICT",
    );
    await revokeInvitation(deps(), owner, first.view.id);
    await expect(invite(owner, "bob@example.test")).resolves.toBeDefined();

    const stale = await invite(
      owner,
      "old@example.test",
      "MEMBER",
      new Date(Date.now() - 8 * 24 * 3_600_000),
    );
    const listed = await listPendingInvitations(deps(), owner);
    expect(listed.find((i) => i.id === stale.view.id)?.expired).toBe(true);
    await expect(invite(owner, "old@example.test")).resolves.toBeDefined();

    const existingEmail = (
      await db().user.findUniqueOrThrow({ where: { id: acme.users.member!.id } })
    ).email;
    await expectCode(
      createInvitation(deps(), owner, { email: existingEmail, role: "MEMBER" }, OPTIONS),
      "CONFLICT",
    );
    await expectCode(
      createInvitation(deps(), owner, { email: "x@example.test", role: "OWNER" }, OPTIONS),
      "INVALID_INPUT",
    );
    await expectCode(
      createInvitation(deps(), owner, { email: "not-an-email", role: "MEMBER" }, OPTIONS),
      "INVALID_INPUT",
    );
    await expect(
      db().invitation.create({
        data: {
          organizationId: acme.organization.id,
          email: "owner@example.test",
          role: "OWNER",
          tokenHash: "h",
          invitedById: acme.users.owner!.id,
          expiresAt: new Date(Date.now() + 1000),
        },
      }),
    ).rejects.toThrow();
  });

  it("does not re-enable a disabled member through an invitation", async () => {
    const { owner, acme } = await setup();
    const bob = await newUser("bob@example.test");
    const { token } = await invite(owner, "bob@example.test");
    await db().member.create({
      data: {
        organizationId: acme.organization.id,
        userId: bob.id,
        role: "VIEWER",
        status: "DISABLED",
      },
    });
    await expectCode(acceptInvitation(deps(), bob, token), "CONFLICT");
    expect((await db().member.findFirstOrThrow({ where: { userId: bob.id } })).status).toBe(
      "DISABLED",
    );
  });

  it("limits invitation management to roles with member:invite", async () => {
    const { owner, admin, manager, member, viewer } = await setup();
    for (const context of [manager, member, viewer]) {
      await expectCode(
        createInvitation(deps(), context, { email: "x@example.test", role: "MEMBER" }, OPTIONS),
        "FORBIDDEN",
      );
      await expectCode(listPendingInvitations(deps(), context), "FORBIDDEN");
    }
    const { view } = await invite(admin, "bob@example.test");
    expect((await listPendingInvitations(deps(), owner)).map((i) => i.id)).toEqual([view.id]);
    await expectCode(revokeInvitation(deps(), viewer, view.id), "FORBIDDEN");
  });

  it("shows member emails only to roles that can invite", async () => {
    const { owner, viewer } = await setup();
    expect((await listMembers(deps(), owner)).every((m) => m.email !== null)).toBe(true);
    expect((await listMembers(deps(), viewer)).every((m) => m.email === null)).toBe(true);
  });

  describe("tenant isolation", () => {
    it("keeps invitations scoped to their organization", async () => {
      const { owner, globexOwner } = await setup();
      const { view, token } = await invite(owner, "bob@example.test", "VIEWER");

      expect(await listPendingInvitations(deps(), globexOwner)).toEqual([]);
      await expectCode(revokeInvitation(deps(), globexOwner, view.id), "NOT_FOUND");
      expect(
        (await db().invitation.findUniqueOrThrow({ where: { id: view.id } })).revokedAt,
      ).toBeNull();

      // A token grants membership only in the organization that issued it.
      const bob = await newUser("bob@example.test");
      await acceptInvitation(deps(), bob, token);
      const memberships = await db().member.findMany({
        where: { userId: bob.id },
        include: { organization: true },
      });
      expect(memberships.map((m) => m.organization.slug)).toEqual(["acme"]);
    });
  });
});
