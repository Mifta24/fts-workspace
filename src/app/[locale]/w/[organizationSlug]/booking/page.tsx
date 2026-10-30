import { getTranslations } from "next-intl/server";
import { ServerForm } from "@/components/server-form";
import { Card, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { BookingSettingsFields } from "@/features/booking/components/settings-fields";
import { createBookingPageAction } from "@/features/booking/server/actions";
import { listBookingPages } from "@/features/booking/server/booking-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { getTimeZone } from "@/features/scheduling/server/scheduling-service";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";

export default async function BookingPagesPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/booking">) {
  const { organizationSlug } = await params;
  const context = await requireWorkspace(organizationSlug, "booking:manage");
  const deps = { prisma: db() };
  const [t, pages, zone] = await Promise.all([
    getTranslations("Booking"),
    listBookingPages(deps, context),
    getTimeZone(deps, context),
  ]);

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
