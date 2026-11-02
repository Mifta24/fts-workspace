import { beforeEach, describe, expect, it } from "vitest";
import { listWorkspaces, resolveOperator } from "@/features/admin/server/admin-service";
import { DELETION_GRACE_DAYS } from "@/features/organizations/schemas/deletion";
import {
  cancelWorkspaceDeletion,
  requestWorkspaceDeletion,
} from "@/features/organizations/server/deletion-service";
import { getAuthorizedOrganization } from "@/features/organizations/server/organization-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createTestOrganization, createTestUser, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });
const DAY = 86_400_000;

async function contextOf(slug: string, userId: string) {
  return getAuthorizedOrganization(deps(), { userId, organizationSlug: slug });
}

async function expectCode(promise: Promise<unknown>, code: AppError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof AppError && error.code === code,
  );
}

const auditActions = async (organizationId: string) =>
  (
    await db().auditLog.findMany({
      where: { organizationId, action: { startsWith: "organization.deletion" } },
      orderBy: { createdAt: "asc" },
    })
  ).map((row) => row.action);

describe("workspace deletion request", () => {
  beforeEach(resetDatabase);

  it("records the request, shows the due date, and leaves the workspace working", async () => {
    const { organization, users } = await createTestOrganization("acme", { member: "MEMBER" });
    const now = new Date("2026-11-02T10:00:00Z");
    const state = await requestWorkspaceDeletion(
      deps(),
      await contextOf("acme", users.owner.id),
      { confirm: "ACME " },
      now,
    );
    expect(state.requestedAt).toEqual(now);
    expect(state.dueAfter.getTime() - now.getTime()).toBe(DELETION_GRACE_DAYS * DAY);

    const row = await db().organization.findUniqueOrThrow({ where: { id: organization.id } });
    expect(row.deletionRequestedAt).toEqual(now);
    expect(row.deletionRequestedBy).toBe(users.owner.id);
    expect(await auditActions(organization.id)).toEqual(["organization.deletion_requested"]);

    // Everyone in the workspace can still open it, and sees the request in their context.
    const member = await contextOf("acme", users.member.id);
    expect(member.organization.deletionRequestedAt).toEqual(now);
    expect(await db().member.count({ where: { organizationId: organization.id } })).toBe(2);
  });

  it("is idempotent: asking again keeps the first date and writes one audit event", async () => {
    const { organization, users } = await createTestOrganization("acme");
    const context = await contextOf("acme", users.owner.id);
    const first = new Date("2026-11-02T10:00:00Z");
    await requestWorkspaceDeletion(deps(), context, { confirm: "acme" }, first);
    const again = await requestWorkspaceDeletion(
      deps(),
      context,
      { confirm: "acme" },
      new Date("2026-11-09T10:00:00Z"),
    );
    expect(again.requestedAt).toEqual(first);
    expect(await auditActions(organization.id)).toEqual(["organization.deletion_requested"]);
  });

  it("two requests at once still record one", async () => {
    const { organization, users } = await createTestOrganization("acme");
    const context = await contextOf("acme", users.owner.id);
    await Promise.all([
      requestWorkspaceDeletion(deps(), context, { confirm: "acme" }),
      requestWorkspaceDeletion(deps(), context, { confirm: "acme" }),
    ]);
    expect(await auditActions(organization.id)).toEqual(["organization.deletion_requested"]);
  });

  it("needs the workspace address typed correctly", async () => {
    const { organization, users } = await createTestOrganization("acme");
    const context = await contextOf("acme", users.owner.id);
    for (const confirm of ["", "acme-2", "ACME CORP", undefined, 5]) {
      await expectCode(requestWorkspaceDeletion(deps(), context, { confirm }), "INVALID_INPUT");
    }
    const row = await db().organization.findUniqueOrThrow({ where: { id: organization.id } });
    expect(row.deletionRequestedAt).toBeNull();
  });

  it("is for owners only", async () => {
    const { organization, users } = await createTestOrganization("acme", {
      admin: "ADMIN",
      manager: "MANAGER",
      member: "MEMBER",
      viewer: "VIEWER",
    });
    for (const label of ["admin", "manager", "member", "viewer"]) {
      const context = await contextOf("acme", users[label].id);
      await expectCode(requestWorkspaceDeletion(deps(), context, { confirm: "acme" }), "FORBIDDEN");
      await expectCode(cancelWorkspaceDeletion(deps(), context), "FORBIDDEN");
    }
    const row = await db().organization.findUniqueOrThrow({ where: { id: organization.id } });
    expect(row.deletionRequestedAt).toBeNull();
  });

  it("an owner of another workspace cannot reach this one", async () => {
    const { organization } = await createTestOrganization("acme");
    const { users: other } = await createTestOrganization("globex");
    // The tenant lookup fails before any permission check, as for every other action.
    await expectCode(contextOf("acme", other.owner.id), "NOT_FOUND");
    // A context built for globex never touches acme's row.
    const context = await contextOf("globex", other.owner.id);
    await expectCode(
      requestWorkspaceDeletion(deps(), context, { confirm: "acme" }),
      "INVALID_INPUT",
    );
    await requestWorkspaceDeletion(deps(), context, { confirm: "globex" });
    const acme = await db().organization.findUniqueOrThrow({ where: { id: organization.id } });
    expect(acme.deletionRequestedAt).toBeNull();
  });

  it("can be cancelled, and cancelling twice or without a request does nothing", async () => {
    const { organization, users } = await createTestOrganization("acme");
    const context = await contextOf("acme", users.owner.id);
    await cancelWorkspaceDeletion(deps(), context);
    expect(await auditActions(organization.id)).toEqual([]);

    await requestWorkspaceDeletion(deps(), context, { confirm: "acme" });
    await cancelWorkspaceDeletion(deps(), context);
    await cancelWorkspaceDeletion(deps(), context);
    const row = await db().organization.findUniqueOrThrow({ where: { id: organization.id } });
    expect(row.deletionRequestedAt).toBeNull();
    expect(row.deletionRequestedBy).toBeNull();
    expect(await auditActions(organization.id)).toEqual([
      "organization.deletion_requested",
      "organization.deletion_cancelled",
    ]);

    // After a cancel the owner can ask again, with a new date.
    const later = new Date("2026-12-01T00:00:00Z");
    const again = await requestWorkspaceDeletion(deps(), context, { confirm: "acme" }, later);
    expect(again.requestedAt).toEqual(later);
  });

  it("shows operators which workspaces are waiting", async () => {
    const { users } = await createTestOrganization("acme");
    await createTestOrganization("globex");
    const asker = await contextOf("acme", users.owner.id);
    const now = new Date("2026-11-02T10:00:00Z");
    await requestWorkspaceDeletion(deps(), asker, { confirm: "acme" }, now);

    const operatorUser = await createTestUser("operator");
    const operator = resolveOperator(operatorUser, [operatorUser.email.toLowerCase()]);
    if (!operator) throw new Error("operator expected");
    const rows = await listWorkspaces(deps(), operator, "");
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    expect(bySlug.get("acme")?.deletionRequestedAt).toEqual(now);
    expect(bySlug.get("globex")?.deletionRequestedAt).toBeNull();
  });
});
