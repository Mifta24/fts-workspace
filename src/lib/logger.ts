import "server-only";
import pino from "pino";

/**
 * Structured JSON logger. Sensitive fields are redacted; never log raw
 * passwords, tokens, cookies, or document/message content.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "fts-web" },
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "secret",
      "*.secret",
      "headers.cookie",
      "headers.authorization",
      "*.headers.cookie",
      "*.headers.authorization",
    ],
    censor: "[REDACTED]",
  },
});
