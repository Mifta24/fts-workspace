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

describe("createInvitationSchema", () => {
  it("normalizes the email and only allows invitable roles", async () => {
    const { createInvitationSchema } =
      await import("@/features/organizations/schemas/organization");
    expect(createInvitationSchema.parse({ email: "  Bob@Example.TEST ", role: "ADMIN" })).toEqual({
      email: "bob@example.test",
      role: "ADMIN",
    });
    expect(
      createInvitationSchema.safeParse({ email: "bob@example.test", role: "OWNER" }).success,
    ).toBe(false);
    expect(createInvitationSchema.safeParse({ email: "nope", role: "VIEWER" }).success).toBe(false);
  });
});
