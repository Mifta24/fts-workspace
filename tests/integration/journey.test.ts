import { beforeEach, describe, expect, it } from "vitest";
import {
  createContact,
  createDeal,
  eraseContact,
  getContactDetail,
  listContacts,
  moveDeal,
  setJourneyStage,
} from "@/features/crm/server/crm-service";
import {
  createForm,
  getForm,
  setFormStatus,
  submitPublicForm,
} from "@/features/forms/server/forms-service";
import { getInsights } from "@/features/insights/server/insights-service";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });

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
    manager: await contextFor("acme", acme.users.manager!.id),
    alice: await contextFor("acme", acme.users.alice!.id),
    bob: await contextFor("acme", acme.users.bob!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

const person = (name = "Dana Lead") => ({ name });
const history = async (context: OrganizationContext, contactId: string) =>
  (await getContactDetail(deps(), context, contactId)).journeyHistory;

describe("customer journey", () => {
  beforeEach(resetDatabase);

  it("starts every contact as a lead with a first history entry", async () => {
    const { alice } = await setup();
    const contact = await createContact(deps(), alice, person());
    expect(contact.journeyStage).toBe("LEAD");
    expect(await history(alice, contact.id)).toEqual([
      { from: null, to: "LEAD", reason: "CREATED", at: expect.any(Date) },
    ]);
  });

  it("moves a contact by hand, records it, and ignores a move to the same stage", async () => {
    const { alice } = await setup();
    const contact = await createContact(deps(), alice, person());
    await setJourneyStage(deps(), alice, contact.id, "PROSPECT");
    await setJourneyStage(deps(), alice, contact.id, "PROSPECT");
    await setJourneyStage(deps(), alice, contact.id, "CUSTOMER");
    await setJourneyStage(deps(), alice, contact.id, "LAPSED");

    const detail = await getContactDetail(deps(), alice, contact.id);
    expect(detail.contact.journeyStage).toBe("LAPSED");
    expect(detail.journeyHistory.map((h) => [h.from, h.to, h.reason]).reverse()).toEqual([
      [null, "LEAD", "CREATED"],
      ["LEAD", "PROSPECT", "MANUAL"],
      ["PROSPECT", "CUSTOMER", "MANUAL"],
      ["CUSTOMER", "LAPSED", "MANUAL"],
    ]);
    const audit = await db().auditLog.findMany({ where: { action: "crm.journey_stage_changed" } });
    expect(audit).toHaveLength(3);
    expect(audit[0]!.metadata).toEqual({ from: "LEAD", to: "PROSPECT" });
  });

  it("rejects unknown stages and respects who may see and change the contact", async () => {
    const { alice, bob, manager, viewer, globexOwner } = await setup();
    const contact = await createContact(deps(), alice, person());
    for (const stage of ["VIP", "", null, undefined, "lead"]) {
      await expectCode(setJourneyStage(deps(), alice, contact.id, stage), "INVALID_INPUT");
    }
    await expectCode(setJourneyStage(deps(), viewer, contact.id, "PROSPECT"), "FORBIDDEN");
    await expectCode(setJourneyStage(deps(), bob, contact.id, "PROSPECT"), "NOT_FOUND");
    await expectCode(setJourneyStage(deps(), globexOwner, contact.id, "PROSPECT"), "NOT_FOUND");
    await expectCode(setJourneyStage(deps(), alice, "not-an-id", "PROSPECT"), "NOT_FOUND");
    // Managers see every contact and may move it.
    await setJourneyStage(deps(), manager, contact.id, "PROSPECT");
    expect((await history(alice, contact.id))[0]).toMatchObject({
      to: "PROSPECT",
      reason: "MANUAL",
    });
  });

  describe("winning a deal", () => {
    const deal = (context: OrganizationContext, contactId: string) =>
      createDeal(deps(), context, { contactId, title: "Annual plan" });

    it("makes the contact a customer from any other stage, once", async () => {
      const { alice } = await setup();
      for (const start of ["LEAD", "PROSPECT", "LAPSED"] as const) {
        const contact = await createContact(deps(), alice, person(`From ${start}`));
        if (start !== "LEAD") await setJourneyStage(deps(), alice, contact.id, start);
        const one = await deal(alice, contact.id);
        await moveDeal(deps(), alice, one.id, "WON");
        const entries = await history(alice, contact.id);
        expect(entries[0]).toMatchObject({ from: start, to: "CUSTOMER", reason: "DEAL_WON" });

        // A second won deal changes nothing.
        const two = await deal(alice, contact.id);
        await moveDeal(deps(), alice, two.id, "WON");
        expect(await history(alice, contact.id)).toHaveLength(entries.length);
      }
    });

    it("is not triggered by other outcomes, and an erased contact stays as it is", async () => {
      const { alice, owner } = await setup();
      const lost = await createContact(deps(), alice, person("Lost"));
      await moveDeal(deps(), alice, (await deal(alice, lost.id)).id, "LOST");
      await moveDeal(deps(), alice, (await deal(alice, lost.id)).id, "NEGOTIATION");
      expect((await getContactDetail(deps(), alice, lost.id)).contact.journeyStage).toBe("LEAD");

      const gone = await createContact(deps(), alice, person("Gone"));
      const pending = await deal(alice, gone.id);
      await eraseContact(deps(), owner, gone.id);
      await moveDeal(deps(), alice, pending.id, "WON");
      expect((await getContactDetail(deps(), alice, gone.id)).contact.journeyStage).toBe("LEAD");
    });
  });

  it("keeps the history when a contact is erased, and refuses to move an erased contact", async () => {
    const { alice, owner } = await setup();
    const contact = await createContact(deps(), alice, person());
    await setJourneyStage(deps(), alice, contact.id, "PROSPECT");
    await eraseContact(deps(), owner, contact.id);
    expect(await history(alice, contact.id)).toHaveLength(2);
    await expectCode(setJourneyStage(deps(), alice, contact.id, "CUSTOMER"), "UNPROCESSABLE");
  });

  it("gives contacts created by a public form a first history entry from the form owner", async () => {
    const { manager, acme } = await setup();
    const { id } = await createForm(deps(), manager, {
      templateId: "contact_request",
      title: "Hi",
    });
    await setFormStatus(deps(), manager, id, "PUBLISHED");
    const { form } = await getForm(deps(), manager, id);
    await submitPublicForm(
      deps(),
      form.publicToken,
      { name: "Pat Visitor", email: "pat@visitor.test", message: "Hello" },
      true,
    );
    const [contact] = await listContacts(deps(), manager, "pat@visitor");
    expect(contact!.journeyStage).toBe("LEAD");
    const rows = await db().contactStageChange.findMany({ where: { contactId: contact!.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: acme.organization.id,
      fromStage: null,
      toStage: "LEAD",
      reason: "CREATED",
      changedById: manager.userId,
    });
  });

  it("filters the contact list by stage within the caller's own contacts", async () => {
    const { alice, bob, manager } = await setup();
    const a = await createContact(deps(), alice, person("Alice's customer"));
    await createContact(deps(), alice, person("Alice's lead"));
    const b = await createContact(deps(), bob, person("Bob's customer"));
    await setJourneyStage(deps(), alice, a.id, "CUSTOMER");
    await setJourneyStage(deps(), bob, b.id, "CUSTOMER");

    const names = async (context: OrganizationContext, stage: unknown) =>
      (await listContacts(deps(), context, "", { stage })).map((c) => c.name).sort();
    expect(await names(alice, "CUSTOMER")).toEqual(["Alice's customer"]);
    expect(await names(manager, "CUSTOMER")).toEqual(["Alice's customer", "Bob's customer"]);
    expect(await names(alice, "LEAD")).toEqual(["Alice's lead"]);
    // Anything that is not a stage means no filter.
    expect(await names(alice, "nonsense")).toHaveLength(2);
    expect(await names(alice, undefined)).toHaveLength(2);
  });

  describe("database rules", () => {
    it("rejects edits and deletes of history, and entries that are not a change", async () => {
      const { alice, acme } = await setup();
      const contact = await createContact(deps(), alice, person());
      const entry = await db().contactStageChange.findFirstOrThrow({
        where: { contactId: contact.id },
      });
      await expect(
        db().contactStageChange.update({ where: { id: entry.id }, data: { toStage: "CUSTOMER" } }),
      ).rejects.toThrow(/append-only/);
      await expect(db().contactStageChange.delete({ where: { id: entry.id } })).rejects.toThrow(
        /append-only/,
      );
      const base = {
        organizationId: acme.organization.id,
        contactId: contact.id,
        changedById: alice.userId,
      };
      await expect(
        db().contactStageChange.create({
          data: { ...base, fromStage: "LEAD", toStage: "LEAD", reason: "MANUAL" },
        }),
      ).rejects.toThrow();
      await expect(
        db().contactStageChange.create({
          data: { ...base, fromStage: null, toStage: "LEAD", reason: "MANUAL" },
        }),
      ).rejects.toThrow();
    });

    it("rejects history that points at another organization's contact", async () => {
      const { alice, globexOwner } = await setup();
      const foreign = await createContact(deps(), globexOwner, person("Foreign"));
      await expect(
        db().contactStageChange.create({
          data: {
            organizationId: (await db().organization.findFirstOrThrow({ where: { slug: "acme" } }))
              .id,
            contactId: foreign.id,
            fromStage: null,
            toStage: "LEAD",
            reason: "CREATED",
            changedById: alice.userId,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe("insights", () => {
    it("counts contacts per stage and those who became customers in the period", async () => {
      const { alice, bob, manager, owner } = await setup();
      const a = await createContact(deps(), alice, person("Contact A"));
      const b = await createContact(deps(), alice, person("Contact B"));
      const c = await createContact(deps(), bob, person("Contact C"));
      const gone = await createContact(deps(), alice, person("Erased"));
      await setJourneyStage(deps(), alice, a.id, "CUSTOMER");
      await setJourneyStage(deps(), alice, a.id, "LAPSED");
      await setJourneyStage(deps(), alice, a.id, "CUSTOMER"); // twice, but one contact
      await setJourneyStage(deps(), alice, b.id, "PROSPECT");
      await setJourneyStage(deps(), bob, c.id, "CUSTOMER");
      await setJourneyStage(deps(), alice, gone.id, "PROSPECT");
      await eraseContact(deps(), owner, gone.id);

      const now = new Date(Date.now() + 1000); // after every change above
      const all = (await getInsights(deps(), manager, 30, now)).contacts!;
      expect(all.journey).toEqual({ LEAD: 0, PROSPECT: 1, CUSTOMER: 2, LAPSED: 0 });
      expect(all.becameCustomers).toBe(2);
      const mine = (await getInsights(deps(), alice, 30, now)).contacts!;
      expect(mine.journey).toEqual({ LEAD: 0, PROSPECT: 1, CUSTOMER: 1, LAPSED: 0 });
      expect(mine.becameCustomers).toBe(1);
      // Outside the period nothing became a customer.
      const later = new Date(now.getTime() + 60 * 86_400_000);
      expect((await getInsights(deps(), manager, 30, later)).contacts!.becameCustomers).toBe(0);
    });

    it("never counts another organization's contacts", async () => {
      const { manager, globexOwner } = await setup();
      const foreign = await createContact(deps(), globexOwner, person("Foreign"));
      await setJourneyStage(deps(), globexOwner, foreign.id, "CUSTOMER");
      const { contacts } = await getInsights(deps(), manager, 30, new Date());
      expect(contacts!.journey).toEqual({ LEAD: 0, PROSPECT: 0, CUSTOMER: 0, LAPSED: 0 });
      expect(contacts!.becameCustomers).toBe(0);
    });
  });
});
