import "server-only";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth/auth";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  /** True once an authenticator app is confirmed (every session of such a user passed the code step). */
  twoFactorEnabled: boolean;
};

/** Current verified session user, or null. Always resolved server-side. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const { id, email, name, emailVerified, twoFactorEnabled } = session.user;
  return { id, email, name, emailVerified, twoFactorEnabled: twoFactorEnabled === true };
}
