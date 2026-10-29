import { z } from "zod";

export const goalIdSchema = z.uuid();

export const PROGRESS_MODES = ["TASK_BASED", "MILESTONE_BASED", "NUMERIC_KPI", "MANUAL"] as const;
export const GOAL_STATUSES = ["ACTIVE", "COMPLETED", "ARCHIVED"] as const;
export const EDITABLE_GOAL_STATUSES = ["ACTIVE", "COMPLETED"] as const;

/** Empty form fields arrive as "" or null; treat them as "not provided". */
const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(emptyToUndefined, schema.optional());

const decimal = z.coerce.number().finite().max(1_000_000_000_000);

const goalFields = {
  title: z.string().trim().min(2).max(160),
  description: optional(z.string().trim().max(4000)),
  projectId: optional(z.uuid()),
  parentGoalId: optional(z.uuid()),
  ownerId: optional(z.uuid()),
  progressMode: z.enum(PROGRESS_MODES).default("MANUAL"),
  manualProgress: optional(z.coerce.number().int().min(0).max(100)),
  targetValue: optional(decimal.positive()),
  currentValue: optional(decimal.min(0)),
  dueAt: optional(z.coerce.date()),
};

/** Mode-specific rules shared by create and update. */
function refineProgress(
  value: { progressMode?: (typeof PROGRESS_MODES)[number]; targetValue?: number },
  ctx: z.RefinementCtx,
) {
  if (value.progressMode === "NUMERIC_KPI" && value.targetValue === undefined) {
    ctx.addIssue({ code: "custom", path: ["targetValue"], message: "A KPI goal needs a target." });
  }
}

export const createGoalSchema = z.object(goalFields).superRefine(refineProgress);

export const updateGoalSchema = z
  .object({
    ...goalFields,
    progressMode: z.enum(PROGRESS_MODES).optional(),
    // `null` detaches the goal from its project/parent; omitted leaves it unchanged.
    projectId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable().optional()),
    parentGoalId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable().optional()),
    // `null` clears the field; omitted leaves it unchanged.
    description: z.preprocess(
      (v) => (v === "" ? null : v),
      z.string().trim().max(4000).nullable().optional(),
    ),
    dueAt: z.preprocess((v) => (v === "" ? null : v), z.coerce.date().nullable().optional()),
    // Archiving goes through `archiveGoal` (own permission, subgoal check), never through update.
    status: z.enum(["ACTIVE", "COMPLETED"]).optional(),
  })
  .partial();

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
