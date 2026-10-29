import { describe, expect, it, vi } from "vitest";
import { keywordQuery, questionSchema } from "@/features/assistant/server/assistant-service";

vi.mock("server-only", () => ({}));

describe("keywordQuery", () => {
  it("keeps significant words, drops stop words and duplicates, joined by OR", () => {
    expect(keywordQuery("What is the budget for the marketing budget?")).toBe(
      "budget or marketing",
    );
  });

  it("caps the number of terms and works for non-Latin scripts", () => {
    const many = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
    expect(keywordQuery(many)!.split(" or ")).toHaveLength(8);
    expect(keywordQuery("予算 について 教えて")).toContain("予算");
  });

  it("returns null when nothing significant remains", () => {
    expect(keywordQuery("is it ok?")).toBeNull();
    expect(keywordQuery("the and for")).toBeNull();
  });

  it("neutralizes operator characters because only word characters survive", () => {
    expect(keywordQuery("budget' OR 1=1; --")).toBe("budget");
  });
});

describe("questionSchema", () => {
  it("bounds the question", () => {
    expect(questionSchema.safeParse("hi").success).toBe(false);
    expect(questionSchema.safeParse("x".repeat(1001)).success).toBe(false);
    expect(questionSchema.parse("  What is our refund policy?  ")).toBe(
      "What is our refund policy?",
    );
  });
});
