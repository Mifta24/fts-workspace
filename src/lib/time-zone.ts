/**
 * Time zone helpers built on Intl, so no dependency is needed. Instants are always stored in UTC;
 * a zone only decides how wall-clock times are shown and entered.
 */
export const DEFAULT_TIME_ZONE = "UTC";

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const MINUTE = 60_000;

export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Selectable zones: UTC first, then everything the runtime knows. */
export function listTimeZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC");
  return [DEFAULT_TIME_ZONE, ...zones];
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let cached = formatters.get(zone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, cached);
  }
  return cached;
}

/** The wall-clock fields of an instant in a zone, as if they were UTC fields. */
function wallClock(instant: number, zone: string): number {
  const fields: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  return Date.UTC(
    fields.year!,
    fields.month! - 1,
    fields.day!,
    fields.hour!,
    fields.minute!,
    fields.second!,
  );
}

/** Offset of the zone from UTC at an instant, in milliseconds (positive east of UTC). */
function offsetAt(instant: number, zone: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  return wallClock(whole, zone) - whole;
}

/** `YYYY-MM-DD HH:mm` of the instant in the zone. */
export function formatInZone(date: Date, zone: string): string {
  return new Date(wallClock(date.getTime(), zone)).toISOString().slice(0, 16).replace("T", " ");
}

/** `YYYY-MM-DDTHH:mm`, the value format of `<input type="datetime-local">`. */
export function toLocalInputValue(date: Date, zone: string): string {
  return new Date(wallClock(date.getTime(), zone)).toISOString().slice(0, 16);
}

/**
 * Converts a `datetime-local` value entered in a zone to the UTC instant. Returns null when the
 * value is malformed or does not exist in that zone (the hour skipped when clocks go forward).
 * When a wall-clock time happens twice (clocks go back), the earlier instant wins.
 */
export function zonedToUtc(local: string, zone: string): Date | null {
  const match = LOCAL_PATTERN.exec(local);
  if (!match || !isValidTimeZone(zone)) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const roundTrips = new Date(wall);
  if (
    roundTrips.getUTCFullYear() !== year ||
    roundTrips.getUTCMonth() !== month - 1 ||
    roundTrips.getUTCDate() !== day ||
    roundTrips.getUTCHours() !== hour ||
    roundTrips.getUTCMinutes() !== minute
  ) {
    return null; // e.g. February 30th or 24:00
  }
  // The offset can only differ by a transition near the wall time, so test the offsets a day
  // either side and keep the candidates that really show this wall time in the zone.
  const offsets = new Set([
    offsetAt(wall - 24 * 60 * MINUTE, zone),
    offsetAt(wall + 24 * 60 * MINUTE, zone),
  ]);
  const matches = [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => wallClock(instant, zone) === wall)
    .sort((a, b) => a - b);
  return matches.length > 0 ? new Date(matches[0]!) : null;
}
