import { requireCsrf, readJson } from '../../_shared/http'
import { readRepoDetail, startSummaryJob } from '../../_shared/d1'
import { requireUser } from '../../_shared/current-user'
import { fail, ok } from '../../_shared/response'

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const body = await readJson<{ target_type?: string; target_ref?: string }>(request)
  if (!body?.target_type) return fail('VALIDATION_ERROR', 'target_type is required', 422)
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  let targetRef = body.target_ref ?? null
  if (body.target_type === 'repo' && targetRef) {
    const repo = await readRepoDetail(env as { DB?: D1Database }, user.id, targetRef)
    if (!repo) return fail('NOT_FOUND', 'repository not found', 404)
    targetRef = String(repo.id)
  }
  return ok({ job: await startSummaryJob(env as { DB?: D1Database }, user.id, body.target_type, targetRef) })
}
