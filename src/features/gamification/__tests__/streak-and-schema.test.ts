import { describe, expect, it } from "vitest";
import { createChallengeSchema, TASK_POINTS } from "@/features/gamification/schemas/gamification";
import { computeStreak } from "@/features/gamification/server/gamification-service";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("computeStreak", () => {
  it("counts consecutive UTC days ending today", () => {
    const now = day("2026-10-29");
    expect(computeStreak([day("2026-10-29"), day("2026-10-28"), day("2026-10-27")], now)).toBe(3);
  });

  it("keeps a streak alive until the day ends when yesterday had an award", () => {
    const now = day("2026-10-29");
    expect(computeStreak([day("2026-10-28"), day("2026-10-27")], now)).toBe(2);
  });

  it("breaks on a gap, ignores duplicates within a day, and is zero without recent awards", () => {
    const now = day("2026-10-29");
    expect(computeStreak([day("2026-10-29"), day("2026-10-29"), day("2026-10-27")], now)).toBe(1);
    expect(computeStreak([day("2026-10-25")], now)).toBe(0);
    expect(computeStreak([], now)).toBe(0);
  });

  it("uses UTC day boundaries", () => {
    const now = new Date("2026-10-29T00:30:00Z");
    expect(computeStreak([new Date("2026-10-28T23:59:00Z")], now)).toBe(1);
  });
});

describe("points and challenge schema", () => {
  it("has fixed positive point values per priority", () => {
    expect(TASK_POINTS).toEqual({ LOW: 5, MEDIUM: 10, HIGH: 15, URGENT: 20 });
  });

  it("validates challenge windows and targets", () => {
    const base = {
      title: "October push",
      target: "10",
      startsAt: "2026-10-01",
      endsAt: "2026-10-31",
    };
    expect(createChallengeSchema.safeParse(base).success).toBe(true);
    expect(createChallengeSchema.safeParse({ ...base, endsAt: "2026-09-01" }).success).toBe(false);
    expect(createChallengeSchema.safeParse({ ...base, endsAt: "2028-01-01" }).success).toBe(false);
    expect(createChallengeSchema.safeParse({ ...base, target: "0" }).success).toBe(false);
    expect(createChallengeSchema.safeParse({ ...base, target: "100000" }).success).toBe(false);
    expect(createChallengeSchema.safeParse({ ...base, title: "x" }).success).toBe(false);
  });
});
