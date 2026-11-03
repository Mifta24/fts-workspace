import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETION_GRACE_DAYS } from "@/features/organizations/schemas/deletion";
import {
  cancelWorkspaceDeletion,
  requestWorkspaceDeletion,
} from "@/features/organizations/server/deletion-service";
import { getAuthorizedOrganization } from "@/features/organizations/server/organization-service";
import { PURGE_TABLE_NAMES, purgeWorkspace } from "@/features/organizations/server/purge-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { runJobs } from "@/server/jobs/queue";
import { createLocalStorage, type StoragePort } from "@/server/storage/storage";
import { createTestOrganization, resetDatabase } from "../helpers/db";

async function seedAppendOnly(organizationId: string, userId: string) {
  const contact = await db().crmContact.create({
    data: { organizationId, name: "Contact", ownerId: userId, createdById: userId },
  });
  await db().pointEvent.create({
    data: {
      organizationId,
      userId,
      type: "TASK_COMPLETED",
      points: 5,
      sourceType: "task",
      sourceId: crypto.randomUUID(),
    },
  });
  await db().consentEvent.create({
    data: {
      organizationId,
      contactId: contact.id,
      status: "GRANTED",
      source: "form",
      recordedById: userId,
    },
  });
  await db().contactStageChange.create({
    data: {
      organizationId,
      contactId: contact.id,
      toStage: "LEAD",
      reason: "CREATED",
      changedById: userId,
    },
  });
}

const setPurgeOrg = (tx: { $executeRaw: ReturnType<typeof db>["$executeRaw"] }, id: string) =>
  tx.$executeRaw`SELECT set_config('app.purge_org', ${id}, true)`;

describe("append-only tables", () => {
  beforeEach(resetDatabase);

  it("rejects deletes and updates outside a purge", async () => {
    const { organization, users } = await createTestOrganization("acme");
    await seedAppendOnly(organization.id, users.owner.id);
    await expect(
      db().pointEvent.deleteMany({ where: { organizationId: organization.id } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      db().consentEvent.deleteMany({ where: { organizationId: organization.id } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      db().contactStageChange.deleteMany({ where: { organizationId: organization.id } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      db().pointEvent.updateMany({
        where: { organizationId: organization.id },
        data: { points: 9 },
      }),
    ).rejects.toThrow(/append-only/);
  });

  it("allows deletes only for the organization named in the transaction setting", async () => {
    const a = await createTestOrganization("acme");
    const b = await createTestOrganization("beta");
    await seedAppendOnly(a.organization.id, a.users.owner.id);
    await seedAppendOnly(b.organization.id, b.users.owner.id);

    await db().$transaction(async (tx) => {
      await setPurgeOrg(tx, a.organization.id);
      await tx.pointEvent.deleteMany({ where: { organizationId: a.organization.id } });
      await tx.consentEvent.deleteMany({ where: { organizationId: a.organization.id } });
      await tx.contactStageChange.deleteMany({ where: { organizationId: a.organization.id } });
    });
    expect(await db().pointEvent.count({ where: { organizationId: a.organization.id } })).toBe(0);
    expect(await db().consentEvent.count({ where: { organizationId: b.organization.id } })).toBe(1);
    expect(await db().pointEvent.count({ where: { organizationId: b.organization.id } })).toBe(1);
    expect(
      await db().contactStageChange.count({ where: { organizationId: b.organization.id } }),
    ).toBe(1);

    await expect(
      db().$transaction(async (tx) => {
        await setPurgeOrg(tx, a.organization.id);
        await tx.pointEvent.deleteMany({ where: { organizationId: b.organization.id } });
      }),
    ).rejects.toThrow(/append-only/);
    expect(await db().pointEvent.count({ where: { organizationId: b.organization.id } })).toBe(1);
  });

  it("still rejects updates during a purge, and the setting does not leak", async () => {
    const a = await createTestOrganization("acme");
    await seedAppendOnly(a.organization.id, a.users.owner.id);
    await expect(
      db().$transaction(async (tx) => {
        await setPurgeOrg(tx, a.organization.id);
        await tx.pointEvent.updateMany({
          where: { organizationId: a.organization.id },
          data: { points: 9 },
        });
      }),
    ).rejects.toThrow(/append-only/);

    await db().$transaction(async (tx) => {
      await setPurgeOrg(tx, a.organization.id);
    });
    await expect(
      db().pointEvent.deleteMany({ where: { organizationId: a.organization.id } }),
    ).rejects.toThrow(/append-only/);
  });
});

const DAY = 86_400_000;
const NOW = new Date("2026-11-03T10:00:00Z");
const REQUESTED = new Date(NOW.getTime() - DELETION_GRACE_DAYS * DAY);

const fakeStorage = (): StoragePort => ({
  put: async () => {},
  get: async () => null,
  delete: async () => {},
  deletePrefix: async () => 0,
});

const deps = () => ({ prisma: db(), storage: fakeStorage() });
const actor = { trigger: "admin", userId: null } as const;
const purge = (organizationId: string, now: Date = NOW) =>
  purgeWorkspace(deps(), { organizationId, actor }, now);

async function expectRefused(promise: Promise<unknown>) {
  await expect(promise).rejects.toSatisfy((error: unknown) => error instanceof AppError);
}

/** One or more rows in every kind of table that matters: tree keys, composite keys, append-only. */
async function seedWorkspace(slug: string) {
  const { organization, users } = await createTestOrganization(slug, { member: "MEMBER" });
  const organizationId = organization.id;
  const userId = users.owner.id;
  const project = await db().project.create({
    data: { organizationId, name: "Project", createdById: userId },
  });
  const goal = await db().goal.create({
    data: {
      organizationId,
      projectId: project.id,
      title: "Goal",
      ownerId: userId,
      createdById: userId,
    },
  });
  await db().goal.create({
    data: {
      organizationId,
      parentGoalId: goal.id,
      title: "Sub goal",
      ownerId: userId,
      createdById: userId,
    },
  });
  const task = await db().task.create({
    data: {
      organizationId,
      projectId: project.id,
      goalId: goal.id,
      title: "Task",
      createdById: userId,
    },
  });
  await db().task.create({
    data: { organizationId, parentTaskId: task.id, title: "Subtask", createdById: userId },
  });
  await db().taskComment.create({
    data: { organizationId, taskId: task.id, authorId: userId, body: "Comment" },
  });
  const channel = await db().channel.create({
    data: { organizationId, name: "general", createdById: userId },
  });
  await db().channelMember.create({ data: { organizationId, channelId: channel.id, userId } });
  await db().message.create({
    data: { organizationId, channelId: channel.id, authorId: userId, body: "Hello" },
  });
  await db().notification.create({
    data: {
      organizationId,
      userId,
      type: "TASK_ASSIGNED",
      resourceType: "task",
      resourceId: task.id,
    },
  });
  const file = await db().fileObject.create({
    data: {
      organizationId,
      uploadedById: userId,
      name: "a.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      sha256: "0".repeat(64),
      storageKey: `${organizationId}/${crypto.randomUUID()}`,
    },
  });
  await db().fileShare.create({ data: { organizationId, fileId: file.id, userId } });
  await db().job.create({ data: { organizationId, type: "noop", payload: {} } });
  await db().subscription.create({
    data: { organizationId, planKey: "TEAM", status: "ACTIVE" },
  });
  const contact = await db().crmContact.create({
    data: {
      organizationId,
      name: "Visitor",
      email: "visitor@example.test",
      ownerId: userId,
      createdById: userId,
    },
  });
  const form = await db().form.create({
    data: {
      organizationId,
      title: "Form",
      fields: [{ key: "name", label: "Name", type: "text", required: true }],
      ownerId: userId,
      createdById: userId,
      publicToken: crypto.randomUUID(),
    },
  });
  await db().formSubmission.create({
    data: { organizationId, formId: form.id, answers: {}, contactId: contact.id },
  });
  const bookingPage = await db().bookingPage.create({
    data: {
      organizationId,
      ownerId: userId,
      title: "Booking",
      durationMinutes: 30,
      timeZone: "UTC",
      weekdays: [1],
      startMinute: 540,
      endMinute: 1020,
      consentText: "ok",
      publicToken: crypto.randomUUID(),
    },
  });
  await db().appointment.create({
    data: {
      organizationId,
      title: "Meeting",
      startsAt: NOW,
      endsAt: new Date(NOW.getTime() + 1_800_000),
      bookingPageId: bookingPage.id,
      organizerId: userId,
      contactId: contact.id,
    },
  });
  await seedAppendOnly(organizationId, userId);
  await db().auditLog.create({
    data: { organizationId, actorId: userId, action: "seed.event", resourceType: "organization" },
  });
  return { organization, users, userId };
}

async function organizationTables(): Promise<string[]> {
  const rows = await db().$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organizationId'
    ORDER BY table_name`;
  return rows.map((row) => row.table_name);
}

async function countRows(organizationId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of await organizationTables()) {
    const [row] = await db().$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "${table}" WHERE "organizationId" = $1::uuid`,
      organizationId,
    );
    counts[table] = row?.n ?? 0;
  }
  return counts;
}

const requestAt = (organizationId: string, at: Date | null) =>
  db().organization.update({
    where: { id: organizationId },
    data: { deletionRequestedAt: at, deletionRequestedBy: null },
  });

describe("purge table list", () => {
  beforeEach(resetDatabase);

  it("covers every table that has an organizationId column", async () => {
    expect([...PURGE_TABLE_NAMES].sort()).toEqual(await organizationTables());
  });

  it("deletes children before the tables their rows point at", async () => {
    const edges = await db().$queryRaw<{ child: string; parent: string }[]>`
      SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
      FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`;
    const position = new Map(PURGE_TABLE_NAMES.map((name, index) => [name, index]));
    for (const { child, parent } of edges) {
      const at = position.get(child);
      const parentAt = position.get(parent);
      if (at === undefined || parentAt === undefined || child === parent) continue;
      expect(at, `${child} must be deleted before ${parent}`).toBeLessThan(parentAt);
    }
  });
});

describe("purgeWorkspace", () => {
  beforeEach(resetDatabase);

  it("refuses a workspace with no request, and one that is not due", async () => {
    const { organization } = await seedWorkspace("acme");
    const before = await countRows(organization.id);
    await expectRefused(purge(organization.id));
    await requestAt(organization.id, REQUESTED);
    await expectRefused(purge(organization.id, new Date(NOW.getTime() - 1000)));
    expect(await countRows(organization.id)).toEqual(before);
    const row = await db().organization.findUniqueOrThrow({ where: { id: organization.id } });
    expect(row.purgedAt).toBeNull();
  });

  it("refuses an unknown workspace", async () => {
    await expectRefused(purge(crypto.randomUUID()));
  });

  it("purges a due workspace and leaves the other workspace untouched", async () => {
    const a = await seedWorkspace("acme");
    const b = await seedWorkspace("beta");
    await requestAt(a.organization.id, REQUESTED);
    const usersBefore = await db().user.count();
    const bBefore = await countRows(b.organization.id);

    const result = await purge(a.organization.id);

    expect(result.alreadyPurged).toBe(false);
    const after = await countRows(a.organization.id);
    for (const [table, n] of Object.entries(after)) {
      if (table !== "audit_logs") expect(n, table).toBe(0);
    }
    expect(await countRows(b.organization.id)).toEqual(bBefore);
    expect(await db().user.count()).toBe(usersBefore);

    const row = await db().organization.findUniqueOrThrow({ where: { id: a.organization.id } });
    const token = `deleted-${a.organization.id.replaceAll("-", "")}`;
    expect(row).toMatchObject({
      name: token,
      slug: token,
      purgedAt: NOW,
      deletionRequestedAt: null,
      deletionRequestedBy: null,
    });
  });

  it("writes one organization.purged event with counts only", async () => {
    const a = await seedWorkspace("acme");
    await requestAt(a.organization.id, REQUESTED);
    await purge(a.organization.id);

    const events = await db().auditLog.findMany({ where: { organizationId: a.organization.id } });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event).toMatchObject({ action: "organization.purged", resourceType: "organization" });
    expect(Object.keys(event?.metadata as object).sort()).toEqual([
      "filesRemoved",
      "rowCounts",
      "trigger",
    ]);
    const text = JSON.stringify(event?.metadata);
    expect(text).not.toContain("acme");
    expect(text).not.toContain("@example.test");
    expect((event?.metadata as { trigger: string }).trigger).toBe("admin");
  });

  it("is idempotent", async () => {
    const a = await seedWorkspace("acme");
    await requestAt(a.organization.id, REQUESTED);
    await purge(a.organization.id);
    const again = await purge(a.organization.id);
    expect(again.alreadyPurged).toBe(true);
    expect(
      await db().auditLog.count({
        where: { organizationId: a.organization.id, action: "organization.purged" },
      }),
    ).toBe(1);
  });

  it("uses the date of the latest request after cancel and re-request", async () => {
    const a = await seedWorkspace("acme");
    const context = async () =>
      getAuthorizedOrganization({ prisma: db() }, { userId: a.userId, organizationSlug: "acme" });
    await requestWorkspaceDeletion(
      { prisma: db() },
      await context(),
      { confirm: "acme" },
      REQUESTED,
    );
    await cancelWorkspaceDeletion({ prisma: db() }, await context());
    await requestWorkspaceDeletion(
      { prisma: db() },
      await context(),
      { confirm: "acme" },
      new Date(NOW.getTime() - DAY),
    );
    await expectRefused(purge(a.organization.id));
    expect(await db().task.count({ where: { organizationId: a.organization.id } })).toBe(2);
  });

  it("does the work once when two purges run at the same time", async () => {
    const a = await seedWorkspace("acme");
    await requestAt(a.organization.id, REQUESTED);
    const results = await Promise.all([purge(a.organization.id), purge(a.organization.id)]);
    expect(results.filter((result) => !result.alreadyPurged)).toHaveLength(1);
    expect(
      await db().auditLog.count({
        where: { organizationId: a.organization.id, action: "organization.purged" },
      }),
    ).toBe(1);
  });

  it("purges a suspended workspace", async () => {
    const a = await seedWorkspace("acme");
    await db().organization.update({
      where: { id: a.organization.id },
      data: { suspendedAt: NOW, deletionRequestedAt: REQUESTED },
    });
    await purge(a.organization.id);
    const row = await db().organization.findUniqueOrThrow({ where: { id: a.organization.id } });
    expect(row).toMatchObject({ purgedAt: NOW, suspendedAt: null });
  });

  it("frees the slug and keeps a person's other membership", async () => {
    const a = await seedWorkspace("acme");
    const b = await seedWorkspace("beta");
    await db().member.create({
      data: { organizationId: b.organization.id, userId: a.userId, role: "MEMBER" },
    });
    await requestAt(a.organization.id, REQUESTED);
    await purge(a.organization.id);

    expect(await db().user.count({ where: { id: a.userId } })).toBe(1);
    expect(
      await db().member.count({ where: { organizationId: b.organization.id, userId: a.userId } }),
    ).toBe(1);
    const reused = await createTestOrganization("acme");
    expect(reused.organization.slug).toBe("acme");
  });

  it("leaves no jobs to run", async () => {
    const a = await seedWorkspace("acme");
    await requestAt(a.organization.id, REQUESTED);
    await purge(a.organization.id);
    expect(await db().job.count({ where: { organizationId: a.organization.id } })).toBe(0);
    const ran = await runJobs(db(), { noop: async () => {} }, { max: 10 });
    expect(ran.done + ran.retried + ran.failed).toBe(0);
  });
});

describe("purgeWorkspace files and failures", () => {
  let dir: string;
  let storage: StoragePort;

  beforeEach(async () => {
    await resetDatabase();
    dir = await mkdtemp(path.join(tmpdir(), "fts-purge-"));
    storage = createLocalStorage(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  async function putFile(organizationId: string, withRow: boolean, userId: string) {
    const key = `${organizationId}/${crypto.randomUUID()}`;
    await storage.put(key, new Uint8Array([1, 2, 3]));
    if (withRow) {
      await db().fileObject.create({
        data: {
          organizationId,
          uploadedById: userId,
          name: "x.bin",
          mimeType: "application/octet-stream",
          sizeBytes: 3,
          sha256: "1".repeat(64),
          storageKey: key,
        },
      });
    }
    return key;
  }

  it("removes file bytes, including bytes with no row, and keeps the other workspace's files", async () => {
    const a = await createTestOrganization("acme");
    const b = await createTestOrganization("beta");
    const keys = [
      await putFile(a.organization.id, true, a.users.owner.id),
      await putFile(a.organization.id, true, a.users.owner.id),
      await putFile(a.organization.id, false, a.users.owner.id),
    ];
    const keep = await putFile(b.organization.id, true, b.users.owner.id);
    await requestAt(a.organization.id, REQUESTED);

    const result = await purgeWorkspace(
      { prisma: db(), storage },
      { organizationId: a.organization.id, actor },
      NOW,
    );

    expect(result.filesRemoved).toBe(3);
    for (const key of keys) expect(await storage.get(key)).toBeNull();
    expect(await storage.get(keep)).not.toBeNull();
    expect(await db().fileObject.count({ where: { organizationId: b.organization.id } })).toBe(1);
    const event = await db().auditLog.findFirstOrThrow({
      where: { organizationId: a.organization.id, action: "organization.purged" },
    });
    expect((event.metadata as { filesRemoved: number }).filesRemoved).toBe(3);
  });

  it("keeps the database unchanged when removing bytes fails, and finishes on retry", async () => {
    const a = await seedWorkspace("acme");
    await requestAt(a.organization.id, REQUESTED);
    const before = await countRows(a.organization.id);
    const broken: StoragePort = {
      ...storage,
      deletePrefix: async () => {
        throw new Error("disk unavailable");
      },
    };
    await expect(
      purgeWorkspace(
        { prisma: db(), storage: broken },
        { organizationId: a.organization.id, actor },
        NOW,
      ),
    ).rejects.toThrow("disk unavailable");
    expect(await countRows(a.organization.id)).toEqual(before);
    expect(
      (await db().organization.findUniqueOrThrow({ where: { id: a.organization.id } })).purgedAt,
    ).toBeNull();

    const result = await purgeWorkspace(
      { prisma: db(), storage },
      { organizationId: a.organization.id, actor },
      NOW,
    );
    expect(result.alreadyPurged).toBe(false);
  });

  it("rolls everything back when the database step fails, and finishes on retry", async () => {
    const a = await seedWorkspace("acme");
    await requestAt(a.organization.id, REQUESTED);
    const before = await countRows(a.organization.id);
    await db().$executeRawUnsafe(`
      CREATE FUNCTION test_fail_purge() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated failure'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_fail_purge BEFORE INSERT ON audit_logs
        FOR EACH ROW WHEN (NEW.action = 'organization.purged') EXECUTE FUNCTION test_fail_purge();`);
    try {
      await expect(
        purgeWorkspace(
          { prisma: db(), storage },
          { organizationId: a.organization.id, actor },
          NOW,
        ),
      ).rejects.toThrow(/simulated failure/);
      expect(await countRows(a.organization.id)).toEqual(before);
      expect(
        (await db().organization.findUniqueOrThrow({ where: { id: a.organization.id } })).purgedAt,
      ).toBeNull();
    } finally {
      await db().$executeRawUnsafe(
        "DROP TRIGGER test_fail_purge ON audit_logs; DROP FUNCTION test_fail_purge();",
      );
    }
    const result = await purgeWorkspace(
      { prisma: db(), storage },
      { organizationId: a.organization.id, actor },
      NOW,
    );
    expect(result.alreadyPurged).toBe(false);
  });
});
