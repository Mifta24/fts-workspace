import { ORGANIZATION_QUOTA_BYTES } from "@/features/files/schemas/file";

/**
 * The plan catalog: what each plan allows. It lives in code on purpose, so a change to a limit is
 * a reviewed deploy and not a database edit. Prices are not here: the pricing model is still open
 * (OD-05) and no payment provider is connected (ADR-015). These numbers are starting points for a
 * pilot, not a commercial offer.
 */

export const PLAN_KEYS = ["FREE", "TEAM", "BUSINESS"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/** Things a plan can switch on or off. Reading what already exists is never a feature. */
export const FEATURES = ["ai", "crm", "publicPages"] as const;
export type Feature = (typeof FEATURES)[number];

const MB = 1024 * 1024;
const GB = 1024 * MB;

export type PlanLimits = {
  /** Active members plus pending invitations. */
  seats: number;
  storageBytes: number;
  /** Tokens the AI features may use per UTC day and per UTC month (a hard stop, no overage billing). */
  aiDailyTokens: number;
  aiMonthlyTokens: number;
  features: readonly Feature[];
};

export const PLANS: Record<PlanKey, PlanLimits> = {
  FREE: {
    seats: 5,
    storageBytes: 200 * MB,
    aiDailyTokens: 50_000,
    aiMonthlyTokens: 500_000,
    features: ["ai"],
  },
  TEAM: {
    seats: 25,
    storageBytes: 5 * GB,
    aiDailyTokens: 500_000,
    aiMonthlyTokens: 5_000_000,
    features: ["ai", "crm", "publicPages"],
  },
  BUSINESS: {
    seats: 250,
    storageBytes: 100 * GB,
    aiDailyTokens: 5_000_000,
    aiMonthlyTokens: 50_000_000,
    features: ["ai", "crm", "publicPages"],
  },
};

/** The plan a trial starts on. */
export const TRIAL_PLAN: PlanKey = "TEAM";
export const DEFAULT_TRIAL_DAYS = 14;

/** Storage of a workspace that has no subscription (the limit that applied before billing existed). */
export const UNMETERED_STORAGE_BYTES = ORGANIZATION_QUOTA_BYTES;

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
}

export type SubscriptionRow = {
  planKey: PlanKey;
  status: "TRIALING" | "ACTIVE";
  trialEndsAt: Date | null;
};

export type Entitlements = {
  /** UNMETERED: no subscription row, so no plan limits apply. */
  plan: PlanKey | "UNMETERED";
  /** True when a trial ran out and the workspace fell back to FREE. */
  trialExpired: boolean;
  trialEndsAt: Date | null;
  /** null = no limit from the plan. */
  seats: number | null;
  storageBytes: number;
  aiDailyTokens: number | null;
  aiMonthlyTokens: number | null;
  features: readonly Feature[];
};

/** Pure: what a workspace may do at `now`, given its subscription row (or none). */
export function resolveEntitlements(subscription: SubscriptionRow | null, now: Date): Entitlements {
  if (!subscription) {
    return {
      plan: "UNMETERED",
      trialExpired: false,
      trialEndsAt: null,
      seats: null,
      storageBytes: UNMETERED_STORAGE_BYTES,
      aiDailyTokens: null,
      aiMonthlyTokens: null,
      features: FEATURES,
    };
  }
  const trialExpired =
    subscription.status === "TRIALING" &&
    (subscription.trialEndsAt === null || subscription.trialEndsAt <= now);
  const plan: PlanKey = trialExpired ? "FREE" : subscription.planKey;
  const limits = PLANS[plan];
  return {
    plan,
    trialExpired,
    trialEndsAt: subscription.status === "TRIALING" ? subscription.trialEndsAt : null,
    seats: limits.seats,
    storageBytes: limits.storageBytes,
    aiDailyTokens: limits.aiDailyTokens,
    aiMonthlyTokens: limits.aiMonthlyTokens,
    features: limits.features,
  };
}
