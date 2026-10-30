import { getTranslations } from "next-intl/server";
import { ServerForm } from "@/components/server-form";
import { Card, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { BookingSettingsFields } from "@/features/booking/components/settings-fields";
import { CONNECT_RESULTS } from "@/features/calendar-sync/schemas/calendar-sync";
import { GoogleCalendarPanel } from "@/features/calendar-sync/components/google-calendar-panel";
import { getGoogleConnection } from "@/features/calendar-sync/server/calendar-sync-service";
import { createBookingPageAction } from "@/features/booking/server/actions";
import { listBookingPages } from "@/features/booking/server/booking-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { getTimeZone } from "@/features/scheduling/server/scheduling-service";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";

export default async function BookingPagesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/w/[organizationSlug]/booking">) {
  const [{ organizationSlug }, query] = await Promise.all([params, searchParams]);
  const context = await requireWorkspace(organizationSlug, "booking:manage");
  const deps = { prisma: db() };
  const [t, pages, zone, google] = await Promise.all([
    getTranslations("Booking"),
    listBookingPages(deps, context),
    getTimeZone(deps, context),
    getGoogleConnection(deps, context),
  ]);
  // Set by the OAuth callback; anything else in the query string is ignored.
  const result = CONNECT_RESULTS.find((value) => value === query.calendar);

  return (
    <WorkspaceShell context={context} active="schedule">
      <Link
        href={`/w/${organizationSlug}/schedule`}
        className="text-sm text-primary hover:underline"
      >
        {t("backToSchedule")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      {result && (
        <p role="status" className="rounded-md border border-border bg-card p-3 text-sm">
          {t(`googleResult.${result}`)}
        </p>
      )}
      <GoogleCalendarPanel
        organizationSlug={organizationSlug}
        configured={google.configured}
        status={google.status}
        connectedOn={google.connectedAt?.toISOString().slice(0, 10) ?? null}
      />

      {pages.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">{t("empty")}</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {pages.map((page) => (
            <li key={page.id} className="rounded-md border border-border bg-card p-3">
              <Link
                href={`/w/${organizationSlug}/booking/${page.id}`}
                className="font-medium text-primary hover:underline"
              >
                {page.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                {t(`status.${page.status}`)} · {t("upcoming", { count: page.upcomingBookings })}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardTitle className="mb-4 text-lg">{t("createTitle")}</CardTitle>
        <ServerForm
          action={createBookingPageAction}
          fields={{ organizationSlug }}
          submitLabel={t("create")}
        >
          <BookingSettingsFields idPrefix="new" defaults={{ timeZone: zone }} />
          <div className="mt-4 space-y-2">
            <Label htmlFor="new-consent">{t("consentLabel")}</Label>
            <Input
              id="new-consent"
              name="consentText"
              required
              minLength={10}
              maxLength={500}
              defaultValue={t("consentDefault")}
            />
            <p className="text-xs text-muted-foreground">{t("consentHint")}</p>
          </div>
        </ServerForm>
      </Card>
    </WorkspaceShell>
  );
}
