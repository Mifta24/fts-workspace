import { getLocale, getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { TwoFactorPanel } from "@/features/auth/components/two-factor-panel";
import { Link, redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth/session";

export default async function SecurityPage({ searchParams }: PageProps<"/[locale]/security">) {
  const locale = await getLocale();
  const user = await getSessionUser();
  if (!user?.emailVerified) return redirect({ href: "/sign-in", locale });
  const [t, query] = await Promise.all([getTranslations("Security"), searchParams]);
  const required = query.required === "operator" || query.required === "owner";

  return (
    <main className="mx-auto w-full max-w-xl space-y-6 px-4 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        <Link href="/workspaces" className="text-sm text-primary hover:underline">
          {t("back")}
        </Link>
      </header>
      {required && !user.twoFactorEnabled ? (
        <Card role="alert" data-testid="mfa-required">
          <p className="text-sm font-medium">
            {query.required === "operator" ? t("requiredOperator") : t("requiredOwner")}
          </p>
        </Card>
      ) : null}
      <Card>
        <TwoFactorPanel enabled={user.twoFactorEnabled} />
      </Card>
    </main>
  );
}
