import { describe, expect, it } from "vitest";
import {
  buildAnswerSchema,
  fieldsSchema,
  FORM_LOCALES,
  FORM_TEMPLATES,
  HONEYPOT_FIELD,
  TEMPLATE_COPY,
  templateIn,
} from "@/features/forms/schemas/forms";

describe("templates and field definitions", () => {
  it("ships only valid templates, and contact-creating ones carry name, email and consent wording", () => {
    for (const template of FORM_TEMPLATES) {
      expect(fieldsSchema.safeParse(template.fields).success, template.id).toBe(true);
      if (template.createsContact) {
        expect(template.fields.map((f) => f.key)).toEqual(
          expect.arrayContaining(["name", "email"]),
        );
      }
    }
  });

  it("has complete wording in every language for every template", () => {
    for (const locale of FORM_LOCALES) {
      for (const template of FORM_TEMPLATES) {
        const copy = TEMPLATE_COPY[locale][template.id];
        expect(Object.keys(copy.labels).sort(), `${locale}/${template.id}`).toEqual(
          template.fields.map((f) => f.key).sort(),
        );
        if (template.createsContact) {
          expect(copy.consentText?.length ?? 0, `${locale}/${template.id}`).toBeGreaterThanOrEqual(
            10,
          );
        } else {
          expect(copy.consentText).toBeNull();
        }
        expect(fieldsSchema.safeParse(templateIn(template.id, locale).fields).success).toBe(true);
      }
    }
    expect(templateIn("contact_request", "ja").fields[0]!.label).toBe("お名前");
  });

  it("rejects duplicate keys, reserved names, bad keys, and options on the wrong types", () => {
    const text = { key: "a", label: "A", type: "text", required: false };
    expect(fieldsSchema.safeParse([text, text]).success).toBe(false);
    expect(fieldsSchema.safeParse([{ ...text, key: HONEYPOT_FIELD }]).success).toBe(false);
    expect(fieldsSchema.safeParse([{ ...text, key: "Bad Key" }]).success).toBe(false);
    expect(fieldsSchema.safeParse([{ ...text, options: ["x", "y"] }]).success).toBe(false);
    expect(fieldsSchema.safeParse([{ ...text, type: "select" }]).success).toBe(false);
    expect(fieldsSchema.safeParse([]).success).toBe(false);
  });
});

describe("buildAnswerSchema", () => {
  const schema = buildAnswerSchema([
    { key: "name", label: "Name", type: "text", required: true },
    { key: "email", label: "Email", type: "email", required: true },
    { key: "phone", label: "Phone", type: "phone", required: false },
    { key: "size", label: "Size", type: "select", required: false, options: ["S", "M"] },
  ]);

  it("normalizes and accepts valid answers, with optional fields left blank", () => {
    expect(schema.parse({ name: " Dana ", email: " Dana@X.TEST ", phone: "", size: "" })).toEqual({
      name: "Dana",
      email: "dana@x.test",
    });
  });

  it("rejects missing required, malformed, out-of-options, oversize and unknown answers", () => {
    expect(schema.safeParse({ email: "a@x.test" }).success).toBe(false);
    expect(schema.safeParse({ name: "A", email: "nope" }).success).toBe(false);
    expect(schema.safeParse({ name: "A", email: "a@x.test", size: "XL" }).success).toBe(false);
    expect(schema.safeParse({ name: "A".repeat(501), email: "a@x.test" }).success).toBe(false);
    expect(schema.safeParse({ name: "A", email: "a@x.test", role: "OWNER" }).success).toBe(false);
    expect(schema.safeParse({ name: "A", email: "a@x.test", phone: "call me" }).success).toBe(
      false,
    );
  });
});
