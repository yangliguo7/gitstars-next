import { decryptString } from './crypto'

export async function readGitHubToken(env: Env, userId: string) {
  if (!env.DB || !env.ENCRYPTION_SECRET) return null
  const row = await env.DB.prepare(
    'SELECT access_token_encrypted, iv FROM github_tokens WHERE user_id = ?',
  ).bind(userId).first<{ access_token_encrypted: string; iv: string }>()
  if (!row) return null
  return decryptString(row.access_token_encrypted, row.iv, env.ENCRYPTION_SECRET)
}
