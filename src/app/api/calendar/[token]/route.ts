import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { readFeed } from "@/features/scheduling/server/calendar-feed";

export const dynamic = "force-dynamic";

const baseHeaders = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

const notFound = () => new Response(null, { status: 404, headers: baseHeaders });

/**
 * Read-only meetings feed for calendar apps (`/api/calendar/<token>.ics`). There is no session:
 * the secret token in the link is the credential, and it decides whose meetings are shown.
 * Unknown, revoked and malformed tokens all get the same 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const bare = token.endsWith(".ics") ? token.slice(0, -4) : token;
  try {
    const calendar = await readFeed({ prisma: db() }, bare);
    if (calendar === null) return notFound();
    return new Response(calendar, {
      headers: {
        ...baseHeaders,
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'inline; filename="meetings.ics"',
      },
    });
  } catch (error) {
    logger.error({ err: error }, "calendar feed failed");
    return new Response(null, { status: 500, headers: baseHeaders });
  }
}
