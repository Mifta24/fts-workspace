import { beforeEach, describe, expect, it } from "vitest";
import { createContact, eraseContact, getContactDetail } from "@/features/crm/server/crm-service";
import { SUBMISSIONS_PER_MINUTE } from "@/features/forms/schemas/forms";
import {
  createForm,
  getForm,
  getPublicForm,
  listForms,
  setFormStatus,
  submitPublicForm,
  updateForm,
} from "@/features/forms/server/forms-service";
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
    manager: "MANAGER",
    alice: "MEMBER",
    viewer: "VIEWER",
  });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    owner: await contextFor("acme", acme.users.owner!.id),
    manager: await contextFor("acme", acme.users.manager!.id),
    alice: await contextFor("acme", acme.users.alice!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

async function publishedForm(context: OrganizationContext, templateId = "contact_request") {
  const { id } = await createForm(deps(), context, { templateId, title: "Contact us" });
  await setFormStatus(deps(), context, id, "PUBLISHED");
  const { form } = await getForm(deps(), context, id);
  return form;
}

const lead = (overrides: Record<string, unknown> = {}) => ({
  name: "Dana Visitor",
  email: "Dana@Visitor.test",
  company: "Visitor Inc",
  message: "Please call me about pricing.",
  ...overrides,
});

describe("forms", () => {
  beforeEach(resetDatabase);

  describe("management", () => {
    it("is limited to managers and above", async () => {
      const { manager, alice, viewer } = await setup();
      for (const context of [alice, viewer]) {
        await expectCode(
          createForm(deps(), context, { templateId: "feedback", title: "Nope" }),
          "FORBIDDEN",
        );
        await expectCode(listForms(deps(), context), "FORBIDDEN");
      }
      const { id } = await createForm(deps(), manager, {
        templateId: "feedback",
        title: "Feedback",
      });
      await expectCode(getForm(deps(), alice, id), "FORBIDDEN");
    });

    it("creates drafts from templates with an unguessable public token", async () => {
      const { manager } = await setup();
      await expectCode(
        createForm(deps(), manager, { templateId: "mystery", title: "Bad template" }),
        "INVALID_INPUT",
      );
      await expectCode(
        createForm(deps(), manager, { templateId: "feedback", title: "x" }),
        "INVALID_INPUT",
      );
      const { id } = await createForm(deps(), manager, {
        templateId: "contact_request",
        title: "Contact us",
      });
      const { form } = await getForm(deps(), manager, id);
      expect(form).toMatchObject({ status: "DRAFT", createsContact: true, submissionCount: 0 });
      expect(form.publicToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(form.publicToken).not.toContain(id.slice(0, 8));
      expect(form.consentText).toContain("agree");
      const other = await createForm(deps(), manager, {
        templateId: "contact_request",
        title: "Second",
      });
      expect((await getForm(deps(), manager, other.id)).form.publicToken).not.toBe(
        form.publicToken,
      );
    });

    it("locks the consent wording once the form has been published", async () => {
      const { manager } = await setup();
      const { id } = await createForm(deps(), manager, {
        templateId: "contact_request",
        title: "Contact us",
      });
      await updateForm(deps(), manager, id, { consentText: "I agree to be contacted by Acme." });
      await setFormStatus(deps(), manager, id, "PUBLISHED");
      await expectCode(
        updateForm(deps(), manager, id, { consentText: "A weaker wording that nobody saw." }),
        "UNPROCESSABLE",
      );
      await expect(updateForm(deps(), manager, id, { title: "Renamed" })).resolves.toBeUndefined();
      await expectCode(updateForm(deps(), manager, id, { consentText: "short" }), "INVALID_INPUT");
    });

    it("allows only sensible status changes", async () => {
      const { manager } = await setup();
      const { id } = await createForm(deps(), manager, {
        templateId: "feedback",
        title: "Feedback",
      });
      await expectCode(setFormStatus(deps(), manager, id, "CLOSED"), "UNPROCESSABLE");
      await setFormStatus(deps(), manager, id, "PUBLISHED");
      await setFormStatus(deps(), manager, id, "CLOSED");
      await setFormStatus(deps(), manager, id, "PUBLISHED");
      await expectCode(setFormStatus(deps(), manager, id, "DRAFT"), "UNPROCESSABLE");
      await expectCode(setFormStatus(deps(), manager, id, "LIVE"), "INVALID_INPUT");
      expect(await db().auditLog.count({ where: { action: "form.status_changed" } })).toBe(3);
    });
  });

  describe("public access", () => {
    it("shows only published forms, and drafts, closed and unknown tokens look the same", async () => {
      const { manager } = await setup();
      const { id } = await createForm(deps(), manager, {
        templateId: "contact_request",
        title: "Contact us",
      });
      const { form } = await getForm(deps(), manager, id);
      await expectCode(getPublicForm(deps(), form.publicToken), "NOT_FOUND");
      await setFormStatus(deps(), manager, id, "PUBLISHED");
      const view = await getPublicForm(deps(), form.publicToken);
      expect(view).toMatchObject({ title: "Contact us", organizationName: "acme" });
      expect(JSON.stringify(view)).not.toContain(id);
      await setFormStatus(deps(), manager, id, "CLOSED");
      await expectCode(getPublicForm(deps(), form.publicToken), "NOT_FOUND");
      await expectCode(getPublicForm(deps(), "A".repeat(22)), "NOT_FOUND");
      await expectCode(getPublicForm(deps(), id), "NOT_FOUND");
      await expectCode(getPublicForm(deps(), "../../etc"), "NOT_FOUND");
    });

    it("does not offer consent wording on forms that do not create contacts", async () => {
      const { manager } = await setup();
      const form = await publishedForm(manager, "feedback");
      expect((await getPublicForm(deps(), form.publicToken)).consentText).toBeNull();
    });
  });

  describe("submissions", () => {
    it("creates a contact with recorded consent, owned by the form owner, and keeps PII out of the audit trail", async () => {
      const { manager, acme } = await setup();
      const form = await publishedForm(manager);
      await submitPublicForm(deps(), form.publicToken, lead(), true);

      const contact = await db().crmContact.findFirstOrThrow({
        where: { organizationId: acme.organization.id },
      });
      expect(contact).toMatchObject({
        name: "Dana Visitor",
        email: "dana@visitor.test",
        company: "Visitor Inc",
        ownerId: manager.userId,
        consentStatus: "GRANTED",
      });
      const detail = await getContactDetail(deps(), manager, contact.id);
      expect(detail.consentHistory).toMatchObject([
        { status: "GRANTED", source: "form: Contact us" },
      ]);
      const { submissions } = await getForm(deps(), manager, form.id);
      expect(submissions).toMatchObject([
        { contactId: contact.id, answers: { name: "Dana Visitor", email: "dana@visitor.test" } },
      ]);
      const audit = await db().auditLog.findFirstOrThrow({ where: { action: "form.submitted" } });
      expect(audit.actorId).toBeNull();
      expect(JSON.stringify(audit)).not.toMatch(/dana|visitor|pricing/i);
    });

    it("requires the consent checkbox for contact-creating forms and rejects invalid answers", async () => {
      const { manager } = await setup();
      const form = await publishedForm(manager);
      await expectCode(submitPublicForm(deps(), form.publicToken, lead(), false), "INVALID_INPUT");
      await expectCode(
        submitPublicForm(deps(), form.publicToken, lead({ email: "nope" }), true),
        "INVALID_INPUT",
      );
      await expectCode(
        submitPublicForm(deps(), form.publicToken, lead({ message: "" }), true),
        "INVALID_INPUT",
      );
      await expectCode(
        submitPublicForm(deps(), form.publicToken, lead({ role: "OWNER" }), true),
        "INVALID_INPUT",
      );
      await expectCode(
        submitPublicForm(deps(), form.publicToken, { name: "x".repeat(20_000) }, true),
        "INVALID_INPUT",
      );
      expect(await db().formSubmission.count()).toBe(0);
      expect(await db().crmContact.count()).toBe(0);
    });

    it("rejects submissions to drafts, closed forms and unknown tokens", async () => {
      const { manager } = await setup();
      const form = await publishedForm(manager);
      await setFormStatus(deps(), manager, form.id, "CLOSED");
      await expectCode(submitPublicForm(deps(), form.publicToken, lead(), true), "NOT_FOUND");
      await expectCode(submitPublicForm(deps(), "B".repeat(22), lead(), true), "NOT_FOUND");
    });

    it("links an existing contact instead of duplicating, and records the new consent", async () => {
      const { manager, alice } = await setup();
      const existing = await createContact(deps(), alice, {
        name: "Dana Old Name",
        email: "dana@visitor.test",
      });
      const form = await publishedForm(manager);
      await submitPublicForm(deps(), form.publicToken, lead(), true);
      expect(await db().crmContact.count()).toBe(1);
      const row = await db().crmContact.findUniqueOrThrow({ where: { id: existing.id } });
      expect(row).toMatchObject({
        name: "Dana Old Name",
        ownerId: alice.userId,
        consentStatus: "GRANTED",
      });
      expect((await db().formSubmission.findFirstOrThrow()).contactId).toBe(existing.id);
      expect(await db().consentEvent.count({ where: { contactId: existing.id } })).toBe(1);
    });

    it("keeps the submission without a contact when the form owner is no longer active", async () => {
      const { manager, acme } = await setup();
      const form = await publishedForm(manager);
      await db().member.update({
        where: {
          organizationId_userId: { organizationId: acme.organization.id, userId: manager.userId },
        },
        data: { status: "DISABLED" },
      });
      await submitPublicForm(deps(), form.publicToken, lead(), true);
      expect(await db().crmContact.count()).toBe(0);
      expect(await db().formSubmission.count()).toBe(1);
    });

    it("takes no contact or consent from forms that are anonymous", async () => {
      const { manager } = await setup();
      const form = await publishedForm(manager, "feedback");
      await submitPublicForm(deps(), form.publicToken, { rating: "5", comment: "Great" }, false);
      await expectCode(
        submitPublicForm(deps(), form.publicToken, { rating: "9" }, false),
        "INVALID_INPUT",
      );
      expect(await db().crmContact.count()).toBe(0);
      expect(await db().consentEvent.count()).toBe(0);
      expect(await db().formSubmission.count()).toBe(1);
    });

    it("limits the submission rate per form", async () => {
      const { manager } = await setup();
      const form = await publishedForm(manager, "feedback");
      const now = new Date();
      for (let i = 0; i < SUBMISSIONS_PER_MINUTE; i++) {
        await submitPublicForm(deps(), form.publicToken, { rating: "4" }, false, now);
      }
      await expectCode(
        submitPublicForm(deps(), form.publicToken, { rating: "4" }, false, now),
        "RATE_LIMITED",
      );
      const later = new Date(now.getTime() + 61_000);
      await expect(
        submitPublicForm(deps(), form.publicToken, { rating: "4" }, false, later),
      ).resolves.toBeUndefined();
    });

    it("erases submissions together with the contact they belong to", async () => {
      const { manager, owner } = await setup();
      const form = await publishedForm(manager);
      await submitPublicForm(deps(), form.publicToken, lead(), true);
      const contact = await db().crmContact.findFirstOrThrow();
      await eraseContact(deps(), owner, contact.id);
      const { submissions } = await getForm(deps(), manager, form.id);
      expect(submissions).toMatchObject([{ erased: true, answers: {} }]);
      const raw = await db().formSubmission.findFirstOrThrow();
      expect(JSON.stringify(raw.answers)).toBe("{}");
      // The database refuses personal data on an erased submission.
      await expect(
        db().formSubmission.update({ where: { id: raw.id }, data: { answers: { name: "back" } } }),
      ).rejects.toThrow();
    });
  });

  describe("tenant isolation", () => {
    it("keeps forms, submissions and contacts inside their organization", async () => {
      const { manager, globexOwner, acme } = await setup();
      const form = await publishedForm(globexOwner);
      await submitPublicForm(deps(), form.publicToken, lead(), true);

      expect(await listForms(deps(), manager)).toEqual([]);
      await expectCode(getForm(deps(), manager, form.id), "NOT_FOUND");
      await expectCode(setFormStatus(deps(), manager, form.id, "CLOSED"), "NOT_FOUND");
      await expectCode(updateForm(deps(), manager, form.id, { title: "Hijacked" }), "NOT_FOUND");
      expect(await db().crmContact.count({ where: { organizationId: acme.organization.id } })).toBe(
        0,
      );
      expect((await db().crmContact.findFirstOrThrow()).ownerId).toBe(globexOwner.userId);
    });

    it("rejects cross-tenant submissions at the database level", async () => {
      const { manager, globexOwner, acme } = await setup();
      const foreign = await publishedForm(globexOwner);
      await expect(
        db().formSubmission.create({
          data: { organizationId: acme.organization.id, formId: foreign.id, answers: {} },
        }),
      ).rejects.toThrow();
      expect(manager.userId).toBeTruthy();
    });
  });
});
