import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChatSidebar } from "@/features/chat/components/chat-sidebar";
import { MarkRead } from "@/features/chat/components/mark-read";
import { MessageForm } from "@/features/chat/components/message-form";
import { MessageItem } from "@/features/chat/components/message-item";
import { listChannels, listMessages } from "@/features/chat/server/chat-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { roleHasPermission } from "@/lib/permissions/matrix";

export default async function ChannelPage({
  params,
  searchParams,
}: PageProps<"/[locale]/w/[organizationSlug]/chat/[channelId]">) {
  const [{ organizationSlug, channelId }, query] = await Promise.all([params, searchParams]);
  const context = await requireWorkspace(organizationSlug, "chat:read");
  const deps = { prisma: db() };
  const before = typeof query.before === "string" ? query.before : undefined;

  const [t, channels, page] = await Promise.all([
    getTranslations("Chat"),
    listChannels(deps, context),
    listMessages(deps, context, channelId, { before }),
  ]).catch((error: unknown) => {
    // Missing, private and DM channels you do not belong to are all "not found".
    if (isAppError(error) && (error.code === "NOT_FOUND" || error.code === "INVALID_INPUT"))
      notFound();
    throw error;
  });

  const channel = channels.joined.find((item) => item.id === channelId);
  if (!channel) notFound();
  const canPost = roleHasPermission(context.role, "chat:post");
  const canModerate = roleHasPermission(context.role, "chat:moderate");
  const latestId = page.messages.at(-1)?.id ?? null;

  return (
    <WorkspaceShell context={context} active="chat">
      <h1 className="text-2xl font-semibold tracking-tight">
        {channel.type === "CHANNEL" ? `# ${channel.name}` : channel.name}
      </h1>
      <div className="flex flex-col gap-6 md:flex-row">
        <ChatSidebar
          organizationSlug={organizationSlug}
          joined={channels.joined}
          available={channels.available}
          activeId={channelId}
        />
        <section aria-label={t("messages")} className="flex-1 space-y-4">
          {page.nextCursor && (
            <Link
              href={`/w/${organizationSlug}/chat/${channelId}?before=${page.messages[0]!.id}`}
              className="text-sm text-primary hover:underline"
            >
              {t("loadOlder")}
            </Link>
          )}
          {page.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noMessages")}</p>
          ) : (
            <ul className="space-y-2">
              {page.messages.map((message) => {
                const own = message.authorId === context.userId;
                return (
                  <MessageItem
                    key={message.id}
                    organizationSlug={organizationSlug}
                    message={{
                      id: message.id,
                      authorName: message.authorName,
                      body: message.body,
                      edited: message.edited,
                      deleted: message.deleted,
                      time: message.createdAt.toISOString().slice(0, 16).replace("T", " ") + " UTC",
                      canEdit: canPost && message.editable,
                      // Moderation of DMs is never offered; the service enforces the same rule.
                      canDelete: own || (canModerate && channel.type === "CHANNEL"),
                    }}
                  />
                );
              })}
            </ul>
          )}
          {canPost ? (
            <MessageForm organizationSlug={organizationSlug} channelId={channelId} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("readOnly")}</p>
          )}
        </section>
      </div>
      <MarkRead
        organizationSlug={organizationSlug}
        channelId={channelId}
        latestMessageId={latestId}
      />
    </WorkspaceShell>
  );
}
