import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { pipelineReport } from "@/features/crm/server/crm-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";

const money = (value: Record<string, number>) => {
  const entries = Object.entries(value);
  return entries.length === 0
    ? "—"
    : entries
        .map(
          ([currency, minor]) =>
            `${(minor / 100).toLocaleString("en", { minimumFractionDigits: 2 })} ${currency}`,
        )
        .join(" · ");
};

export default async function PipelinePage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/crm/pipeline">) {
  const { organizationSlug } = await params;
  const context = await requireWorkspace(organizationSlug, "crm:read");
  const [t, report] = await Promise.all([
    getTranslations("Crm"),
    pipelineReport({ prisma: db() }, context),
  ]);

  return (
    <WorkspaceShell context={context} active="crm">
      <Link href={`/w/${organizationSlug}/crm`} className="text-sm text-primary hover:underline">
        {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{t("pipeline")}</h1>
      <p className="text-sm text-muted-foreground">
        {t("pipelineIntro", { days: report.periodDays })}
      </p>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {report.stages.map((stage) => (
          <Card key={stage.stage} className="space-y-1 p-4">
            <dt className="text-sm text-muted-foreground">{t(`stage.${stage.stage}`)}</dt>
            <dd className="text-3xl font-semibold tabular-nums">{stage.count}</dd>
            <dd className="text-xs text-muted-foreground">{money(stage.value)}</dd>
          </Card>
        ))}
      </dl>
      <dl className="grid gap-4 sm:grid-cols-3">
        <Card className="space-y-1 p-4">
          <dt className="text-sm text-muted-foreground">{t("wonCount")}</dt>
          <dd className="text-3xl font-semibold tabular-nums">{report.won.count}</dd>
          <dd className="text-xs text-muted-foreground">{money(report.won.value)}</dd>
        </Card>
        <Card className="space-y-1 p-4">
          <dt className="text-sm text-muted-foreground">{t("lostCount")}</dt>
          <dd className="text-3xl font-semibold tabular-nums">{report.lost.count}</dd>
        </Card>
        <Card className="space-y-1 p-4">
          <dt className="text-sm text-muted-foreground">{t("winRate")}</dt>
          <dd className="text-3xl font-semibold tabular-nums">
            {report.winRatePercent === null ? "—" : `${report.winRatePercent}%`}
          </dd>
        </Card>
      </dl>
    </WorkspaceShell>
  );
}
