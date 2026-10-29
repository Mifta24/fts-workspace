import { z } from "zod";

export const DASHBOARD_RANGES = ["7", "30", "90", "all"] as const;

/** Query-string filters; empty strings mean "not set". Invalid values fail validation. */
const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);

export const dashboardFilterSchema = z.object({
  projectId: z.preprocess(blankToUndefined, z.uuid().optional()),
  assigneeId: z.preprocess(blankToUndefined, z.uuid().optional()),
  range: z.preprocess(blankToUndefined, z.enum(DASHBOARD_RANGES).default("30")),
});

export type DashboardFilter = z.infer<typeof dashboardFilterSchema>;
