/**
 * Removes a workspace's data once its owner's deletion request has passed the waiting period:
 *   pnpm purge:workspace <slug> --confirm <slug>
 * Environment: DATABASE_URL and STORAGE_DIR (the same directory the app uses). Take a fresh backup
 * first (docs/12-OPERATIONS.md). Exit code 0 when the workspace was purged (or already had been), 1 otherwise.
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { isAppError } from "../src/lib/errors";
import { purgeWorkspace } from "../src/features/organizations/server/purge-service";
import { createLocalStorage, type StoragePort } from "../src/server/storage/storage";

type Deps = { prisma: PrismaClient; storage: StoragePort; log: (line: string) => void };

export async function runPurgeCli(
  argv: string[],
  { prisma, storage, log }: Deps,
  now: Date = new Date(),
): Promise<number> {
  const slug = argv[0]?.toLowerCase();
  const confirmAt = argv.indexOf("--confirm");
  const confirm = confirmAt === -1 ? undefined : argv[confirmAt + 1]?.toLowerCase();
  if (!slug || slug.startsWith("--") || confirm !== slug) {
    log("Usage: pnpm purge:workspace <slug> --confirm <slug>");
    return 1;
  }
  const organization = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!organization) {
    log(`No workspace with the address "${slug}".`);
    return 1;
  }
  try {
    const result = await purgeWorkspace(
      { prisma, storage },
      { organizationId: organization.id, actor: { trigger: "cli", userId: null } },
      now,
    );
    log(
      result.alreadyPurged ? "Already purged." : `Purged. Files removed: ${result.filesRemoved}.`,
    );
    for (const [table, count] of Object.entries(result.rowCounts)) {
      if (count > 0) log(`  ${table}: ${count}`);
    }
    return 0;
  } catch (error) {
    if (isAppError(error)) {
      log(error.message);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const storage = createLocalStorage(process.env.STORAGE_DIR ?? ".data/files");
  const code = await runPurgeCli(process.argv.slice(2), { prisma, storage, log: console.log });
  await prisma.$disconnect();
  process.exit(code);
}
