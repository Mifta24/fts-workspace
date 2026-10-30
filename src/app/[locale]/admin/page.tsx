import { getLocale, getTranslations } from "next-intl/server";
import { ActionButton } from "@/components/action-button";
import { ServerForm } from "@/components/server-form";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { MAX_TRIAL_DAYS } from "@/features/admin/schemas/admin";
import { PLAN_KEYS } from "@/features/billing/schemas/plans";
import { getOperationsSnapshot, listWorkspaces } from "@/features/admin/server/admin-service";
import { setPlanAction, setSuspendedAction } from "@/features/admin/server/actions";
import { requireOperator } from "@/features/admin/server/require-operator";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

function Figure({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <Card className="space-y-1 p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-3xl font-semibold tabular-nums">{value}</dd>
      {note && <dd className="text-xs text-muted-foreground">{note}</dd>}
    </Card>
  );
}

export default async function AdminPage({ searchParams }: PageProps<"/[locale]/admin">) {
  const operator = await requireOperator();
  const query = await searchParams;
  const search = typeof query.q === "string" ? query.q : "";
  const deps = { prisma: db() };
  const [t, locale, snapshot, workspaces] = await Promise.all([
    getTranslations("Admin"),
    getLocale(),
    getOperationsSnapshot(deps, operator),
    listWorkspaces(deps, operator, search.slice(0, 80)),
  ]);
  logger.info({ operatorId: operator.userId, search: search.length > 0 }, "admin.console viewed");
  const number = new Intl.NumberFormat(locale);
  const date = (value: Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(value);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        <Link href="/workspaces" className="text-sm text-primary hover:underline">
          {t("back")}
        </Link>
      </header>

      <section aria-labelledby="health-title" className="space-y-3">
        <h2 id="health-title" className="text-lg font-semibold tracking-tight">
          {t("healthTitle")}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label={t("workspaces")} value={snapshot.workspaces} />
          <Figure label={t("suspended")} value={snapshot.suspendedWorkspaces} />
          <Figure label={t("users")} value={snapshot.users} />
          <Figure label={t("signups")} value={snapshot.signupsLast24h} />
          <Figure label={t("jobsQueued")} value={snapshot.jobs.queued} />
          <Figure
            label={t("oldestDue")}
            value={
              snapshot.jobs.oldestDueSeconds === null
                ? t("none")
                : t("seconds", { count: number.format(snapshot.jobs.oldestDueSeconds) })
            }
          />
          <Figure label={t("jobsFailed")} value={snapshot.jobs.failedLast24h} />
          <Figure label={t("jobsStuck")} value={snapshot.jobs.stuck} />
          <Figure label={t("aiCalls")} value={snapshot.ai.callsLast24h} />
          <Figure label={t("aiErrors")} value={snapshot.ai.errorsLast24h} />
        </dl>
      </section>

      <section aria-labelledby="workspaces-title" className="space-y-3">
        <h2 id="workspaces-title" className="text-lg font-semibold tracking-tight">
          {t("workspacesTitle")}
        </h2>
        <form role="search" className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="admin-search">{t("search")}</Label>
            <Input id="admin-search" name="q" defaultValue={search} maxLength={80} />
          </div>
          <button
            type="submit"
            className="h-10 rounded-md border border-input bg-card px-4 text-sm hover:bg-muted"
          >
            {t("searchSubmit")}
          </button>
        </form>
        {workspaces.length === 0 ? (
          <Card>
            <p className="text-muted-foreground">{t("noWorkspaces")}</p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <Card className="space-y-4" data-testid={`workspace-${workspace.slug}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{workspace.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        /{workspace.slug} · {t("created", { date: date(workspace.createdAt) })}
                      </p>
                    </div>
                    <p className="text-sm">
                      <span className="font-medium">{t(`plan.${workspace.plan}`)}</span>
                      {workspace.trialEndsAt && !workspace.trialExpired && (
                        <> · {t("trialEnds", { date: date(workspace.trialEndsAt) })}</>
                      )}
                      {workspace.trialExpired && <> · {t("trialExpired")}</>}
                      {workspace.suspended && (
                        <>
                          {" · "}
                          <strong>{t("suspendedBadge")}</strong>
                        </>
                      )}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("usage", {
                      members: workspace.members,
                      tokens: number.format(workspace.aiTokensThisMonth),
                    })}
                  </p>
                  <ServerForm
                    action={setPlanAction}
                    fields={{ organizationId: workspace.id }}
                    submitLabel={t("setPlan")}
                    resetOnSuccess={false}
                    showSaved
                    className="flex flex-wrap items-end gap-3"
                  >
                    <div className="space-y-2">
                      <Label htmlFor={`plan-${workspace.id}`}>{t("planLabel")}</Label>
                      <Select
                        id={`plan-${workspace.id}`}
                        name="plan"
                        defaultValue={workspace.plan === "UNMETERED" ? "UNMETERED" : workspace.plan}
                      >
                        {[...PLAN_KEYS, "UNMETERED" as const].map((plan) => (
                          <option key={plan} value={plan}>
                            {t(`plan.${plan}`)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`trial-${workspace.id}`}>{t("trialDays")}</Label>
                      <Input
                        id={`trial-${workspace.id}`}
                        name="trialDays"
                        type="number"
                        min={1}
                        max={MAX_TRIAL_DAYS}
                        inputMode="numeric"
                        className="w-28"
                      />
                    </div>
                  </ServerForm>
                  <ActionButton
                    action={setSuspendedAction}
                    fields={{
                      organizationId: workspace.id,
                      suspended: workspace.suspended ? "false" : "true",
                    }}
                    label={workspace.suspended ? t("unsuspend") : t("suspend")}
                  />
                </Card>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t("limit", { count: 100 })}</p>
      </section>
    </main>
  );
}
