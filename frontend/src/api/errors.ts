/**
 * Typed API errors. Every failure reaches the UI with a code, so screens can show a typed error
 * with a retry, never an empty result such as "0 paths" (solution.md §13.6).
 */

/** Codes from the tool contract (§10.4), HTTP-level codes, and client-side transport codes. */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'SCOPE_INCOMPLETE'
  | 'QUERY_FAILED'
  | 'TIMEOUT'
  | 'PRECONDITION_FAILED'
  | 'BUDGET_EXHAUSTED'
  | 'CONCURRENT_MODIFICATION'
  | 'RATE_LIMITED'
  | 'BUSY'
  | 'CSRF'
  | 'NO_SESSION'
  | 'UNAUTHORIZED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'STREAM_CLOSED'
  | 'BAD_RESPONSE'
  | (string & {});

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** Transport and server failures are worth retrying; validation and 404s are not. */
  get retryable(): boolean {
    return (
      this.code === 'NETWORK_ERROR' ||
      this.code === 'TIMEOUT' ||
      this.code === 'SERVER_ERROR' ||
      this.code === 'STREAM_CLOSED' ||
      this.code === 'QUERY_FAILED' ||
      this.code === 'RATE_LIMITED' ||
      this.code === 'BUSY' ||
      this.code === 'CONCURRENT_MODIFICATION'
    );
  }
}

const STATUS_CODES: Record<number, ApiErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  409: 'CONCURRENT_MODIFICATION',
  412: 'PRECONDITION_FAILED',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
  504: 'TIMEOUT',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Build an ApiError from an HTTP status and a parsed body. The API returns
 * `{detail: {code, message}}`; `{code, message}`, `{error: {...}}` and FastAPI's plain
 * `{detail: "..."}` or validation list are accepted too.
 */
export function errorFromResponse(status: number, body: unknown): ApiError {
  let code: string | undefined;
  let message: string | undefined;

  if (isRecord(body)) {
    const nested = isRecord(body.error) ? body.error : undefined;
    const detail = isRecord(body.detail) ? body.detail : undefined;
    code = str(nested?.code) ?? str(body.code) ?? str(detail?.code);
    message =
      str(nested?.message) ??
      str(body.message) ??
      str(detail?.message) ??
      str(body.detail) ??
      (Array.isArray(body.detail) ? 'The request did not pass validation.' : undefined);
  }

  const fallback = STATUS_CODES[status] ?? (status >= 500 ? 'SERVER_ERROR' : 'BAD_RESPONSE');
  return new ApiError(code ?? fallback, message ?? `Request failed with HTTP ${status}.`, status, body);
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new ApiError('TIMEOUT', 'The request was cancelled or timed out.');
  }
  if (error instanceof TypeError) {
    return new ApiError('NETWORK_ERROR', 'The API could not be reached. Check your connection.');
  }
  return new ApiError('BAD_RESPONSE', error instanceof Error ? error.message : String(error));
}
