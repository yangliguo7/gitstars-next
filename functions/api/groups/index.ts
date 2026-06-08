import { requireCsrf, readJson } from '../_shared/http'
import { createGroup, readGroups } from '../_shared/d1'
import { fail, ok } from '../_shared/response'
import { requireUser } from '../_shared/current-user'

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  return ok({ items: await readGroups(env as { DB?: D1Database }, user.id) })
}

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const body = await readJson<{ name?: string; description?: string; color?: string; icon?: string }>(request)
  if (!body?.name?.trim()) return fail('VALIDATION_ERROR', 'group name is required', 422)
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const existing = await readGroups(env as { DB?: D1Database }, user.id)
  if (existing.some((group) => String(group.name).toLowerCase() === body.name!.trim().toLowerCase())) {
    return fail('CONFLICT', 'group name already exists', 409)
  }
  const group = await createGroup(env as { DB?: D1Database }, user.id, { name: body.name.trim(), description: body.description?.trim() || undefined, color: body.color, icon: body.icon })
  return ok({ group }, { status: 201 })
}
