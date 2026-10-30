import { getLocale, getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { FEATURES } from "@/features/billing/schemas/plans";
import { formatBytes, percentUsed } from "@/features/billing/schemas/format";
import { getBillingOverview } from "@/features/billing/server/billing-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { db } from "@/lib/db";

function Meter({
  label,
  used,
  limit,
  text,
}: {
  label: string;
  used: number;
  limit: number | null;
  text: string;
}) {
  const percent = percentUsed(used, limit);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <dt className="text-sm font-medium">{label}</dt>
        <dd className="text-sm tabular-nums text-muted-foreground">{text}</dd>
      </div>
      {percent !== null && (
        <progress
          className="h-2 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
          value={percent}
          max={100}
          aria-label={label}
        />
      )}
    </div>
  );
}

export default async function BillingPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/billing">) {
  const { organizationSlug } = await params;
  const context = await requireWorkspace(organizationSlug, "billing:read");
  const [t, locale, overview] = await Promise.all([
    getTranslations("Billing"),
    getLocale(),
    getBillingOverview({ prisma: db() }, context),
  ]);
  const number = new Intl.NumberFormat(locale);
  const of = (used: number, limit: number | null, format: (n: number) => string = number.format) =>
    limit === null
      ? t("unlimited", { used: format(used) })
      : t("usedOf", { used: format(used), limit: format(limit) });
  const date = (value: Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(value);

  return (
    <WorkspaceShell context={context} active="billing">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      <Card className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">{t("planTitle")}</h2>
        <p className="text-2xl font-semibold" data-testid="plan-name">
          {t(`plan.${overview.plan}`)}
        </p>
        {overview.plan === "UNMETERED" && (
          <p className="text-sm text-muted-foreground">{t("unmeteredNote")}</p>
        )}
        {overview.trialEndsAt && !overview.trialExpired && (
          <p className="text-sm text-muted-foreground">
            {t("trialEnds", { date: date(overview.trialEndsAt) })}
          </p>
        )}
        {overview.trialExpired && (
          <p className="text-sm text-muted-foreground" role="status">
            {t("trialExpired")}
          </p>
        )}
        <p className="text-sm text-muted-foreground">{t("changePlan")}</p>
      </Card>

      <section aria-labelledby="usage-title" className="space-y-3">
        <h2 id="usage-title" className="text-lg font-semibold tracking-tight">
          {t("usageTitle")}
        </h2>
        <Card>
          <dl className="space-y-5">
            <Meter
              label={t("seats")}
              used={overview.seats.members + overview.seats.pendingInvitations}
              limit={overview.seats.limit}
              text={of(
                overview.seats.members + overview.seats.pendingInvitations,
                overview.seats.limit,
              )}
            />
            <Meter
              label={t("storage")}
              used={overview.storage.usedBytes}
              limit={overview.storage.limitBytes}
              text={of(overview.storage.usedBytes, overview.storage.limitBytes, formatBytes)}
            />
            <Meter
              label={t("aiToday")}
              used={overview.ai.usedToday}
              limit={overview.ai.dailyLimit}
              text={of(overview.ai.usedToday, overview.ai.dailyLimit)}
            />
            <Meter
              label={t("aiMonth")}
              used={overview.ai.usedThisMonth}
              limit={overview.ai.monthlyLimit}
              text={of(overview.ai.usedThisMonth, overview.ai.monthlyLimit)}
            />
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">{t("seatsNote")}</p>
          <p className="text-xs text-muted-foreground">{t("aiNote")}</p>
        </Card>
      </section>

      <section aria-labelledby="features-title" className="space-y-3">
        <h2 id="features-title" className="text-lg font-semibold tracking-tight">
          {t("featuresTitle")}
        </h2>
        <Card>
          <ul className="space-y-2 text-sm">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-center justify-between gap-3">
                <span>{t(`feature.${feature}`)}</span>
                <span
                  className={overview.features[feature] ? "font-medium" : "text-muted-foreground"}
                >
                  {overview.features[feature] ? t("included") : t("notIncluded")}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">{t("downgradeNote")}</p>
        </Card>
      </section>
    </WorkspaceShell>
  );
}
