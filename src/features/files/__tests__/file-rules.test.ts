import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sanitizeFileName, verifyContent } from "@/features/files/schemas/file";
import { createLocalStorage } from "@/server/storage/storage";

vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_SECRET: "x".repeat(40) }) }));

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe("verifyContent", () => {
  it("accepts files whose content matches the declared type", () => {
    expect(verifyContent("application/pdf", text("%PDF-1.7 ..."))).toBe("application/pdf");
    expect(
      verifyContent("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)),
    ).toBe("image/png");
    expect(verifyContent("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(verifyContent("image/webp", text("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(verifyContent("text/markdown; charset=utf-8", text("# 日本語 title"))).toBe(
      "text/markdown",
    );
    expect(verifyContent("text/csv", text("a,b\n1,2"))).toBe("text/csv");
  });

  it("rejects mismatches, disallowed types, binary text and invalid UTF-8", () => {
    expect(verifyContent("application/pdf", text("not a pdf"))).toBeNull();
    expect(verifyContent("image/png", bytes(0xff, 0xd8, 0xff))).toBeNull();
    expect(verifyContent("text/html", text("<script>alert(1)</script>"))).toBeNull();
    expect(verifyContent("image/svg+xml", text("<svg onload=alert(1)/>"))).toBeNull();
    expect(verifyContent("application/x-msdownload", text("MZ"))).toBeNull();
    expect(verifyContent("text/plain", bytes(0x68, 0x00, 0x69))).toBeNull();
    expect(verifyContent("text/plain", bytes(0xc3, 0x28))).toBeNull();
    expect(verifyContent("", text("anything"))).toBeNull();
  });
});

describe("sanitizeFileName", () => {
  it("keeps display names harmless", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
    expect(sanitizeFileName('a<b>"c".txt')).toBe("abc.txt");
    expect(sanitizeFileName("  .hidden  ")).toBe("hidden");
    expect(sanitizeFileName("\u0000\u001f")).toBe("file");
    expect(sanitizeFileName("x".repeat(500))).toHaveLength(120);
  });
});

describe("local storage", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fts-storage-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const key = () => `${crypto.randomUUID()}/${crypto.randomUUID()}`;

  it("stores, reads and deletes by server-generated key", async () => {
    const storage = createLocalStorage(dir);
    const k = key();
    await storage.put(k, text("hello"));
    expect(new TextDecoder().decode((await storage.get(k))!)).toBe("hello");
    await storage.delete(k);
    expect(await storage.get(k)).toBeNull();
    await storage.delete(k);
  });

  it("refuses overwriting an existing object and any key that is not <uuid>/<uuid>", async () => {
    const storage = createLocalStorage(dir);
    const k = key();
    await storage.put(k, text("a"));
    await expect(storage.put(k, text("b"))).rejects.toThrow();
    for (const bad of [
      "../escape",
      "/abs/path",
      `${key()}/../../x`,
      "a/b",
      "",
      `${crypto.randomUUID()}`,
    ]) {
      await expect(storage.put(bad, text("x"))).rejects.toThrow("Invalid storage key");
      await expect(storage.get(bad)).rejects.toThrow("Invalid storage key");
    }
    expect((await readdir(path.dirname(dir))).includes("escape")).toBe(false);
  });
});

describe("signed download URLs", () => {
  it("binds the signature to the file, the person and the expiry", async () => {
    const { signDownloadPath, verifyDownloadSignature, DOWNLOAD_URL_TTL_MS } =
      await import("@/features/files/server/signed-url");
    const now = new Date("2026-10-29T10:00:00Z");
    const fileId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const url = new URL(
      signDownloadPath({ fileId, userId, organizationSlug: "acme" }, now),
      "http://x",
    );
    const exp = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig");
    expect(url.searchParams.get("org")).toBe("acme");

    expect(verifyDownloadSignature({ fileId, userId, exp, sig }, now)).toBe(true);
    expect(verifyDownloadSignature({ fileId, userId: crypto.randomUUID(), exp, sig }, now)).toBe(
      false,
    );
    expect(verifyDownloadSignature({ fileId: crypto.randomUUID(), userId, exp, sig }, now)).toBe(
      false,
    );
    expect(
      verifyDownloadSignature({ fileId, userId, exp: String(Number(exp) + 60), sig }, now),
    ).toBe(false);
    expect(verifyDownloadSignature({ fileId, userId, exp, sig: `${sig}x` }, now)).toBe(false);
    expect(verifyDownloadSignature({ fileId, userId, exp: null, sig: null }, now)).toBe(false);
    const later = new Date(now.getTime() + DOWNLOAD_URL_TTL_MS + 1000);
    expect(verifyDownloadSignature({ fileId, userId, exp, sig }, later)).toBe(false);
  });
});
