import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { RealtimeBridge } from "@/features/realtime/components/realtime-bridge";
import { countUnread } from "@/features/notifications/server/notification-service";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { ReactNode } from "react";
import { SignOutButton } from "@/features/auth/components/auth-forms";
import { Link } from "@/i18n/navigation";
import type { OrganizationContext } from "@/features/organizations/server/organization-service";
import {
  NAV_MODE_COOKIE,
  parseNavMode,
  visibleSections,
} from "@/features/organizations/schemas/nav-mode";
import { dueAfter } from "@/features/organizations/schemas/deletion";
import { setNavModeAction } from "@/features/organizations/server/nav-mode-action";
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
  | "schedule"
  | "forms"
  | "insights"
  | "automations"
  | "members"
  | "billing"
  | "settings";

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
  { key: "schedule", path: "/schedule" },
  { key: "forms", path: "/forms", permission: "form:manage" },
  { key: "insights", path: "/insights" },
  { key: "automations", path: "/automations", permission: "automation:manage" },
  { key: "members", path: "/members" },
  { key: "billing", path: "/billing", permission: "billing:read" },
  { key: "settings", path: "/settings", permission: "organization:delete" },
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
  const [t, help, roles, unread, cookieStore, locale] = await Promise.all([
    getTranslations("Workspace"),
    getTranslations("Help"),
    getTranslations("Roles"),
    countUnread({ prisma: db() }, context),
    cookies(),
    getLocale(),
  ]);
  const base = `/w/${context.organization.slug}`;
  const deletionRequestedAt = context.organization.deletionRequestedAt ?? null;
  const mode = parseNavMode(cookieStore.get(NAV_MODE_COOKIE)?.value);
  // Permission decides what exists for this person; the view mode only decides what is listed.
  const allowed = SECTIONS.filter(
    ({ permission }) => !permission || context.permissions.includes(permission),
  );
  const shown = new Set(
    visibleSections(
      mode,
      active,
      allowed.map(({ key }) => key),
    ),
  );

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <nav
        aria-label={t("navLabel")}
        className="flex shrink-0 gap-2 overflow-x-auto border-b border-border bg-sidebar p-4 text-sidebar-foreground md:w-60 md:flex-col md:border-r md:border-b-0"
      >
        <p className="hidden truncate px-2 font-semibold md:block">{context.organization.name}</p>
        {allowed
          .filter(({ key }) => shown.has(key))
          .map(({ key, path }) => (
            <Link
              key={key}
              href={`${base}${path}`}
              aria-current={key === active ? "page" : undefined}
              className={cn(
                "rounded-md px-2 py-1.5 text-sm whitespace-nowrap hover:bg-foreground/5 focus-visible:outline-2",
                key === active &&
                  "bg-card font-semibold text-primary ring-1 ring-border hover:bg-card",
              )}
            >
              {t(key)}
              {key === "notifications" && unread > 0 && (
                <span
                  className="ml-2 rounded-full bg-primary px-2 text-xs text-primary-foreground"
                  aria-label={t("unread", { count: unread })}
                >
                  {unread}
                </span>
              )}
            </Link>
          ))}
        <form action={setNavModeAction} className="md:mt-auto">
          <input type="hidden" name="mode" value={mode === "simple" ? "full" : "simple"} />
          <button
            type="submit"
            className="rounded-md px-2 py-1.5 text-sm whitespace-nowrap text-sidebar-foreground/70 hover:bg-foreground/5 focus-visible:outline-2"
          >
            {mode === "simple" ? t("showAll") : t("showEssentials")}
          </button>
        </form>
      </nav>
      <main className="flex-1 space-y-6 px-4 py-8 md:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
          <p className="text-sm text-muted-foreground">
            <span className="mr-2 font-semibold text-foreground md:hidden">
              {context.organization.name}
            </span>
            {t("role", { role: roles(context.role) })}
          </p>
          <div className="flex items-center gap-3">
            <Link href="/help" className="text-sm font-medium text-primary hover:underline">
              {help("nav")}
            </Link>
            <Link href="/workspaces" className="text-sm font-medium text-primary hover:underline">
              {t("switch")}
            </Link>
            <SignOutButton />
          </div>
        </header>
        {deletionRequestedAt && (
          <p
            role="status"
            data-testid="deletion-banner"
            className="rounded-md border border-border bg-card px-4 py-3 text-sm"
          >
            {t("deletionBanner", {
              date: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
                dueAfter(deletionRequestedAt),
              ),
            })}
          </p>
        )}
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
