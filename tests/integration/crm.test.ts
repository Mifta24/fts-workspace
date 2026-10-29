import { beforeEach, describe, expect, it } from "vitest";
import {
  addActivity,
  createContact,
  createDeal,
  eraseContact,
  getContactDetail,
  listContacts,
  listDeals,
  moveDeal,
  pipelineReport,
  recordConsent,
  updateContact,
} from "@/features/crm/server/crm-service";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });
const DAY = 86_400_000;

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
    alice: "MEMBER",
    bob: "MEMBER",
    viewer: "VIEWER",
  });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    owner: await contextFor("acme", acme.users.owner!.id),
    admin: await contextFor("acme", acme.users.admin!.id),
    manager: await contextFor("acme", acme.users.manager!.id),
    alice: await contextFor("acme", acme.users.alice!.id),
    bob: await contextFor("acme", acme.users.bob!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

const person = (overrides: Record<string, unknown> = {}) => ({
  name: "Dana Customer",
  email: "Dana@Customer.test",
  phone: "+1 555 0100",
  company: "Customer Inc",
  ...overrides,
});

describe("crm contacts", () => {
  beforeEach(resetDatabase);

  it("creates contacts owned by the creator, normalizes email and keeps PII out of the audit trail", async () => {
    const { alice } = await setup();
    const contact = await createContact(deps(), alice, person());
    expect(contact).toMatchObject({
      name: "Dana Customer",
      email: "dana@customer.test",
      ownerId: alice.userId,
      consentStatus: "UNKNOWN",
      mine: true,
      erased: false,
    });
    const audit = await db().auditLog.findFirstOrThrow({
      where: { action: "crm.contact_created" },
    });
    expect(JSON.stringify(audit)).not.toMatch(/dana|customer|555/i);
  });

  it("validates input and rejects duplicate emails within the organization", async () => {
    const { alice, bob, globexOwner } = await setup();
    await expectCode(createContact(deps(), alice, person({ name: "x" })), "INVALID_INPUT");
    await expectCode(createContact(deps(), alice, person({ email: "nope" })), "INVALID_INPUT");
    await expectCode(createContact(deps(), alice, person({ phone: "call me" })), "INVALID_INPUT");
    await createContact(deps(), alice, person());
    await expectCode(
      createContact(deps(), bob, person({ email: "DANA@customer.test" })),
      "CONFLICT",
    );
    // The same address in another organization is a different contact.
    await expect(createContact(deps(), globexOwner, person())).resolves.toBeDefined();
  });

  it("members see only their own contacts; managers and above see all; viewers none", async () => {
    const { alice, bob, manager, admin, viewer, owner } = await setup();
    await createContact(deps(), alice, person({ name: "Alice's contact", email: "a@x.test" }));
    await createContact(deps(), bob, person({ name: "Bob's contact", email: "b@x.test" }));
    const names = async (context: OrganizationContext) =>
      (await listContacts(deps(), context)).map((c) => c.name);
    expect(await names(alice)).toEqual(["Alice's contact"]);
    expect(await names(bob)).toEqual(["Bob's contact"]);
    for (const context of [manager, admin, owner])
      expect(await names(context)).toEqual(["Alice's contact", "Bob's contact"]);
    await expectCode(listContacts(deps(), viewer), "FORBIDDEN");
    await expectCode(createContact(deps(), viewer, person()), "FORBIDDEN");
  });

  it("hides other members' contacts completely (detail, update, consent, deals, activities)", async () => {
    const { alice, bob } = await setup();
    const contact = await createContact(deps(), alice, person());
    await expectCode(getContactDetail(deps(), bob, contact.id), "NOT_FOUND");
    await expectCode(updateContact(deps(), bob, contact.id, { name: "Hijacked" }), "NOT_FOUND");
    await expectCode(
      recordConsent(deps(), bob, contact.id, { status: "GRANTED", source: "verbal" }),
      "NOT_FOUND",
    );
    await expectCode(
      createDeal(deps(), bob, { contactId: contact.id, title: "Steal" }),
      "NOT_FOUND",
    );
    await expectCode(
      addActivity(deps(), bob, { contactId: contact.id, type: "NOTE", body: "x" }),
      "NOT_FOUND",
    );
    expect((await getContactDetail(deps(), alice, contact.id)).contact.name).toBe("Dana Customer");
  });

  it("restricts owner assignment to managers, and the owner must be an active member", async () => {
    const { alice, manager, acme, globexOwner } = await setup();
    await expectCode(
      createContact(deps(), alice, person({ ownerId: manager.userId })),
      "FORBIDDEN",
    );
    const contact = await createContact(deps(), manager, person({ ownerId: alice.userId }));
    expect(contact.ownerId).toBe(alice.userId);
    await expectCode(
      createContact(deps(), manager, person({ email: "o@x.test", ownerId: globexOwner.userId })),
      "UNPROCESSABLE",
    );
    await expectCode(
      updateContact(deps(), alice, contact.id, { ownerId: alice.userId }),
      "FORBIDDEN",
    );
    const reassigned = await updateContact(deps(), manager, contact.id, {
      ownerId: manager.userId,
    });
    expect(reassigned.ownerId).toBe(manager.userId);
    expect(acme.organization.id).toBeTruthy();
  });

  it("updates and clears optional fields", async () => {
    const { alice } = await setup();
    const contact = await createContact(deps(), alice, person());
    const updated = await updateContact(deps(), alice, contact.id, {
      company: "",
      phone: "",
      name: "Dana C.",
    });
    expect(updated).toMatchObject({
      company: null,
      phone: null,
      name: "Dana C.",
      email: "dana@customer.test",
    });
  });

  it("searches name, email and company without treating input as a pattern", async () => {
    const { alice } = await setup();
    await createContact(
      deps(),
      alice,
      person({ name: "Zed Zero", email: "zed@acme-co.test", company: "Zeta Ltd" }),
    );
    await createContact(
      deps(),
      alice,
      person({ name: "Other", email: "other@x.test", company: null }),
    );
    const find = async (q: string) => (await listContacts(deps(), alice, q)).map((c) => c.name);
    expect(await find("zed")).toEqual(["Zed Zero"]);
    expect(await find("ZETA")).toEqual(["Zed Zero"]);
    expect(await find("acme-co")).toEqual(["Zed Zero"]);
    expect(await find("%")).toEqual([]);
    expect(await find("' OR 1=1 --")).toEqual([]);
  });
});

describe("consent", () => {
  beforeEach(resetDatabase);

  it("records every decision with its basis and keeps an append-only history", async () => {
    const { alice } = await setup();
    await expectCode(
      createContact(deps(), alice, person({ consentStatus: "GRANTED" })),
      "INVALID_INPUT",
    );
    const contact = await createContact(
      deps(),
      alice,
      person({ consentStatus: "GRANTED", consentSource: "signed form" }),
    );
    expect(contact.consentStatus).toBe("GRANTED");

    await expectCode(
      recordConsent(deps(), alice, contact.id, { status: "WITHDRAWN", source: "" }),
      "INVALID_INPUT",
    );
    await expectCode(
      recordConsent(deps(), alice, contact.id, { status: "UNKNOWN", source: "reset" }),
      "INVALID_INPUT",
    );
    await recordConsent(deps(), alice, contact.id, { status: "WITHDRAWN", source: "email reply" });

    const detail = await getContactDetail(deps(), alice, contact.id);
    expect(detail.contact.consentStatus).toBe("WITHDRAWN");
    expect(detail.consentHistory.map((e) => [e.status, e.source])).toEqual([
      ["WITHDRAWN", "email reply"],
      ["GRANTED", "signed form"],
    ]);
    await expect(db().consentEvent.updateMany({ data: { source: "forged" } })).rejects.toThrow();
    await expect(db().consentEvent.deleteMany({})).rejects.toThrow();
  });
});

describe("erasure", () => {
  beforeEach(resetDatabase);

  it("is refused to everyone below admin", async () => {
    const { alice, manager } = await setup();
    const contact = await createContact(deps(), alice, person());
    await expectCode(eraseContact(deps(), alice, contact.id), "FORBIDDEN");
    await expectCode(eraseContact(deps(), manager, contact.id), "FORBIDDEN");
    expect(
      (await db().crmContact.findUniqueOrThrow({ where: { id: contact.id } })).erasedAt,
    ).toBeNull();
  });

  it("is performed by owners and admins, is idempotent and final", async () => {
    const { alice, owner } = await setup();
    const contact = await createContact(
      deps(),
      alice,
      person({ consentStatus: "GRANTED", consentSource: "web form" }),
    );
    const deal = await createDeal(deps(), alice, {
      contactId: contact.id,
      title: "Annual plan",
      amount: 1200,
    });
    await addActivity(deps(), alice, {
      contactId: contact.id,
      type: "NOTE",
      body: "Prefers calls after 5pm",
    });

    await eraseContact(deps(), owner, contact.id);
    await eraseContact(deps(), owner, contact.id);
    const row = await db().crmContact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(row).toMatchObject({ name: "Erased contact", email: null, phone: null, company: null });
    expect(row.erasedAt).not.toBeNull();
    expect((await db().crmActivity.findFirstOrThrow()).body).toBe("");
    expect(await db().consentEvent.count()).toBe(1);
    expect((await listDeals(deps(), owner))[0]).toMatchObject({
      id: deal.id,
      contactName: "Erased contact",
    });
    expect(await db().auditLog.count({ where: { action: "crm.contact_erased" } })).toBe(1);

    await expectCode(
      updateContact(deps(), owner, contact.id, { name: "Back again" }),
      "UNPROCESSABLE",
    );
    await expectCode(
      recordConsent(deps(), owner, contact.id, { status: "GRANTED", source: "again" }),
      "UNPROCESSABLE",
    );
    await expectCode(
      createDeal(deps(), owner, { contactId: contact.id, title: "New" }),
      "UNPROCESSABLE",
    );
    await expectCode(
      addActivity(deps(), owner, { contactId: contact.id, type: "NOTE", body: "x" }),
      "UNPROCESSABLE",
    );
    // The address can be used for a new contact.
    await expect(createContact(deps(), alice, person())).resolves.toBeDefined();
    // The database refuses to hold personal data on an erased row.
    await expect(
      db().crmContact.update({ where: { id: contact.id }, data: { email: "back@x.test" } }),
    ).rejects.toThrow();
  });
});

describe("deals, activities and the pipeline report", () => {
  beforeEach(resetDatabase);

  it("moves deals through stages with a consistent closing time", async () => {
    const { alice } = await setup();
    const contact = await createContact(deps(), alice, person());
    const deal = await createDeal(deps(), alice, {
      contactId: contact.id,
      title: "Plan",
      amount: "49.90",
      currency: "eur",
    });
    expect(deal).toMatchObject({
      stage: "LEAD",
      amountMinor: 4990,
      currency: "EUR",
      closedAt: null,
    });

    const now = new Date();
    expect((await moveDeal(deps(), alice, deal.id, "WON", now)).closedAt).toEqual(now);
    expect((await moveDeal(deps(), alice, deal.id, "NEGOTIATION")).closedAt).toBeNull();
    await expectCode(moveDeal(deps(), alice, deal.id, "SOLD"), "INVALID_INPUT");
    await expect(
      db().crmDeal.update({ where: { id: deal.id }, data: { stage: "WON", closedAt: null } }),
    ).rejects.toThrow();
    const audit = await db().auditLog.findMany({
      where: { action: "crm.deal_stage_changed" },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => a.metadata)).toEqual([
      { from: "LEAD", to: "WON" },
      { from: "WON", to: "NEGOTIATION" },
    ]);
  });

  it("validates deal input and sees only deals of accessible contacts", async () => {
    const { alice, bob, manager } = await setup();
    const contact = await createContact(deps(), alice, person());
    await expectCode(
      createDeal(deps(), alice, { contactId: contact.id, title: "x" }),
      "INVALID_INPUT",
    );
    await expectCode(
      createDeal(deps(), alice, { contactId: contact.id, title: "Deal", amount: -5 }),
      "INVALID_INPUT",
    );
    await expectCode(
      createDeal(deps(), alice, { contactId: contact.id, title: "Deal", currency: "DOLLARS" }),
      "INVALID_INPUT",
    );
    const deal = await createDeal(deps(), alice, { contactId: contact.id, title: "Deal" });
    expect((await listDeals(deps(), manager)).map((d) => d.id)).toEqual([deal.id]);
    expect(await listDeals(deps(), bob)).toEqual([]);
    await expectCode(moveDeal(deps(), bob, deal.id, "WON"), "NOT_FOUND");
  });

  it("attaches activities to the right deal only", async () => {
    const { alice } = await setup();
    const one = await createContact(deps(), alice, person({ email: "one@x.test" }));
    const two = await createContact(deps(), alice, person({ email: "two@x.test" }));
    const deal = await createDeal(deps(), alice, { contactId: one.id, title: "Deal" });
    await addActivity(deps(), alice, {
      contactId: one.id,
      dealId: deal.id,
      type: "CALL",
      body: "Intro call",
    });
    await expectCode(
      addActivity(deps(), alice, { contactId: two.id, dealId: deal.id, type: "NOTE", body: "x" }),
      "UNPROCESSABLE",
    );
    await expectCode(
      addActivity(deps(), alice, { contactId: one.id, type: "SMS", body: "x" }),
      "INVALID_INPUT",
    );
    await expectCode(
      addActivity(deps(), alice, { contactId: one.id, type: "NOTE", body: "   " }),
      "INVALID_INPUT",
    );
    const detail = await getContactDetail(deps(), alice, one.id);
    expect(detail.activities).toMatchObject([
      { type: "CALL", body: "Intro call", dealId: deal.id, authorName: "Test acme-alice" },
    ]);
    const audit = await db().auditLog.findFirstOrThrow({ where: { action: "crm.activity_added" } });
    expect(JSON.stringify(audit)).not.toContain("Intro call");
  });

  it("reports open value per stage and currency, won totals and win rate for the period", async () => {
    const { alice, bob, manager } = await setup();
    const a = await createContact(deps(), alice, person({ email: "a@x.test" }));
    const b = await createContact(deps(), bob, person({ email: "b@x.test" }));
    const mk = (
      context: OrganizationContext,
      contactId: string,
      title: string,
      amount: number,
      currency = "USD",
    ) => createDeal(deps(), context, { contactId, title, amount, currency });
    const d1 = await mk(alice, a.id, "One", 100);
    await mk(alice, a.id, "Two", 50, "EUR");
    const d3 = await mk(alice, a.id, "Three", 300);
    const d4 = await mk(bob, b.id, "Four", 1000);
    const d5 = await mk(bob, b.id, "Five", 10);
    await moveDeal(deps(), alice, d1.id, "QUALIFIED");
    await moveDeal(deps(), alice, d3.id, "WON");
    await moveDeal(deps(), bob, d4.id, "WON");
    await moveDeal(deps(), bob, d5.id, "LOST");

    const all = await pipelineReport(deps(), manager);
    expect(all.stages.find((s) => s.stage === "LEAD")).toEqual({
      stage: "LEAD",
      count: 1,
      value: { EUR: 5000 },
    });
    expect(all.stages.find((s) => s.stage === "QUALIFIED")).toEqual({
      stage: "QUALIFIED",
      count: 1,
      value: { USD: 10000 },
    });
    expect(all.won).toEqual({ count: 2, value: { USD: 130000 } });
    expect(all.lost.count).toBe(1);
    expect(all.winRatePercent).toBe(67);

    // A member's report covers only what they can see.
    const mine = await pipelineReport(deps(), alice);
    expect(mine.won).toEqual({ count: 1, value: { USD: 30000 } });
    expect(mine.lost.count).toBe(0);
    expect(mine.winRatePercent).toBe(100);

    // Deals closed before the period are excluded.
    await db().crmDeal.update({
      where: { id: d3.id },
      data: { closedAt: new Date(Date.now() - 200 * DAY) },
    });
    expect((await pipelineReport(deps(), manager, 90)).won.count).toBe(1);
    expect((await pipelineReport(deps(), manager, 365)).won.count).toBe(2);
    expect((await pipelineReport(deps(), manager, 1)).winRatePercent).toBe(50);
  });

  it("returns an empty, well-formed report and a null win rate when nothing closed", async () => {
    const { manager } = await setup();
    const report = await pipelineReport(deps(), manager);
    expect(report.stages.map((s) => s.count)).toEqual([0, 0, 0, 0]);
    expect(report).toMatchObject({
      won: { count: 0, value: {} },
      lost: { count: 0 },
      winRatePercent: null,
    });
  });

  describe("tenant isolation", () => {
    it("never exposes another organization's CRM data, and the database enforces it", async () => {
      const { alice, globexOwner, acme } = await setup();
      const foreign = await createContact(deps(), globexOwner, person({ email: "g@x.test" }));
      const foreignDeal = await createDeal(deps(), globexOwner, {
        contactId: foreign.id,
        title: "Globex deal",
      });

      expect(await listContacts(deps(), alice)).toEqual([]);
      expect(await listDeals(deps(), alice)).toEqual([]);
      await expectCode(getContactDetail(deps(), alice, foreign.id), "NOT_FOUND");
      await expectCode(moveDeal(deps(), alice, foreignDeal.id, "WON"), "NOT_FOUND");
      await expectCode(
        createDeal(deps(), alice, { contactId: foreign.id, title: "Cross" }),
        "NOT_FOUND",
      );
      expect((await pipelineReport(deps(), alice)).stages.every((s) => s.count === 0)).toBe(true);
      await expect(
        db().crmDeal.create({
          data: {
            organizationId: acme.organization.id,
            contactId: foreign.id,
            title: "Cross",
            ownerId: alice.userId,
            createdById: alice.userId,
          },
        }),
      ).rejects.toThrow();
    });
  });
});
