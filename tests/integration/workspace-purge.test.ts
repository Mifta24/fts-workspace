import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
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
