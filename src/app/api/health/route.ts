import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Liveness + database readiness. Exposes no configuration or version details. */
export async function GET() {
  try {
    await db().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", database: "ok" });
  } catch (error) {
    logger.error({ err: error }, "health.database failed");
    return Response.json({ status: "degraded", database: "unavailable" }, { status: 503 });
  }
}
