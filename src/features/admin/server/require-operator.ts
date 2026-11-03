import "server-only";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getLocale } from "next-intl/server";
import { mfaRequired } from "@/features/auth/server/mfa-policy";
import { redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { resolveOperator, type Operator } from "@/features/admin/server/admin-service";

/**
 * Page/action guard for the operator console. Anyone who is not a listed operator, signed in or
 * not, gets a plain 404: the console's existence is not confirmed. An operator without two-step
 * sign-in is sent to the page where it is turned on; this guard also protects the server actions.
 */
export async function requireOperator(): Promise<Operator> {
  // Never prerendered: the answer depends on who is asking.
  await connection();
  const user = await getSessionUser();
  const operator = resolveOperator(user, env().PLATFORM_ADMIN_EMAILS);
  if (!user || !operator) notFound();
  if (mfaRequired({ twoFactorEnabled: user.twoFactorEnabled, isOperator: true })) {
    return redirect({ href: "/security?required=operator", locale: await getLocale() });
  }
  return operator;
}
