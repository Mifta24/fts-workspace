import "server-only";
import { isAppError, type AppErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

export type ActionError =
  "invalid" | "forbidden" | "notFound" | "conflict" | "unprocessable" | "rateLimited" | "generic";
export type ActionState = {
  error?: ActionError;
  ok?: boolean;
  /** A secret link that is shown once, right after it was created. */
  link?: string;
};

const BY_CODE: Partial<Record<AppErrorCode, ActionError>> = {
  INVALID_INPUT: "invalid",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "notFound",
  CONFLICT: "conflict",
  UNPROCESSABLE: "unprocessable",
  RATE_LIMITED: "rateLimited",
};

/** Maps a thrown error to a client-safe state; unexpected errors are logged, not leaked. */
export function toActionError(
  error: unknown,
  correlationId: string,
  operation: string,
): ActionState {
  if (isAppError(error)) return { error: BY_CODE[error.code] ?? "generic" };
  logger.error({ err: error, correlationId }, `${operation} failed`);
  return { error: "generic" };
}
