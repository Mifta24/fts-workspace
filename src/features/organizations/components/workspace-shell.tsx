import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { SignOutButton } from "@/features/auth/components/auth-forms";
import { Link } from "@/i18n/navigation";
import type { OrganizationContext } from "@/features/organizations/server/organization-service";
import { cn } from "@/lib/utils";

type Section = "overview" | "projects" | "goals" | "tasks" | "members";

const SECTIONS: { key: Section; path: string }[] = [
  { key: "overview", path: "" },
  { key: "projects", path: "/projects" },
  { key: "goals", path: "/goals" },
  { key: "tasks", path: "/tasks" },
  { key: "members", path: "/members" },
];

export async function WorkspaceShell({
  context,
  active,
  children,
}: {
  context: OrganizationContext;
  active: Section;
  children: ReactNode;
}) {
  const [t, roles] = await Promise.all([getTranslations("Workspace"), getTranslations("Roles")]);
  const base = `/w/${context.organization.slug}`;

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <nav
        aria-label={t("navLabel")}
        className="flex shrink-0 gap-2 overflow-x-auto bg-sidebar p-4 text-sidebar-foreground md:w-60 md:flex-col"
      >
        <p className="hidden truncate px-2 font-semibold md:block">{context.organization.name}</p>
        {SECTIONS.map(({ key, path }) => (
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
    </div>
  );
}
