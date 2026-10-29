import { getTranslations } from "next-intl/server";
import { ActionButton } from "@/components/action-button";
import { Card, CardTitle } from "@/components/ui/card";
import { UploadForm } from "@/features/files/components/upload-form";
import { deleteFileAction } from "@/features/files/server/actions";
import { listFiles } from "@/features/files/server/file-service";
import { requestIndexingAction } from "@/features/knowledge/server/actions";
import { listDocuments } from "@/features/knowledge/server/knowledge-service";
import { signDownloadPath } from "@/features/files/server/signed-url";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { roleHasPermission } from "@/lib/permissions/matrix";

const formatSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default async function FilesPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/files">) {
  const { organizationSlug } = await params;
  const context = await requireWorkspace(organizationSlug, "file:read");
  const [t, files, documents] = await Promise.all([
    getTranslations("Files"),
    listFiles({ prisma: db() }, context),
    listDocuments({ prisma: db() }, context),
  ]);
  const indexed = new Map(documents.map((document) => [document.fileId, document.status]));
  const canUpload = roleHasPermission(context.role, "file:upload");
  const canModerate = roleHasPermission(context.role, "file:delete-any");

  return (
    <WorkspaceShell context={context} active="files">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      {files.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">{canUpload ? t("empty") : t("emptyReadOnly")}</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
            >
              <div className="min-w-0 space-y-1">
                <a
                  href={signDownloadPath({
                    fileId: file.id,
                    userId: context.userId,
                    organizationSlug,
                  })}
                  className="font-medium text-primary hover:underline"
                >
                  {file.name}
                </a>
                <p className="text-xs text-muted-foreground">
                  {formatSize(file.sizeBytes)} · {t(`visibility.${file.visibility}`)} ·{" "}
                  {file.uploaderName ?? t("formerMember")} ·{" "}
                  {file.createdAt.toISOString().slice(0, 10)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {file.mine && (
                  <Link
                    href={`/w/${organizationSlug}/files/${file.id}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {t("manage")}
                  </Link>
                )}
                {file.mine && file.mimeType.startsWith("text/") && !indexed.has(file.id) && (
                  <ActionButton
                    action={requestIndexingAction}
                    fields={{ organizationSlug, id: file.id }}
                    label={t("addToKnowledge")}
                  />
                )}
                {indexed.has(file.id) && (
                  <span className="text-xs text-muted-foreground">{t("inKnowledge")}</span>
                )}
                {(file.mine || canModerate) && (
                  <ActionButton
                    action={deleteFileAction}
                    fields={{ organizationSlug, id: file.id }}
                    label={t("delete")}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <Card>
          <CardTitle className="mb-4 text-lg">{t("uploadTitle")}</CardTitle>
          <UploadForm organizationSlug={organizationSlug} />
        </Card>
      )}
    </WorkspaceShell>
  );
}
