import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getCorrelationId } from "@/lib/correlation";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { readFileContent } from "@/features/files/server/file-service";
import { verifyDownloadSignature } from "@/features/files/server/signed-url";
import { getAuthorizedOrganization } from "@/features/organizations/server/organization-service";
import { getStorage } from "@/server/storage/storage";

const notFound = () =>
  new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });

/**
 * Serves file bytes. Three independent checks must pass: a verified session, a short-lived
 * signature issued to that same person for this file, and the file's access rule.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const user = await getSessionUser();
  if (!user?.emailVerified) return new NextResponse(null, { status: 401 });
  if (
    !verifyDownloadSignature({
      fileId: id,
      userId: user.id,
      exp: url.searchParams.get("exp"),
      sig: url.searchParams.get("sig"),
    })
  ) {
    return notFound();
  }

  const correlationId = await getCorrelationId();
  try {
    const context = await getAuthorizedOrganization(
      { prisma: db() },
      {
        userId: user.id,
        organizationSlug: url.searchParams.get("org") ?? "",
        permission: "file:read",
      },
    );
    const { file, bytes } = await readFileContent(
      { prisma: db(), storage: getStorage(), correlationId },
      context,
      id,
    );
    const asciiName = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": file.mimeType,
        "content-length": String(bytes.length),
        // Always a download: stored content is never rendered in the app's origin.
        "content-disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    if (isAppError(error) && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN"))
      return notFound();
    logger.error({ err: error, correlationId }, "file download failed");
    return new NextResponse(null, { status: 500 });
  }
}
