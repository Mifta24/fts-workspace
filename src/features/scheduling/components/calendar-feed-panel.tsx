"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { createFeedAction, revokeFeedAction } from "@/features/scheduling/server/actions";
import type { ActionState } from "@/server/services/action-result";

/**
 * Subscription link for calendar apps. The link is shown once, when it is created: the server
 * keeps only a hash, so nobody (including this page, later) can read it back.
 */
export function CalendarFeedPanel({
  organizationSlug,
  enabled,
  createdOn,
  lastUsedOn,
}: {
  organizationSlug: string;
  enabled: boolean;
  createdOn: string | null;
  lastUsedOn: string | null;
}) {
  const t = useTranslations("Schedule");
  const [created, create, creating] = useActionState<ActionState, FormData>(createFeedAction, {});
  const [revoked, revoke, revoking] = useActionState<ActionState, FormData>(revokeFeedAction, {});
  const hidden = <input type="hidden" name="organizationSlug" value={organizationSlug} />;

  return (
    <section
      aria-labelledby="feed-title"
      className="space-y-3 rounded-md border border-border bg-card p-4"
    >
      <h2 id="feed-title" className="text-lg font-semibold tracking-tight">
        {t("feedTitle")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("feedIntro")}</p>
      {created.link && (
        <div className="space-y-2" role="status">
          <label htmlFor="feed-link" className="text-sm font-medium">
            {t("feedLink")}
          </label>
          <input
            id="feed-link"
            readOnly
            value={created.link}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded-md border border-input bg-muted px-3 py-2 font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">{t("feedShownOnce")}</p>
        </div>
      )}
      {enabled && !created.link && (
        <p className="text-sm">
          {t("feedActive", { created: createdOn ?? "—" })}{" "}
          {lastUsedOn ? t("feedUsed", { used: lastUsedOn }) : t("feedNeverUsed")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <form action={create}>
          {hidden}
          <Button type="submit" variant="outline" size="sm" disabled={creating}>
            {enabled ? t("feedReplace") : t("feedCreate")}
          </Button>
        </form>
        {enabled && !revoked.ok && (
          <form action={revoke}>
            {hidden}
            <Button type="submit" variant="outline" size="sm" disabled={revoking}>
              {t("feedRevoke")}
            </Button>
          </form>
        )}
      </div>
      <ActionErrorMessage error={created.error ?? revoked.error} />
    </section>
  );
}
