import { getLocale, getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth/session";

export default async function HomePage() {
  const locale = await getLocale();
  if (await getSessionUser()) redirect({ href: "/workspaces", locale });
  const t = await getTranslations("Home");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-primary">FTS Workspace</p>
      <h1 className="text-4xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-lg text-muted-foreground">{t("subtitle")}</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/sign-in" className={buttonVariants()}>
          {t("signIn")}
        </Link>
        <Link href="/sign-up" className={buttonVariants({ variant: "outline" })}>
          {t("signUp")}
        </Link>
      </div>
    </main>
  );
}
