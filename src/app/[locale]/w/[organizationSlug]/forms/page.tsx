import { getTranslations } from "next-intl/server";
import { ServerForm } from "@/components/server-form";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FORM_TEMPLATES } from "@/features/forms/schemas/forms";
import { createFormAction } from "@/features/forms/server/actions";
import { listForms } from "@/features/forms/server/forms-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";

export default async function FormsPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/forms">) {
  const { organizationSlug } = await params;
  const context = await requireWorkspace(organizationSlug, "form:manage");
  const [t, forms] = await Promise.all([
    getTranslations("Forms"),
    listForms({ prisma: db() }, context),
  ]);

  return (
    <WorkspaceShell context={context} active="forms">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      {forms.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">{t("empty")}</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {forms.map((form) => (
            <li
              key={form.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
            >
              <div>
                <Link
                  href={`/w/${organizationSlug}/forms/${form.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {form.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {t(`status.${form.status}`)} · {t("submissions", { count: form.submissionCount })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Card>
        <CardTitle className="mb-4 text-lg">{t("createTitle")}</CardTitle>
        <ServerForm
          action={createFormAction}
          fields={{ organizationSlug }}
          submitLabel={t("create")}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="f-template">{t("template")}</Label>
              <Select id="f-template" name="templateId" defaultValue="contact_request">
                {FORM_TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>
                    {t(`templates.${template.id}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="f-title">{t("titleLabel")}</Label>
              <Input id="f-title" name="title" required minLength={2} maxLength={120} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="f-description">{t("descriptionLabel")}</Label>
              <Input id="f-description" name="description" maxLength={1000} />
            </div>
          </div>
        </ServerForm>
      </Card>
    </WorkspaceShell>
  );
}
