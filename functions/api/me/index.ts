import { currentUser } from '../_shared/current-user'
import { readModelSettings } from '../_shared/d1'
import { readCsrfCookie } from '../_shared/session'
import { ok } from '../_shared/response'

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const user = await currentUser(env as { DB?: D1Database }, request)
  const model = user ? await readModelSettings(env as { DB?: D1Database }, user.id) : null
  return ok({
    user,
    settings: { model_enabled: Boolean(model?.enabled && model?.api_key_encrypted), default_view: 'all' },
    csrf_token: readCsrfCookie(request) || null,
  })
}
