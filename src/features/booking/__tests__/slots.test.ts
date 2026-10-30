import { describe, expect, it } from "vitest";
import { computeSlots, MAX_SLOTS, type SlotRules } from "@/features/booking/schemas/slots";

const HOUR = 3_600_000;
// Monday 2026-11-02 08:00 UTC.
const NOW = new Date("2026-11-02T08:00:00Z");

const rules = (overrides: Partial<SlotRules> = {}): SlotRules => ({
  durationMinutes: 60,
  timeZone: "UTC",
  weekdays: [1, 2, 3, 4, 5],
  startMinute: 9 * 60,
  endMinute: 12 * 60,
  minNoticeHours: 4,
  maxDaysAhead: 7,
  ...overrides,
});
const iso = (slots: Date[]) => slots.map((slot) => slot.toISOString().slice(0, 16));

describe("computeSlots", () => {
  it("offers working-hour slots from the first moment the notice allows", () => {
    const slots = iso(computeSlots(rules({ maxDaysAhead: 2 }), [], NOW));
    // Monday's slots (09-11) start before now + 4 h = 12:00, so the first offer is Tuesday.
    expect(slots).toEqual(["2026-11-03T09:00", "2026-11-03T10:00", "2026-11-03T11:00"]);
  });

  it("keeps to the chosen weekdays and the horizon", () => {
    const slots = iso(computeSlots(rules({ weekdays: [3, 6], maxDaysAhead: 7 }), [], NOW));
    // Wednesday 4 Nov only: Saturday 7 Nov is a 6, but the horizon ends 9 Nov 08:00 and 7 Nov is inside.
    expect(slots.map((s) => s.slice(0, 10))).toEqual([
      "2026-11-04",
      "2026-11-04",
      "2026-11-04",
      "2026-11-07",
      "2026-11-07",
      "2026-11-07",
    ]);
    expect(computeSlots(rules({ weekdays: [1], maxDaysAhead: 1 }), [], NOW)).toEqual([]);
    // A slot exactly at the end of the horizon is not offered.
    const edge = computeSlots(
      rules({
        minNoticeHours: 0,
        maxDaysAhead: 1,
        weekdays: [1, 2],
        startMinute: 8 * 60,
        endMinute: 10 * 60,
      }),
      [],
      NOW,
    );
    expect(iso(edge)).toEqual(["2026-11-02T08:00", "2026-11-02T09:00"]);
  });

  it("drops slots that overlap a busy interval, but not ones that merely touch it", () => {
    const busy = [
      { startsAt: new Date("2026-11-03T10:00:00Z"), endsAt: new Date("2026-11-03T10:30:00Z") },
    ];
    expect(iso(computeSlots(rules({ maxDaysAhead: 2 }), busy, NOW))).toEqual([
      "2026-11-03T09:00",
      "2026-11-03T11:00",
    ]);
    // 09:00-10:00 and the meeting from 10:00 touch only at the boundary.
    const after = [
      { startsAt: new Date("2026-11-03T09:30:00Z"), endsAt: new Date("2026-11-03T10:00:00Z") },
    ];
    expect(iso(computeSlots(rules({ maxDaysAhead: 2 }), after, NOW))).toEqual([
      "2026-11-03T10:00",
      "2026-11-03T11:00",
    ]);
  });

  it("reads working hours in the page's time zone", () => {
    const tokyo = computeSlots(rules({ timeZone: "Asia/Tokyo", maxDaysAhead: 1 }), [], NOW);
    // 09:00-12:00 in Tokyo is 00:00-03:00 UTC.
    expect(iso(tokyo)).toEqual(["2026-11-03T00:00", "2026-11-03T01:00", "2026-11-03T02:00"]);
    // At 22:00 UTC on Monday it is already Tuesday morning in Tokyo; Tuesday's day is still offered once.
    const late = computeSlots(
      rules({ timeZone: "Asia/Tokyo", minNoticeHours: 0, maxDaysAhead: 1 }),
      [],
      new Date("2026-11-02T22:00:00Z"),
    );
    expect(iso(late)).toEqual(["2026-11-03T00:00", "2026-11-03T01:00", "2026-11-03T02:00"]);
  });

  it("follows daylight saving and skips wall-clock times that do not exist", () => {
    // New York jumps from 02:00 to 03:00 on Sunday 8 March 2026.
    const slots = computeSlots(
      rules({
        timeZone: "America/New_York",
        weekdays: [7],
        durationMinutes: 30,
        startMinute: 120,
        endMinute: 240,
        minNoticeHours: 0,
        maxDaysAhead: 5,
      }),
      [],
      new Date("2026-03-06T12:00:00Z"),
    );
    expect(iso(slots)).toEqual(["2026-03-08T07:00", "2026-03-08T07:30"]); // 03:00 and 03:30 EDT
  });

  it("never lists more than the cap", () => {
    const many = computeSlots(
      rules({
        durationMinutes: 15,
        startMinute: 0,
        endMinute: 1440,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        maxDaysAhead: 90,
      }),
      [],
      NOW,
    );
    expect(many).toHaveLength(MAX_SLOTS);
    expect(many[0]!.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 4 * HOUR);
  });
});
