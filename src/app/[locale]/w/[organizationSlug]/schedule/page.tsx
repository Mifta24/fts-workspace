import { getTranslations } from "next-intl/server";
import { ActionButton } from "@/components/action-button";
import { ServerForm } from "@/components/server-form";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { listContacts } from "@/features/crm/server/crm-service";
import { WorkspaceShell } from "@/features/organizations/components/workspace-shell";
import { listMembers } from "@/features/organizations/server/organization-service";
import { requireWorkspace } from "@/features/organizations/server/require-workspace";
import {
  cancelAction,
  createAppointmentAction,
  rescheduleAction,
  respondAction,
  setTimeZoneAction,
} from "@/features/scheduling/server/actions";
import { CalendarFeedPanel } from "@/features/scheduling/components/calendar-feed-panel";
import { REMINDER_CHOICES } from "@/features/scheduling/schemas/scheduling";
import { getFeedStatus } from "@/features/scheduling/server/calendar-feed";
import { getTimeZone, listAppointments } from "@/features/scheduling/server/scheduling-service";
import { db } from "@/lib/db";
import { roleHasPermission } from "@/lib/permissions/matrix";
import { formatInZone, listTimeZones } from "@/lib/time-zone";

const minutes = (start: Date, end: Date) => Math.round((end.getTime() - start.getTime()) / 60_000);

export default async function SchedulePage({
  params,
}: PageProps<"/[locale]/w/[organizationSlug]/schedule">) {
  const { organizationSlug } = await params;
  const context = await requireWorkspace(organizationSlug, "appointment:read");
  const deps = { prisma: db() };
  const canWrite = roleHasPermission(context.role, "appointment:write");
  const canSeeContacts = roleHasPermission(context.role, "crm:read");
  const [t, appointments, members, contacts, timeZone, feed] = await Promise.all([
    getTranslations("Schedule"),
    listAppointments(deps, context),
    listMembers(deps, context),
    canWrite && canSeeContacts ? listContacts(deps, context) : Promise.resolve([]),
    getTimeZone(deps, context),
    getFeedStatus(deps, context),
  ]);

  return (
    <WorkspaceShell context={context} active="schedule">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("intro", { zone: timeZone })}</p>

      <ServerForm
        action={setTimeZoneAction}
        fields={{ organizationSlug }}
        submitLabel={t("saveZone")}
        resetOnSuccess={false}
        className="flex flex-wrap items-end gap-3"
      >
        <div className="space-y-1">
          <Label htmlFor="tz">{t("zoneLabel")}</Label>
          <Select id="tz" name="timeZone" defaultValue={timeZone}>
            {listTimeZones().map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </div>
      </ServerForm>

      {appointments.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">{canWrite ? t("empty") : t("emptyReadOnly")}</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {appointments.map((appointment) => (
            <li
              key={appointment.id}
              className="space-y-3 rounded-md border border-border bg-card p-4"
            >
              <div>
                <p className="font-medium">{appointment.title}</p>
                <p className="text-sm text-muted-foreground">
                  {formatInZone(appointment.startsAt, timeZone)} ({timeZone}) ·{" "}
                  {t("minutes", { count: minutes(appointment.startsAt, appointment.endsAt) })}
                  {appointment.location ? ` · ${appointment.location}` : ""}
                </p>
                {appointment.contactName && (
                  <p className="text-sm text-muted-foreground">
                    {t("withContact", { name: appointment.contactName })}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {appointment.attendees
                    .map((a) => `${a.name ?? t("formerMember")} (${t(`response.${a.response}`)})`)
                    .join(", ")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!appointment.mine && appointment.myResponse !== "ACCEPTED" && (
                  <ActionButton
                    action={respondAction}
                    fields={{ organizationSlug, id: appointment.id, response: "ACCEPTED" }}
                    label={t("accept")}
                  />
                )}
                {!appointment.mine && appointment.myResponse !== "DECLINED" && (
                  <ActionButton
                    action={respondAction}
                    fields={{ organizationSlug, id: appointment.id, response: "DECLINED" }}
                    label={t("decline")}
                  />
                )}
                {appointment.mine && (
                  <ActionButton
                    action={cancelAction}
                    fields={{ organizationSlug, id: appointment.id }}
                    label={t("cancel")}
                  />
                )}
              </div>
              {appointment.mine && (
                <ServerForm
                  action={rescheduleAction}
                  fields={{ organizationSlug, id: appointment.id }}
                  submitLabel={t("reschedule")}
                  resetOnSuccess={false}
                  className="flex flex-wrap items-end gap-3"
                >
                  <div className="space-y-1">
                    <Label htmlFor={`rs-${appointment.id}`}>
                      {t("newStart", { zone: timeZone })}
                    </Label>
                    <Input
                      id={`rs-${appointment.id}`}
                      name="startsAt"
                      type="datetime-local"
                      required
                    />
                  </div>
                  <input
                    type="hidden"
                    name="durationMinutes"
                    value={minutes(appointment.startsAt, appointment.endsAt)}
                  />
                </ServerForm>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <Card>
          <CardTitle className="mb-4 text-lg">{t("createTitle")}</CardTitle>
          <ServerForm
            action={createAppointmentAction}
            fields={{ organizationSlug }}
            submitLabel={t("create")}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="ap-title">{t("titleLabel")}</Label>
                <Input id="ap-title" name="title" required minLength={2} maxLength={160} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ap-start">{t("startLabel", { zone: timeZone })}</Label>
                <Input id="ap-start" name="startsAt" type="datetime-local" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ap-duration">{t("durationLabel")}</Label>
                <Select id="ap-duration" name="durationMinutes" defaultValue="30">
                  {[15, 30, 45, 60, 90, 120].map((value) => (
                    <option key={value} value={value}>
                      {t("minutes", { count: value })}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ap-reminder">{t("reminderLabel")}</Label>
                <Select id="ap-reminder" name="reminderMinutes" defaultValue="15">
                  {REMINDER_CHOICES.map((value) => (
                    <option key={value} value={value}>
                      {value === 0 ? t("reminderNone") : t("reminderBefore", { count: value })}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ap-location">{t("locationLabel")}</Label>
                <Input id="ap-location" name="location" maxLength={200} />
              </div>
              {canSeeContacts && (
                <div className="space-y-2">
                  <Label htmlFor="ap-contact">{t("contactLabel")}</Label>
                  <Select id="ap-contact" name="contactId" defaultValue="">
                    <option value="">{t("none")}</option>
                    {contacts
                      .filter((c) => !c.erased)
                      .map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.name}
                        </option>
                      ))}
                  </Select>
                </div>
              )}
              <fieldset className="space-y-2 sm:col-span-2">
                <legend className="text-sm font-medium">{t("attendeesLabel")}</legend>
                <div className="flex flex-wrap gap-4">
                  {members
                    .filter((member) => member.userId !== context.userId)
                    .map((member) => (
                      <label key={member.userId} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="attendeeIds"
                          value={member.userId}
                          className="size-4"
                        />
                        {member.name}
                      </label>
                    ))}
                </div>
              </fieldset>
            </div>
          </ServerForm>
        </Card>
      )}
      <CalendarFeedPanel
        organizationSlug={organizationSlug}
        enabled={feed.enabled}
        createdOn={feed.createdAt ? formatInZone(feed.createdAt, timeZone).slice(0, 10) : null}
        lastUsedOn={feed.lastUsedAt ? formatInZone(feed.lastUsedAt, timeZone) : null}
      />
    </WorkspaceShell>
  );
}
