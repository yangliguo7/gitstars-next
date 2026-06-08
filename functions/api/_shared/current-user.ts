import { readSessionCookie } from './session'

export interface CurrentUser {
  id: string
  login: string
  avatar_url: string | null
}

export async function currentUser(env: { DB?: D1Database }, request: Request): Promise<CurrentUser | null> {
  const sessionId = readSessionCookie(request)
  if (!env.DB || !sessionId) return null
  return env.DB.prepare(
    `SELECT u.id, u.login, u.avatar_url
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now')
     LIMIT 1`,
  ).bind(sessionId).first<CurrentUser>()
}


export async function requireUser(env: { DB?: D1Database }, request: Request) {
  const user = await currentUser(env, request)
  if (!user) return { user: null, response: new Response(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Login required' } }), { status: 401, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }) }
  return { user, response: null }
}
