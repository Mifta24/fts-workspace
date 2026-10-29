/**
 * Organization role → permission matrix (default deny).
 *
 * Phase 0 defined organization, membership and audit permissions; Phase 1
 * adds project:*, goal:* and task:*. Later phases extend `PERMISSIONS` (task:*,
 * ai:use, ...) and update docs/07-SECURITY.md.
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
  "project:read",
  "project:create",
  "project:update",
  "project:archive",
  "goal:read",
  "goal:create",
  "goal:update",
  "goal:archive",
  "task:read",
  "task:create",
  "task:update",
  "task:comment",
  "dashboard:read",
  "ai:use",
  "chat:read",
  "chat:post",
  "chat:manage",
  "chat:moderate",
  "notification:read",
  "gamification:read",
  "challenge:manage",
  "file:read",
  "file:upload",
  "file:delete-any",
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
  "project:read": ALL_ROLES,
  "project:create": ["OWNER", "ADMIN", "MANAGER"],
  "project:update": ["OWNER", "ADMIN", "MANAGER"],
  "project:archive": ["OWNER", "ADMIN", "MANAGER"],
  "goal:read": ALL_ROLES,
  "goal:create": ["OWNER", "ADMIN", "MANAGER", "MEMBER"],
  "goal:update": ["OWNER", "ADMIN", "MANAGER", "MEMBER"],
  "goal:archive": ["OWNER", "ADMIN", "MANAGER"],
  "task:read": ALL_ROLES,
  "task:create": ["OWNER", "ADMIN", "MANAGER", "MEMBER"],
  "task:update": ["OWNER", "ADMIN", "MANAGER", "MEMBER"],
  "task:comment": ["OWNER", "ADMIN", "MANAGER", "MEMBER"],
  "dashboard:read": ALL_ROLES,
  "ai:use": ["OWNER", "ADMIN", "MANAGER", "MEMBER"],
  "chat:read": ALL_ROLES,
  "chat:post": ["OWNER", "ADMIN", "MANAGER", "MEMBER"],
  "chat:manage": ["OWNER", "ADMIN", "MANAGER"],
  "chat:moderate": ["OWNER", "ADMIN"],
  "notification:read": ALL_ROLES,
  "gamification:read": ALL_ROLES,
  "challenge:manage": ["OWNER", "ADMIN", "MANAGER"],
  "file:read": ALL_ROLES,
  "file:upload": ["OWNER", "ADMIN", "MANAGER", "MEMBER"],
  "file:delete-any": ["OWNER", "ADMIN"],
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
