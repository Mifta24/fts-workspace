import "server-only";
import { headers } from "next/headers";

/**
 * The visitor's address as reported by the proxy in front of the app, passed to Cloudflare as a
 * hint only. It is not used for any decision here, so a forged header gains nothing.
 */
export async function requestIp(): Promise<string | null> {
  const list = await headers();
  return list.get("cf-connecting-ip") ?? list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}
