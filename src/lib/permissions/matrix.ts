/**
 * Organization role → permission matrix (default deny).
 *
 * Phase 0 only defines organization, membership and audit permissions.
 * Later phases extend `PERMISSIONS` with their own domain permissions
 * (goal:*, task:*, ai:use, ...) and update docs/07-SECURITY.md.
 */

export const ORGANIZATION_ROLES = ["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const PERMISSIONS = [
  "organization:read",
  "organization:update",
  "organization:delete",
  "member:read",
  "member:invite",
  "member:update-role",
  "member:remove",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL_ROLES: readonly OrganizationRole[] = ORGANIZATION_ROLES;

const MATRIX: Record<Permission, readonly OrganizationRole[]> = {
  "organization:read": ALL_ROLES,
  "organization:update": ["OWNER", "ADMIN"],
  "organization:delete": ["OWNER"],
  "member:read": ALL_ROLES,
  "member:invite": ["OWNER", "ADMIN"],
  "member:update-role": ["OWNER", "ADMIN"],
  "member:remove": ["OWNER", "ADMIN"],
  "audit:read": ["OWNER", "ADMIN"],
};

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === "string" && (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

export function roleHasPermission(role: OrganizationRole, permission: Permission): boolean {
  return MATRIX[permission]?.includes(role) ?? false;
}

export function permissionsForRole(role: OrganizationRole): Permission[] {
  return PERMISSIONS.filter((permission) => roleHasPermission(role, permission));
}
