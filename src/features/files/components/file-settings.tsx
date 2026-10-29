"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ActionButton } from "@/components/action-button";
import {
  setVisibilityAction,
  shareFileAction,
  unshareFileAction,
} from "@/features/files/server/actions";
import type { ActionState } from "@/server/services/action-result";

type Props = {
  organizationSlug: string;
  fileId: string;
  visibility: "PRIVATE" | "SHARED" | "ORGANIZATION";
  shares: { userId: string; name: string }[];
  candidates: { userId: string; name: string }[];
};

export function FileSettings({ organizationSlug, fileId, visibility, shares, candidates }: Props) {
  const t = useTranslations("Files");
  const common = useTranslations("Common");
  const [visState, visAction, visPending] = useActionState<ActionState, FormData>(
    setVisibilityAction,
    {},
  );
  const [shareState, shareAction, sharePending] = useActionState<ActionState, FormData>(
    shareFileAction,
    {},
  );
  const shareable = candidates.filter((c) => !shares.some((s) => s.userId === c.userId));

  return (
    <div className="space-y-6">
      {/* Keyed by the saved value so the select shows what the server now holds after a save. */}
      <form key={visibility} action={visAction} className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="organizationSlug" value={organizationSlug} />
        <input type="hidden" name="id" value={fileId} />
        <div className="space-y-2">
          <Label htmlFor="settings-visibility">{t("visibilityLabel")}</Label>
          <Select id="settings-visibility" name="visibility" defaultValue={visibility}>
            <option value="PRIVATE">{t("visibility.PRIVATE")}</option>
            <option value="SHARED">{t("visibility.SHARED")}</option>
            <option value="ORGANIZATION">{t("visibility.ORGANIZATION")}</option>
          </Select>
        </div>
        <Button type="submit" disabled={visPending}>
          {visPending ? common("loading") : t("save")}
        </Button>
        <ActionErrorMessage error={visState.error} />
      </form>

      <section aria-labelledby="shares-title" className="space-y-3">
        <h2 id="shares-title" className="text-lg font-semibold tracking-tight">
          {t("sharedWith")}
        </h2>
        {shares.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noShares")}</p>
        ) : (
          <ul className="space-y-2">
            {shares.map((share) => (
              <li
                key={share.userId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
              >
                <span className="text-sm">{share.name}</span>
                <ActionButton
                  action={unshareFileAction}
                  fields={{ organizationSlug, id: fileId, userId: share.userId }}
                  label={t("unshare")}
                />
              </li>
            ))}
          </ul>
        )}
        {shareable.length > 0 && (
          <form action={shareAction} className="flex flex-wrap items-end gap-4">
            <input type="hidden" name="organizationSlug" value={organizationSlug} />
            <input type="hidden" name="id" value={fileId} />
            <div className="space-y-2">
              <Label htmlFor="share-user">{t("shareWith")}</Label>
              <Select id="share-user" name="userId" defaultValue={shareable[0]!.userId}>
                {shareable.map((candidate) => (
                  <option key={candidate.userId} value={candidate.userId}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={sharePending}>
              {sharePending ? common("loading") : t("share")}
            </Button>
            <ActionErrorMessage error={shareState.error} />
          </form>
        )}
      </section>
    </div>
  );
}
