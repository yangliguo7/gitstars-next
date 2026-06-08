import { requireCsrf, readJson } from '../../_shared/http'
import { deleteGroup, updateGroup } from '../../_shared/d1'
import { fail, ok } from '../../_shared/response'
import { requireUser } from '../../_shared/current-user'

export const onRequestPatch: PagesFunction<{ id: string }> = async ({ request, params, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const body = await readJson<{ name?: string; description?: string; color?: string; icon?: string; sort_order?: number }>(request)
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const updated = await updateGroup(env as { DB?: D1Database }, user.id, String(params.id), body ?? {})
  if (!updated) return fail('NOT_FOUND', 'group not found', 404)
  return ok({ group: updated })
}

export const onRequestDelete: PagesFunction<{ id: string }> = async ({ request, params, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const deleted = await deleteGroup(env as { DB?: D1Database }, user.id, String(params.id))
  if (!deleted) return fail('NOT_FOUND', 'group not found', 404)
  return ok({ deleted: true })
}
