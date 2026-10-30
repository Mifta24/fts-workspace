import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSecretBox, parseSecretKey } from "@/server/security/secret-box";

const box = () => createSecretBox(randomBytes(32));

describe("secret box", () => {
  it("opens what it sealed, and never shows the plaintext", () => {
    const secret = box();
    const sealed = secret.seal("1//refresh-token-value", "owner-a");
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("refresh-token-value");
    expect(secret.open(sealed, "owner-a")).toBe("1//refresh-token-value");
  });

  it("seals the same value differently each time", () => {
    const secret = box();
    expect(secret.seal("same", "c")).not.toBe(secret.seal("same", "c"));
  });

  it("refuses another context, another key and altered values", () => {
    const key = randomBytes(32);
    const secret = createSecretBox(key);
    const sealed = secret.seal("token", "owner-a");
    expect(() => secret.open(sealed, "owner-b")).toThrow();
    expect(() => createSecretBox(randomBytes(32)).open(sealed, "owner-a")).toThrow();
    const [version, iv, tag, body] = sealed.split(".");
    const flipped = `${body!.slice(0, -2)}${body!.endsWith("AA") ? "BB" : "AA"}`;
    expect(() => secret.open([version, iv, tag, flipped].join("."), "owner-a")).toThrow();
    expect(() => secret.open("v2.a.b.c", "owner-a")).toThrow();
    expect(() => secret.open("not sealed", "owner-a")).toThrow();
    expect(() => secret.open(`${sealed}.extra`, "owner-a")).toThrow();
  });

  it("accepts only a 32-byte base64 key", () => {
    expect(parseSecretKey(randomBytes(32).toString("base64"))?.length).toBe(32);
    expect(parseSecretKey(randomBytes(16).toString("base64"))).toBeUndefined();
    expect(parseSecretKey("not base64 at all!")).toBeUndefined();
    expect(() => createSecretBox(randomBytes(16))).toThrow();
  });
});
