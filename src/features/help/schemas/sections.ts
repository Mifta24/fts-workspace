/**
 * The public how-to-use guide. The text lives in the message catalogs (`Help.sections.<section>`
 * with `title`, a lead paragraph `p1` and list items `i1..`); this file fixes which sections exist,
 * in which order, and which lists are steps rather than facts.
 */
export const HELP_SECTIONS = [
  "start",
  "account",
  "goals",
  "tasks",
  "chat",
  "files",
  "assistant",
  "crm",
  "schedule",
  "forms",
  "progress",
  "roles",
  "faq",
] as const;
export type HelpSection = (typeof HELP_SECTIONS)[number];

/** Sections whose list is a sequence to follow in order. */
export const ORDERED_SECTIONS: ReadonlySet<HelpSection> = new Set(["start"]);

/** How many list items a section may have in the catalogs. */
export const MAX_ITEMS = 8;
