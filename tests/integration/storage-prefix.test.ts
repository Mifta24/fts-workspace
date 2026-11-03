import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalStorage, type StoragePort } from "@/server/storage/storage";

const ORG_A = "0198a000-0000-7000-8000-00000000000a";
const ORG_B = "0198a000-0000-7000-8000-00000000000b";
const file = (n: number) => `0198f000-0000-7000-8000-0000000000${String(n).padStart(2, "0")}`;

describe("storage deletePrefix", () => {
  let dir: string;
  let storage: StoragePort;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fts-storage-"));
    storage = createLocalStorage(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("removes one organization's files and no one else's", async () => {
    await storage.put(`${ORG_A}/${file(1)}`, new Uint8Array([1]));
    await storage.put(`${ORG_A}/${file(2)}`, new Uint8Array([2]));
    await storage.put(`${ORG_B}/${file(3)}`, new Uint8Array([3]));

    expect(await storage.deletePrefix(ORG_A)).toBe(2);
    expect(await storage.get(`${ORG_A}/${file(1)}`)).toBeNull();
    expect(await storage.get(`${ORG_A}/${file(2)}`)).toBeNull();
    expect(await storage.get(`${ORG_B}/${file(3)}`)).toEqual(new Uint8Array([3]));
  });

  it("returns 0 when there is nothing to remove", async () => {
    expect(await storage.deletePrefix(ORG_A)).toBe(0);
  });

  it("rejects anything that is not an organization id", async () => {
    await expect(storage.deletePrefix("../x")).rejects.toThrow("Invalid storage key");
    await expect(storage.deletePrefix("")).rejects.toThrow("Invalid storage key");
    await expect(storage.deletePrefix(`${ORG_A}/${file(1)}`)).rejects.toThrow(
      "Invalid storage key",
    );
  });
});
