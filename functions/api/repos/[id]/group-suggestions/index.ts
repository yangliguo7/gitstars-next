import { readRepos } from '../../../_shared/d1'
import { repoGroupSuggestions } from '../../../_shared/grouping'
import { requireUser } from '../../../_shared/current-user'
import { fail, ok } from '../../../_shared/response'

export const onRequestGet: PagesFunction<{ id: string }> = async ({ request, params, env }) => {
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const repos = await readRepos(env as { DB?: D1Database }, user.id, 'all', null, 1, 100)
  const repo = repos.items.find((item) => String(item.id) === String(params.id) || String(item.github_id) === String(params.id))
  if (!repo) return fail('NOT_FOUND', 'repository not found', 404)
  return ok({ suggestions: repoGroupSuggestions(repo) })
}
