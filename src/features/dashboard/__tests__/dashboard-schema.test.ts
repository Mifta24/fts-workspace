import { describe, expect, it } from "vitest";
import { dashboardFilterSchema } from "@/features/dashboard/schemas/dashboard";

describe("dashboardFilterSchema", () => {
  it("defaults to the last 30 days with no project or assignee", () => {
    expect(dashboardFilterSchema.parse({})).toEqual({
      projectId: undefined,
      assigneeId: undefined,
      range: "30",
    });
  });

  it("treats blank query values as unset", () => {
    expect(dashboardFilterSchema.parse({ projectId: "", assigneeId: "", range: "" }).range).toBe(
      "30",
    );
  });

  it("rejects non-uuid ids and unknown ranges", () => {
    expect(dashboardFilterSchema.safeParse({ projectId: "x" }).success).toBe(false);
    expect(dashboardFilterSchema.safeParse({ range: "365" }).success).toBe(false);
  });
});
