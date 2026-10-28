import { existsSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

export type LocalPostgres = {
  ensureDatabase(name: string): Promise<void>;
  urlFor(database: string): string;
  stop(): Promise<void>;
};

type Options = {
  dataDir: string;
  port: number;
  persistent: boolean;
  user?: string;
  password?: string;
};

/**
 * Starts a PostgreSQL server from npm-provided binaries (no Docker needed).
 * Development and test use only; binds to localhost.
 */
export async function startLocalPostgres(options: Options): Promise<LocalPostgres> {
  const user = options.user ?? "fts";
  const password = options.password ?? "fts_dev_password";
  const databaseDir = path.resolve(options.dataDir);

  const server = new EmbeddedPostgres({
    databaseDir,
    user,
    password,
    port: options.port,
    persistent: options.persistent,
    onLog: () => {},
  });

  if (!existsSync(path.join(databaseDir, "PG_VERSION"))) {
    await server.initialise();
  }
  await server.start();

  return {
    async ensureDatabase(name) {
      const client = server.getPgClient();
      await client.connect();
      try {
        const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
        if (existing.rowCount === 0) await server.createDatabase(name);
      } finally {
        await client.end();
      }
    },
    urlFor(database) {
      return `postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:${options.port}/${database}`;
    },
    async stop() {
      await server.stop();
    },
  };
}
