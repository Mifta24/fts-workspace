"use client";

import { createAuthClient } from "better-auth/react";

/** Browser auth client. Same-origin; never holds secrets. */
export const authClient = createAuthClient();
