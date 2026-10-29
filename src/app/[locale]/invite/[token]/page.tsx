import { getTranslations } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card";
import { AcceptInvitationForm } from "@/features/organizations/components/accept-invitation-form";
import {
  previewInvitation,
  type InvitationPreview,
} from "@/features/organizations/server/invitation-service";
import { Link } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";

export default async function InvitePage({ params }: PageProps<"/[locale]/invite/[token]">) {
  const { token } = await params;
  const [t, roles, user] = await Promise.all([
    getTranslations("Invitation"),
    getTranslations("Roles"),
    getSessionUser(),
  ]);

  let preview: InvitationPreview | null = null;
  try {
    preview = await previewInvitation({ prisma: db() }, token);
  } catch (error) {
    if (!isAppError(error) || error.code !== "NOT_FOUND") throw error;
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <Card className="space-y-4">
        {preview === null ? (
          <>
            <CardTitle>{t("invalidTitle")}</CardTitle>
            <p className="text-muted-foreground">{t("invalidBody")}</p>
            <Link href="/workspaces" className="text-sm font-medium text-primary hover:underline">
              {t("toWorkspaces")}
            </Link>
          </>
        ) : (
          <>
            <CardTitle>{t("title", { organization: preview.organizationName })}</CardTitle>
            <p className="text-muted-foreground">
              {t("body", { role: roles(preview.role), email: preview.maskedEmail })}
            </p>
            {user?.emailVerified ? (
              <AcceptInvitationForm token={token} />
            ) : (
              <div className="space-y-2">
                <p className="text-sm">{t("signInFirst")}</p>
                <div className="flex gap-4 text-sm font-medium text-primary">
                  <Link href="/sign-in" className="hover:underline">
                    {t("signIn")}
                  </Link>
                  <Link href="/sign-up" className="hover:underline">
                    {t("signUp")}
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </main>
  );
}
