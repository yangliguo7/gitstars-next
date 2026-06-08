import { requireCsrf, readJson } from '../../../_shared/http'
import { groupIdsExist, readRepoDetail, replaceRepoGroups } from '../../../_shared/d1'
import { requireUser } from '../../../_shared/current-user'
import { fail, ok } from '../../../_shared/response'

export const onRequestPut: PagesFunction<{ id: string }> = async ({ request, params, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const repo = await readRepoDetail(env as { DB?: D1Database }, user.id, String(params.id))
  if (!repo) return fail('NOT_FOUND', 'repository not found', 404)
  const body = await readJson<{ group_ids?: string[] }>(request)
  const groupIds = body?.group_ids ?? []
  if (!await groupIdsExist(env as { DB?: D1Database }, user.id, groupIds)) return fail('VALIDATION_ERROR', 'unknown group id', 422)
  const repositoryId = String(repo.id)
  const saved = await replaceRepoGroups(env as { DB?: D1Database }, user.id, repositoryId, groupIds)
  return ok({ repository_id: repositoryId, group_ids: saved })
}
