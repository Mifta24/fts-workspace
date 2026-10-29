import type { ProgressMode } from "@/generated/prisma/client";

export type ProgressInput = {
  progressMode: ProgressMode;
  manualProgress: number | null;
  targetValue: number | null;
  currentValue: number | null;
};

/**
 * Goal progress as an integer percentage (0-100), or null when it cannot be
 * computed yet. Task- and milestone-based progress depend on tasks and
 * milestones, which arrive in later Phase 1 slices, so they report null.
 */
export function computeGoalProgress(goal: ProgressInput): number | null {
  switch (goal.progressMode) {
    case "MANUAL":
      return goal.manualProgress === null ? 0 : clampPercent(goal.manualProgress);
    case "NUMERIC_KPI": {
      if (goal.targetValue === null || goal.targetValue <= 0) return null;
      return clampPercent(((goal.currentValue ?? 0) / goal.targetValue) * 100);
    }
    case "TASK_BASED":
    case "MILESTONE_BASED":
      return null;
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}
