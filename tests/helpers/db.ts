import { db } from "@/lib/db";

/** Removes all rows between tests. Test databases only. */
export async function resetDatabase(): Promise<void> {
  if (process.env.NODE_ENV !== "test" || !process.env.DATABASE_URL?.includes("_test")) {
    throw new Error("Refusing to reset a database whose name does not contain '_test'.");
  }
  await db().$executeRawUnsafe(
    'TRUNCATE TABLE "goals", "projects", "audit_logs", "members", "organizations", "verifications", "accounts", "sessions", "users" RESTART IDENTITY CASCADE',
  );
}

let counter = 0;

export async function createTestUser(label: string) {
  counter += 1;
  return db().user.create({
    data: {
      id: crypto.randomUUID(),
      name: `Test ${label}`,
      email: `${label.toLowerCase()}-${counter}@example.test`,
      emailVerified: true,
    },
  });
}

/** Creates an organization with an OWNER plus one member per requested extra role. */
export async function createTestOrganization(
  slug: string,
  extraRoles: Record<string, "ADMIN" | "MANAGER" | "MEMBER" | "VIEWER"> = {},
) {
  const owner = await createTestUser(`${slug}-owner`);
  const organization = await db().organization.create({
    data: { name: slug, slug, members: { create: { userId: owner.id, role: "OWNER" } } },
  });
  const users: Record<string, { id: string }> = { owner };
  for (const [label, role] of Object.entries(extraRoles)) {
    const user = await createTestUser(`${slug}-${label}`);
    await db().member.create({ data: { organizationId: organization.id, userId: user.id, role } });
    users[label] = user;
  }
  return { organization, users };
}
