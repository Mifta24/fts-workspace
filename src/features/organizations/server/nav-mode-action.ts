"use server";

import { cookies } from "next/headers";
import {
  NAV_MODE_COOKIE,
  NAV_MODE_MAX_AGE_SECONDS,
  parseNavMode,
} from "@/features/organizations/schemas/nav-mode";

/** Remembers the menu view in this browser. Nothing here depends on, or changes, any access. */
export async function setNavModeAction(formData: FormData): Promise<void> {
  (await cookies()).set(NAV_MODE_COOKIE, parseNavMode(formData.get("mode")), {
    path: "/",
    maxAge: NAV_MODE_MAX_AGE_SECONDS,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}
