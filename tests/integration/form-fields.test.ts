import { beforeEach, describe, expect, it } from "vitest";
import { MAX_FIELDS } from "@/features/forms/schemas/forms";
import {
  createForm,
  getForm,
  setFormStatus,
  submitPublicForm,
  updateFormFields,
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
    manager: await contextFor("acme", acme.users.manager!.id),
    alice: await contextFor("acme", acme.users.alice!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

const make = async (context: OrganizationContext, templateId: string, extra = {}) => {
  const { id } = await createForm(deps(), context, { templateId, title: "A form", ...extra });
  return id;
};
const fieldsOf = async (context: OrganizationContext, id: string) =>
  (await getForm(deps(), context, id)).form.fields;

/** The editor's view of stored fields: same keys, so they count as existing fields. */
const asInput = (fields: Awaited<ReturnType<typeof fieldsOf>>) =>
  fields.map((field) => ({ ...field }));

describe("form languages", () => {
  beforeEach(resetDatabase);

  it("copies labels and consent wording in the chosen language, English by default", async () => {
    const { manager } = await setup();
    const english = await make(manager, "contact_request");
    const japanese = await make(manager, "contact_request", { locale: "ja" });
    const indonesian = await make(manager, "event_signup", { locale: "id" });

    expect((await fieldsOf(manager, english)).map((f) => f.label)).toContain("Your name");
    expect((await fieldsOf(manager, japanese)).map((f) => f.label)).toEqual([
      "お名前",
      "メールアドレス",
      "会社名",
      "ご用件をお聞かせください",
    ]);
    const { form } = await getForm(deps(), manager, japanese);
    expect(form.consentText).toMatch(/同意します/);
    expect((await getForm(deps(), manager, indonesian)).form.consentText).toMatch(/Saya setuju/);
    // Keys never change with the language, so the contact mapping keeps working.
    expect((await fieldsOf(manager, japanese)).map((f) => f.key)).toEqual(
      (await fieldsOf(manager, english)).map((f) => f.key),
    );
  });

  it("rejects languages that are not offered, and an own consent text still wins", async () => {
    const { manager } = await setup();
    await expectCode(
      createForm(deps(), manager, { templateId: "feedback", title: "Hi", locale: "fr" }),
      "INVALID_INPUT",
    );
    const id = await make(manager, "contact_request", {
      locale: "ja",
      consentText: "Custom consent wording for this form.",
    });
    expect((await getForm(deps(), manager, id)).form.consentText).toBe(
      "Custom consent wording for this form.",
    );
  });
});

describe("editing fields", () => {
  beforeEach(resetDatabase);

  it("lets a draft be rebuilt: add, remove, reorder and retype, with keys chosen by the server", async () => {
    const { manager } = await setup();
    const id = await make(manager, "feedback");
    const [rating, comment] = await fieldsOf(manager, id);
    await updateFormFields(deps(), manager, id, [
      { ...comment },
      {
        key: rating!.key,
        label: "Rate us",
        type: "select",
        required: true,
        options: ["Good", "Bad"],
      },
      { label: "Job title", type: "text", required: false },
      { label: "電話", type: "phone", required: false },
      { label: "好きな色", type: "text", required: false },
      { label: "Job title", type: "text", required: false },
    ]);
    const fields = await fieldsOf(manager, id);
    expect(fields.map((f) => f.key)).toEqual([
      "comment",
      "rating",
      "job_title",
      "phone",
      "field_1",
      "field_2",
    ]);
    expect(fields[1]).toMatchObject({ label: "Rate us", options: ["Good", "Bad"] });
    expect(fields[2]).toMatchObject({ label: "Job title", type: "text" });
    // Options are dropped from fields that are not choices.
    await updateFormFields(deps(), manager, id, [
      { key: "comment", label: "Comments", type: "textarea", required: false, options: ["x", "y"] },
    ]);
    expect(await fieldsOf(manager, id)).toEqual([
      { key: "comment", label: "Comments", type: "textarea", required: false },
    ]);
  });

  it("rejects invalid field lists", async () => {
    const { manager } = await setup();
    const id = await make(manager, "feedback");
    const text = { label: "Q", type: "text", required: false };
    const bad: unknown[] = [
      "nope",
      null,
      [],
      Array.from({ length: MAX_FIELDS + 1 }, (_, i) => ({ ...text, label: `Q${i}` })),
      [{ ...text, label: "" }],
      [{ ...text, label: "x".repeat(81) }],
      [{ ...text, type: "file" }],
      [{ ...text, type: "select", options: ["only one"] }],
      [{ ...text, type: "select" }],
      [{ ...text, key: "website" }],
      [{ ...text, key: "Bad Key" }],
      [
        { ...text, key: "a" },
        { ...text, key: "a" },
      ],
    ];
    for (const input of bad) {
      await expectCode(updateFormFields(deps(), manager, id, input), "INVALID_INPUT");
    }
    expect((await fieldsOf(manager, id)).map((f) => f.key)).toEqual(["rating", "comment"]);
    await expectCode(updateFormFields(deps(), manager, "not-an-id", [text]), "NOT_FOUND");
  });

  it("keeps a required name and email on forms that create contacts", async () => {
    const { manager } = await setup();
    const id = await make(manager, "contact_request");
    const original = asInput(await fieldsOf(manager, id));
    const without = (key: string) => original.filter((f) => f.key !== key);
    const change = (key: string, patch: object) =>
      original.map((f) => (f.key === key ? { ...f, ...patch } : f));
    await expectCode(updateFormFields(deps(), manager, id, without("email")), "UNPROCESSABLE");
    await expectCode(updateFormFields(deps(), manager, id, without("name")), "UNPROCESSABLE");
    await expectCode(
      updateFormFields(deps(), manager, id, change("email", { required: false })),
      "UNPROCESSABLE",
    );
    await expectCode(
      updateFormFields(deps(), manager, id, change("email", { type: "text" })),
      "UNPROCESSABLE",
    );
    await expectCode(
      updateFormFields(deps(), manager, id, change("name", { type: "textarea" })),
      "UNPROCESSABLE",
    );
    // Anything else may change, including removing the optional company field.
    await updateFormFields(deps(), manager, id, without("company"));
    expect((await fieldsOf(manager, id)).map((f) => f.key)).toEqual(["name", "email", "message"]);
  });

  it("allows only label changes once the form is published or closed", async () => {
    const { manager } = await setup();
    const id = await make(manager, "event_signup");
    await setFormStatus(deps(), manager, id, "PUBLISHED");
    const original = asInput(await fieldsOf(manager, id));

    const relabeled = original.map((f) => ({ ...f, label: `${f.label} (new)` }));
    await updateFormFields(deps(), manager, id, relabeled);
    expect((await fieldsOf(manager, id))[0]!.label).toBe("Your name (new)");

    const structural: unknown[] = [
      [...original, { label: "Extra", type: "text", required: false }],
      original.slice(1),
      [...original].reverse(),
      original.map((f) => (f.key === "phone" ? { ...f, required: true } : f)),
      original.map((f) => (f.key === "phone" ? { ...f, type: "text" } : f)),
      original.map((f) => (f.key === "guests" ? { ...f, options: ["1", "2"] } : f)),
    ];
    for (const input of structural) {
      await expectCode(updateFormFields(deps(), manager, id, input), "UNPROCESSABLE");
    }

    await setFormStatus(deps(), manager, id, "CLOSED");
    await updateFormFields(deps(), manager, id, original);
    await expectCode(updateFormFields(deps(), manager, id, structural[0]), "UNPROCESSABLE");
  });

  it("keeps old answers readable after labels change", async () => {
    const { manager } = await setup();
    const id = await make(manager, "feedback");
    await setFormStatus(deps(), manager, id, "PUBLISHED");
    const { form } = await getForm(deps(), manager, id);
    await submitPublicForm(deps(), form.publicToken, { rating: "5", comment: "Great" }, false);
    await updateFormFields(
      deps(),
      manager,
      id,
      form.fields.map((f) => ({ ...f, label: `${f.label}?` })),
    );
    await submitPublicForm(deps(), form.publicToken, { rating: "4" }, false);
    const { submissions } = await getForm(deps(), manager, id);
    expect(
      submissions
        .map((s) => s.answers)
        .sort((a, b) => String(a.rating).localeCompare(String(b.rating))),
    ).toEqual([{ rating: "4" }, { rating: "5", comment: "Great" }]);
  });

  it("checks permissions, tenant scope and keeps labels out of the audit trail", async () => {
    const { manager, alice, viewer, globexOwner } = await setup();
    const id = await make(manager, "feedback");
    const fields = asInput(await fieldsOf(manager, id));
    for (const context of [alice, viewer]) {
      await expectCode(updateFormFields(deps(), context, id, fields), "FORBIDDEN");
    }
    await expectCode(updateFormFields(deps(), globexOwner, id, fields), "NOT_FOUND");

    await updateFormFields(deps(), manager, id, [
      { key: "comment", label: "Secret wording", type: "textarea", required: false },
    ]);
    const audit = await db().auditLog.findFirstOrThrow({
      where: { action: "form.fields_updated" },
    });
    expect(audit.metadata).toEqual({ fields: 1, labelsOnly: false });
    expect(JSON.stringify(audit)).not.toContain("Secret wording");
    expect((await fieldsOf(manager, id)).map((f) => f.key)).toEqual(["comment"]);
  });
});
