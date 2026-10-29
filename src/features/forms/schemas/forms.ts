import { z } from "zod";

export const FIELD_TYPES = ["text", "email", "phone", "textarea", "select"] as const;
export const MAX_FIELDS = 20;
export const MAX_PUBLIC_BODY_CHARS = 10_000;
export const SUBMISSIONS_PER_MINUTE = 30;
export const SUBMISSIONS_PER_DAY = 500;
/** Hidden field that real visitors never fill in. */
export const HONEYPOT_FIELD = "website";

export const fieldDefSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/),
    label: z.string().trim().min(1).max(80),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(60)).min(2).max(20).optional(),
  })
  .refine((field) => (field.type === "select") === (field.options !== undefined), {
    message: "Only select fields have options, and they need some.",
  })
  .refine((field) => field.key !== HONEYPOT_FIELD, { message: "Reserved field name." });

export const fieldsSchema = z
  .array(fieldDefSchema)
  .min(1)
  .max(MAX_FIELDS)
  .refine((fields) => new Set(fields.map((field) => field.key)).size === fields.length, {
    message: "Field keys must be unique.",
  });
export type FieldDef = z.infer<typeof fieldDefSchema>;

export const formIdSchema = z.uuid();
export const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
const blank = (value: unknown) => (value === "" || value === null ? undefined : value);

export const createFormSchema = z.object({
  templateId: z.enum(["contact_request", "event_signup", "feedback"]),
  title: z.string().trim().min(2).max(120),
  description: z.preprocess(blank, z.string().trim().max(1000).optional()),
  consentText: z.preprocess(blank, z.string().trim().min(10).max(500).optional()),
});

export const updateFormSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    description: z.preprocess(
      (v) => (v === "" ? null : v),
      z.string().trim().max(1000).nullable().optional(),
    ),
    consentText: z.string().trim().min(10).max(500),
  })
  .partial();

export const statusSchema = z.enum(["DRAFT", "PUBLISHED", "CLOSED"]);

export type FormTemplate = {
  id: "contact_request" | "event_signup" | "feedback";
  createsContact: boolean;
  consentText: string | null;
  fields: FieldDef[];
};

/** Built-in starting points. The stored form is a copy, so later template changes never touch it. */
export const FORM_TEMPLATES: readonly FormTemplate[] = [
  {
    id: "contact_request",
    createsContact: true,
    consentText: "I agree that you may store these details and contact me about my request.",
    fields: [
      { key: "name", label: "Your name", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "company", label: "Company", type: "text", required: false },
      { key: "message", label: "How can we help?", type: "textarea", required: true },
    ],
  },
  {
    id: "event_signup",
    createsContact: true,
    consentText: "I agree that you may store these details and contact me about this event.",
    fields: [
      { key: "name", label: "Your name", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "phone", label: "Phone", type: "phone", required: false },
      {
        key: "guests",
        label: "Number of guests",
        type: "select",
        required: true,
        options: ["1", "2", "3", "4", "5"],
      },
    ],
  },
  {
    id: "feedback",
    createsContact: false,
    consentText: null,
    fields: [
      {
        key: "rating",
        label: "How would you rate us?",
        type: "select",
        required: true,
        options: ["1", "2", "3", "4", "5"],
      },
      { key: "comment", label: "Comments", type: "textarea", required: false },
    ],
  },
];

const LIMITS = { text: 500, textarea: 2000, email: 254, phone: 40, select: 60 } as const;

/** Strict validator for one form's answers: unknown keys are rejected, values are bounded per type. */
export function buildAnswerSchema(fields: readonly FieldDef[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    let value: z.ZodType;
    switch (field.type) {
      case "email":
        value = z.string().trim().toLowerCase().max(LIMITS.email).pipe(z.email());
        break;
      case "phone":
        value = z
          .string()
          .trim()
          .min(3)
          .max(LIMITS.phone)
          .regex(/^[0-9+()\-.\s]+$/);
        break;
      case "select":
        value = z.enum(field.options as [string, ...string[]]);
        break;
      default:
        value = z.string().trim().min(1).max(LIMITS[field.type]);
    }
    shape[field.key] = field.required
      ? value
      : z.preprocess((v) => (v === "" || v === null ? undefined : v), value.optional());
  }
  return z.object(shape).strict();
}
