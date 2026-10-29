import { describe, expect, it } from "vitest";
import { computeGoalProgress } from "@/features/goals/server/progress";
import type { GoalView } from "@/features/goals/server/goal-service";
import { buildGoalTree } from "@/features/goals/server/tree";

const base = { manualProgress: null, targetValue: null, currentValue: null };

describe("computeGoalProgress", () => {
  it("returns manual progress clamped to 0-100 and 0 when unset", () => {
    expect(computeGoalProgress({ ...base, progressMode: "MANUAL", manualProgress: 40 })).toBe(40);
    expect(computeGoalProgress({ ...base, progressMode: "MANUAL", manualProgress: 250 })).toBe(100);
    expect(computeGoalProgress({ ...base, progressMode: "MANUAL", manualProgress: -5 })).toBe(0);
    expect(computeGoalProgress({ ...base, progressMode: "MANUAL" })).toBe(0);
  });

  it("derives KPI progress from current/target and clamps overshoot", () => {
    const kpi = { ...base, progressMode: "NUMERIC_KPI" as const };
    expect(computeGoalProgress({ ...kpi, targetValue: 200, currentValue: 50 })).toBe(25);
    expect(computeGoalProgress({ ...kpi, targetValue: 10, currentValue: 30 })).toBe(100);
    expect(computeGoalProgress({ ...kpi, targetValue: 10 })).toBe(0);
  });

  it("never divides by a missing or non-positive target", () => {
    const kpi = { ...base, progressMode: "NUMERIC_KPI" as const, currentValue: 5 };
    expect(computeGoalProgress(kpi)).toBeNull();
    expect(computeGoalProgress({ ...kpi, targetValue: 0 })).toBeNull();
  });

  it("derives task-based progress from completed / total tasks", () => {
    const task = { ...base, progressMode: "TASK_BASED" as const };
    expect(computeGoalProgress({ ...task, tasks: { total: 4, completed: 1 } })).toBe(25);
    expect(computeGoalProgress({ ...task, tasks: { total: 3, completed: 3 } })).toBe(100);
    expect(computeGoalProgress({ ...task, tasks: { total: 0, completed: 0 } })).toBeNull();
    expect(computeGoalProgress(task)).toBeNull();
  });

  it("derives milestone-based progress from completed / total milestones", () => {
    const milestone = { ...base, progressMode: "MILESTONE_BASED" as const };
    expect(computeGoalProgress({ ...milestone, milestones: { total: 4, completed: 3 } })).toBe(75);
    expect(
      computeGoalProgress({ ...milestone, milestones: { total: 0, completed: 0 } }),
    ).toBeNull();
    expect(computeGoalProgress(milestone)).toBeNull();
  });
});

function goal(id: string, parentGoalId: string | null): GoalView {
  return {
    id,
    parentGoalId,
    projectId: null,
    title: id,
    description: null,
    status: "ACTIVE",
    progressMode: "MANUAL",
    progress: 0,
    manualProgress: 0,
    targetValue: null,
    currentValue: null,
    ownerId: "owner",
    dueAt: null,
  };
}

describe("buildGoalTree", () => {
  it("nests children under parents and keeps roots in input order", () => {
    const tree = buildGoalTree([goal("a", null), goal("b", "a"), goal("c", "b"), goal("d", null)]);
    expect(tree.map((n) => n.id)).toEqual(["a", "d"]);
    expect(tree[0]?.children[0]?.children[0]?.id).toBe("c");
  });

  it("promotes goals with a missing parent to roots", () => {
    expect(buildGoalTree([goal("b", "archived")]).map((n) => n.id)).toEqual(["b"]);
  });

  it("terminates on corrupt cyclic data", () => {
    const tree = buildGoalTree([goal("a", "b"), goal("b", "a")]);
    expect(tree.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });
});
