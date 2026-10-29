import { describe, expect, it } from "vitest";
import {
  applySelectionSchema,
  MAX_PLAN_TASKS,
  parseModelPlan,
} from "@/features/ai-planner/schemas/plan";

describe("parseModelPlan", () => {
  it("accepts a clean JSON answer and fills defaults", () => {
    const tasks = parseModelPlan(
      '{"tasks":[{"title":"Set up auth","priority":"HIGH","estimatedDays":2},{"title":"Write docs"}]}',
    );
    expect(tasks).toEqual([
      { title: "Set up auth", priority: "HIGH", estimatedDays: 2 },
      { title: "Write docs", priority: "MEDIUM" },
    ]);
  });

  it("tolerates code fences and surrounding prose", () => {
    const raw =
      'Sure! ```json\n{"tasks":[{"title":"Do the thing","priority":"LOW"}]}\n``` Hope that helps.';
    expect(parseModelPlan(raw)).toEqual([{ title: "Do the thing", priority: "LOW" }]);
  });

  it("drops fields the model should never control", () => {
    const tasks = parseModelPlan(
      '{"tasks":[{"title":"Sneaky task","priority":"LOW","assigneeId":"abc","status":"COMPLETED","role":"OWNER","organizationId":"x"}]}',
    );
    expect(tasks).toEqual([{ title: "Sneaky task", priority: "LOW" }]);
  });

  it("rejects malformed, empty, oversized or invalid answers", () => {
    expect(parseModelPlan("no json here")).toBeNull();
    expect(parseModelPlan("{broken")).toBeNull();
    expect(parseModelPlan('{"tasks":[]}')).toBeNull();
    expect(parseModelPlan('{"tasks":[{"title":"x"}]}')).toBeNull();
    expect(parseModelPlan('{"tasks":[{"title":"Valid title","priority":"SOON"}]}')).toBeNull();
    const many = Array.from({ length: MAX_PLAN_TASKS + 1 }, (_, i) => ({
      title: `Task number ${i}`,
    }));
    expect(parseModelPlan(JSON.stringify({ tasks: many }))).toBeNull();
  });
});

describe("applySelectionSchema", () => {
  it("requires at least one valid task", () => {
    expect(applySelectionSchema.safeParse([]).success).toBe(false);
    expect(applySelectionSchema.safeParse([{ title: "x" }]).success).toBe(false);
    expect(
      applySelectionSchema.safeParse([
        { title: "Fine task", priority: "URGENT", estimatedDays: "3" },
      ]).success,
    ).toBe(true);
  });
});
