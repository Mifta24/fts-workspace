import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** Links to the public legal pages, shown at the bottom of every page. */
export async function LegalFooter() {
  const t = await getTranslations("Legal");
  return (
    <footer className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
      <nav aria-label={t("footerLabel")} className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        <Link href="/privacy" className="hover:underline">
          {t("privacy")}
        </Link>
        <Link href="/terms" className="hover:underline">
          {t("terms")}
        </Link>
      </nav>
    </footer>
  );
}
