/**
 * Backup and restore rehearsal: `pnpm rehearse:restore`
 *
 * Proves that a cold physical backup (database directory + file storage directory) brings the
 * product back with nothing lost, using only npm-provided PostgreSQL binaries:
 *   1. start a database, migrate, load a small multi-tenant data set and real stored files;
 *   2. fingerprint it (rows per table, content hash of every file, tenant ids);
 *   3. stop the database cleanly and copy both directories (the "backup");
 *   4. destroy the originals (the "disaster");
 *   5. start a new database from the copy and compare everything with the fingerprint.
 *
 * What this does NOT prove: hot backups (pg_dump or continuous archiving), point-in-time recovery,
 * or restoring into the production hosting (OD-01). Those need the real environment and are listed
 * in docs/12-OPERATIONS.md. Exits non-zero on any difference. Prints the measured restore time.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { startLocalPostgres } from "./local-postgres";

const PORT = Number(process.env.REHEARSAL_PORT ?? 54332);
const PASSWORD = "fts_rehearsal_password";
const DATABASE = "fts_workspace_rehearsal";

const work = await mkdtemp(path.join(tmpdir(), "fts-rehearsal-"));
const dirs = {
  db: path.join(work, "db"),
  files: path.join(work, "files"),
  backupDb: path.join(work, "backup", "db"),
  backupFiles: path.join(work, "backup", "files"),
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const client = (url: string) =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

type Fingerprint = {
  rows: Record<string, number>;
  migrations: number;
  files: { key: string; sha256: string }[];
  /** Tasks and files per tenant: restoring must not move rows between organizations. */
  perTenant: { organizationId: string; tasks: number; files: number }[];
};

async function fingerprint(prisma: PrismaClient, filesDir: string): Promise<Fingerprint> {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
    ORDER BY table_name`;
  const rows: Record<string, number> = {};
  for (const { table_name } of tables) {
    if (!/^[a-z_]+$/.test(table_name)) throw new Error(`Unexpected table name ${table_name}`);
    const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM "${table_name}"`,
    );
    rows[table_name] = Number(count);
  }
  const [{ count: migrations }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
  const stored = await prisma.fileObject.findMany({
    where: { status: "READY" },
    select: { storageKey: true, sha256: true },
    orderBy: { storageKey: "asc" },
  });
  // Every file row must have its bytes, and the bytes must hash to what the row says.
  const files: Fingerprint["files"] = [];
  for (const row of stored) {
    const bytes = await readFile(path.join(filesDir, row.storageKey)).catch(() => null);
    files.push({ key: row.storageKey, sha256: bytes ? sha256(bytes) : "MISSING" });
    if (!bytes || sha256(bytes) !== row.sha256) {
      throw new Error(`File ${row.storageKey} is missing or does not match its recorded hash`);
    }
  }
  const organizations = await prisma.organization.findMany({
    select: { id: true, _count: { select: { tasks: true, fileObjects: true } } },
    orderBy: { id: "asc" },
  });
  const perTenant = organizations.map((organization) => ({
    organizationId: organization.id,
    tasks: organization._count.tasks,
    files: organization._count.fileObjects,
  }));
  return { rows, migrations: Number(migrations), files, perTenant };
}

let exitCode = 0;
try {
  // 1. Original system with data.
  let database = await startLocalPostgres({
    dataDir: dirs.db,
    port: PORT,
    persistent: true,
    password: PASSWORD,
  });
  await database.ensureDatabase(DATABASE);
  const url = database.urlFor(DATABASE);
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  let prisma = client(url);
  for (const slug of ["acme", "globex", "initech"]) {
    const owner = await prisma.user.create({
      data: { name: `${slug} owner`, email: `owner@${slug}.rehearsal`, emailVerified: true },
    });
    const org = await prisma.organization.create({
      data: {
        name: slug,
        slug,
        members: { create: { userId: owner.id, role: "OWNER" } },
        subscription: { create: { planKey: "TEAM", status: "ACTIVE" } },
      },
    });
    await prisma.task.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        organizationId: org.id,
        title: `${slug} task ${i}`,
        createdById: owner.id,
      })),
    });
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        actorId: owner.id,
        action: "rehearsal.seeded",
        resourceType: "organization",
      },
    });
    for (let i = 0; i < 3; i++) {
      const bytes = new TextEncoder().encode(`${slug} file ${i} ${crypto.randomUUID()}`);
      const storageKey = `${org.id}/${crypto.randomUUID()}`;
      await mkdir(path.dirname(path.join(dirs.files, storageKey)), { recursive: true });
      await writeFile(path.join(dirs.files, storageKey), bytes);
      await prisma.fileObject.create({
        data: {
          organizationId: org.id,
          uploadedById: owner.id,
          name: `file-${i}.txt`,
          mimeType: "text/plain",
          sizeBytes: bytes.length,
          sha256: sha256(bytes),
          storageKey,
        },
      });
    }
  }
  const before = await fingerprint(prisma, dirs.files);
  if (before.perTenant.some((tenant) => tenant.tasks !== 25 || tenant.files !== 3)) {
    throw new Error("The rehearsal data set was not created as expected");
  }

  // 2-3. Backup: stop cleanly, then copy both directories.
  await prisma.$disconnect();
  await database.stop();
  await mkdir(path.dirname(dirs.backupDb), { recursive: true });
  await cp(dirs.db, dirs.backupDb, { recursive: true });
  await cp(dirs.files, dirs.backupFiles, { recursive: true });

  // 4. Disaster.
  await rm(dirs.db, { recursive: true, force: true });
  await rm(dirs.files, { recursive: true, force: true });

  // 5. Restore from the copy, timed.
  const started = Date.now();
  database = await startLocalPostgres({
    dataDir: dirs.backupDb,
    port: PORT,
    persistent: true,
    password: PASSWORD,
  });
  prisma = client(database.urlFor(DATABASE));
  const after = await fingerprint(prisma, dirs.backupFiles);
  const restoreSeconds = (Date.now() - started) / 1000;

  await prisma.$disconnect();
  await database.stop();

  const same = JSON.stringify(before) === JSON.stringify(after);
  console.log(
    JSON.stringify({
      rehearsal: same ? "PASS" : "FAIL",
      restoreSeconds,
      tables: Object.keys(after.rows).length,
      rows: Object.values(after.rows).reduce((a, b) => a + b, 0),
      migrations: after.migrations,
      files: after.files.length,
      tenants: after.perTenant.length,
    }),
  );
  if (!same) {
    console.error("Before:", JSON.stringify(before.rows));
    console.error("After: ", JSON.stringify(after.rows));
    exitCode = 1;
  }
} catch (error) {
  console.error("Rehearsal failed:", error);
  exitCode = 1;
} finally {
  await rm(work, { recursive: true, force: true });
}
process.exit(exitCode);
