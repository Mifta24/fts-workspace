import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PublicBookingClient } from "@/features/booking/components/public-booking";
import { getPublicBookingPage } from "@/features/booking/server/booking-service";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { captchaSiteKey } from "@/server/security/captcha";
import { isValidTimeZone, listTimeZones } from "@/lib/time-zone";

export default async function PublicBookingPage({
  params,
  searchParams,
}: PageProps<"/[locale]/b/[token]">) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const page = await getPublicBookingPage({ prisma: db() }, token).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const t = await getTranslations("PublicBooking");
  // Visitors may view the times in their own zone; anything unknown means the page's zone.
  const zone = isValidTimeZone(query.tz) ? query.tz : page.timeZone;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-10">
      <p className="text-sm text-muted-foreground">{page.organizationName}</p>
      <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
      {page.description && <p className="text-muted-foreground">{page.description}</p>}
      <p className="text-sm text-muted-foreground">
        {t("details", { minutes: page.durationMinutes })}
        {page.location ? ` · ${page.location}` : ""}
      </p>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="tz">{t("zone")}</Label>
          <Select id="tz" name="tz" defaultValue={zone}>
            {[...new Set([page.timeZone, ...listTimeZones()])].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="outline" size="sm">
          {t("showTimes")}
        </Button>
      </form>
      <PublicBookingClient
        token={token}
        slots={page.slots.map((slot) => slot.toISOString())}
        zone={zone}
        consentText={page.consentText}
        captchaSiteKey={captchaSiteKey()}
      />
      <p className="text-xs text-muted-foreground">{t("privacy")}</p>
    </main>
  );
}
