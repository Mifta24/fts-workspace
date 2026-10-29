import { getTranslations } from "next-intl/server";
import { ActionButton } from "@/components/action-button";
import { ArchiveButton } from "@/components/archive-button";
import { startDirectMessageAction } from "@/features/chat/server/actions";
import { Card, CardTitle } from "@/components/ui/card";
import { InviteMemberForm } from "@/features/organizations/components/invite-member-form";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { revokeInvitationAction } from "@/features/organizations/server/invitation-actions";
import { listPendingInvitations } from "@/features/organizations/server/invitation-service";
import { listMembers } from "@/features/organizations/server/organization-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import { db } from "@/lib/db";
import { roleHasPermission } from "@/lib/permissions/matrix";

export default async function MembersPage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/members">) {
  const { organizationSlug } = await params;
  const context = await requireWorkspace(organizationSlug, "member:read");
  const deps = { prisma: db() };
  const canInvite = roleHasPermission(context.role, "member:invite");
  const canMessage = roleHasPermission(context.role, "chat:post");
  const [t, tc, roles, members, invitations] = await Promise.all([
    getTranslations("Members"),
    getTranslations("Chat"),
    getTranslations("Roles"),
    listMembers(deps, context),
    canInvite ? listPendingInvitations(deps, context) : Promise.resolve([]),
  ]);

  return (
    <WorkspaceShell context={context} active="members">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <ul className="space-y-2">
        {members.map((member) => (
          <li
            key={member.userId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-3"
          >
            <div>
              <p className="font-medium">{member.name}</p>
              {member.email && <p className="text-xs text-muted-foreground">{member.email}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">{roles(member.role)}</span>
              {canMessage && member.userId !== context.userId && (
                <ActionButton
                  action={startDirectMessageAction}
                  fields={{ organizationSlug, userId: member.userId }}
                  label={tc("message")}
                />
              )}
            </div>
          </li>
        ))}
      </ul>

      {canInvite && (
        <>
          <section aria-labelledby="pending-title" className="space-y-2">
            <h2 id="pending-title" className="text-lg font-semibold tracking-tight">
              {t("pending")}
            </h2>
            {invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noPending")}</p>
            ) : (
              <ul className="space-y-2">
                {invitations.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
                  >
                    <div>
                      <p className="font-medium">{invitation.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {roles(invitation.role)} ·{" "}
                        {invitation.expired
                          ? t("expired")
                          : t("expires", { date: invitation.expiresAt.toISOString().slice(0, 10) })}
                      </p>
                    </div>
                    <ArchiveButton
                      action={revokeInvitationAction}
                      organizationSlug={organizationSlug}
                      id={invitation.id}
                      label={t("revoke")}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Card>
            <CardTitle className="mb-4 text-lg">{t("inviteTitle")}</CardTitle>
            <InviteMemberForm organizationSlug={organizationSlug} />
          </Card>
        </>
      )}
    </WorkspaceShell>
  );
}
