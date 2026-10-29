"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteMessageAction, editMessageAction } from "@/features/chat/server/actions";
import type { ActionState } from "@/server/services/action-result";

export type MessageItemData = {
  id: string;
  authorName: string | null;
  body: string;
  edited: boolean;
  deleted: boolean;
  time: string;
  canEdit: boolean;
  canDelete: boolean;
};

export function MessageItem({
  organizationSlug,
  message,
}: {
  organizationSlug: string;
  message: MessageItemData;
}) {
  const t = useTranslations("Chat");
  const common = useTranslations("Common");
  const [editing, setEditing] = useState(false);
  const [editState, editAction, editing$] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await editMessageAction(previous, formData);
      if (result.ok) setEditing(false);
      return result;
    },
    {},
  );
  const [deleteState, deleteAction, deleting] = useActionState<ActionState, FormData>(
    deleteMessageAction,
    {},
  );

  return (
    <li
      className="space-y-1 rounded-md border border-border bg-card p-3"
      data-message-id={message.id}
    >
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {message.authorName ?? t("formerMember")}
        </span>{" "}
        · {message.time}
        {message.edited && !message.deleted ? ` · ${t("edited")}` : ""}
      </p>
      {message.deleted ? (
        <p className="text-sm italic text-muted-foreground">{t("deleted")}</p>
      ) : editing ? (
        <form action={editAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="organizationSlug" value={organizationSlug} />
          <input type="hidden" name="id" value={message.id} />
          <Input
            name="body"
            defaultValue={message.body}
            required
            maxLength={4000}
            aria-label={t("editLabel")}
            className="min-w-48 flex-1"
          />
          <Button type="submit" size="sm" disabled={editing$}>
            {editing$ ? common("loading") : t("save")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {t("cancel")}
          </Button>
          <ActionErrorMessage error={editState.error} />
        </form>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
      )}
      {!message.deleted && !editing && (message.canEdit || message.canDelete) && (
        <div className="flex flex-wrap items-center gap-2">
          {message.canEdit && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {t("edit")}
            </Button>
          )}
          {message.canDelete && (
            <form action={deleteAction} className="flex items-center gap-2">
              <input type="hidden" name="organizationSlug" value={organizationSlug} />
              <input type="hidden" name="id" value={message.id} />
              <Button type="submit" size="sm" variant="ghost" disabled={deleting}>
                {deleting ? common("loading") : t("delete")}
              </Button>
              <ActionErrorMessage error={deleteState.error} />
            </form>
          )}
        </div>
      )}
    </li>
  );
}
