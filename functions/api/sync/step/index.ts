import { requireCsrf, readJson } from '../../_shared/http'
import { fail, ok } from '../../_shared/response'
import { acquireSyncJobLock, advanceSyncJob, failSyncJob, markReposUnstarredNotSyncedSince, pauseSyncJobForRateLimit, updateSyncState, upsertGitHubRepository } from '../../_shared/d1'
import { GitHubApiError, githubRequest, normalizeGitHubRepo, type GitHubStarredRepoPayload } from '../../_shared/github'
import { readGitHubToken } from '../../_shared/token'
import { requireUser } from '../../_shared/current-user'

const STAR_PAGE_SIZE = 100

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const body = await readJson<{ job_id?: string }>(request)
  if (!body?.job_id) return fail('VALIDATION_ERROR', 'job_id is required', 422)

  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const locked = await acquireSyncJobLock(env as { DB?: D1Database }, user.id, body.job_id)
  if (!locked) return fail('JOB_LOCKED', 'sync job is already being processed', 409)

  const token = await readGitHubToken(env as Env, user.id)
  if (!token) return fail('UNAUTHORIZED', 'GitHub token missing; reconnect GitHub', 401)

  const page = Number(locked.page ?? 1) || 1
  const cursor = typeof locked.cursor === 'string' && locked.cursor ? locked.cursor : null
  const mode = locked.mode === 'repair' ? 'repair' : 'sync'
  const startedAt = typeof locked.created_at === 'string' ? locked.created_at : new Date().toISOString()

  try {
    const starredRepos = await githubRequest<GitHubStarredRepoPayload[]>(token, `/user/starred?sort=created&direction=desc&per_page=${STAR_PAGE_SIZE}&page=${page}`, {
      headers: { accept: 'application/vnd.github.star+json' },
    })

    const isIncremental = mode === 'sync' && Boolean(cursor)
    const itemsToSave = isIncremental ? starredRepos.filter((item) => item.starred_at > String(cursor)) : starredRepos
    let newestStarredAt: string | null = null
    for (const item of itemsToSave) {
      newestStarredAt = maxIso(newestStarredAt, item.starred_at)
      await upsertGitHubRepository(env as { DB?: D1Database }, user.id, normalizeGitHubRepo(item.repo), item.starred_at)
    }

    const reachedCursor = Boolean(isIncremental && itemsToSave.length < starredRepos.length)
    const hasMore = !reachedCursor && starredRepos.length === STAR_PAGE_SIZE
    let processedDelta = itemsToSave.length

    if (mode === 'repair' && page === 1 && newestStarredAt) {
      await updateSyncState(env as { DB?: D1Database }, user.id, { lastStarredAt: newestStarredAt })
    }

    if (mode === 'repair' && !hasMore) {
      processedDelta += await markReposUnstarredNotSyncedSince(env as { DB?: D1Database }, user.id, startedAt)
      await updateSyncState(env as { DB?: D1Database }, user.id, { baselineComplete: true, baselineNextPage: 1, lastRepairAt: new Date().toISOString() })
    } else if (mode === 'sync' && !cursor) {
      await updateSyncState(env as { DB?: D1Database }, user.id, {
        baselineComplete: !hasMore,
        baselineNextPage: hasMore ? page + 1 : 1,
        lastStarredAt: newestStarredAt,
      })
    } else if (mode === 'sync' && !hasMore) {
      await updateSyncState(env as { DB?: D1Database }, user.id, { baselineComplete: true, baselineNextPage: 1, lastStarredAt: newestStarredAt ?? cursor })
    }

    return ok({ job: await advanceSyncJob(env as { DB?: D1Database }, user.id, body.job_id, { processedDelta, hasMore, page }) })
  } catch (error) {
    if (error instanceof GitHubApiError && (error.status === 403 || error.status === 429)) {
      return ok({ job: await pauseSyncJobForRateLimit(env as { DB?: D1Database }, user.id, body.job_id, error.retryAfter) })
    }
    return ok({ job: await failSyncJob(env as { DB?: D1Database }, user.id, body.job_id, error instanceof Error ? error.message : 'sync failed') })
  }
}

function maxIso(current: string | null, next: string) {
  return !current || next > current ? next : current
}
