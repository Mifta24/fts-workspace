import { describe, expect, it } from "vitest";
import {
  commentSchema,
  createTaskSchema,
  taskFilterSchema,
  updateTaskSchema,
} from "@/features/tasks/schemas/task";

describe("createTaskSchema", () => {
  it("applies defaults and treats empty form fields as not provided", () => {
    const task = createTaskSchema.parse({
      title: "Write docs",
      goalId: "",
      assigneeId: "",
      dueAt: "",
    });
    expect(task).toMatchObject({ status: "TODO", priority: "MEDIUM" });
    expect(task.goalId).toBeUndefined();
    expect(task.dueAt).toBeUndefined();
  });

  it("rejects bad titles, enums, ids and inverted dates", () => {
    expect(createTaskSchema.safeParse({ title: "x" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "Valid", status: "DONE" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "Valid", assigneeId: "me" }).success).toBe(false);
    expect(
      createTaskSchema.safeParse({ title: "Valid", startsAt: "2026-11-05", dueAt: "2026-11-01" })
        .success,
    ).toBe(false);
  });
});

describe("updateTaskSchema", () => {
  it("distinguishes clearing (empty -> null) from leaving unchanged (omitted)", () => {
    const result = updateTaskSchema.parse({ assigneeId: "" });
    expect(result.assigneeId).toBeNull();
    expect(result.goalId).toBeUndefined();
    expect(result.status).toBeUndefined();
  });
});

describe("filters and comments", () => {
  it("rejects unknown statuses and non-uuid filters", () => {
    expect(taskFilterSchema.safeParse({ status: "NOPE" }).success).toBe(false);
    expect(taskFilterSchema.safeParse({ assigneeId: "x" }).success).toBe(false);
  });

  it("requires a non-empty trimmed comment body", () => {
    expect(commentSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(commentSchema.parse({ body: "  hi  " }).body).toBe("hi");
  });
});
