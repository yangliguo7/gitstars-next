import { requireUser } from '../../_shared/current-user'
import { getSyncJob } from '../../_shared/d1'
import { fail, ok } from '../../_shared/response'

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const jobId = new URL(request.url).searchParams.get('job_id')
  if (!jobId) return fail('VALIDATION_ERROR', 'job_id is required', 422)
  const job = await getSyncJob(env as { DB?: D1Database }, user.id, jobId)
  if (!job) return fail('NOT_FOUND', 'sync job not found', 404)
  return ok({ job })
}
