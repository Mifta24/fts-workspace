/**
 * The public legal documents. The text lives in the message catalogs (`Legal.<document>.<section>`,
 * with `title`, paragraphs `p1..` and list items `i1..`); this file fixes which sections exist and in
 * which order, and the date of the current wording.
 */
export const LEGAL_DOCUMENTS = ["privacyDoc", "termsDoc"] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];

export const SECTIONS: Record<LegalDocument, readonly string[]> = {
  privacyDoc: [
    "who",
    "data",
    "why",
    "ai",
    "sharing",
    "transfers",
    "retention",
    "rights",
    "security",
    "children",
    "changes",
    "contact",
  ],
  termsDoc: [
    "service",
    "accounts",
    "workspaces",
    "content",
    "use",
    "plans",
    "availability",
    "termination",
    "liability",
    "law",
    "changes",
    "contact",
  ],
};

/** Change this whenever the wording changes in a way people should know about (YYYY-MM-DD, UTC). */
export const LEGAL_UPDATED = "2026-11-02";

/** How many paragraphs and list items a section may have in the catalogs. */
export const MAX_PARTS = 8;
