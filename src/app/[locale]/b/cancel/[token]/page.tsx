import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CancelBookingForm } from "@/features/booking/components/cancel-booking";
import { getPublicCancellation } from "@/features/booking/server/booking-service";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { formatInZone } from "@/lib/time-zone";

export default async function CancelBookingPage({
  params,
}: PageProps<"/[locale]/b/cancel/[token]">) {
  const { token } = await params;
  const booking = await getPublicCancellation({ prisma: db() }, token).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const t = await getTranslations("PublicBooking");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-10">
      <p className="text-sm text-muted-foreground">{booking.organizationName}</p>
      <h1 className="text-2xl font-semibold tracking-tight">{booking.title}</h1>
      <p className="text-muted-foreground">
        {formatInZone(booking.startsAt, booking.timeZone)} ({booking.timeZone})
      </p>
      {booking.open ? (
        <CancelBookingForm token={token} />
      ) : (
        <p role="status" className="rounded-md border border-border bg-card p-4">
          {t("cancelClosed")}
        </p>
      )}
    </main>
  );
}
