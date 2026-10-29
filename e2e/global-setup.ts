import { execFileSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { startLocalPostgres } from "../scripts/local-postgres";
import { PrismaClient, type MemberRole } from "../src/generated/prisma/client";
import { E2E_DATABASE_URL, E2E_PASSWORD, USES_LOCAL_DATABASE } from "./e2e-env";

/** Starts the database (locally), applies migrations and seeds two isolated tenants. */
export default async function globalSetup() {
  let stop: (() => Promise<void>) | undefined;
  if (USES_LOCAL_DATABASE) {
    const local = await startLocalPostgres({
      dataDir: ".data/postgres-e2e",
      port: 54330,
      persistent: false,
      password: "fts_e2e_password",
    });
    await local.ensureDatabase("fts_workspace_e2e");
    stop = () => local.stop();
  }

  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: "pipe",
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: E2E_DATABASE_URL }),
  });
  try {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "task_comments", "tasks", "goals", "projects", "audit_logs", "members", "organizations", "verifications", "accounts", "sessions", "users" RESTART IDENTITY CASCADE',
    );
    const passwordHash = await hashPassword(E2E_PASSWORD);
    const user = async (email: string, name: string) => {
      const created = await prisma.user.create({
        data: { id: crypto.randomUUID(), email, name, emailVerified: true },
      });
      await prisma.account.create({
        data: {
          id: crypto.randomUUID(),
          userId: created.id,
          accountId: created.id,
          providerId: "credential",
          password: passwordHash,
        },
      });
      return created;
    };
    const organization = async (slug: string, members: [string, MemberRole][]) => {
      await prisma.organization.create({
        data: {
          slug,
          name: `${slug} workspace`,
          members: { create: members.map(([userId, role]) => ({ userId, role })) },
        },
      });
    };

    const acmeOwner = await user("owner@acme.test", "Acme Owner");
    const acmeViewer = await user("viewer@acme.test", "Acme Viewer");
    const globexOwner = await user("owner@globex.test", "Globex Owner");
    await organization("acme", [
      [acmeOwner.id, "OWNER"],
      [acmeViewer.id, "VIEWER"],
    ]);
    await organization("globex", [[globexOwner.id, "OWNER"]]);

    // A task that belongs to the other tenant, used for direct-object-reference checks.
    const globex = await prisma.organization.findUniqueOrThrow({ where: { slug: "globex" } });
    const secret = await prisma.task.create({
      data: { organizationId: globex.id, title: "Globex secret task", createdById: globexOwner.id },
    });
    process.env.E2E_FOREIGN_TASK_ID = secret.id;
  } finally {
    await prisma.$disconnect();
  }

  return async () => {
    await stop?.();
  };
}
