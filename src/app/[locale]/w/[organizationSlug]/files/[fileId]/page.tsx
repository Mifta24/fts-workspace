import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { FileSettings } from "@/features/files/components/file-settings";
import { getFile, listShares } from "@/features/files/server/file-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { listMembers } from "@/features/organizations/server/organization-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";

export default async function FileSettingsPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/files/[fileId]">) {
  const { organizationSlug, fileId } = await params;
  const context = await requireWorkspace(organizationSlug, "file:upload");
  const deps = { prisma: db() };
  const file = await getFile(deps, context, fileId).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  // Only the uploader manages access.
  if (!file.mine) notFound();
  const [t, shares, members] = await Promise.all([
    getTranslations("Files"),
    listShares(deps, context, file.id),
    listMembers(deps, context),
  ]);

  return (
    <WorkspaceShell context={context} active="files">
      <Link href={`/w/${organizationSlug}/files`} className="text-sm text-primary hover:underline">
        {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{file.name}</h1>
      <Card>
        <FileSettings
          organizationSlug={organizationSlug}
          fileId={file.id}
          visibility={file.visibility}
          shares={shares}
          candidates={members
            .filter((m) => m.userId !== context.userId)
            .map((m) => ({ userId: m.userId, name: m.name }))}
        />
      </Card>
    </WorkspaceShell>
  );
}
