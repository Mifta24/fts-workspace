import { getTranslations } from "next-intl/server";
import { ServerForm } from "@/components/server-form";
import { setRuleAction } from "@/features/automations/server/actions";
import { listRules } from "@/features/automations/server/automation-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { db } from "@/lib/db";

export default async function AutomationsPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/automations">) {
  const { organizationSlug } = await params;
  const context = await requireWorkspace(organizationSlug, "automation:manage");
  const [t, rules] = await Promise.all([
    getTranslations("Automations"),
    listRules({ prisma: db() }, context),
  ]);

  return (
    <WorkspaceShell context={context} active="automations">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <ul className="space-y-3">
        {rules.map((rule) => (
          <li
            key={rule.key}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-4"
          >
            <div className="max-w-xl space-y-1">
              <h2 className="font-medium">{t(`rules.${rule.key}.title`)}</h2>
              <p className="text-sm text-muted-foreground">{t(`rules.${rule.key}.description`)}</p>
              <p className="text-xs" data-testid={`state-${rule.key}`}>
                {rule.enabled ? t("on") : t("off")}
              </p>
            </div>
            <ServerForm
              action={setRuleAction}
              fields={{
                organizationSlug,
                ruleKey: rule.key,
                enabled: rule.enabled ? "false" : "true",
              }}
              submitLabel={rule.enabled ? t("turnOff") : t("turnOn")}
              resetOnSuccess={false}
              className="space-y-2"
            >
              {null}
            </ServerForm>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("note")}</p>
    </WorkspaceShell>
  );
}
