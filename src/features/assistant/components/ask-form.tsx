"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionErrorMessage } from "@/components/action-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { askAction, type AskState } from "@/features/assistant/server/actions";

export function AskForm({ organizationSlug }: { organizationSlug: string }) {
  const t = useTranslations("Assistant");
  const common = useTranslations("Common");
  const [state, action, pending] = useActionState<AskState, FormData>(askAction, {});
  const result = state.result;

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <input type="hidden" name="organizationSlug" value={organizationSlug} />
        <Label htmlFor="question">{t("questionLabel")}</Label>
        <textarea
          id="question"
          name="question"
          required
          minLength={5}
          maxLength={1000}
          rows={3}
          className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <ActionErrorMessage error={state.error} />
        <Button type="submit" disabled={pending}>
          {pending ? common("loading") : t("ask")}
        </Button>
      </form>

      {result?.status === "no_sources" && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("noSources")}
        </p>
      )}
      {result?.status === "answered" && (
        <section aria-labelledby="answer-title" className="space-y-3">
          <h2 id="answer-title" className="text-lg font-semibold tracking-tight">
            {t("answer")}
          </h2>
          {/* Plain text only: the model's output is never interpreted as markup. */}
          <p className="whitespace-pre-wrap rounded-md border border-border bg-card p-3 text-sm">
            {result.answer}
          </p>
          <p className="text-xs text-muted-foreground">{t("aiNote")}</p>
          <h3 className="text-sm font-semibold">{t("sources")}</h3>
          <ol className="space-y-2">
            {result.sources.map((source) => (
              <li
                key={source.n}
                className="rounded-md border border-border bg-card p-3 text-sm"
                data-cited={result.citations.includes(source.n)}
              >
                <p className="font-medium">
                  [{source.n}] {source.fileName}
                  {result.citations.includes(source.n) ? ` · ${t("cited")}` : ""}
                </p>
                <p className="whitespace-pre-wrap text-muted-foreground">{source.snippet}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
