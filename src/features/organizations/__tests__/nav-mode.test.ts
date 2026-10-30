import { describe, expect, it } from "vitest";
import { parseNavMode, visibleSections } from "@/features/organizations/schemas/nav-mode";

const ALL = [
  "overview",
  "projects",
  "goals",
  "tasks",
  "chat",
  "notifications",
  "progress",
  "files",
  "knowledge",
  "assistant",
  "crm",
  "schedule",
  "forms",
  "insights",
  "members",
  "billing",
] as const;

describe("navigation view", () => {
  it("shows only the everyday work by default, in the menu's own order", () => {
    expect(visibleSections("simple", "overview", ALL)).toEqual([
      "overview",
      "projects",
      "goals",
      "tasks",
      "chat",
      "notifications",
      "schedule",
      "members",
    ]);
  });

  it("shows everything in the full view", () => {
    expect(visibleSections("full", "overview", ALL)).toEqual([...ALL]);
  });

  it("keeps the current page in the menu even if it is a specialist one", () => {
    const shown = visibleSections("simple", "crm", ALL);
    expect(shown).toContain("crm");
    expect(shown).not.toContain("billing");
    // It keeps its own place in the menu rather than moving to the end.
    expect(shown.indexOf("crm")).toBeLessThan(shown.indexOf("schedule"));
  });

  it("never adds an entry the caller did not offer", () => {
    // Pages a person may not open are filtered out before the view is applied.
    expect(visibleSections("full", "overview", ["overview", "tasks"])).toEqual([
      "overview",
      "tasks",
    ]);
    expect(visibleSections("simple", "overview", ["overview", "tasks", "crm"])).toEqual([
      "overview",
      "tasks",
    ]);
  });

  it("reads anything but an exact 'full' as simple", () => {
    expect(parseNavMode("full")).toBe("full");
    expect(parseNavMode("simple")).toBe("simple");
    for (const value of [undefined, null, "", "FULL", "everything", 1, {}]) {
      expect(parseNavMode(value)).toBe("simple");
    }
  });
});
