import type { ProgressMode } from "@/generated/prisma/client";

export type ProgressInput = {
  progressMode: ProgressMode;
  manualProgress: number | null;
  targetValue: number | null;
  currentValue: number | null;
  /** Counts of the goal's non-cancelled tasks; omitted when unknown. */
  tasks?: { total: number; completed: number };
  /** Counts of the goal's milestones; omitted when unknown. */
  milestones?: { total: number; completed: number };
};

/**
 * Goal progress as an integer percentage (0-100), or null when it cannot be
 * computed yet. Task-based progress is completed / non-cancelled tasks linked to the
 * goal (null while it has none); milestone-based progress is completed / total milestones.
 */
export function computeGoalProgress(goal: ProgressInput): number | null {
  switch (goal.progressMode) {
    case "MANUAL":
      return goal.manualProgress === null ? 0 : clampPercent(goal.manualProgress);
    case "NUMERIC_KPI": {
      if (goal.targetValue === null || goal.targetValue <= 0) return null;
      return clampPercent(((goal.currentValue ?? 0) / goal.targetValue) * 100);
    }
    case "TASK_BASED": {
      const tasks = goal.tasks;
      if (!tasks || tasks.total === 0) return null;
      return clampPercent((tasks.completed / tasks.total) * 100);
    }
    case "MILESTONE_BASED": {
      const milestones = goal.milestones;
      if (!milestones || milestones.total === 0) return null;
      return clampPercent((milestones.completed / milestones.total) * 100);
    }
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}
