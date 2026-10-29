import { getTranslations } from "next-intl/server";
import { ActionButton } from "@/components/action-button";
import { ArchiveButton } from "@/components/archive-button";
import { Card, CardTitle } from "@/components/ui/card";
import { CreateChallengeForm } from "@/features/gamification/components/create-challenge-form";
import {
  archiveChallengeAction,
  setLeaderboardOptInAction,
  setLeaderboardVisibilityAction,
} from "@/features/gamification/server/actions";
import {
  getLeaderboard,
  getMyStats,
  listChallenges,
} from "@/features/gamification/server/gamification-service";
import { leaderboardRangeSchema } from "@/features/gamification/schemas/gamification";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { roleHasPermission } from "@/lib/permissions/matrix";
import { cn } from "@/lib/utils";

export default async function ProgressPage({
  params,
  searchParams,
}: PageProps<"/[locale]/w/[organizationSlug]/progress">) {
  const [{ organizationSlug }, query] = await Promise.all([params, searchParams]);
  const context = await requireWorkspace(organizationSlug, "gamification:read");
  const deps = { prisma: db() };
  const range = leaderboardRangeSchema
    .catch("week")
    .parse(typeof query.range === "string" ? query.range : undefined);

  const [t, stats, challenges, board, organization] = await Promise.all([
    getTranslations("Progress"),
    getMyStats(deps, context),
    listChallenges(deps, context),
    getLeaderboard(deps, context, range),
    deps.prisma.organization.findUniqueOrThrow({
      where: { id: context.organization.id },
      select: { leaderboardVisibility: true },
    }),
  ]);
  const canManageChallenges = roleHasPermission(context.role, "challenge:manage");
  const canSetPolicy = roleHasPermission(context.role, "organization:update");
  const base = `/w/${organizationSlug}/progress`;

  const cards = [
    { key: "totalPoints", value: stats.totalPoints },
    { key: "pointsLast7Days", value: stats.pointsLast7Days },
    { key: "streakDays", value: stats.streakDays },
    { key: "awardsToday", value: `${stats.awardsToday} / ${stats.dailyCap}` },
  ] as const;

  return (
    <WorkspaceShell context={context} active="progress">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.key} className="space-y-1 p-4">
            <dt className="text-sm text-muted-foreground">{t(`cards.${card.key}`)}</dt>
            <dd className="text-3xl font-semibold tabular-nums">{card.value}</dd>
          </Card>
        ))}
      </dl>

      <section aria-labelledby="challenges-title" className="space-y-3">
        <h2 id="challenges-title" className="text-lg font-semibold tracking-tight">
          {t("challenges")}
        </h2>
        {challenges.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noChallenges")}</p>
        ) : (
          <ul className="space-y-2">
            {challenges.map((challenge) => (
              <li
                key={challenge.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
              >
                <div className="space-y-1">
                  <p className="font-medium">{challenge.title}</p>
                  {challenge.description && (
                    <p className="text-sm text-muted-foreground">{challenge.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t(`state.${challenge.state}`)} ·{" "}
                    {challenge.startsAt.toISOString().slice(0, 10)} →{" "}
                    {challenge.endsAt.toISOString().slice(0, 10)}
                  </p>
                  <div className="flex items-center gap-2">
                    <progress
                      value={challenge.progress}
                      max={challenge.target}
                      aria-label={t("challengeProgress", { title: challenge.title })}
                      className="h-2 w-40"
                    />
                    <span className="text-xs tabular-nums">
                      {challenge.progress} / {challenge.target}
                      {challenge.completed ? ` · ${t("completed")}` : ""}
                    </span>
                  </div>
                </div>
                {canManageChallenges && (
                  <ArchiveButton
                    action={archiveChallengeAction}
                    organizationSlug={organizationSlug}
                    id={challenge.id}
                    label={t("archive")}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="leaderboard-title" className="space-y-3">
        <h2 id="leaderboard-title" className="text-lg font-semibold tracking-tight">
          {t("leaderboard")}
        </h2>
        {!board.enabled ? (
          <p className="text-sm text-muted-foreground">{t("leaderboardOff")}</p>
        ) : (
          <>
            <nav aria-label={t("rangeLabel")} className="flex gap-2">
              {(["week", "month", "all"] as const).map((value) => (
                <Link
                  key={value}
                  href={`${base}?range=${value}`}
                  aria-current={value === range ? "true" : undefined}
                  className={cn(
                    "rounded-md border border-border px-3 py-1 text-sm hover:bg-muted",
                    value === range && "bg-muted font-medium",
                  )}
                >
                  {t(`range.${value}`)}
                </Link>
              ))}
            </nav>
            {board.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("leaderboardEmpty")}</p>
            ) : (
              <ol className="space-y-2">
                {board.entries.map((entry) => (
                  <li
                    key={entry.userId}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
                  >
                    <span>
                      {entry.rank}. {entry.name}
                      {entry.userId === context.userId ? ` (${t("you")})` : ""}
                    </span>
                    <span className="tabular-nums">{entry.points}</span>
                  </li>
                ))}
              </ol>
            )}
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {stats.optedIn ? t("optedIn") : t("optedOut")}
              </p>
              <ActionButton
                action={setLeaderboardOptInAction}
                fields={{ organizationSlug, optIn: String(!stats.optedIn) }}
                label={stats.optedIn ? t("hideMe") : t("showMe")}
              />
            </div>
          </>
        )}
      </section>

      {canSetPolicy && (
        <Card className="space-y-3">
          <CardTitle className="text-lg">{t("policyTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {organization.leaderboardVisibility === "OFF" ? t("policyOff") : t("policyOptIn")}
          </p>
          <ActionButton
            action={setLeaderboardVisibilityAction}
            fields={{
              organizationSlug,
              visibility: organization.leaderboardVisibility === "OFF" ? "OPT_IN" : "OFF",
            }}
            label={
              organization.leaderboardVisibility === "OFF"
                ? t("enableLeaderboard")
                : t("disableLeaderboard")
            }
          />
        </Card>
      )}

      {canManageChallenges && (
        <Card>
          <CardTitle className="mb-4 text-lg">{t("createChallengeTitle")}</CardTitle>
          <CreateChallengeForm organizationSlug={organizationSlug} />
        </Card>
      )}
    </WorkspaceShell>
  );
}
