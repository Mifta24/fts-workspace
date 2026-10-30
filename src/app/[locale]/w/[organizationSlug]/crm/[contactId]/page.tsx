import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ServerForm } from "@/components/server-form";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ActionButton } from "@/components/action-button";
import { ACTIVITY_TYPES, DEAL_STAGES, JOURNEY_STAGES } from "@/features/crm/schemas/crm";
import {
  addActivityAction,
  createDealAction,
  eraseContactAction,
  moveDealAction,
  recordConsentAction,
  setJourneyStageAction,
  updateContactAction,
} from "@/features/crm/server/actions";
import { getContactDetail } from "@/features/crm/server/crm-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { roleHasPermission } from "@/lib/permissions/matrix";

const money = (minor: number | null, currency: string) =>
  minor === null
    ? "—"
    : `${(minor / 100).toLocaleString("en", { minimumFractionDigits: 2 })} ${currency}`;

export default async function ContactPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/crm/[contactId]">) {
  const { organizationSlug, contactId } = await params;
  const context = await requireWorkspace(organizationSlug, "crm:read");
  const t = await getTranslations("Crm");
  const detail = await getContactDetail({ prisma: db() }, context, contactId).catch(
    (error: unknown) => {
      if (isAppError(error) && error.code === "NOT_FOUND") notFound();
      throw error;
    },
  );
  const { contact } = detail;
  const canWrite = roleHasPermission(context.role, "crm:write") && !contact.erased;
  const canErase = roleHasPermission(context.role, "crm:erase") && !contact.erased;
  const fields = { organizationSlug, id: contact.id };

  return (
    <WorkspaceShell context={context} active="crm">
      <Link href={`/w/${organizationSlug}/crm`} className="text-sm text-primary hover:underline">
        {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{contact.name}</h1>
      {contact.erased ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("erasedNotice")}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {[contact.company, contact.email, contact.phone].filter(Boolean).join(" · ") ||
            t("noDetails")}
        </p>
      )}

      {canWrite && (
        <Card>
          <CardTitle className="mb-4 text-lg">{t("editTitle")}</CardTitle>
          <ServerForm
            key={JSON.stringify(contact)}
            action={updateContactAction}
            fields={fields}
            submitLabel={t("save")}
            resetOnSuccess={false}
            showSaved
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="e-name">{t("name")}</Label>
                <Input
                  id="e-name"
                  name="name"
                  defaultValue={contact.name}
                  required
                  minLength={2}
                  maxLength={120}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-company">{t("company")}</Label>
                <Input
                  id="e-company"
                  name="company"
                  defaultValue={contact.company ?? ""}
                  maxLength={120}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-email">{t("email")}</Label>
                <Input
                  id="e-email"
                  name="email"
                  type="email"
                  defaultValue={contact.email ?? ""}
                  maxLength={254}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-phone">{t("phone")}</Label>
                <Input
                  id="e-phone"
                  name="phone"
                  defaultValue={contact.phone ?? ""}
                  maxLength={40}
                />
              </div>
            </div>
          </ServerForm>
        </Card>
      )}

      <section aria-labelledby="journey-title" className="space-y-3">
        <h2 id="journey-title" className="text-lg font-semibold tracking-tight">
          {t("journeyTitle")}
        </h2>
        <p className="text-sm">
          {t("journeyNow", { stage: t(`journey.${contact.journeyStage}`) })}
        </p>
        {canWrite && (
          <ServerForm
            key={contact.journeyStage}
            action={setJourneyStageAction}
            fields={fields}
            submitLabel={t("journeyMove")}
            resetOnSuccess={false}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="space-y-2">
              <Label htmlFor="j-stage">{t("journeyLabel")}</Label>
              <Select id="j-stage" name="stage" defaultValue={contact.journeyStage}>
                {JOURNEY_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {t(`journey.${stage}`)}
                  </option>
                ))}
              </Select>
            </div>
          </ServerForm>
        )}
        {detail.journeyHistory.length > 0 && (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {detail.journeyHistory.map((change, index) => (
              <li key={index}>
                {change.from
                  ? t("journeyChange", {
                      from: t(`journey.${change.from}`),
                      to: t(`journey.${change.to}`),
                    })
                  : t("journeyStart", { to: t(`journey.${change.to}`) })}{" "}
                · {t(`journeyReason.${change.reason}`)} · {change.at.toISOString().slice(0, 10)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="consent-title" className="space-y-3">
        <h2 id="consent-title" className="text-lg font-semibold tracking-tight">
          {t("consentTitle")}
        </h2>
        <p className="text-sm">
          {t("consentNow", { status: t(`consent.${contact.consentStatus}`) })}
        </p>
        {detail.consentHistory.length > 0 && (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {detail.consentHistory.map((event, index) => (
              <li key={index}>
                {t(`consent.${event.status}`)} · {event.source} ·{" "}
                {event.at.toISOString().slice(0, 10)}
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <ServerForm
            key={contact.consentStatus}
            action={recordConsentAction}
            fields={fields}
            submitLabel={t("recordConsent")}
          >
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="k-status">{t("consentLabel")}</Label>
                <Select id="k-status" name="status" defaultValue="GRANTED">
                  <option value="GRANTED">{t("consent.GRANTED")}</option>
                  <option value="WITHDRAWN">{t("consent.WITHDRAWN")}</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="k-source">{t("consentSource")}</Label>
                <Input id="k-source" name="source" required minLength={3} maxLength={120} />
              </div>
            </div>
          </ServerForm>
        )}
      </section>

      <section aria-labelledby="deals-title" className="space-y-3">
        <h2 id="deals-title" className="text-lg font-semibold tracking-tight">
          {t("deals")}
        </h2>
        {detail.deals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noDeals")}</p>
        ) : (
          <ul className="space-y-2">
            {detail.deals.map((deal) => (
              <li
                key={deal.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
              >
                <div>
                  <p className="font-medium">{deal.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`stage.${deal.stage}`)} · {money(deal.amountMinor, deal.currency)}
                  </p>
                </div>
                {canWrite && (
                  <ServerForm
                    key={deal.stage}
                    action={moveDealAction}
                    fields={{ organizationSlug, id: deal.id }}
                    submitLabel={t("move")}
                    resetOnSuccess={false}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Select
                      name="stage"
                      defaultValue={deal.stage}
                      aria-label={t("stageLabel", { title: deal.title })}
                      className="w-40"
                    >
                      {DEAL_STAGES.map((stage) => (
                        <option key={stage} value={stage}>
                          {t(`stage.${stage}`)}
                        </option>
                      ))}
                    </Select>
                  </ServerForm>
                )}
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <ServerForm
            action={createDealAction}
            fields={{ organizationSlug, contactId: contact.id }}
            submitLabel={t("addDeal")}
          >
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="d-title">{t("dealTitle")}</Label>
                <Input id="d-title" name="title" required minLength={2} maxLength={160} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-amount">{t("amount")}</Label>
                <Input id="d-amount" name="amount" type="number" min={0} step="0.01" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-currency">{t("currency")}</Label>
                <Input id="d-currency" name="currency" defaultValue="USD" maxLength={3} />
              </div>
            </div>
          </ServerForm>
        )}
      </section>

      <section aria-labelledby="activity-title" className="space-y-3">
        <h2 id="activity-title" className="text-lg font-semibold tracking-tight">
          {t("activity")}
        </h2>
        {detail.activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noActivity")}</p>
        ) : (
          <ul className="space-y-2">
            {detail.activities.map((activity) => (
              <li key={activity.id} className="rounded-md border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">
                  {t(`activityType.${activity.type}`)} · {activity.authorName ?? t("formerMember")}{" "}
                  · {activity.occurredAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                </p>
                {activity.body && <p className="whitespace-pre-wrap text-sm">{activity.body}</p>}
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <ServerForm
            action={addActivityAction}
            fields={{ organizationSlug, contactId: contact.id }}
            submitLabel={t("addActivity")}
          >
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="a-type">{t("activityTypeLabel")}</Label>
                <Select id="a-type" name="type" defaultValue="NOTE">
                  {ACTIVITY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`activityType.${type}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="a-body">{t("activityBody")}</Label>
                <Input id="a-body" name="body" required maxLength={2000} />
              </div>
            </div>
          </ServerForm>
        )}
      </section>

      {canErase && (
        <Card className="space-y-3">
          <CardTitle className="text-lg">{t("eraseTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("eraseBody")}</p>
          <ActionButton action={eraseContactAction} fields={fields} label={t("erase")} />
        </Card>
      )}
    </WorkspaceShell>
  );
}
