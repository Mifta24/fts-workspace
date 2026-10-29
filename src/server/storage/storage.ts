import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * Where file bytes live. Services depend on this port, so moving to an S3-compatible store
 * (OD-04) means writing one adapter. Keys are always server-generated.
 */
export type StoragePort = {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
};

/** "<organization uuid>/<file uuid>" and nothing else; blocks traversal by construction. */
const KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createLocalStorage(baseDir: string): StoragePort {
  const root = path.resolve(baseDir);
  const resolve = (key: string) => {
    if (!KEY.test(key)) throw new Error("Invalid storage key");
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return full;
  };
  return {
    async put(key, bytes) {
      const full = resolve(key);
      await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
      await writeFile(full, bytes, { mode: 0o600, flag: "wx" });
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(resolve(key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(resolve(key), { force: true });
    },
  };
}

let shared: StoragePort | undefined;

export function getStorage(): StoragePort {
  shared ??= createLocalStorage(env().STORAGE_DIR);
  return shared;
}
