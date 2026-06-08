import { encryptString, randomToken, sha256Hex } from './crypto'
import { csrfCookie, sessionCookie } from './session'

interface GitHubTokenResponse {
  access_token?: string
  scope?: string
  error?: string
  error_description?: string
}

interface GitHubUserResponse {
  id: number
  login: string
  name?: string | null
  avatar_url?: string
  html_url?: string
}

export async function exchangeGitHubOAuth(env: Env, code: string, redirectUri: string) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.DB || !env.ENCRYPTION_SECRET) {
    throw new Error('GitHub OAuth env is not configured')
  }

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  })
  const tokenJson = await tokenResponse.json<GitHubTokenResponse>()
  if (!tokenJson.access_token) throw new Error(tokenJson.error_description || tokenJson.error || 'GitHub OAuth failed')

  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${tokenJson.access_token}`,
      'user-agent': 'GitStars-MVP',
    },
  })
  if (!userResponse.ok) throw new Error(`GitHub user request failed: ${userResponse.status}`)
  const githubUser = await userResponse.json<GitHubUserResponse>()
  const userId = `gh_${githubUser.id}`
  const encrypted = await encryptString(tokenJson.access_token, env.ENCRYPTION_SECRET)
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, github_user_id, login, name, avatar_url, html_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(github_user_id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url, html_url = excluded.html_url, updated_at = excluded.updated_at`,
    ).bind(userId, githubUser.id, githubUser.login, githubUser.name ?? null, githubUser.avatar_url ?? null, githubUser.html_url ?? null, now, now),
    env.DB.prepare(
      `INSERT INTO github_tokens (user_id, access_token_encrypted, iv, key_version, scopes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET access_token_encrypted = excluded.access_token_encrypted, iv = excluded.iv, key_version = excluded.key_version, scopes = excluded.scopes, updated_at = excluded.updated_at`,
    ).bind(userId, encrypted.encrypted, encrypted.iv, encrypted.key_version, tokenJson.scope ?? '', now, now),
  ])

  const { sessionId, csrfToken } = await createSessionForUser(env, userId)
  return { sessionId, csrfToken }
}

export async function createSessionForUser(env: Env, userId: string) {
  if (!env.DB) throw new Error('D1 DB is required')
  const sessionId = randomToken('sess_')
  const csrfToken = randomToken('csrf_')
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT OR REPLACE INTO sessions (id, user_id, csrf_token_hash, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(sessionId, userId, await sha256Hex(csrfToken), new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString(), now, now).run()
  return { sessionId, csrfToken }
}

export function loginRedirect(returnTo: string, sessionId: string, csrfToken: string, secureCookie: boolean) {
  return new Response(null, { status: 302, headers: [['location', returnTo], ['set-cookie', sessionCookie(sessionId, secureCookie)], ['set-cookie', csrfCookie(csrfToken, secureCookie)]] })
}
