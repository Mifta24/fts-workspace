import { getTranslations } from "next-intl/server";
import { ActionButton } from "@/components/action-button";
import { Card } from "@/components/ui/card";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/features/notifications/server/actions";
import { listNotifications } from "@/features/notifications/server/notification-service";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";

export default async function NotificationsPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/notifications">) {
  const { organizationSlug } = await params;
  const context = await requireWorkspace(organizationSlug, "notification:read");
  const [t, items] = await Promise.all([
    getTranslations("Notifications"),
    listNotifications({ prisma: db() }, context),
  ]);
  const hasUnread = items.some((item) => !item.read);

  return (
    <WorkspaceShell context={context} active="notifications">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {hasUnread && (
          <ActionButton
            action={markAllNotificationsReadAction}
            fields={{ organizationSlug }}
            label={t("markAll")}
          />
        )}
      </div>
      {items.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">{t("empty")}</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const actor = item.actorName ?? t("someone");
            const href =
              item.resourceType === "task"
                ? `/w/${organizationSlug}/tasks/${item.resourceId}`
                : `/w/${organizationSlug}/chat/${item.resourceId}`;
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
              >
                <div>
                  <Link href={href} className={item.read ? "text-sm" : "text-sm font-semibold"}>
                    {t(`text.${item.type}`, { actor, title: item.resourceTitle ?? t("aTask") })}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {item.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                    {item.read ? "" : ` · ${t("unread")}`}
                  </p>
                </div>
                {!item.read && (
                  <ActionButton
                    action={markNotificationReadAction}
                    fields={{ organizationSlug, id: item.id }}
                    label={t("markRead")}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </WorkspaceShell>
  );
}
