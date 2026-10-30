import { describe, expect, it } from "vitest";
import { formatBytes, percentUsed } from "@/features/billing/schemas/format";
import {
  FEATURES,
  PLANS,
  PLAN_KEYS,
  resolveEntitlements,
  type SubscriptionRow,
} from "@/features/billing/schemas/plans";

const NOW = new Date("2026-11-01T12:00:00Z");
const DAY = 86_400_000;

describe("resolveEntitlements", () => {
  it("treats a workspace without a subscription as unmetered", () => {
    const result = resolveEntitlements(null, NOW);
    expect(result).toMatchObject({
      plan: "UNMETERED",
      seats: null,
      aiDailyTokens: null,
      aiMonthlyTokens: null,
      trialExpired: false,
    });
    expect(result.features).toEqual(FEATURES);
  });

  it("applies the plan while it is active", () => {
    const row: SubscriptionRow = { planKey: "BUSINESS", status: "ACTIVE", trialEndsAt: null };
    expect(resolveEntitlements(row, NOW)).toMatchObject({
      plan: "BUSINESS",
      seats: PLANS.BUSINESS.seats,
      storageBytes: PLANS.BUSINESS.storageBytes,
      trialEndsAt: null,
    });
  });

  it("applies the trial plan until the trial ends, then falls back to FREE", () => {
    const trial = (days: number): SubscriptionRow => ({
      planKey: "TEAM",
      status: "TRIALING",
      trialEndsAt: new Date(NOW.getTime() + days * DAY),
    });
    expect(resolveEntitlements(trial(3), NOW)).toMatchObject({
      plan: "TEAM",
      trialExpired: false,
      trialEndsAt: new Date(NOW.getTime() + 3 * DAY),
    });
    expect(resolveEntitlements(trial(-1), NOW)).toMatchObject({
      plan: "FREE",
      trialExpired: true,
      seats: PLANS.FREE.seats,
    });
    // The end instant itself is already over.
    expect(resolveEntitlements(trial(0), NOW).plan).toBe("FREE");
  });

  it("never lets a smaller plan allow more than a larger one", () => {
    for (let i = 1; i < PLAN_KEYS.length; i++) {
      const small = PLANS[PLAN_KEYS[i - 1]!];
      const large = PLANS[PLAN_KEYS[i]!];
      expect(large.seats).toBeGreaterThanOrEqual(small.seats);
      expect(large.storageBytes).toBeGreaterThanOrEqual(small.storageBytes);
      expect(large.aiDailyTokens).toBeGreaterThanOrEqual(small.aiDailyTokens);
      expect(large.aiMonthlyTokens).toBeGreaterThanOrEqual(small.aiMonthlyTokens);
      for (const feature of small.features) expect(large.features).toContain(feature);
    }
  });
});

describe("usage formatting", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(200 * 1024 * 1024)).toBe("200 MB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5 GB");
  });

  it("computes a bounded percentage", () => {
    expect(percentUsed(50, 200)).toBe(25);
    expect(percentUsed(500, 200)).toBe(100);
    expect(percentUsed(5, null)).toBeNull();
    expect(percentUsed(0, 0)).toBe(100);
  });
});
