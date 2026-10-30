/**
 * How much of the workspace navigation a person sees. This is only a view preference: it never
 * grants or removes access (every page still checks the person's permission on the server), and a
 * page that is not in the menu still opens from a link.
 */
export const NAV_MODES = ["simple", "full"] as const;
export type NavMode = (typeof NAV_MODES)[number];

export const DEFAULT_NAV_MODE: NavMode = "simple";
export const NAV_MODE_COOKIE = "fts_nav_mode";
export const NAV_MODE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** The everyday work of a team. Everything else is one click away in the full view. */
const ESSENTIAL: ReadonlySet<string> = new Set([
  "overview",
  "goals",
  "tasks",
  "projects",
  "chat",
  "schedule",
  "notifications",
  "members",
]);

/** Anything that is not exactly "full" (missing, altered, unknown) means the simple view. */
export const parseNavMode = (value: unknown): NavMode => (value === "full" ? "full" : "simple");

/**
 * The menu entries to show, in their original order. The page the person is on always stays in
 * the menu, so they can see where they are even when they arrived by a link.
 */
export function visibleSections<K extends string>(
  mode: NavMode,
  active: K,
  sections: readonly K[],
): K[] {
  return mode === "full"
    ? [...sections]
    : sections.filter((key) => key === active || ESSENTIAL.has(key));
}
