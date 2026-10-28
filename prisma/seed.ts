/**
 * Development seed: two isolated demo tenants for manual tenant-isolation checks.
 * Run with `pnpm db:seed`. Refuses to run in production.
 *
 * Demo accounts (development only; password from SEED_PASSWORD or the default below):
 *   owner@acme.test   → OWNER of "acme"
 *   owner@globex.test → OWNER of "globex"
 *   viewer@acme.test  → VIEWER of "acme"
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient, type MemberRole } from "../src/generated/prisma/client";

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed a production database");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});
const password = process.env.SEED_PASSWORD ?? "dev-only-password-123";

async function upsertUser(email: string, name: string) {
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { id: crypto.randomUUID(), email, name, emailVerified: true },
  });
  const hasCredential = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
  });
  if (!hasCredential) {
    await prisma.account.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: await hashPassword(password),
      },
    });
  }
  return user;
}

async function upsertOrganization(slug: string, name: string, members: [string, MemberRole][]) {
  const organization = await prisma.organization.upsert({
    where: { slug },
    update: {},
    create: { slug, name },
  });
  for (const [userId, role] of members) {
    await prisma.member.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId } },
      update: { role, status: "ACTIVE" },
      create: { organizationId: organization.id, userId, role },
    });
  }
}

async function main() {
  const acmeOwner = await upsertUser("owner@acme.test", "Acme Owner");
  const acmeViewer = await upsertUser("viewer@acme.test", "Acme Viewer");
  const globexOwner = await upsertUser("owner@globex.test", "Globex Owner");

  await upsertOrganization("acme", "Acme Demo", [
    [acmeOwner.id, "OWNER"],
    [acmeViewer.id, "VIEWER"],
  ]);
  await upsertOrganization("globex", "Globex Demo", [[globexOwner.id, "OWNER"]]);
  console.log("Seeded demo tenants: acme, globex");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
