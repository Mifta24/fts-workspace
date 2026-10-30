import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ServerForm } from "@/components/server-form";
import { JOURNEY_STAGES, journeyStageSchema } from "@/features/crm/schemas/crm";
import { createContactAction } from "@/features/crm/server/actions";
import { listContacts } from "@/features/crm/server/crm-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { roleHasPermission } from "@/lib/permissions/matrix";

export default async function CrmPage({
  params,
  searchParams,
}: PageProps<"/[locale]/w/[organizationSlug]/crm">) {
  const [{ organizationSlug }, query] = await Promise.all([params, searchParams]);
  const context = await requireWorkspace(organizationSlug, "crm:read");
  const q = typeof query.q === "string" ? query.q : "";
  const stage = journeyStageSchema.safeParse(query.stage);
  const t = await getTranslations("Crm");
  const contacts = await listContacts({ prisma: db() }, context, q, {
    stage: stage.success ? stage.data : undefined,
  }).catch((error: unknown) => {
    if (isAppError(error) && error.code === "INVALID_INPUT") return [];
    throw error;
  });
  const canWrite = roleHasPermission(context.role, "crm:write");
  const seesAll = roleHasPermission(context.role, "crm:read-all");

  return (
    <WorkspaceShell context={context} active="crm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <Link
          href={`/w/${organizationSlug}/crm/pipeline`}
          className="text-sm font-medium text-primary hover:underline"
        >
          {t("pipeline")}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">{seesAll ? t("introAll") : t("introOwn")}</p>

      <form method="get" role="search" className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor="crm-q">{t("searchLabel")}</Label>
          <Input id="crm-q" name="q" defaultValue={q} maxLength={100} className="w-72" />
        </div>
        {stage.success && <input type="hidden" name="stage" value={stage.data} />}
        <Button type="submit">{t("search")}</Button>
      </form>
      <nav aria-label={t("journeyFilter")} className="flex flex-wrap gap-2 text-sm">
        {[undefined, ...JOURNEY_STAGES].map((value) => {
          const active = (stage.success ? stage.data : undefined) === value;
          const params = new URLSearchParams();
          if (q) params.set("q", q);
          if (value) params.set("stage", value);
          return (
            <Link
              key={value ?? "all"}
              href={`/w/${organizationSlug}/crm${params.size ? `?${params}` : ""}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-md border border-border px-3 py-1 ${
                active ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"
              }`}
            >
              {value ? t(`journey.${value}`) : t("journeyAll")}
            </Link>
          );
        })}
      </nav>

      {contacts.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">
            {q ? t("noResults") : canWrite ? t("empty") : t("emptyReadOnly")}
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {contacts.map((contact) => (
            <li key={contact.id} className="rounded-md border border-border bg-card p-3">
              <Link
                href={`/w/${organizationSlug}/crm/${contact.id}`}
                className="font-medium text-primary hover:underline"
              >
                {contact.name}
              </Link>
              <p className="text-xs text-muted-foreground">
                {[
                  contact.company,
                  contact.email,
                  t(`journey.${contact.journeyStage}`),
                  t(`consent.${contact.consentStatus}`),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <Card>
          <CardTitle className="mb-4 text-lg">{t("createTitle")}</CardTitle>
          <ServerForm
            action={createContactAction}
            fields={{ organizationSlug }}
            submitLabel={t("create")}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="c-name">{t("name")}</Label>
                <Input id="c-name" name="name" required minLength={2} maxLength={120} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-company">{t("company")}</Label>
                <Input id="c-company" name="company" maxLength={120} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-email">{t("email")}</Label>
                <Input id="c-email" name="email" type="email" maxLength={254} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-phone">{t("phone")}</Label>
                <Input id="c-phone" name="phone" maxLength={40} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-consent">{t("consentLabel")}</Label>
                <Select id="c-consent" name="consentStatus" defaultValue="">
                  <option value="">{t("consent.UNKNOWN")}</option>
                  <option value="GRANTED">{t("consent.GRANTED")}</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-source">{t("consentSource")}</Label>
                <Input
                  id="c-source"
                  name="consentSource"
                  maxLength={120}
                  aria-describedby="c-source-hint"
                />
                <p id="c-source-hint" className="text-xs text-muted-foreground">
                  {t("consentSourceHint")}
                </p>
              </div>
            </div>
          </ServerForm>
        </Card>
      )}
    </WorkspaceShell>
  );
}
