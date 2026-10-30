import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionButton } from "@/components/action-button";
import { ServerForm } from "@/components/server-form";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BookingSettingsFields } from "@/features/booking/components/settings-fields";
import {
  setBookingPageStatusAction,
  updateBookingPageAction,
} from "@/features/booking/server/actions";
import { getBookingPage } from "@/features/booking/server/booking-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isAppError } from "@/lib/errors";

export default async function BookingPageDetail({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/booking/[pageId]">) {
  const { organizationSlug, pageId, locale } = await params;
  const context = await requireWorkspace(organizationSlug, "booking:manage");
  const t = await getTranslations("Booking");
  const page = await getBookingPage({ prisma: db() }, context, pageId).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const publicUrl = `${env().BETTER_AUTH_URL.replace(/\/+$/, "")}/${locale}/b/${page.publicToken}`;
  const fields = { organizationSlug, id: page.id };

  return (
    <WorkspaceShell context={context} active="schedule">
      <Link
        href={`/w/${organizationSlug}/booking`}
        className="text-sm text-primary hover:underline"
      >
        {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
      <p className="text-sm text-muted-foreground">
        {t(`status.${page.status}`)} · {t("upcoming", { count: page.upcomingBookings })}
      </p>

      <Card className="space-y-3">
        <CardTitle className="text-lg">{t("publishing")}</CardTitle>
        {page.status === "PUBLISHED" ? (
          <>
            <p className="text-sm">{t("publicLink")}</p>
            <p
              className="break-all rounded-md border border-border bg-muted p-2 font-mono text-xs"
              data-testid="public-url"
            >
              {publicUrl}
            </p>
            <ActionButton
              action={setBookingPageStatusAction}
              fields={{ ...fields, status: "CLOSED" }}
              label={t("close")}
            />
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {page.status === "DRAFT" ? t("draftNote") : t("closedNote")}
            </p>
            <ActionButton
              action={setBookingPageStatusAction}
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
          key={JSON.stringify(page)}
          action={updateBookingPageAction}
          fields={fields}
          submitLabel={t("save")}
          resetOnSuccess={false}
          showSaved
        >
          <BookingSettingsFields idPrefix="edit" defaults={page} />
          <div className="mt-4 space-y-2">
            <Label htmlFor="edit-consent">{t("consentLabel")}</Label>
            <Input
              id="edit-consent"
              name="consentText"
              defaultValue={page.consentText}
              minLength={10}
              maxLength={500}
              required
              readOnly={page.status !== "DRAFT"}
            />
            <p className="text-xs text-muted-foreground">{t("consentHint")}</p>
          </div>
        </ServerForm>
      </Card>
    </WorkspaceShell>
  );
}
