import "server-only";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";

const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Correlation id from a trusted proxy header, or a fresh one. */
export async function getCorrelationId(): Promise<string> {
  const incoming = (await headers()).get("x-request-id");
  return incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
}
