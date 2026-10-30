import { z } from "zod";

export const PERIOD_CHOICES = [7, 30, 90] as const;
export const DEFAULT_PERIOD_DAYS = 30;

/** Anything that is not an offered period falls back to the default instead of failing. */
export const periodSchema = z
  .preprocess(
    (value) => (typeof value === "string" ? Number(value) : value),
    z.literal([...PERIOD_CHOICES]),
  )
  .catch(DEFAULT_PERIOD_DAYS);
