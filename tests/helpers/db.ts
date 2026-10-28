import { db } from "@/lib/db";

/** Removes all rows between tests. Test databases only. */
export async function resetDatabase(): Promise<void> {
  if (process.env.NODE_ENV !== "test" || !process.env.DATABASE_URL?.includes("_test")) {
    throw new Error("Refusing to reset a database whose name does not contain '_test'.");
  }
  await db().$executeRawUnsafe(
    'TRUNCATE TABLE "audit_logs", "members", "organizations", "verifications", "accounts", "sessions", "users" RESTART IDENTITY CASCADE',
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
