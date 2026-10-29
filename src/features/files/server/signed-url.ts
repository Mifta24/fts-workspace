import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export const DOWNLOAD_URL_TTL_MS = 5 * 60_000;

const mac = (fileId: string, userId: string, expires: number) =>
  createHmac("sha256", `file-download:${env().BETTER_AUTH_SECRET}`)
    .update(`${fileId}.${userId}.${expires}`)
    .digest("base64url");

/** Short-lived download path bound to the file and the person it was issued to. */
export function signDownloadPath(
  params: { fileId: string; userId: string; organizationSlug: string },
  now: Date = new Date(),
): string {
  const expires = Math.floor((now.getTime() + DOWNLOAD_URL_TTL_MS) / 1000);
  const sig = mac(params.fileId, params.userId, expires);
  return `/api/files/${params.fileId}/content?org=${encodeURIComponent(params.organizationSlug)}&exp=${expires}&sig=${sig}`;
}

export function verifyDownloadSignature(
  params: { fileId: string; userId: string; exp: string | null; sig: string | null },
  now: Date = new Date(),
): boolean {
  if (!params.exp || !params.sig || !/^\d{1,12}$/.test(params.exp)) return false;
  const expires = Number(params.exp);
  if (expires * 1000 < now.getTime()) return false;
  const expected = Buffer.from(mac(params.fileId, params.userId, expires));
  const provided = Buffer.from(params.sig);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
