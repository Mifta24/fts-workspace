/** Stable, client-safe error codes (see docs/06-API.md). */
export type AppErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "RATE_LIMITED"
  | "PLAN_LIMIT";

const HTTP_STATUS: Record<AppErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  PLAN_LIMIT: 402,
};

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }

  toJSON() {
    return { error: { code: this.code, message: this.message } };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
