import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { MAX_FILE_BYTES } from "@/features/files/schemas/file";
import { uploadFile } from "@/features/files/server/file-service";
import { getAuthorizedOrganization } from "@/features/organizations/server/organization-service";
import { getStorage } from "@/server/storage/storage";

const fail = (status: number, code: string) =>
  NextResponse.json({ error: { code } }, { status, headers: { "cache-control": "no-store" } });

/**
 * Multipart upload. A route handler (not a server action) so the 1 MB action body limit does
 * not apply; the limit that matters is MAX_FILE_BYTES, checked before and after reading.
 */
export async function POST(request: Request) {
  // Cookies are SameSite=Lax, and the Origin header must also match this app.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(env().BETTER_AUTH_URL).origin) return fail(403, "FORBIDDEN");

  const user = await getSessionUser();
  if (!user?.emailVerified) return fail(401, "UNAUTHENTICATED");

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_FILE_BYTES + 64 * 1024) return fail(413, "UNPROCESSABLE");

  const correlationId = await getCorrelationId();
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail(400, "INVALID_INPUT");
    const context = await getAuthorizedOrganization(
      { prisma: db() },
      {
        userId: user.id,
        organizationSlug: String(form.get("organizationSlug") ?? ""),
        permission: "file:upload",
      },
    );
    const uploaded = await uploadFile(
      { prisma: db(), storage: getStorage(), correlationId },
      context,
      {
        name: file.name,
        mimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
        visibility: form.get("visibility"),
      },
    );
    return NextResponse.json(
      { data: { id: uploaded.id } },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (isAppError(error)) return fail(error.code === "NOT_FOUND" ? 403 : error.status, error.code);
    logger.error({ err: error, correlationId }, "file upload failed");
    return fail(500, "INTERNAL");
  }
}
