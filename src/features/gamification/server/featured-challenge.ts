import type { ChallengeView } from "@/features/gamification/server/gamification-service";

/**
 * The one challenge worth showing on the overview: a running one the person has not finished,
 * else a finished running one, so the win stays visible. The service already orders by end date.
 */
export function pickFeaturedChallenge(challenges: readonly ChallengeView[]): ChallengeView | null {
  const running = challenges.filter((challenge) => challenge.state === "running");
  return running.find((challenge) => !challenge.completed) ?? running[0] ?? null;
}
