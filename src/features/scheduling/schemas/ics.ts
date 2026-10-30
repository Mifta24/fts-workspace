/**
 * Minimal iCalendar (RFC 5545) writer for a read-only meetings feed. Pure functions: no
 * database, no clock; callers pass everything in.
 */
export type IcsEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  updatedAt: Date;
  /** The person's own answer: a pending invitation is shown as tentative. */
  response: "PENDING" | "ACCEPTED";
  reminderMinutes: number;
};

const CRLF = "\r\n";
const encoder = new TextEncoder();

/** TEXT values: backslash, semicolon, comma and line breaks are escaped; control characters dropped. */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Folds a content line at 75 octets, never inside a multi-byte character. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  // The first line may hold 75 octets, the continuation lines 74 plus the leading space.
  let limit = 75;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
      limit = 74;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

export function formatUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function buildIcs(
  events: readonly IcsEvent[],
  options: { calendarName: string; now: Date; uidDomain?: string },
): string {
  const domain = options.uidDomain ?? "fts-workspace";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FTS AI Workspace//Meetings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(options.calendarName)}`,
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@${domain}`,
      `DTSTAMP:${formatUtc(options.now)}`,
      `LAST-MODIFIED:${formatUtc(event.updatedAt)}`,
      `SEQUENCE:${Math.floor(event.updatedAt.getTime() / 1000)}`,
      `DTSTART:${formatUtc(event.startsAt)}`,
      `DTEND:${formatUtc(event.endsAt)}`,
      `SUMMARY:${escapeText(event.title)}`,
    );
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    lines.push(`STATUS:${event.response === "ACCEPTED" ? "CONFIRMED" : "TENTATIVE"}`);
    if (event.reminderMinutes > 0) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeText(event.title)}`,
        `TRIGGER:-PT${event.reminderMinutes}M`,
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}
