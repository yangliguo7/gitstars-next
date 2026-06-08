import { requireCsrf, readJson } from '../../../../_shared/http'
import { deleteUserSummary, readRepoDetail, saveUserSummary } from '../../../../_shared/d1'
import { requireUser } from '../../../../_shared/current-user'
import { fail, ok } from '../../../../_shared/response'

export const onRequestPut: PagesFunction<{ id: string }> = async ({ request, params, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const repo = await readRepoDetail(env as { DB?: D1Database }, user.id, String(params.id))
  if (!repo) return fail('NOT_FOUND', 'repository not found', 404)
  const body = await readJson<{ content?: string; short_content?: string; detail_content?: string }>(request)
  const detail = body?.detail_content?.trim() || body?.content?.trim() || ''
  const short = body?.short_content?.trim() || detail.slice(0, 120)
  if (!detail) return fail('VALIDATION_ERROR', 'detail_content is required', 422)
  const summary = await saveUserSummary(env as { DB?: D1Database }, user.id, String(repo.id), detail, short)
  return ok({ summary })
}

export const onRequestDelete: PagesFunction<{ id: string }> = async ({ request, params, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const repo = await readRepoDetail(env as { DB?: D1Database }, user.id, String(params.id))
  if (!repo) return fail('NOT_FOUND', 'repository not found', 404)
  await deleteUserSummary(env as { DB?: D1Database }, user.id, String(repo.id))
  return ok({ deleted: true })
}
