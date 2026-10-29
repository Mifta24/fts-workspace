import { z } from "zod";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ORGANIZATION_QUOTA_BYTES = 200 * 1024 * 1024;

export const fileIdSchema = z.uuid();
export const visibilitySchema = z.enum(["PRIVATE", "SHARED", "ORGANIZATION"]);
export const uploadVisibilitySchema = z.enum(["PRIVATE", "ORGANIZATION"]);

/** Only these types can be stored. SVG, HTML and office formats are deliberately absent. */
export const ALLOWED_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const TEXT_MIME_TYPES: readonly AllowedMimeType[] = [
  "text/plain",
  "text/markdown",
  "text/csv",
];

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((value, index) => bytes[offset + index] === value);

/**
 * Checks that the bytes really are what the client claims, by content rather than by name or
 * header. Returns the canonical MIME type or null when the type is not allowed or does not match.
 */
export function verifyContent(declaredMime: string, bytes: Uint8Array): AllowedMimeType | null {
  const declared = declaredMime.split(";")[0]!.trim().toLowerCase();
  switch (declared) {
    case "application/pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) ? "application/pdf" : null;
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        ? "image/png"
        : null;
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]) ? "image/jpeg" : null;
    case "image/webp":
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
        ? "image/webp"
        : null;
    case "text/plain":
    case "text/markdown":
    case "text/csv": {
      if (bytes.includes(0)) return null;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return null;
      }
      return declared;
    }
    default:
      return null;
  }
}

/** Display name only: no path parts, control characters or markup-significant characters. */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || "file";
}
