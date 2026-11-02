import { getLocale, getTranslations } from "next-intl/server";
import { ActionButton } from "@/components/action-button";
import { ServerForm } from "@/components/server-form";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { dueAfter } from "@/features/organizations/schemas/deletion";
import {
  cancelDeletionAction,
  requestDeletionAction,
} from "@/features/organizations/server/deletion-actions";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { Link } from "@/i18n/navigation";

export default async function SettingsPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/settings">) {
  const { organizationSlug } = await params;
  const context = await requireWorkspace(organizationSlug, "organization:delete");
  const [t, locale] = await Promise.all([getTranslations("Settings"), getLocale()]);
  const date = (value: Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(value);
  const requestedAt = context.organization.deletionRequestedAt ?? null;
  const fields = { organizationSlug: context.organization.slug };

  return (
    <WorkspaceShell context={context} active="settings">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      <section aria-labelledby="delete-title" className="space-y-3">
        <h2 id="delete-title" className="text-lg font-semibold tracking-tight">
          {t("deleteTitle")}
        </h2>
        <Card className="space-y-4">
          <p className="text-sm">{t("deleteIntro")}</p>
          <p className="text-sm text-muted-foreground">{t("deleteNoCopy")}</p>
          {requestedAt ? (
            <div className="space-y-3" role="status" data-testid="deletion-pending">
              <p className="font-medium">{t("pendingTitle")}</p>
              <p className="text-sm">
                {t("pendingBody", {
                  requested: date(requestedAt),
                  due: date(dueAfter(requestedAt)),
                })}
              </p>
              <ActionButton
                action={cancelDeletionAction}
                fields={fields}
                label={t("cancelButton")}
              />
            </div>
          ) : (
            <ServerForm
              action={requestDeletionAction}
              fields={fields}
              submitLabel={t("requestButton")}
              className="space-y-3"
            >
              <div className="space-y-2">
                <Label htmlFor="delete-confirm">
                  {t("confirmLabel", { slug: context.organization.slug })}
                </Label>
                <Input
                  id="delete-confirm"
                  name="confirm"
                  autoComplete="off"
                  required
                  maxLength={80}
                />
              </div>
            </ServerForm>
          )}
          <Link href="/privacy" className="text-sm text-primary hover:underline">
            {t("privacyLink")}
          </Link>
        </Card>
      </section>
    </WorkspaceShell>
  );
}
