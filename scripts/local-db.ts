/**
 * Runs a local PostgreSQL for development without Docker:
 *   pnpm db:local
 * Data persists in .data/postgres. Matches DATABASE_URL in .env.example.
 */
import { startLocalPostgres } from "./local-postgres";

const DATABASE = "fts_workspace";
const PORT = 5432;

const server = await startLocalPostgres({
  dataDir: ".data/postgres",
  port: PORT,
  persistent: true,
});
await server.ensureDatabase(DATABASE);
console.log(`PostgreSQL ready at ${server.urlFor(DATABASE).replace(/:[^:@/]+@/, ":****@")}`);
console.log("Press Ctrl+C to stop.");

async function shutdown() {
  await server.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
