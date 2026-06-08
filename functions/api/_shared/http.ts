import { sha256Hex } from './crypto'
import { fail } from './response'
import { readSessionCookie } from './session'

export async function requireCsrf(request: Request, env?: { DB?: D1Database }): Promise<Response | undefined> {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return undefined
  if (!sameOriginWrite(request)) return fail('CSRF_INVALID', 'Origin or Referer is not allowed', 403)

  const token = request.headers.get('x-csrf-token') ?? ''
  if (env?.DB && token) {
    const sessionId = readSessionCookie(request)
    if (sessionId) {
      const row = await env.DB.prepare(
        'SELECT csrf_token_hash FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > datetime(\'now\')',
      ).bind(sessionId).first<{ csrf_token_hash: string }>()
      if (row?.csrf_token_hash === await sha256Hex(token)) return undefined
    }
  }
  return fail('CSRF_INVALID', 'Missing or invalid CSRF token', 403)
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return await request.json<T>()
  } catch {
    return null
  }
}

export function appOrigin(request: Request) {
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}

function sameOriginWrite(request: Request) {
  const allowed = appOrigin(request)
  const origin = request.headers.get('origin')
  if (origin) return origin === allowed
  const referer = request.headers.get('referer')
  if (!referer) return true
  try {
    return new URL(referer).origin === allowed
  } catch {
    return false
  }
}
