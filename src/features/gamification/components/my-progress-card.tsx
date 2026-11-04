import { getTranslations } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card";
import { ProgressThread } from "@/components/ui/progress-thread";
import type { ChallengeView, MyStats } from "@/features/gamification/server/gamification-service";
import { Link } from "@/i18n/navigation";

/** The caller's own points, streak and current challenge. It carries nobody else's numbers. */
export async function MyProgressCard({
  stats,
  challenge,
  href,
}: {
  stats: MyStats;
  challenge: ChallengeView | null;
  href: string;
}) {
  const t = await getTranslations("MyProgress");
  return (
    <Card className="space-y-4" aria-labelledby="my-progress-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle level={2} id="my-progress-title" className="text-lg">
          {t("title")}
        </CardTitle>
        <Link href={href} className="text-sm font-medium text-primary hover:underline">
          {t("seeAll")}
        </Link>
      </div>

      {stats.totalPoints === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <dl className="grid grid-cols-3 gap-4">
          <div>
            <dt className="text-sm text-muted-foreground">{t("totalPoints")}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{stats.totalPoints}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t("pointsLast7Days")}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{stats.pointsLast7Days}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t("streakDays")}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{stats.streakDays}</dd>
          </div>
        </dl>
      )}

      {challenge && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{challenge.title}</p>
          <div className="flex items-center gap-2">
            <ProgressThread
              value={(challenge.progress / Math.max(1, challenge.target)) * 100}
              label={t("challengeProgress", { title: challenge.title })}
              className="max-w-xs"
            />
            <span className="text-xs tabular-nums">
              {challenge.progress} / {challenge.target}
              {challenge.completed ? ` · ${t("completed")}` : ""}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
