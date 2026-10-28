import { describe, expect, it } from "vitest";
import {
  createOrganizationSchema,
  organizationSlugSchema,
} from "@/features/organizations/schemas/organization";

describe("organization schemas", () => {
  it.each(["acme", "acme-corp", "team-42"])("accepts slug %s", (slug) => {
    expect(organizationSlugSchema.safeParse(slug).success).toBe(true);
  });

  it.each([
    "ab",
    "-acme",
    "acme-",
    "acme--corp",
    "acme_corp",
    "acme corp",
    "api",
    "w",
    "a".repeat(49),
  ])("rejects slug %s", (slug) => {
    expect(organizationSlugSchema.safeParse(slug).success).toBe(false);
  });

  it("normalizes case and whitespace", () => {
    expect(organizationSlugSchema.parse("  Acme-Corp ")).toBe("acme-corp");
  });

  it("requires a name between 2 and 80 characters", () => {
    expect(createOrganizationSchema.safeParse({ name: "A", slug: "acme" }).success).toBe(false);
    expect(createOrganizationSchema.safeParse({ name: "Acme", slug: "acme" }).success).toBe(true);
    expect(createOrganizationSchema.safeParse({ slug: "acme" }).success).toBe(false);
  });
});
