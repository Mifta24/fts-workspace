import { describe, expect, it } from "vitest";
import { createGoalSchema, updateGoalSchema } from "@/features/goals/schemas/goal";

describe("createGoalSchema", () => {
  it("treats empty form fields as not provided", () => {
    const result = createGoalSchema.parse({
      title: "Ship v1",
      projectId: "",
      dueAt: "",
      manualProgress: "",
    });
    expect(result).toMatchObject({ title: "Ship v1", progressMode: "MANUAL" });
    expect(result.projectId).toBeUndefined();
    expect(result.dueAt).toBeUndefined();
  });

  it("rejects short titles, out-of-range progress and non-uuid references", () => {
    expect(createGoalSchema.safeParse({ title: "x" }).success).toBe(false);
    expect(createGoalSchema.safeParse({ title: "Valid", manualProgress: 101 }).success).toBe(false);
    expect(createGoalSchema.safeParse({ title: "Valid", parentGoalId: "not-a-uuid" }).success).toBe(
      false,
    );
  });

  it("requires a target for KPI goals", () => {
    expect(
      createGoalSchema.safeParse({ title: "Revenue", progressMode: "NUMERIC_KPI" }).success,
    ).toBe(false);
    expect(
      createGoalSchema.safeParse({
        title: "Revenue",
        progressMode: "NUMERIC_KPI",
        targetValue: "1000",
      }).success,
    ).toBe(true);
  });
});

describe("updateGoalSchema", () => {
  it("maps an empty parent to null (detach) and leaves omitted fields undefined", () => {
    const result = updateGoalSchema.parse({ parentGoalId: "" });
    expect(result.parentGoalId).toBeNull();
    expect(result.title).toBeUndefined();
  });
});
