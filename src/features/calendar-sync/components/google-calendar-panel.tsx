"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import {
  connectGoogleAction,
  disconnectGoogleAction,
} from "@/features/calendar-sync/server/actions";
import type { ActionState } from "@/server/services/action-result";

/**
 * Connect or disconnect the person's own Google Calendar. Only when they are busy is read; the
 * panel says so, and says what happens to booking pages if the connection stops working.
 */
export function GoogleCalendarPanel({
  organizationSlug,
  configured,
  status,
  connectedOn,
}: {
  organizationSlug: string;
  configured: boolean;
  status: "ACTIVE" | "NEEDS_RECONNECT" | null;
  connectedOn: string | null;
}) {
  const t = useTranslations("Booking");
  const [removed, disconnect, disconnecting] = useActionState<ActionState, FormData>(
    disconnectGoogleAction,
    {},
  );
  const hidden = <input type="hidden" name="organizationSlug" value={organizationSlug} />;

  return (
    <section
      aria-labelledby="google-calendar-title"
      className="space-y-3 rounded-md border border-border bg-card p-4"
    >
      <h2 id="google-calendar-title" className="text-lg font-semibold tracking-tight">
        {t("googleTitle")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("googleIntro")}</p>
      {!configured && status === null && (
        <p className="text-sm text-muted-foreground">{t("googleNotConfigured")}</p>
      )}
      {status === "ACTIVE" && (
        <p className="text-sm">{t("googleConnected", { date: connectedOn ?? "—" })}</p>
      )}
      {status === "NEEDS_RECONNECT" && (
        <p role="alert" className="text-sm text-destructive">
          {t("googleNeedsReconnect")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {configured && status !== "ACTIVE" && (
          <form action={connectGoogleAction}>
            {hidden}
            <Button type="submit" variant="outline" size="sm">
              {status === "NEEDS_RECONNECT" ? t("googleReconnect") : t("googleConnect")}
            </Button>
          </form>
        )}
        {status !== null && !removed.ok && (
          <form action={disconnect}>
            {hidden}
            <Button type="submit" variant="outline" size="sm" disabled={disconnecting}>
              {t("googleDisconnect")}
            </Button>
          </form>
        )}
      </div>
      <ActionErrorMessage error={removed.error} />
    </section>
  );
}
