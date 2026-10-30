import { describe, expect, it } from "vitest";
import {
  formatInZone,
  isValidTimeZone,
  listTimeZones,
  toLocalInputValue,
  zonedToUtc,
} from "@/lib/time-zone";

describe("time zones", () => {
  it("validates IANA names", () => {
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone("x".repeat(100))).toBe(false);
  });

  it("lists UTC first and only valid zones", () => {
    const zones = listTimeZones();
    expect(zones[0]).toBe("UTC");
    expect(zones).toContain("Asia/Jakarta");
    expect(zones.every(isValidTimeZone)).toBe(true);
  });

  it("converts wall-clock times in zones without daylight saving", () => {
    expect(zonedToUtc("2026-11-02T09:00", "Asia/Tokyo")?.toISOString()).toBe(
      "2026-11-02T00:00:00.000Z",
    );
    expect(zonedToUtc("2026-11-02T09:00", "Asia/Jakarta")?.toISOString()).toBe(
      "2026-11-02T02:00:00.000Z",
    );
    expect(zonedToUtc("2026-11-02T09:00", "UTC")?.toISOString()).toBe("2026-11-02T09:00:00.000Z");
    expect(zonedToUtc("2026-11-02T09:00", "Asia/Kolkata")?.toISOString()).toBe(
      "2026-11-02T03:30:00.000Z",
    );
  });

  it("follows daylight saving", () => {
    expect(zonedToUtc("2026-07-01T09:00", "America/New_York")?.toISOString()).toBe(
      "2026-07-01T13:00:00.000Z",
    );
    expect(zonedToUtc("2026-12-01T09:00", "America/New_York")?.toISOString()).toBe(
      "2026-12-01T14:00:00.000Z",
    );
  });

  it("rejects times that do not exist and picks the earlier of repeated times", () => {
    // 2026-03-08 02:30 never happens in New York (clocks go from 02:00 to 03:00).
    expect(zonedToUtc("2026-03-08T02:30", "America/New_York")).toBeNull();
    // 2026-11-01 01:30 happens twice in New York; the first one is still daylight time (UTC-4).
    expect(zonedToUtc("2026-11-01T01:30", "America/New_York")?.toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  it("rejects malformed values", () => {
    expect(zonedToUtc("", "UTC")).toBeNull();
    expect(zonedToUtc("2026-11-02 09:00", "UTC")).toBeNull();
    expect(zonedToUtc("2026-02-30T09:00", "UTC")).toBeNull();
    expect(zonedToUtc("2026-11-02T24:00", "UTC")).toBeNull();
    expect(zonedToUtc("2026-11-02T09:00", "Mars/Olympus")).toBeNull();
  });

  it("formats instants back into the zone", () => {
    const instant = new Date("2026-11-02T00:00:00Z");
    expect(formatInZone(instant, "Asia/Tokyo")).toBe("2026-11-02 09:00");
    expect(toLocalInputValue(instant, "Asia/Tokyo")).toBe("2026-11-02T09:00");
    expect(formatInZone(instant, "UTC")).toBe("2026-11-02 00:00");
    expect(formatInZone(instant, "America/Los_Angeles")).toBe("2026-11-01 16:00");
  });

  it("round-trips entered values", () => {
    for (const zone of ["Asia/Tokyo", "America/New_York", "Europe/Berlin", "Pacific/Auckland"]) {
      const local = "2026-06-15T13:45";
      expect(toLocalInputValue(zonedToUtc(local, zone)!, zone)).toBe(local);
    }
  });
});
