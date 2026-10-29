import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ServerForm } from "@/components/server-form";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/action-button";
import { setFormStatusAction, updateFormAction } from "@/features/forms/server/actions";
import { getForm } from "@/features/forms/server/forms-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isAppError } from "@/lib/errors";

export default async function FormPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/forms/[formId]">) {
  const { organizationSlug, formId, locale } = await params;
  const context = await requireWorkspace(organizationSlug, "form:manage");
  const t = await getTranslations("Forms");
  const { form, submissions } = await getForm({ prisma: db() }, context, formId).catch(
    (error: unknown) => {
      if (isAppError(error) && error.code === "NOT_FOUND") notFound();
      throw error;
    },
  );
  const publicUrl = `${env().BETTER_AUTH_URL.replace(/\/+$/, "")}/${locale}/f/${form.publicToken}`;
  const fields = { organizationSlug, id: form.id };

  return (
    <WorkspaceShell context={context} active="forms">
      <Link href={`/w/${organizationSlug}/forms`} className="text-sm text-primary hover:underline">
        {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{form.title}</h1>
      <p className="text-sm text-muted-foreground">{t(`status.${form.status}`)}</p>

      <Card className="space-y-3">
        <CardTitle className="text-lg">{t("publishing")}</CardTitle>
        {form.status === "PUBLISHED" ? (
          <>
            <p className="text-sm">{t("publicLink")}</p>
            <p
              className="break-all rounded-md border border-border bg-muted p-2 font-mono text-xs"
              data-testid="public-url"
            >
              {publicUrl}
            </p>
            <ActionButton
              action={setFormStatusAction}
              fields={{ ...fields, status: "CLOSED" }}
              label={t("close")}
            />
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {form.status === "DRAFT" ? t("draftNote") : t("closedNote")}
            </p>
            <ActionButton
              action={setFormStatusAction}
              fields={{ ...fields, status: "PUBLISHED" }}
              label={t("publish")}
              variant="default"
            />
          </>
        )}
      </Card>

      <Card>
        <CardTitle className="mb-4 text-lg">{t("settings")}</CardTitle>
        <ServerForm
          key={JSON.stringify([form.title, form.description, form.consentText])}
          action={updateFormAction}
          fields={fields}
          submitLabel={t("save")}
          resetOnSuccess={false}
          showSaved
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="s-title">{t("titleLabel")}</Label>
              <Input
                id="s-title"
                name="title"
                defaultValue={form.title}
                required
                minLength={2}
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-description">{t("descriptionLabel")}</Label>
              <Input
                id="s-description"
                name="description"
                defaultValue={form.description ?? ""}
                maxLength={1000}
              />
            </div>
            {form.createsContact && (
              <div className="space-y-2">
                <Label htmlFor="s-consent">{t("consentText")}</Label>
                <Input
                  id="s-consent"
                  name="consentText"
                  defaultValue={form.consentText ?? ""}
                  minLength={10}
                  maxLength={500}
                  disabled={form.status !== "DRAFT"}
                />
                <p className="text-xs text-muted-foreground">{t("consentHint")}</p>
              </div>
            )}
          </div>
        </ServerForm>
      </Card>

      <section aria-labelledby="fields-title" className="space-y-2">
        <h2 id="fields-title" className="text-lg font-semibold tracking-tight">
          {t("fields")}
        </h2>
        <ul className="space-y-1 text-sm">
          {form.fields.map((field) => (
            <li key={field.key}>
              {field.label} · {field.type}
              {field.required ? ` · ${t("required")}` : ""}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t("fieldsFixed")}</p>
      </section>

      <section aria-labelledby="submissions-title" className="space-y-2">
        <h2 id="submissions-title" className="text-lg font-semibold tracking-tight">
          {t("submissionsTitle")}
        </h2>
        {submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noSubmissions")}</p>
        ) : (
          <ul className="space-y-2">
            {submissions.map((submission) => (
              <li
                key={submission.id}
                className="rounded-md border border-border bg-card p-3 text-sm"
              >
                <p className="text-xs text-muted-foreground">
                  {submission.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                  {submission.contactId ? ` · ${t("linkedContact")}` : ""}
                </p>
                {submission.erased ? (
                  <p className="italic text-muted-foreground">{t("erased")}</p>
                ) : (
                  <dl className="grid gap-x-4 sm:grid-cols-[auto_1fr]">
                    {form.fields.map((field) => (
                      <div key={field.key} className="contents">
                        <dt className="text-muted-foreground">{field.label}</dt>
                        <dd className="whitespace-pre-wrap break-words">
                          {String(submission.answers[field.key] ?? "—")}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </WorkspaceShell>
  );
}
