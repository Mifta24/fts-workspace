import { getTranslations } from "next-intl/server";
import { RealtimeBridge } from "@/features/realtime/components/realtime-bridge";
import { countUnread } from "@/features/notifications/server/notification-service";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { ReactNode } from "react";
import { SignOutButton } from "@/features/auth/components/auth-forms";
import { Link } from "@/i18n/navigation";
import type { OrganizationContext } from "@/features/organizations/server/organization-service";
import type { Permission } from "@/lib/permissions/matrix";
import { cn } from "@/lib/utils";

type Section =
  | "overview"
  | "projects"
  | "goals"
  | "tasks"
  | "chat"
  | "notifications"
  | "progress"
  | "files"
  | "knowledge"
  | "assistant"
  | "crm"
  | "members";

const SECTIONS: { key: Section; path: string; permission?: Permission }[] = [
  { key: "overview", path: "" },
  { key: "projects", path: "/projects" },
  { key: "goals", path: "/goals" },
  { key: "tasks", path: "/tasks" },
  { key: "chat", path: "/chat" },
  { key: "notifications", path: "/notifications" },
  { key: "progress", path: "/progress" },
  { key: "files", path: "/files" },
  { key: "knowledge", path: "/knowledge" },
  { key: "assistant", path: "/assistant", permission: "ai:use" },
  { key: "crm", path: "/crm", permission: "crm:read" },
  { key: "members", path: "/members" },
];

export async function WorkspaceShell({
  context,
  active,
  channelId,
  children,
}: {
  context: OrganizationContext;
  active: Section;
  /** Open chat channel, so the page also receives its live messages. */
  channelId?: string;
  children: ReactNode;
}) {
  const [t, roles, unread] = await Promise.all([
    getTranslations("Workspace"),
    getTranslations("Roles"),
    countUnread({ prisma: db() }, context),
  ]);
  const base = `/w/${context.organization.slug}`;

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <nav
        aria-label={t("navLabel")}
        className="flex shrink-0 gap-2 overflow-x-auto bg-sidebar p-4 text-sidebar-foreground md:w-60 md:flex-col"
      >
        <p className="hidden truncate px-2 font-semibold md:block">{context.organization.name}</p>
        {SECTIONS.filter(
          ({ permission }) => !permission || context.permissions.includes(permission),
        ).map(({ key, path }) => (
          <Link
            key={key}
            href={`${base}${path}`}
            aria-current={key === active ? "page" : undefined}
            className={cn(
              "rounded-md px-2 py-1.5 text-sm whitespace-nowrap hover:bg-white/10 focus-visible:outline-2",
              key === active && "bg-white/10",
            )}
          >
            {t(key)}
            {key === "notifications" && unread > 0 && (
              <span
                className="ml-2 rounded-full bg-white/20 px-2 text-xs"
                aria-label={t("unread", { count: unread })}
              >
                {unread}
              </span>
            )}
          </Link>
        ))}
      </nav>
      <main className="flex-1 space-y-6 px-4 py-8 md:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">
              {context.organization.name} · {t("role", { role: roles(context.role) })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/workspaces" className="text-sm font-medium text-primary hover:underline">
              {t("switch")}
            </Link>
            <SignOutButton />
          </div>
        </header>
        {children}
      </main>
      <RealtimeBridge
        url={env().REALTIME_PUBLIC_URL}
        organizationSlug={context.organization.slug}
        channelId={channelId}
      />
    </div>
  );
}
