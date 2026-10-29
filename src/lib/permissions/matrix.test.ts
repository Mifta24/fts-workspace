import { describe, expect, it } from "vitest";
import {
  ORGANIZATION_ROLES,
  PERMISSIONS,
  isOrganizationRole,
  permissionsForRole,
  roleHasPermission,
} from "@/lib/permissions/matrix";

describe("permission matrix", () => {
  it("grants every role read access to its organization and members", () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(roleHasPermission(role, "organization:read")).toBe(true);
      expect(roleHasPermission(role, "member:read")).toBe(true);
    }
  });

  it("restricts organization deletion to owners", () => {
    expect(ORGANIZATION_ROLES.filter((r) => roleHasPermission(r, "organization:delete"))).toEqual([
      "OWNER",
    ]);
  });

  it("does not let managers, members or viewers manage membership", () => {
    for (const role of ["MANAGER", "MEMBER", "VIEWER"] as const) {
      expect(roleHasPermission(role, "member:invite")).toBe(false);
      expect(roleHasPermission(role, "member:update-role")).toBe(false);
      expect(roleHasPermission(role, "member:remove")).toBe(false);
      expect(roleHasPermission(role, "audit:read")).toBe(false);
    }
  });

  it("denies unknown permissions by default", () => {
    expect(roleHasPermission("OWNER", "billing:manage" as never)).toBe(false);
  });

  it("lists only granted permissions", () => {
    expect(permissionsForRole("VIEWER")).toEqual([
      "organization:read",
      "member:read",
      "project:read",
      "goal:read",
      "task:read",
    ]);
    expect(permissionsForRole("OWNER")).toEqual([...PERMISSIONS]);
  });

  it("validates role values", () => {
    expect(isOrganizationRole("ADMIN")).toBe(true);
    expect(isOrganizationRole("admin")).toBe(false);
    expect(isOrganizationRole("SUPERUSER")).toBe(false);
    expect(isOrganizationRole(undefined)).toBe(false);
  });

  it("lets viewers read but never write projects and goals", () => {
    for (const permission of PERMISSIONS.filter((p) =>
      /^(project|goal|task):(create|update|archive|comment)$/.test(p),
    )) {
      expect(roleHasPermission("VIEWER", permission)).toBe(false);
    }
  });

  it("keeps archiving and project management above the MEMBER role", () => {
    expect(roleHasPermission("MEMBER", "goal:create")).toBe(true);
    expect(roleHasPermission("MEMBER", "goal:archive")).toBe(false);
    expect(roleHasPermission("MEMBER", "project:create")).toBe(false);
    expect(roleHasPermission("MANAGER", "project:create")).toBe(true);
  });
});
