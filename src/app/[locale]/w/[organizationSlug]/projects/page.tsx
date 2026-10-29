import { getTranslations } from "next-intl/server";
import { ArchiveButton } from "@/components/archive-button";
import { Card, CardTitle } from "@/components/ui/card";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { CreateProjectForm } from "@/features/projects/components/create-project-form";
import { archiveProjectAction } from "@/features/projects/server/actions";
import { listProjects } from "@/features/projects/server/project-service";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { roleHasPermission } from "@/lib/permissions/matrix";

export default async function ProjectsPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/projects">) {
  const { organizationSlug } = await params;
  const context = await requireWorkspace(organizationSlug, "project:read");
  const [t, projects] = await Promise.all([
    getTranslations("Projects"),
    listProjects({ prisma: db() }, context),
  ]);
  const canCreate = roleHasPermission(context.role, "project:create");
  const canEdit = roleHasPermission(context.role, "project:update");
  const canArchive = roleHasPermission(context.role, "project:archive");

  return (
    <WorkspaceShell context={context} active="projects">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      {projects.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">{canCreate ? t("empty") : t("emptyReadOnly")}</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {projects.map((project) => (
            <li
              key={project.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {canEdit ? (
                    <Link
                      href={`/w/${organizationSlug}/projects/${project.id}`}
                      className="text-primary hover:underline"
                    >
                      {project.name}
                    </Link>
                  ) : (
                    project.name
                  )}
                </p>
                {project.description && (
                  <p className="text-sm text-muted-foreground">{project.description}</p>
                )}
              </div>
              {canArchive && (
                <ArchiveButton
                  action={archiveProjectAction}
                  organizationSlug={organizationSlug}
                  id={project.id}
                  label={t("archive")}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canCreate && (
        <Card>
          <CardTitle className="mb-4 text-lg">{t("createTitle")}</CardTitle>
          <CreateProjectForm organizationSlug={organizationSlug} />
        </Card>
      )}
    </WorkspaceShell>
  );
}
