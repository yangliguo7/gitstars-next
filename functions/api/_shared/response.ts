export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CSRF_INVALID'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'GITHUB_ERROR'
  | 'MODEL_CONFIG_MISSING'
  | 'MODEL_REQUEST_BLOCKED'
  | 'MODEL_REQUEST_FAILED'
  | 'JOB_LOCKED'
  | 'JOB_NOT_READY'
  | 'INTERNAL_ERROR'

export interface ApiError {
  code: ApiErrorCode
  message: string
  details?: Record<string, unknown>
}

export function ok(data: unknown, init?: ResponseInit) {
  return json({ ok: true, data }, init)
}

export function fail(code: ApiErrorCode, message: string, status = 400, details?: Record<string, unknown>) {
  return json({ ok: false, error: { code, message, details } }, { status })
}

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(body), { ...init, headers })
}
