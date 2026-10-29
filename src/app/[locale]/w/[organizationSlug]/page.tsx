import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";

export default async function WorkspacePage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]">) {
  const { organizationSlug } = await params;
  const context = await requireWorkspace(organizationSlug, "organization:read");
  const t = await getTranslations("Workspace");

  return (
    <WorkspaceShell context={context} active="overview">
      <h1 className="text-2xl font-semibold tracking-tight">{context.organization.name}</h1>
      <Card>
        <p className="text-muted-foreground">{t("placeholder")}</p>
      </Card>
    </WorkspaceShell>
  );
}
