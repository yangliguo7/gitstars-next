import { requireUser } from '../../../../_shared/current-user'
import { githubRequest } from '../../../../_shared/github'
import { fail, ok } from '../../../../_shared/response'
import { readGitHubToken } from '../../../../_shared/token'

interface GitHubReadmePayload {
  content?: string
  encoding?: string
  path?: string
  html_url?: string
}

export const onRequestGet: PagesFunction<{ owner: string; repo: string }> = async ({ request, params, env }) => {
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const token = await readGitHubToken(env as Env, user.id)
  if (!token) return fail('UNAUTHORIZED', 'GitHub token missing; reconnect GitHub', 401)

  try {
    const readme = await githubRequest<GitHubReadmePayload>(token, `/repos/${params.owner}/${params.repo}/readme`)
    const raw = readme.content ?? ''
    const content = readme.encoding === 'base64' ? decodeBase64(raw) : raw
    return ok({ content, path: readme.path ?? null, html_url: readme.html_url ?? null })
  } catch (error) {
    if (error instanceof Error && error.message.includes('GitHub 404')) return fail('NOT_FOUND', 'README not found', 404)
    throw error
  }
}

function decodeBase64(value: string) {
  const binary = atob(value.replace(/\s/g, ''))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
