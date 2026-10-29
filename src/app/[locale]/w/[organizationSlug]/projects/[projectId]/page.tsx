import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { EditProjectForm } from "@/features/projects/components/edit-project-form";
import { getProject } from "@/features/projects/server/project-service";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";

export default async function EditProjectPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/projects/[projectId]">) {
  const { organizationSlug, projectId } = await params;
  const context = await requireWorkspace(organizationSlug, "project:update");
  const project = await getProject({ prisma: db() }, context, projectId).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const t = await getTranslations("Projects");

  return (
    <WorkspaceShell context={context} active="projects">
      <Link
        href={`/w/${organizationSlug}/projects`}
        className="text-sm text-primary hover:underline"
      >
        {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{t("editTitle")}</h1>
      <Card>
        <EditProjectForm organizationSlug={organizationSlug} project={project} />
      </Card>
    </WorkspaceShell>
  );
}
