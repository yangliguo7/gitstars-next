import { requireCsrf } from '../../../../_shared/http'
import { fail, ok } from '../../../../_shared/response'
import { githubRequest, normalizeGitHubRepo, type GitHubRepoPayload } from '../../../../_shared/github'
import { readGitHubToken } from '../../../../_shared/token'
import { setStarState, upsertGitHubRepository } from '../../../../_shared/d1'
import { requireUser } from '../../../../_shared/current-user'

export const onRequestPost: PagesFunction<{ owner: string; repo: string }> = async ({ request, params, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const fullName = `${params.owner}/${params.repo}`
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const token = await readGitHubToken(env as Env, user.id)
  if (!token) return fail('UNAUTHORIZED', 'GitHub token missing; reconnect GitHub', 401)
  await githubRequest(token, `/user/starred/${params.owner}/${params.repo}`, { method: 'PUT' })
  const repo = await githubRequest<GitHubRepoPayload>(token, `/repos/${params.owner}/${params.repo}`)
  await upsertGitHubRepository(env as { DB?: D1Database }, user.id, normalizeGitHubRepo(repo), new Date().toISOString())
  return ok({ full_name: fullName, is_starred: true, github_called: Boolean(token) })
}

export const onRequestDelete: PagesFunction<{ owner: string; repo: string }> = async ({ request, params, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const fullName = `${params.owner}/${params.repo}`
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const token = await readGitHubToken(env as Env, user.id)
  if (!token) return fail('UNAUTHORIZED', 'GitHub token missing; reconnect GitHub', 401)
  await githubRequest(token, `/user/starred/${params.owner}/${params.repo}`, { method: 'DELETE' })
  await setStarState(env as { DB?: D1Database }, user.id, fullName, false)
  return ok({ full_name: fullName, is_starred: false, github_called: Boolean(token) })
}
