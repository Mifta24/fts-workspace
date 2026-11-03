import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve("deploy/backup-offsite.sh");
const FAKE = path.resolve("tests/helpers/fake-rclone.sh");

let root: string;
let remote: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "fts-offsite-"));
  remote = path.join(root, "remote");
  mkdirSync(path.join(root, "backups"), { recursive: true });
  mkdirSync(path.join(root, "state"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const configure = (extra = "") =>
  writeFileSync(path.join(root, "offsite.conf"), `BACKUP_REMOTE="${remote}"\n${extra}`);
const backup = (name: string, ageDays = 0) => {
  const file = path.join(root, "backups", name);
  writeFileSync(file, `content of ${name}`);
  const when = new Date(Date.now() - ageDays * 86_400_000);
  utimesSync(file, when, when);
};
const run = (env: Record<string, string> = {}) =>
  spawnSync("bash", [SCRIPT], {
    env: { ...process.env, FTS_ROOT: root, RCLONE: FAKE, ...env },
    encoding: "utf8",
  });
const state = () => path.join(root, "state", "offsite.state");

describe("off-server backup copy", () => {
  it("refuses to run without a destination", () => {
    backup("db-today.dump");
    const result = run();
    expect(result.status).toBe(2);
    expect(existsSync(state())).toBe(false);
  });

  it("refuses when there is no fresh local backup", () => {
    configure();
    backup("db-old.dump", 3);
    const result = run();
    expect(result.status).toBe(3);
    expect(existsSync(remote)).toBe(false);
  });

  it("copies, verifies and records the time", () => {
    configure();
    backup("db-today.dump");
    backup("files-today.tar.gz");
    const result = run();
    expect(result.status).toBe(0);
    expect(readdirSync(remote).sort()).toEqual(["db-today.dump", "files-today.tar.gz"]);
    expect(Number(readFileSync(state(), "utf8").trim())).toBeGreaterThan(Date.now() / 1000 - 60);
  });

  it("does not record success when the copy or the check fails", () => {
    configure();
    backup("db-today.dump");
    expect(run({ FAKE_RCLONE_FAIL: "copy" }).status).toBe(4);
    expect(run({ FAKE_RCLONE_FAIL: "check" }).status).toBe(4);
    expect(existsSync(state())).toBe(false);
  });

  it("removes copies past the retention window but not the new ones, and a cleanup failure is not a failed backup", () => {
    configure("REMOTE_KEEP_DAYS=10\n");
    mkdirSync(remote, { recursive: true });
    writeFileSync(path.join(remote, "db-ancient.dump"), "x");
    utimesSync(path.join(remote, "db-ancient.dump"), new Date(0), new Date(0));
    backup("db-today.dump");
    expect(run().status).toBe(0);
    expect(readdirSync(remote)).toEqual(["db-today.dump"]);

    writeFileSync(path.join(remote, "db-ancient2.dump"), "x");
    utimesSync(path.join(remote, "db-ancient2.dump"), new Date(0), new Date(0));
    expect(run({ FAKE_RCLONE_FAIL: "delete" }).status).toBe(0);
  });

  it("rejects a retention value that is not a number", () => {
    configure("REMOTE_KEEP_DAYS=ten\n");
    backup("db-today.dump");
    expect(run().status).toBe(2);
  });
});
