import { readRepos } from '../_shared/d1'
import { ok } from '../_shared/response'
import { requireUser } from '../_shared/current-user'

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const url = new URL(request.url)
  const view = url.searchParams.get('view') ?? 'all'
  const groupId = url.searchParams.get('group_id')
  const page = Number(url.searchParams.get('page') ?? '1')
  const pageSize = Math.min(Number(url.searchParams.get('page_size') ?? '50'), 100)
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  return ok(await readRepos(env as { DB?: D1Database }, user.id, view, groupId, page, pageSize))
}
