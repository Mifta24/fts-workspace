import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { env } from "@/lib/env";
import {
  LEGAL_UPDATED,
  MAX_PARTS,
  SECTIONS,
  type LegalDocument as Kind,
} from "@/features/legal/schemas/documents";

/** The section and part names are built at run time, so the typed key check cannot see them. */
type LooseTranslator = {
  (key: string, values?: Record<string, string>): string;
  has(key: string): boolean;
};

/** One public legal page: the privacy notice or the terms. Text comes from the message catalogs. */
export async function LegalDocument({ kind }: { kind: Kind }) {
  const [t, locale] = await Promise.all([getTranslations("Legal"), getLocale()]);
  const text = t as unknown as LooseTranslator;
  const { LEGAL_OPERATOR_NAME: operator, LEGAL_CONTACT_EMAIL: email } = env();
  const values = { operator: operator ?? "" };
  const updated = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${LEGAL_UPDATED}T00:00:00Z`),
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-6 py-12">
      <header className="space-y-3">
        <Link href="/" className="text-sm font-medium text-primary hover:underline">
          {t("back")}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{text(`${kind}.title`)}</h1>
        <p className="text-sm text-muted-foreground">{t("updated", { date: updated })}</p>
        <p className="text-muted-foreground">{text(`${kind}.intro`, values)}</p>
      </header>

      {SECTIONS[kind].map((section) => {
        const key = `${kind}.${section}`;
        const parts = (prefix: "p" | "i") =>
          Array.from({ length: MAX_PARTS }, (_, n) => `${key}.${prefix}${n + 1}`).filter((name) =>
            text.has(name),
          );
        const [firstParagraph, ...otherParagraphs] = parts("p");
        const items = parts("i");
        return (
          <section key={section} aria-labelledby={`legal-${section}`} className="space-y-3">
            <h2 id={`legal-${section}`} className="text-xl font-semibold tracking-tight">
              {text(`${key}.title`)}
            </h2>
            {firstParagraph && <p>{text(firstParagraph, values)}</p>}
            {items.length > 0 && (
              <ul className="list-disc space-y-2 pl-6">
                {items.map((name) => (
                  <li key={name}>{text(name, values)}</li>
                ))}
              </ul>
            )}
            {otherParagraphs.map((name) => (
              <p key={name}>{text(name, values)}</p>
            ))}
            {section === "contact" && email && (
              <p>
                {t("contactEmail")}:{" "}
                <a href={`mailto:${email}`} className="font-medium text-primary hover:underline">
                  {email}
                </a>
              </p>
            )}
          </section>
        );
      })}
    </main>
  );
}
