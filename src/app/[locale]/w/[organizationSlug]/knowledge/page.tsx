import { getTranslations } from "next-intl/server";
import { ActionButton } from "@/components/action-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { removeFromKnowledgeAction } from "@/features/knowledge/server/actions";
import { listDocuments, searchKnowledge } from "@/features/knowledge/server/knowledge-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { roleHasPermission } from "@/lib/permissions/matrix";

export default async function KnowledgePage({
  params,
  searchParams,
}: PageProps<"/[locale]/w/[organizationSlug]/knowledge">) {
  const [{ organizationSlug }, query] = await Promise.all([params, searchParams]);
  const context = await requireWorkspace(organizationSlug, "knowledge:read");
  const deps = { prisma: db() };
  const q = typeof query.q === "string" ? query.q : "";

  const [t, documents] = await Promise.all([
    getTranslations("Knowledge"),
    listDocuments(deps, context),
  ]);
  let hits: Awaited<ReturnType<typeof searchKnowledge>> = [];
  let invalid = false;
  if (q) {
    try {
      hits = await searchKnowledge(deps, context, q);
    } catch (error) {
      if (!isAppError(error) || error.code !== "INVALID_INPUT") throw error;
      invalid = true;
    }
  }
  const canManage = roleHasPermission(context.role, "knowledge:manage");

  return (
    <WorkspaceShell context={context} active="knowledge">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <form method="get" role="search" className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor="knowledge-q">{t("searchLabel")}</Label>
          <Input
            id="knowledge-q"
            name="q"
            defaultValue={q}
            minLength={2}
            maxLength={200}
            className="w-72"
          />
        </div>
        <Button type="submit">{t("search")}</Button>
      </form>

      {q && (
        <section aria-labelledby="results-title" className="space-y-2">
          <h2 id="results-title" className="text-lg font-semibold tracking-tight">
            {t("results")}
          </h2>
          {invalid ? (
            <p role="alert" className="text-sm text-destructive">
              {t("tooShort")}
            </p>
          ) : hits.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noResults")}</p>
          ) : (
            <ul className="space-y-2">
              {hits.map((hit) => (
                <li key={hit.chunkId} className="rounded-md border border-border bg-card p-3">
                  <p className="text-sm font-medium">{hit.fileName}</p>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{hit.snippet}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="docs-title" className="space-y-2">
        <h2 id="docs-title" className="text-lg font-semibold tracking-tight">
          {t("documents")}
        </h2>
        {documents.length === 0 ? (
          <Card>
            <p className="text-muted-foreground">{canManage ? t("emptyCanManage") : t("empty")}</p>
          </Card>
        ) : (
          <ul className="space-y-2">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
              >
                <div>
                  <p className="font-medium">{document.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`status.${document.status}`)}
                    {document.status === "INDEXED"
                      ? ` · ${t("passages", { count: document.chunkCount })}`
                      : ""}
                    {document.error ? ` · ${document.error}` : ""}
                  </p>
                </div>
                {document.mine && (
                  <ActionButton
                    action={removeFromKnowledgeAction}
                    fields={{ organizationSlug, id: document.fileId }}
                    label={t("remove")}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </WorkspaceShell>
  );
}
