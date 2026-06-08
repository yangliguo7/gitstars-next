const cookieName = 'gitstars_session'

export async function revokeSession(env: { DB?: D1Database }, request: Request) {
  const sessionId = readSessionCookie(request)
  if (env.DB && sessionId) {
    await env.DB.prepare('UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE id = ?').bind(new Date().toISOString(), new Date().toISOString(), sessionId).run()
  }
}

export function sessionCookie(sessionId: string, secure = true) {
  return `${cookieName}=${sessionId}; Path=/; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Max-Age=2678400`
}

export function clearSessionCookie() {
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export function readSessionCookie(request: Request) {
  const cookie = request.headers.get('cookie') ?? ''
  return cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.split('=')[1] ?? ''
}

export function csrfCookie(csrfToken: string, secure = true) {
  return `gitstars_csrf=${csrfToken}; Path=/; ${secure ? 'Secure; ' : ''}SameSite=Lax; Max-Age=2678400`
}

export function readCsrfCookie(request: Request) {
  const cookie = request.headers.get('cookie') ?? ''
  return cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('gitstars_csrf='))?.split('=')[1] ?? ''
}

export function clearCsrfCookie() {
  return 'gitstars_csrf=; Path=/; SameSite=Lax; Max-Age=0'
}
