import { getLocale, getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { ProgressThread } from "@/components/ui/progress-thread";
import { Link, redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth/session";

// Illustrative values for the example goal only; not tenant data.
const SAMPLE_MILESTONES = [
  { key: "sampleM1", progress: 100 },
  { key: "sampleM2", progress: 40 },
  { key: "sampleM3", progress: 0 },
] as const;

export default async function HomePage() {
  const locale = await getLocale();
  if (await getSessionUser()) redirect({ href: "/workspaces", locale });
  const t = await getTranslations("Home");
  const goalProgress = Math.round(
    SAMPLE_MILESTONES.reduce((sum, m) => sum + m.progress, 0) / SAMPLE_MILESTONES.length,
  );

  return (
    <main className="mx-auto grid w-full max-w-5xl flex-1 content-center gap-12 px-6 py-16 md:grid-cols-[1.1fr_1fr] md:items-center md:gap-16">
      <div className="space-y-6">
        <p className="text-base font-semibold text-primary">FTS Workspace</p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
          {t("title")}
        </h1>
        <p className="max-w-prose text-lg text-muted-foreground">{t("subtitle")}</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/sign-in" className={buttonVariants()}>
            {t("signIn")}
          </Link>
          <Link href="/sign-up" className={buttonVariants({ variant: "outline" })}>
            {t("signUp")}
          </Link>
        </div>
      </div>

      <section aria-labelledby="sample-goal" className="space-y-5">
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="sample-goal" className="text-lg font-semibold tracking-tight">
              {t("sampleGoal")}
            </h2>
            <span className="text-lg font-semibold tabular-nums">{goalProgress}%</span>
          </div>
          <ProgressThread
            value={goalProgress}
            label={t("sampleProgress", { title: t("sampleGoal") })}
          />
        </div>
        <ul className="space-y-4 border-t border-border pt-5">
          {SAMPLE_MILESTONES.map((m) => (
            <li key={m.key} className="space-y-2">
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span>{t(m.key)}</span>
                <span className="tabular-nums text-muted-foreground">{m.progress}%</span>
              </div>
              <ProgressThread
                value={m.progress}
                label={t("sampleProgress", { title: t(m.key) })}
                className="h-1"
              />
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">{t("sampleCaption")}</p>
      </section>
    </main>
  );
}
