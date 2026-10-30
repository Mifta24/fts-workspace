"use client";

import { useTranslations } from "next-intl";
import { useActionState, useMemo } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HONEYPOT_FIELD } from "@/features/booking/schemas/booking";
import { bookSlotAction, type BookingActionState } from "@/features/booking/server/actions";
import { formatInZone } from "@/lib/time-zone";

/** Free slots grouped by day, and the form that books the chosen one. */
export function PublicBookingClient({
  token,
  slots,
  zone,
  consentText,
}: {
  token: string;
  /** ISO instants of the free slots, soonest first. */
  slots: string[];
  /** Zone the times are shown in. */
  zone: string;
  consentText: string;
}) {
  const t = useTranslations("PublicBooking");
  const common = useTranslations("Common");
  const [state, action, pending] = useActionState<BookingActionState, FormData>(bookSlotAction, {});

  const days = useMemo(() => {
    const byDay = new Map<string, { value: string; time: string }[]>();
    for (const value of slots) {
      const text = formatInZone(new Date(value), zone);
      const day = text.slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), { value, time: text.slice(11) }]);
    }
    return [...byDay.entries()];
  }, [slots, zone]);

  if (state.ok && state.booked) {
    return (
      <p role="status" className="rounded-md border border-border bg-card p-4">
        {t("booked", { time: `${formatInZone(new Date(state.booked.startsAt), zone)} (${zone})` })}
      </p>
    );
  }
  if (state.ok) {
    // A bot's filled-in honeypot gets the same friendly answer as a real booking.
    return (
      <p role="status" className="rounded-md border border-border bg-card p-4">
        {t("bookedGeneric")}
      </p>
    );
  }
  if (days.length === 0) {
    return <p className="text-muted-foreground">{t("noSlots")}</p>;
  }

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-4">
        {days.map(([day, times]) => (
          <fieldset key={day} className="space-y-2">
            <legend className="text-sm font-medium">{day}</legend>
            <div className="flex flex-wrap gap-2">
              {times.map((slot) => (
                <label
                  key={slot.value}
                  className="cursor-pointer rounded-md border border-border bg-card px-3 py-1 text-sm has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <input
                    type="radio"
                    name="startsAt"
                    value={slot.value}
                    required
                    className="sr-only"
                  />
                  {slot.time}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="b-name">{t("name")}</Label>
          <Input
            id="b-name"
            name="name"
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="b-email">{t("email")}</Label>
          <Input
            id="b-email"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="b-note">{t("note")}</Label>
          <Input id="b-note" name="note" maxLength={500} />
        </div>
      </div>
      {/* Honeypot: invisible to people and assistive technology, tempting to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" required className="mt-1 size-4" />
        <span>{consentText}</span>
      </label>
      <ActionErrorMessage error={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("book")}
      </Button>
    </form>
  );
}
