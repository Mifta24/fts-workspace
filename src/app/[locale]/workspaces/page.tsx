import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card";
import { SignOutButton } from "@/features/auth/components/auth-forms";
import { CreateOrganizationForm } from "@/features/organizations/components/create-organization-form";
import { listUserOrganizations } from "@/features/organizations/server/organization-service";
import { Link, redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export default async function WorkspacesPage() {
  const locale = await getLocale();
  const user = await getSessionUser();
  if (!user?.emailVerified) return redirect({ href: "/sign-in", locale });

  const [t, roles, organizations] = await Promise.all([
    getTranslations("Workspaces"),
    getTranslations("Roles"),
    listUserOrganizations({ prisma: db() }, user.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <SignOutButton />
      </header>

      <Card>
        {organizations.length === 0 ? (
          <p className="text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {organizations.map((organization) => (
              <li key={organization.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="font-medium">{organization.name}</p>
                  <p className="text-sm text-muted-foreground">
                    /{organization.slug} · {roles(organization.role)}
                  </p>
                </div>
                <Link
                  href={`/w/${organization.slug}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {t("open")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-4">
        <CardTitle className="text-lg">{t("createTitle")}</CardTitle>
        <CreateOrganizationForm />
      </Card>
    </main>
  );
}
