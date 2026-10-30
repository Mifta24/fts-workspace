import { describe, expect, it } from "vitest";
import {
  buildIcs,
  escapeText,
  foldLine,
  formatUtc,
  type IcsEvent,
} from "@/features/scheduling/schemas/ics";

const NOW = new Date("2026-11-02T08:00:00Z");
const event = (overrides: Partial<IcsEvent> = {}): IcsEvent => ({
  id: "0190a1b2-0000-7000-8000-000000000001",
  title: "Planning",
  description: null,
  location: null,
  startsAt: new Date("2026-11-03T09:00:00Z"),
  endsAt: new Date("2026-11-03T10:00:00Z"),
  updatedAt: new Date("2026-11-01T12:30:45Z"),
  response: "ACCEPTED",
  reminderMinutes: 0,
  ...overrides,
});

describe("ics", () => {
  it("formats UTC instants", () => {
    expect(formatUtc(new Date("2026-11-03T09:05:07.123Z"))).toBe("20261103T090507Z");
  });

  it("escapes text values and drops control characters", () => {
    expect(escapeText("a, b; c \\ d")).toBe("a\\, b\; c \\\\ d");
    expect(escapeText("line1\r\nline2\nline3")).toBe("line1\\nline2\\nline3");
    expect(escapeText("bell\u0007 and tab\u0000")).toBe("bell and tab");
    // A title cannot inject another property or end the event.
    expect(escapeText("x\r\nEND:VEVENT")).toBe("x\\nEND:VEVENT");
  });

  it("folds long lines at 75 octets and never splits a character", () => {
    const short = "SUMMARY:short";
    expect(foldLine(short)).toBe(short);
    const long = `SUMMARY:${"あ".repeat(60)}`;
    const folded = foldLine(long);
    const physical = folded.split("\r\n");
    expect(physical.length).toBeGreaterThan(1);
    for (const [index, line] of physical.entries()) {
      const octets = new TextEncoder().encode(line).length;
      expect(octets).toBeLessThanOrEqual(75);
      if (index > 0) expect(line.startsWith(" ")).toBe(true);
    }
    // Unfolding restores the original.
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    const ascii = foldLine(`DESCRIPTION:${"x".repeat(200)}`);
    expect(ascii.replace(/\r\n /g, "")).toBe(`DESCRIPTION:${"x".repeat(200)}`);
  });

  it("builds a calendar with CRLF line endings and one VEVENT per meeting", () => {
    const text = buildIcs([event(), event({ id: "0190a1b2-0000-7000-8000-000000000002" })], {
      calendarName: "Acme, Inc meetings",
      now: NOW,
    });
    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text).not.toMatch(/[^\r]\n/);
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(text).toContain("X-WR-CALNAME:Acme\\, Inc meetings");
    expect(text).toContain("UID:0190a1b2-0000-7000-8000-000000000001@fts-workspace");
    expect(text).toContain("DTSTAMP:20261102T080000Z");
    expect(text).toContain("DTSTART:20261103T090000Z");
    expect(text).toContain("DTEND:20261103T100000Z");
    expect(text).toContain("STATUS:CONFIRMED");
    expect(text).not.toContain("VALARM");
    expect(text).not.toContain("LOCATION");
  });

  it("shows pending invitations as tentative and adds a reminder when one is set", () => {
    const text = buildIcs(
      [
        event({
          response: "PENDING",
          reminderMinutes: 30,
          location: "Room 4",
          description: "Agenda",
        }),
      ],
      { calendarName: "Meetings", now: NOW },
    );
    expect(text).toContain("STATUS:TENTATIVE");
    expect(text).toContain("LOCATION:Room 4");
    expect(text).toContain("DESCRIPTION:Agenda");
    expect(text).toContain(
      "BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Planning\r\nTRIGGER:-PT30M\r\nEND:VALARM",
    );
  });

  it("builds an empty but valid calendar", () => {
    const text = buildIcs([], { calendarName: "Meetings", now: NOW });
    expect(text).not.toContain("VEVENT");
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
