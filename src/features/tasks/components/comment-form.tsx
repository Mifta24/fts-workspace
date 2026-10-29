"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { addCommentAction } from "@/features/tasks/server/actions";
import type { ActionState } from "@/server/services/action-result";

export function CommentForm({
  organizationSlug,
  taskId,
}: {
  organizationSlug: string;
  taskId: string;
}) {
  const t = useTranslations("Tasks");
  const common = useTranslations("Common");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await addCommentAction(previous, formData);
      if (result.ok) formRef.current?.reset();
      return result;
    },
    {},
  );
  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="id" value={taskId} />
      <Label htmlFor="comment-body">{t("commentLabel")}</Label>
      <textarea
        id="comment-body"
        name="body"
        required
        maxLength={5000}
        rows={3}
        className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <ActionErrorMessage error={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("commentSubmit")}
      </Button>
    </form>
  );
}
