import { requireCsrf } from '../../_shared/http'
import { ok } from '../../_shared/response'
import { clearCsrfCookie, clearSessionCookie, revokeSession } from '../../_shared/session'

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  await revokeSession(env as { DB?: D1Database }, request)
  return ok({ logged_out: true }, { headers: [['set-cookie', clearSessionCookie()], ['set-cookie', clearCsrfCookie()]] })
}
