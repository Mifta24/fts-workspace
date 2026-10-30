import { getTranslations } from "next-intl/server";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DURATION_CHOICES, ISO_WEEKDAYS } from "@/features/booking/schemas/booking";
import { listTimeZones } from "@/lib/time-zone";

export type SettingsDefaults = {
  title?: string;
  description?: string | null;
  location?: string | null;
  durationMinutes?: number;
  timeZone?: string;
  weekdays?: number[];
  startMinute?: number;
  endMinute?: number;
  minNoticeHours?: number;
  maxDaysAhead?: number;
};

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** The inputs shared by creating and editing a booking page. Plain markup: it lives inside a ServerForm. */
export async function BookingSettingsFields({
  defaults = {},
  idPrefix,
}: {
  defaults?: SettingsDefaults;
  idPrefix: string;
}) {
  const t = await getTranslations("Booking");
  const weekdays = defaults.weekdays ?? [1, 2, 3, 4, 5];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-title`}>{t("titleLabel")}</Label>
        <Input
          id={`${idPrefix}-title`}
          name="title"
          defaultValue={defaults.title}
          required
          minLength={2}
          maxLength={120}
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-description`}>{t("descriptionLabel")}</Label>
        <Input
          id={`${idPrefix}-description`}
          name="description"
          defaultValue={defaults.description ?? ""}
          maxLength={1000}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-location`}>{t("locationLabel")}</Label>
        <Input
          id={`${idPrefix}-location`}
          name="location"
          defaultValue={defaults.location ?? ""}
          maxLength={200}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-duration`}>{t("durationLabel")}</Label>
        <Select
          id={`${idPrefix}-duration`}
          name="durationMinutes"
          defaultValue={String(defaults.durationMinutes ?? 30)}
        >
          {DURATION_CHOICES.map((value) => (
            <option key={value} value={value}>
              {t("minutes", { count: value })}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-zone`}>{t("zoneLabel")}</Label>
        <Select id={`${idPrefix}-zone`} name="timeZone" defaultValue={defaults.timeZone ?? "UTC"}>
          {listTimeZones().map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </Select>
      </div>
      <fieldset className="space-y-2 sm:col-span-2">
        <legend className="text-sm font-medium">{t("weekdaysLabel")}</legend>
        <div className="flex flex-wrap gap-4">
          {ISO_WEEKDAYS.map((day) => (
            <label key={day} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="weekdays"
                value={day}
                defaultChecked={weekdays.includes(day)}
                className="size-4"
              />
              {t(`weekday.${day}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-start`}>{t("startLabel")}</Label>
        <Input
          id={`${idPrefix}-start`}
          name="start"
          type="time"
          defaultValue={clock(defaults.startMinute ?? 9 * 60)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-end`}>{t("endLabel")}</Label>
        <Input
          id={`${idPrefix}-end`}
          name="end"
          type="time"
          defaultValue={clock(defaults.endMinute ?? 17 * 60)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-notice`}>{t("noticeLabel")}</Label>
        <Input
          id={`${idPrefix}-notice`}
          name="minNoticeHours"
          type="number"
          min={0}
          max={720}
          defaultValue={defaults.minNoticeHours ?? 4}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-ahead`}>{t("aheadLabel")}</Label>
        <Input
          id={`${idPrefix}-ahead`}
          name="maxDaysAhead"
          type="number"
          min={1}
          max={90}
          defaultValue={defaults.maxDaysAhead ?? 30}
          required
        />
      </div>
    </div>
  );
}
