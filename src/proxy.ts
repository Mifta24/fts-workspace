import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

// Locale negotiation only. Authorization is enforced in server code, never here.
export default createMiddleware(routing);

export const config = {
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
