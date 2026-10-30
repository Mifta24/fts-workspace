import "server-only";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { resolveOperator, type Operator } from "@/features/admin/server/admin-service";

/**
 * Page/action guard for the operator console. Anyone who is not a listed operator, signed in or
 * not, gets a plain 404: the console's existence is not confirmed.
 */
export async function requireOperator(): Promise<Operator> {
  // Never prerendered: the answer depends on who is asking.
  await connection();
  const operator = resolveOperator(await getSessionUser(), env().PLATFORM_ADMIN_EMAILS);
  if (!operator) notFound();
  return operator;
}
