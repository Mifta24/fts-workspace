import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";

/**
 * Lets the realtime gateway verify a browser's session cookie with Better Auth (the single
 * source of truth for sessions). It only ever reveals the caller's own user id.
 */
export async function GET() {
  const user = await getSessionUser();
  const headers = { "cache-control": "no-store" };
  if (!user?.emailVerified)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });
  return NextResponse.json({ userId: user.id }, { headers });
}
