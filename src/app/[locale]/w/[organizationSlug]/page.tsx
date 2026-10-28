import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { SignOutButton } from "@/features/auth/components/auth-forms";
import { getAuthorizedOrganization } from "@/features/organizations/server/organization-service";
import { Link, redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";

export default async function WorkspacePage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]">) {
  const [{ organizationSlug }, locale] = await Promise.all([params, getLocale()]);
  const user = await getSessionUser();
  if (!user?.emailVerified) return redirect({ href: "/sign-in", locale });

  // Tenant access comes from the canonical membership row, never from the URL alone.
  const context = await getAuthorizedOrganization(
    { prisma: db() },
    { userId: user.id, organizationSlug, permission: "organization:read" },
  ).catch((error: unknown) => {
    if (isAppError(error) && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) {
      notFound();
    }
    throw error;
  });

  const [t, roles] = await Promise.all([getTranslations("Workspace"), getTranslations("Roles")]);

  return (
    <div className="flex flex-1">
      <nav
        aria-label="Primary"
        className="hidden w-60 shrink-0 flex-col gap-2 bg-sidebar p-4 text-sidebar-foreground md:flex"
      >
        <p className="truncate px-2 font-semibold">{context.organization.name}</p>
        <span aria-current="page" className="rounded-md bg-white/10 px-2 py-1.5 text-sm">
          {t("overview")}
        </span>
      </nav>
      <main className="flex-1 space-y-6 px-4 py-8 md:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{context.organization.name}</h1>
            <p className="text-sm text-muted-foreground">
              {t("role", { role: roles(context.role) })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/workspaces" className="text-sm font-medium text-primary hover:underline">
              {t("switch")}
            </Link>
            <SignOutButton />
          </div>
        </header>
        <Card>
          <p className="text-muted-foreground">{t("placeholder")}</p>
        </Card>
      </main>
    </div>
  );
}
