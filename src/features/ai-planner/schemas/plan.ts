import { z } from "zod";
import { TASK_PRIORITIES } from "@/features/tasks/schemas/task";

export const MAX_PLAN_TASKS = 15;

export const planIdSchema = z.uuid();

export const objectiveSchema = z.string().trim().min(10).max(2000);

/** One suggested task. Unknown keys from the model (ids, assignees, status) are dropped. */
export const suggestedTaskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
  estimatedDays: z.coerce.number().int().min(1).max(60).optional(),
});

/** What the model must return. */
export const modelPlanSchema = z.object({
  tasks: z.array(suggestedTaskSchema).min(1).max(MAX_PLAN_TASKS),
});

/** What the reviewer submits when applying: the draft, possibly edited and filtered. */
export const applySelectionSchema = z.array(suggestedTaskSchema).min(1).max(MAX_PLAN_TASKS);

export type SuggestedTask = z.infer<typeof suggestedTaskSchema>;

/** Pulls the JSON object out of a model answer, tolerating code fences and prose around it. */
export function parseModelPlan(raw: string): SuggestedTask[] | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = modelPlanSchema.safeParse(json);
  return parsed.success ? parsed.data.tasks : null;
}
