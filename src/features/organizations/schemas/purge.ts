import { z } from "zod";

/** Who started a purge. Only the operator console has a user; the CLI and the worker do not. */
export type PurgeTrigger = "admin" | "cli" | "worker";
export type PurgeActor = { trigger: PurgeTrigger; userId: string | null };

export type PurgeResult = {
  organizationId: string;
  /** True when the workspace had been purged before; nothing was changed by this call. */
  alreadyPurged: boolean;
  filesRemoved: number;
  rowCounts: Record<string, number>;
};

/** How often the worker looks for workspaces whose waiting period is over (when switched on). */
export const PURGE_SWEEP_INTERVAL_MS = 5 * 60_000;
/** Workspaces purged per sweep, so one long purge never starves the other jobs. */
export const PURGE_BATCH = 3;

/** The operator types the workspace address to confirm; case-insensitive and trimmed. */
export const purgeConfirmSchema = z.object({
  organizationId: z.uuid(),
  confirm: z.string().trim().min(1).max(80),
});
