import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { HELP_SECTIONS, MAX_ITEMS, ORDERED_SECTIONS } from "@/features/help/schemas/sections";

/** The section and item names are built at run time, so the typed key check cannot see them. */
type LooseTranslator = {
  (key: string): string;
  has(key: string): boolean;
};

/** The public guide to using the product. Anyone may read it, signed in or not. */
export async function HelpGuide() {
  const t = await getTranslations("Help");
  const text = t as unknown as LooseTranslator;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-6 py-12">
      <header className="space-y-3">
        <Link href="/" className="text-sm font-medium text-primary hover:underline">
          {t("back")}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </header>

      <nav aria-label={t("contents")} className="rounded-lg border border-border bg-card p-4">
        <p className="mb-2 text-sm font-semibold">{t("contents")}</p>
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {HELP_SECTIONS.map((section) => (
            <li key={section}>
              <a href={`#help-${section}`} className="text-primary hover:underline">
                {text(`sections.${section}.title`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {HELP_SECTIONS.map((section) => {
        const key = `sections.${section}`;
        const items = Array.from({ length: MAX_ITEMS }, (_, n) => `${key}.i${n + 1}`).filter(
          (name) => text.has(name),
        );
        const List = ORDERED_SECTIONS.has(section) ? "ol" : "ul";
        return (
          <section
            key={section}
            id={`help-${section}`}
            aria-labelledby={`help-${section}-title`}
            className="scroll-mt-6 space-y-3"
          >
            <h2 id={`help-${section}-title`} className="text-xl font-semibold tracking-tight">
              {text(`${key}.title`)}
            </h2>
            <p>{text(`${key}.p1`)}</p>
            {items.length > 0 && (
              <List className={`space-y-2 pl-6 ${List === "ol" ? "list-decimal" : "list-disc"}`}>
                {items.map((name) => (
                  <li key={name}>{text(name)}</li>
                ))}
              </List>
            )}
          </section>
        );
      })}

      <p className="border-t border-border pt-6 text-sm text-muted-foreground">{t("footer")}</p>
    </main>
  );
}
