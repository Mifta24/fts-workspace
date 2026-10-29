import { getTranslations } from "next-intl/server";
import { ArchiveButton } from "@/components/archive-button";
import { archiveGoalAction } from "@/features/goals/server/actions";
import type { GoalNode } from "@/features/goals/server/tree";

type Props = {
  nodes: GoalNode[];
  organizationSlug: string;
  canArchive: boolean;
  projectNames: ReadonlyMap<string, string>;
};

export async function GoalTree({ nodes, organizationSlug, canArchive, projectNames }: Props) {
  const t = await getTranslations("Goals");
  if (nodes.length === 0) return null;

  return (
    <ul className="space-y-2">
      {nodes.map((goal) => (
        <li key={goal.id}>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{goal.title}</p>
              <p className="text-xs text-muted-foreground">
                {[
                  goal.projectId ? projectNames.get(goal.projectId) : undefined,
                  t(`status.${goal.status}`),
                  goal.dueAt
                    ? t("due", { date: goal.dueAt.toISOString().slice(0, 10) })
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {goal.progress === null ? (
                <p className="text-xs text-muted-foreground">{t("progressPending")}</p>
              ) : (
                <div className="flex items-center gap-2">
                  <progress
                    value={goal.progress}
                    max={100}
                    aria-label={t("progressLabel", { title: goal.title })}
                    className="h-2 w-40"
                  />
                  <span className="text-xs tabular-nums">{goal.progress}%</span>
                </div>
              )}
            </div>
            {canArchive && (
              <ArchiveButton
                action={archiveGoalAction}
                organizationSlug={organizationSlug}
                id={goal.id}
                label={t("archive")}
              />
            )}
          </div>
          {goal.children.length > 0 && (
            <div className="mt-2 ml-4 border-l border-border pl-4">
              <GoalTree
                nodes={goal.children}
                organizationSlug={organizationSlug}
                canArchive={canArchive}
                projectNames={projectNames}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
