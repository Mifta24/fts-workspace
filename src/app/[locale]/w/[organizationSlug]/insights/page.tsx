import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { PERIOD_CHOICES } from "@/features/insights/schemas/insights";
import { getInsights } from "@/features/insights/server/insights-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { roleHasPermission } from "@/lib/permissions/matrix";
import { cn } from "@/lib/utils";

function Figure({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <Card className="space-y-1 p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-3xl font-semibold tabular-nums">{value}</dd>
      {note && <dd className="text-xs text-muted-foreground">{note}</dd>}
    </Card>
  );
}

export default async function InsightsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/w/[organizationSlug]/insights">) {
  const [{ organizationSlug }, query] = await Promise.all([params, searchParams]);
  const context = await requireWorkspace(organizationSlug, "dashboard:read");
  const [t, insights] = await Promise.all([
    getTranslations("Insights"),
    getInsights({ prisma: db() }, context, typeof query.days === "string" ? query.days : undefined),
  ]);
  const { contacts, forms, meetings } = insights;
  const compare = (previous: number) => t("previous", { count: previous });

  return (
    <WorkspaceShell context={context} active="insights">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("intro", { days: insights.periodDays })}</p>
      <nav aria-label={t("period")} className="flex flex-wrap gap-2">
        {PERIOD_CHOICES.map((days) => (
          <Link
            key={days}
            href={`/w/${organizationSlug}/insights?days=${days}`}
            aria-current={days === insights.periodDays ? "page" : undefined}
            className={cn(
              "rounded-md border border-border px-3 py-1 text-sm",
              days === insights.periodDays
                ? "bg-primary text-primary-foreground"
                : "bg-card hover:bg-muted",
            )}
          >
            {t("days", { count: days })}
          </Link>
        ))}
      </nav>

      {contacts && (
        <section aria-labelledby="contacts-title" className="space-y-3">
          <h2 id="contacts-title" className="text-lg font-semibold tracking-tight">
            {t("contactsTitle")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {roleHasPermission(context.role, "crm:read-all")
              ? t("contactsScopeAll")
              : t("contactsScopeOwn")}
          </p>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Figure
              label={t("newContacts")}
              value={contacts.created}
              note={compare(contacts.createdPreviousPeriod)}
            />
            <Figure label={t("fromForms")} value={contacts.createdFromForms} />
            <Figure label={t("erased")} value={contacts.erased} />
          </dl>
          <h3 className="text-sm font-medium">{t("consentTitle")}</h3>
          <dl className="grid gap-4 sm:grid-cols-3">
            {(["GRANTED", "UNKNOWN", "WITHDRAWN"] as const).map((status) => (
              <Figure
                key={status}
                label={t(`consent.${status}`)}
                value={contacts.consent[status]}
              />
            ))}
          </dl>
          <Link
            href={`/w/${organizationSlug}/crm/pipeline`}
            className="text-sm text-primary hover:underline"
          >
            {t("pipelineLink")}
          </Link>
        </section>
      )}

      {forms && (
        <section aria-labelledby="forms-title" className="space-y-3">
          <h2 id="forms-title" className="text-lg font-semibold tracking-tight">
            {t("formsTitle")}
          </h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Figure
              label={t("submissions")}
              value={forms.submissions}
              note={compare(forms.submissionsPreviousPeriod)}
            />
            <Figure label={t("withContact")} value={forms.submissionsWithContact} />
          </dl>
          {forms.perForm.length === 0 ? (
            <Card>
              <p className="text-muted-foreground">{t("noForms")}</p>
            </Card>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">{t("perForm")}</caption>
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th scope="col" className="py-2 font-medium">
                    {t("formColumn")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t("submissions")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t("withContact")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {forms.perForm.map((form) => (
                  <tr key={form.formId} className="border-b border-border">
                    <th scope="row" className="py-2 text-left font-normal">
                      <Link
                        href={`/w/${organizationSlug}/forms/${form.formId}`}
                        className="text-primary hover:underline"
                      >
                        {form.title}
                      </Link>
                    </th>
                    <td className="py-2 text-right tabular-nums">{form.submissions}</td>
                    <td className="py-2 text-right tabular-nums">{form.withContact}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section aria-labelledby="meetings-title" className="space-y-3">
        <h2 id="meetings-title" className="text-lg font-semibold tracking-tight">
          {t("meetingsTitle")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("meetingsScope")}</p>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label={t("upcoming")} value={meetings.upcoming} />
          <Figure label={t("held")} value={meetings.held} />
          <Figure label={t("organized")} value={meetings.organized} />
          <Figure label={t("cancelled")} value={meetings.cancelled} />
        </dl>
        <h3 className="text-sm font-medium">{t("guestResponses")}</h3>
        <dl className="grid gap-4 sm:grid-cols-3">
          {(["ACCEPTED", "PENDING", "DECLINED"] as const).map((response) => (
            <Figure
              key={response}
              label={t(`response.${response}`)}
              value={meetings.guestResponses[response]}
            />
          ))}
        </dl>
      </section>
    </WorkspaceShell>
  );
}
