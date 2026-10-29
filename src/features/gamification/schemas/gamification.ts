import { z } from "zod";

/** Points per completed task by priority. Fixed values; there is no balance to spend. */
export const TASK_POINTS = { LOW: 5, MEDIUM: 10, HIGH: 15, URGENT: 20 } as const;

/** Anti-farming limits. */
export const DAILY_AWARD_CAP = 10;
/** Completing a task you created yourself within this window earns nothing. */
export const SELF_CREATED_COOLDOWN_MS = 10 * 60_000;

export const LEADERBOARD_RANGES = ["week", "month", "all"] as const;
export const LEADERBOARD_LIMIT = 20;
export const MAX_CHALLENGE_DAYS = 366;

const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);

export const createChallengeSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    description: z.preprocess(emptyToUndefined, z.string().trim().max(1000).optional()),
    target: z.coerce.number().int().min(1).max(1000),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .superRefine((value, ctx) => {
    if (value.endsAt <= value.startsAt) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "The end must be after the start.",
      });
    } else if (
      value.endsAt.getTime() - value.startsAt.getTime() >
      MAX_CHALLENGE_DAYS * 86_400_000
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "A challenge can last at most a year.",
      });
    }
  });

export const challengeIdSchema = z.uuid();
export const visibilitySchema = z.enum(["OFF", "OPT_IN"]);
export const leaderboardRangeSchema = z.enum(LEADERBOARD_RANGES).default("week");
