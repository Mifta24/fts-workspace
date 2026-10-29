import { z } from "zod";

export const taskIdSchema = z.uuid();

export const TASK_STATUSES = [
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "COMPLETED",
  "CANCELLED",
] as const;
export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskStatusValue = (typeof TASK_STATUSES)[number];
export type TaskPriorityValue = (typeof TASK_PRIORITIES)[number];

/** Empty form fields arrive as "" or null; treat them as "not provided". */
const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(emptyToUndefined, schema.optional());
/** For updates: "" clears the field (null), omitted leaves it unchanged. */
const clearable = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? null : value), schema.nullable().optional());

function refineDates(value: { startsAt?: Date | null; dueAt?: Date | null }, ctx: z.RefinementCtx) {
  if (value.startsAt && value.dueAt && value.startsAt > value.dueAt) {
    ctx.addIssue({
      code: "custom",
      path: ["dueAt"],
      message: "Due date is before the start date.",
    });
  }
}

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    description: optional(z.string().trim().max(10_000)),
    projectId: optional(z.uuid()),
    goalId: optional(z.uuid()),
    parentTaskId: optional(z.uuid()),
    assigneeId: optional(z.uuid()),
    status: z.enum(TASK_STATUSES).default("TODO"),
    priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
    startsAt: optional(z.coerce.date()),
    dueAt: optional(z.coerce.date()),
  })
  .superRefine(refineDates);

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    description: clearable(z.string().trim().max(10_000)),
    projectId: clearable(z.uuid()),
    goalId: clearable(z.uuid()),
    parentTaskId: clearable(z.uuid()),
    assigneeId: clearable(z.uuid()),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(TASK_PRIORITIES),
    startsAt: clearable(z.coerce.date()),
    dueAt: clearable(z.coerce.date()),
  })
  .partial()
  .superRefine(refineDates);

export const taskFilterSchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: z.uuid().optional(),
  goalId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  parentTaskId: z.uuid().optional(),
  overdue: z.boolean().optional(),
});
export type TaskFilter = z.infer<typeof taskFilterSchema>;

export const commentSchema = z.object({ body: z.string().trim().min(1).max(5000) });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
