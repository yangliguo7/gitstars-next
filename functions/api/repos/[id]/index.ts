import { requireUser } from '../../_shared/current-user'
import { readRepoDetail } from '../../_shared/d1'
import { fail, ok } from '../../_shared/response'

export const onRequestGet: PagesFunction<{ id: string }> = async ({ request, params, env }) => {
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const repo = await readRepoDetail(env as { DB?: D1Database }, user.id, String(params.id))
  if (!repo) return fail('NOT_FOUND', 'repository not found', 404)
  return ok({ repo })
}
