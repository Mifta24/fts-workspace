import { describe, expect, it } from "vitest";
import { pickFeaturedChallenge } from "@/features/gamification/server/featured-challenge";
import type { ChallengeView } from "@/features/gamification/server/gamification-service";

const challenge = (overrides: Partial<ChallengeView>): ChallengeView => ({
  id: "c",
  title: "Challenge",
  description: null,
  target: 5,
  startsAt: new Date("2040-01-01T00:00:00Z"),
  endsAt: new Date("2040-02-01T00:00:00Z"),
  state: "running",
  progress: 0,
  completed: false,
  ...overrides,
});

describe("pickFeaturedChallenge", () => {
  it("returns nothing when no challenge is running", () => {
    expect(pickFeaturedChallenge([])).toBeNull();
    expect(
      pickFeaturedChallenge([challenge({ state: "upcoming" }), challenge({ state: "ended" })]),
    ).toBeNull();
  });

  it("prefers a running challenge the person has not finished yet", () => {
    const done = challenge({ id: "done", progress: 5, completed: true });
    const open = challenge({ id: "open", progress: 2 });
    expect(pickFeaturedChallenge([done, open])?.id).toBe("open");
  });

  it("falls back to a finished running challenge so the win stays visible", () => {
    const done = challenge({ id: "done", progress: 5, completed: true });
    expect(pickFeaturedChallenge([challenge({ state: "ended" }), done])?.id).toBe("done");
  });

  it("keeps the service's order, which puts the one ending first", () => {
    const soon = challenge({ id: "soon" });
    const later = challenge({ id: "later" });
    expect(pickFeaturedChallenge([soon, later])?.id).toBe("soon");
  });
});
