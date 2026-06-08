import { requireCsrf, readJson } from '../../_shared/http'
import { ok } from '../../_shared/response'
import { startSyncJob, type SyncMode } from '../../_shared/d1'
import { requireUser } from '../../_shared/current-user'

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const body = await readJson<{ mode?: SyncMode }>(request).catch(() => null)
  const mode = body?.mode === 'repair' ? 'repair' : 'sync'
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  return ok({ job: await startSyncJob(env as { DB?: D1Database }, user.id, mode) })
}
