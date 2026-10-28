import { beforeEach, describe, expect, it } from "vitest";
import {
  createOrganization,
  getAuthorizedOrganization,
  listUserOrganizations,
} from "@/features/organizations/server/organization-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createTestUser, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });

async function expectCode(promise: Promise<unknown>, code: AppError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof AppError && error.code === code,
  );
}

describe("organization tenancy", () => {
  beforeEach(resetDatabase);

  it("creates an organization with the creator as OWNER and an audit event", async () => {
    const alice = await createTestUser("alice");
    const org = await createOrganization(deps(), alice.id, { name: "Acme", slug: "acme" });

    expect(org).toMatchObject({ name: "Acme", slug: "acme", role: "OWNER" });
    const member = await db().member.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: org.id, userId: alice.id } },
    });
    expect(member).toMatchObject({ role: "OWNER", status: "ACTIVE" });
    const audit = await db().auditLog.findMany({ where: { organizationId: org.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "organization.created", actorId: alice.id });
  });

  it("rejects invalid input and duplicate slugs", async () => {
    const alice = await createTestUser("alice");
    await expectCode(
      createOrganization(deps(), alice.id, { name: "", slug: "x" }),
      "INVALID_INPUT",
    );
    await createOrganization(deps(), alice.id, { name: "Acme", slug: "acme" });
    const bob = await createTestUser("bob");
    await expectCode(
      createOrganization(deps(), bob.id, { name: "Other", slug: "acme" }),
      "CONFLICT",
    );
    expect(await db().organization.count()).toBe(1);
  });

  it("resolves the organization for an active member", async () => {
    const alice = await createTestUser("alice");
    const org = await createOrganization(deps(), alice.id, { name: "Acme", slug: "acme" });
    const context = await getAuthorizedOrganization(deps(), {
      userId: alice.id,
      organizationSlug: "acme",
      permission: "organization:update",
    });
    expect(context.organization.id).toBe(org.id);
    expect(context.role).toBe("OWNER");
  });

  it("denies cross-tenant access exactly like a nonexistent organization", async () => {
    const alice = await createTestUser("alice");
    const bob = await createTestUser("bob");
    await createOrganization(deps(), alice.id, { name: "Acme", slug: "acme" });
    await createOrganization(deps(), bob.id, { name: "Globex", slug: "globex" });

    const crossTenant = getAuthorizedOrganization(deps(), {
      userId: alice.id,
      organizationSlug: "globex",
    });
    const missing = getAuthorizedOrganization(deps(), {
      userId: alice.id,
      organizationSlug: "does-not-exist",
    });
    await expect(crossTenant).rejects.toThrow("Organization not found.");
    await expect(missing).rejects.toThrow("Organization not found.");
    await expectCode(crossTenant, "NOT_FOUND");
    await expectCode(missing, "NOT_FOUND");
  });

  it("denies access through a disabled membership", async () => {
    const alice = await createTestUser("alice");
    const bob = await createTestUser("bob");
    const org = await createOrganization(deps(), alice.id, { name: "Acme", slug: "acme" });
    await db().member.create({
      data: { organizationId: org.id, userId: bob.id, role: "ADMIN", status: "DISABLED" },
    });

    await expectCode(
      getAuthorizedOrganization(deps(), { userId: bob.id, organizationSlug: "acme" }),
      "NOT_FOUND",
    );
    expect(await listUserOrganizations(deps(), bob.id)).toEqual([]);
  });

  it("enforces role permissions inside the tenant", async () => {
    const alice = await createTestUser("alice");
    const victor = await createTestUser("victor");
    const org = await createOrganization(deps(), alice.id, { name: "Acme", slug: "acme" });
    await db().member.create({
      data: { organizationId: org.id, userId: victor.id, role: "VIEWER" },
    });

    const context = await getAuthorizedOrganization(deps(), {
      userId: victor.id,
      organizationSlug: "acme",
      permission: "organization:read",
    });
    expect(context.role).toBe("VIEWER");
    await expectCode(
      getAuthorizedOrganization(deps(), {
        userId: victor.id,
        organizationSlug: "acme",
        permission: "member:invite",
      }),
      "FORBIDDEN",
    );
  });

  it("lists only the user's own active organizations", async () => {
    const alice = await createTestUser("alice");
    const bob = await createTestUser("bob");
    await createOrganization(deps(), alice.id, { name: "Acme", slug: "acme" });
    await createOrganization(deps(), alice.id, { name: "Beta", slug: "beta" });
    await createOrganization(deps(), bob.id, { name: "Globex", slug: "globex" });

    const slugs = (await listUserOrganizations(deps(), alice.id)).map((o) => o.slug);
    expect(slugs).toEqual(["acme", "beta"]);
  });

  it("rejects malformed slugs without querying other tenants", async () => {
    const alice = await createTestUser("alice");
    await expectCode(
      getAuthorizedOrganization(deps(), { userId: alice.id, organizationSlug: "../globex" }),
      "NOT_FOUND",
    );
  });
});
