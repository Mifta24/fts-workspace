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

export const FORM_LOCALES = ["en", "ja", "id"] as const;
export type FormLocale = (typeof FORM_LOCALES)[number];

export const createFormSchema = z.object({
  templateId: z.enum(["contact_request", "event_signup", "feedback"]),
  /** Language of the copied labels and consent wording; the visitor sees them as stored. */
  locale: z.preprocess(blank, z.enum(FORM_LOCALES).default("en")),
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
  /** Field keys, types and options; the wording lives in `TEMPLATE_COPY`. */
  fields: FieldDef[];
};

type TemplateCopy = {
  consentText: string | null;
  /** Label per field key. */
  labels: Record<string, string>;
};

/**
 * Built-in starting points. The stored form is a copy in the owner's language, so later
 * template changes never touch it. English is the base and the fallback.
 */
export const FORM_TEMPLATES: readonly FormTemplate[] = [
  {
    id: "contact_request",
    createsContact: true,
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

export const TEMPLATE_COPY: Record<FormLocale, Record<FormTemplate["id"], TemplateCopy>> = {
  en: {
    contact_request: {
      consentText: "I agree that you may store these details and contact me about my request.",
      labels: {
        name: "Your name",
        email: "Email",
        company: "Company",
        message: "How can we help?",
      },
    },
    event_signup: {
      consentText: "I agree that you may store these details and contact me about this event.",
      labels: { name: "Your name", email: "Email", phone: "Phone", guests: "Number of guests" },
    },
    feedback: {
      consentText: null,
      labels: { rating: "How would you rate us?", comment: "Comments" },
    },
  },
  ja: {
    contact_request: {
      consentText: "入力した情報を保管し、お問い合わせの件で私に連絡することに同意します。",
      labels: {
        name: "お名前",
        email: "メールアドレス",
        company: "会社名",
        message: "ご用件をお聞かせください",
      },
    },
    event_signup: {
      consentText: "入力した情報を保管し、このイベントの件で私に連絡することに同意します。",
      labels: { name: "お名前", email: "メールアドレス", phone: "電話番号", guests: "参加人数" },
    },
    feedback: {
      consentText: null,
      labels: { rating: "満足度を教えてください", comment: "コメント" },
    },
  },
  id: {
    contact_request: {
      consentText:
        "Saya setuju data ini disimpan dan Anda boleh menghubungi saya terkait permintaan saya.",
      labels: {
        name: "Nama Anda",
        email: "Email",
        company: "Perusahaan",
        message: "Apa yang bisa kami bantu?",
      },
    },
    event_signup: {
      consentText:
        "Saya setuju data ini disimpan dan Anda boleh menghubungi saya terkait acara ini.",
      labels: { name: "Nama Anda", email: "Email", phone: "Telepon", guests: "Jumlah tamu" },
    },
    feedback: {
      consentText: null,
      labels: { rating: "Bagaimana penilaian Anda?", comment: "Komentar" },
    },
  },
};

/** A template's fields and consent wording in one language. */
export function templateIn(templateId: FormTemplate["id"], locale: FormLocale) {
  const template = FORM_TEMPLATES.find((candidate) => candidate.id === templateId)!;
  const copy = TEMPLATE_COPY[locale][templateId];
  return {
    template,
    consentText: copy.consentText,
    fields: template.fields.map((field) => ({
      ...field,
      label: copy.labels[field.key] ?? field.label,
    })),
  };
}

/** Field as sent by the editor: new fields have no key yet. */
const fieldInputSchema = z.object({
  key: z.preprocess(
    blank,
    z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,29}$/)
      .optional(),
  ),
  label: z.string().trim().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
});

export const fieldsInputSchema = z.array(fieldInputSchema).min(1).max(MAX_FIELDS);
export type FieldInput = z.infer<typeof fieldInputSchema>;

const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);

/**
 * Gives new fields a key and drops options from fields that cannot have them. A phone field
 * claims the `phone` key (the contact's phone number) when it is free; otherwise the key comes
 * from the label, or is `field_<n>` when the label has no usable letters.
 */
export function assignFieldKeys(inputs: readonly FieldInput[]): unknown[] {
  const used = new Set(inputs.flatMap((input) => (input.key ? [input.key] : [])));
  let counter = 1;
  const claim = (candidate: string) => {
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(candidate) || candidate === HONEYPOT_FIELD) return null;
    if (used.has(candidate)) return null;
    used.add(candidate);
    return candidate;
  };
  return inputs.map((input) => {
    let key = input.key;
    if (!key && input.type === "phone") key = claim("phone") ?? undefined;
    if (!key) key = claim(slug(input.label)) ?? undefined;
    while (!key) key = claim(`field_${counter++}`) ?? undefined;
    return {
      key,
      label: input.label,
      type: input.type,
      required: input.required,
      ...(input.type === "select" ? { options: input.options } : {}),
    };
  });
}

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
