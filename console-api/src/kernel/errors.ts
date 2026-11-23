// Stable, machine-readable error codes (LLD §12.2)
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'OTP_TOKEN_INVALID'
  | 'OTP_INVALID'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'TENANT_FORBIDDEN'
  | 'IP_NOT_ALLOWED'
  | 'MFA_SETUP_REQUIRED'
  | 'MODULE_NOT_ENTITLED'
  | 'MODULE_READ_ONLY'
  | 'LIMIT_REACHED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'DUPLICATE_TRIAL'
  | 'EMAIL_TAKEN'
  | 'MOBILE_TAKEN'
  | 'INVALID_TRANSITION'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'CONFLICT'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'PROVIDER_UNAVAILABLE';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  OTP_TOKEN_INVALID: 400,
  OTP_INVALID: 400,
  WEBHOOK_SIGNATURE_INVALID: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 423,
  TENANT_FORBIDDEN: 403,
  IP_NOT_ALLOWED: 403,
  MFA_SETUP_REQUIRED: 403,
  MODULE_NOT_ENTITLED: 403,
  MODULE_READ_ONLY: 403,
  LIMIT_REACHED: 403,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  DUPLICATE_TRIAL: 409,
  EMAIL_TAKEN: 409,
  MOBILE_TAKEN: 409,
  INVALID_TRANSITION: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  CONFLICT: 409,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  PROVIDER_UNAVAILABLE: 503,
};

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const appError = (code: ErrorCode, message: string, details?: Record<string, unknown>) =>
  new AppError(code, message, details);

export const notFound = (what = 'Record') => new AppError('NOT_FOUND', `${what} not found.`);
