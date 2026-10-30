import { toLocalInputValue, zonedToUtc } from "@/lib/time-zone";

/**
 * Which start times a booking page offers. Pure: the caller passes the page's rules, the owner's
 * busy intervals and the clock, so the same function decides what a visitor is shown and what the
 * server accepts when they book.
 */
export type SlotRules = {
  durationMinutes: number;
  timeZone: string;
  /** ISO weekdays, 1 = Monday ... 7 = Sunday. */
  weekdays: readonly number[];
  startMinute: number;
  endMinute: number;
  minNoticeHours: number;
  maxDaysAhead: number;
};

export type Interval = { startsAt: Date; endsAt: Date };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** A page never lists more than this many slots, however short the slots are. */
export const MAX_SLOTS = 500;

const pad = (value: number) => String(value).padStart(2, "0");

export function computeSlots(rules: SlotRules, busy: readonly Interval[], now: Date): Date[] {
  const earliest = now.getTime() + rules.minNoticeHours * HOUR;
  const latest = now.getTime() + rules.maxDaysAhead * DAY;
  const duration = rules.durationMinutes * MINUTE;
  const [year, month, day] = toLocalInputValue(now, rules.timeZone)
    .slice(0, 10)
    .split("-")
    .map(Number) as [number, number, number];
  const firstDay = Date.UTC(year, month - 1, day);

  const slots: Date[] = [];
  // One day more than the horizon, because the zone's date can be ahead of or behind UTC.
  for (let offset = 0; offset <= rules.maxDaysAhead + 1; offset++) {
    const date = new Date(firstDay + offset * DAY);
    const isoWeekday = ((date.getUTCDay() + 6) % 7) + 1;
    if (!rules.weekdays.includes(isoWeekday)) continue;
    const dateText = date.toISOString().slice(0, 10);
    for (
      let minute = rules.startMinute;
      minute + rules.durationMinutes <= rules.endMinute;
      minute += rules.durationMinutes
    ) {
      const instant = zonedToUtc(
        `${dateText}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`,
        rules.timeZone,
      );
      // A wall-clock time skipped by a clock change simply has no slot.
      if (!instant) continue;
      const start = instant.getTime();
      if (start < earliest || start >= latest) continue;
      const end = start + duration;
      if (
        busy.some(
          (interval) => interval.startsAt.getTime() < end && interval.endsAt.getTime() > start,
        )
      ) {
        continue;
      }
      slots.push(instant);
    }
  }
  slots.sort((a, b) => a.getTime() - b.getTime());
  return slots.slice(0, MAX_SLOTS);
}
