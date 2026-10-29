/**
 * Shared E2E configuration. CI reuses the PostgreSQL service container
 * (TEST_DATABASE_URL); locally an embedded PostgreSQL is started on a fixed port.
 */
export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
export const E2E_PASSWORD = "e2e-only-password-123";

const LOCAL_URL = "postgresql://fts:fts_e2e_password@127.0.0.1:54330/fts_workspace_e2e";

export const E2E_DATABASE_URL = process.env.TEST_DATABASE_URL ?? LOCAL_URL;
export const USES_LOCAL_DATABASE = !process.env.TEST_DATABASE_URL;
