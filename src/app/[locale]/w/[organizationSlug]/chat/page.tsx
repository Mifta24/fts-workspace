import { getTranslations } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card";
import { ChatSidebar } from "@/features/chat/components/chat-sidebar";
import { CreateChannelForm } from "@/features/chat/components/create-channel-form";
import { listChannels } from "@/features/chat/server/chat-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { db } from "@/lib/db";
import { roleHasPermission } from "@/lib/permissions/matrix";

export default async function ChatPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/chat">) {
  const { organizationSlug } = await params;
  const context = await requireWorkspace(organizationSlug, "chat:read");
  const [t, { joined, available }] = await Promise.all([
    getTranslations("Chat"),
    listChannels({ prisma: db() }, context),
  ]);
  const canManage = roleHasPermission(context.role, "chat:manage");

  return (
    <WorkspaceShell context={context} active="chat">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <div className="flex flex-col gap-6 md:flex-row">
        <ChatSidebar organizationSlug={organizationSlug} joined={joined} available={available} />
        <div className="flex-1 space-y-4">
          <Card>
            <p className="text-muted-foreground">{t("pickChannel")}</p>
          </Card>
          {canManage && (
            <Card>
              <CardTitle className="mb-4 text-lg">{t("createTitle")}</CardTitle>
              <CreateChannelForm organizationSlug={organizationSlug} />
            </Card>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}
