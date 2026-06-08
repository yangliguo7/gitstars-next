import { createSessionForUser } from '../../_shared/auth'
import { encryptString } from '../../_shared/crypto'
import { csrfCookie, sessionCookie } from '../../_shared/session'
import { fail, ok } from '../../_shared/response'

interface GitHubUserResponse {
  id: number
  login: string
  name?: string | null
  avatar_url?: string
  html_url?: string
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const appEnv = env as Env
  const url = new URL(request.url)
  if (!isLocalHost(url.hostname)) return fail('FORBIDDEN', 'dev login is only available on localhost', 403)
  if (!appEnv.DB || !appEnv.ENCRYPTION_SECRET || !appEnv.DEV_GITHUB_TOKEN) {
    return fail('VALIDATION_ERROR', 'DEV_GITHUB_TOKEN, ENCRYPTION_SECRET and D1 DB are required', 500)
  }

  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${appEnv.DEV_GITHUB_TOKEN}`,
      'user-agent': 'GitStars-Local-Dev',
    },
  })
  if (!userResponse.ok) return fail('GITHUB_ERROR', `GitHub user request failed: ${userResponse.status}`, 502)

  const githubUser = await userResponse.json<GitHubUserResponse>()
  const userId = `gh_${githubUser.id}`
  const encrypted = await encryptString(appEnv.DEV_GITHUB_TOKEN, appEnv.ENCRYPTION_SECRET)
  const now = new Date().toISOString()
  await appEnv.DB.batch([
    appEnv.DB.prepare(
      `INSERT INTO users (id, github_user_id, login, name, avatar_url, html_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(github_user_id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url, html_url = excluded.html_url, updated_at = excluded.updated_at`,
    ).bind(userId, githubUser.id, githubUser.login, githubUser.name ?? null, githubUser.avatar_url ?? null, githubUser.html_url ?? null, now, now),
    appEnv.DB.prepare(
      `INSERT INTO github_tokens (user_id, access_token_encrypted, iv, key_version, scopes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET access_token_encrypted = excluded.access_token_encrypted, iv = excluded.iv, key_version = excluded.key_version, scopes = excluded.scopes, updated_at = excluded.updated_at`,
    ).bind(userId, encrypted.encrypted, encrypted.iv, encrypted.key_version, 'dev-token', now, now),
  ])

  const { sessionId, csrfToken } = await createSessionForUser(appEnv, userId)
  const secureCookie = url.protocol === 'https:'
  const headers: [string, string][] = [['set-cookie', sessionCookie(sessionId, secureCookie)], ['set-cookie', csrfCookie(csrfToken, secureCookie)]]
  const accept = request.headers.get('accept') ?? ''
  if (accept.includes('text/html')) {
    return new Response(null, { status: 302, headers: [['location', '/'], ...headers] })
  }
  return ok({ user: { id: userId, login: githubUser.login }, csrf_token: csrfToken }, { headers })
}

function isLocalHost(hostname: string) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}
