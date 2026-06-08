import { encryptString } from './crypto'

const now = new Date().toISOString()

export async function readGroups(env: { DB?: D1Database }, userId: string) {
  if (!env.DB) return []
  try {
    const result = await env.DB.prepare(
      'SELECT id, name, description, color, icon, sort_order FROM groups WHERE user_id = ? ORDER BY sort_order ASC',
    ).bind(userId).all()
    return result.results
  } catch {
    return []
  }
}

export async function createGroup(env: { DB?: D1Database }, userId: string, input: { name: string; description?: string; color?: string; icon?: string }) {
  if (!env.DB) throw new Error('D1 DB is required')
  const id = slugId(input.name)
  await env.DB.prepare(
    `INSERT INTO groups (id, user_id, name, description, color, icon, sort_order, is_system, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM groups WHERE user_id = ?), 0, ?, ?)`,
  ).bind(id, userId, input.name, input.description ?? null, input.color ?? 'blue', input.icon ?? 'folder', userId, now, now).run()
  return { id, name: input.name, description: input.description ?? null, color: input.color ?? 'blue', icon: input.icon ?? 'folder' }
}

export async function updateGroup(env: { DB?: D1Database }, userId: string, id: string, input: { name?: string; description?: string; color?: string; icon?: string; sort_order?: number }) {
  if (!env.DB) return null
  const existing = await env.DB.prepare('SELECT id, name, description, color, icon, sort_order FROM groups WHERE user_id = ? AND id = ?').bind(userId, id).first<Record<string, unknown>>()
  if (!existing) return null
  await env.DB.prepare(
    `UPDATE groups
     SET name = COALESCE(?, name), description = COALESCE(?, description), color = COALESCE(?, color), icon = COALESCE(?, icon), sort_order = COALESCE(?, sort_order), updated_at = ?
     WHERE user_id = ? AND id = ?`,
  ).bind(input.name ?? null, input.description ?? null, input.color ?? null, input.icon ?? null, input.sort_order ?? null, now, userId, id).run()
  return { ...existing, ...input }
}

export async function deleteGroup(env: { DB?: D1Database }, userId: string, id: string) {
  if (!env.DB) return false
  const result = await env.DB.prepare('DELETE FROM groups WHERE user_id = ? AND id = ?').bind(userId, id).run()
  return result.meta.changes > 0
}

export async function readRepos(env: { DB?: D1Database }, userId: string, view: string, groupId: string | null, page: number, pageSize: number) {
  if (!env.DB) return { items: [], page, page_size: pageSize, total: 0 }
  try {
    const rows = await env.DB.prepare(
      `SELECT
        r.id,
        r.github_id,
        r.full_name,
        r.owner,
        r.name,
        r.description,
        r.language,
        r.stars_count,
        r.forks_count,
        r.html_url,
        ur.starred_at,
        ur.is_starred,
        s.kind AS summary_kind,
        s.content AS summary_content,
        s.short_content AS summary_short_content,
        s.detail_content AS summary_detail_content,
        COALESCE((
          SELECT json_group_array(json_object('id', g.id, 'name', g.name, 'color', g.color))
          FROM repository_groups rg
          JOIN groups g ON g.id = rg.group_id
          WHERE rg.user_id = ur.user_id AND rg.repository_id = r.id
        ), '[]') AS groups_json
      FROM user_repositories ur
      JOIN repositories r ON r.id = ur.repository_id
      LEFT JOIN summaries s ON s.id = (
        SELECT s2.id
        FROM summaries s2
        WHERE s2.user_id = ur.user_id AND s2.repository_id = r.id
        ORDER BY CASE s2.kind WHEN 'user' THEN 1 WHEN 'ai' THEN 2 ELSE 3 END
        LIMIT 1
      )
      WHERE ur.user_id = ? AND ur.is_starred = 1
      ORDER BY ur.starred_at DESC`,
    ).bind(userId).all<Record<string, unknown>>()
    let items = rows.results.map(mapD1Repo)
    if (view === 'ungrouped') items = items.filter((repo) => repo.groups.length === 0)
    if (view === 'recent') {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
      items = items.filter((repo) => Date.parse(repo.starred_at) >= cutoff)
    }
    if (view === 'has_summary') items = items.filter((repo) => repo.summary)
    if (groupId) items = items.filter((repo) => repo.groups.some((group) => group.id === groupId))
    const start = (page - 1) * pageSize
    return { items: items.slice(start, start + pageSize), page, page_size: pageSize, total: items.length }
  } catch {
    return { items: [], page, page_size: pageSize, total: 0 }
  }
}


export async function addReposToGroup(env: { DB?: D1Database }, userId: string, groupId: string, repositoryIds: string[]) {
  if (!env.DB || !repositoryIds.length) return []
  const current = currentIso()
  await env.DB.batch(repositoryIds.map((repositoryId) => env.DB!.prepare(
    'INSERT OR IGNORE INTO repository_groups (user_id, repository_id, group_id, created_at) VALUES (?, ?, ?, ?)',
  ).bind(userId, repositoryId, groupId, current)))
  return repositoryIds
}

export async function replaceRepoGroups(env: { DB?: D1Database }, userId: string, repositoryId: string, groupIds: string[]) {
  if (!env.DB) throw new Error('D1 DB is required')
  await env.DB.batch([
    env.DB.prepare('DELETE FROM repository_groups WHERE user_id = ? AND repository_id = ?').bind(userId, repositoryId),
    ...groupIds.map((groupId) => env.DB!.prepare(
      'INSERT OR IGNORE INTO repository_groups (user_id, repository_id, group_id, created_at) VALUES (?, ?, ?, ?)',
    ).bind(userId, repositoryId, groupId, now)),
  ])
  return groupIds
}

export async function saveUserSummary(env: { DB?: D1Database }, userId: string, repositoryId: string, content: string, shortContent?: string) {
  if (!env.DB) throw new Error('D1 DB is required')
  const current = currentIso()
  const short = shortContent?.trim() || content.trim().slice(0, 120)
  await env.DB.prepare(
    `INSERT INTO summaries (id, user_id, repository_id, kind, content, short_content, detail_content, created_at, updated_at)
     VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, repository_id, kind) DO UPDATE SET content = excluded.content, short_content = excluded.short_content, detail_content = excluded.detail_content, updated_at = excluded.updated_at`,
  ).bind(`sum_user_${repositoryId}`, userId, repositoryId, content, short, content, current, current).run()
  return { kind: 'user', content, short_content: short, detail_content: content }
}

export async function upsertModelSettings(env: { DB?: D1Database; ENCRYPTION_SECRET?: string }, userId: string, input: { enabled?: boolean; provider_name?: string; base_url: string; model_name: string; api_key?: string; allow_repo_metadata?: boolean; allow_user_notes?: boolean; allow_readme_content?: boolean }) {
  if (!env.DB) throw new Error('D1 DB is required')
  const encrypted = input.api_key && env.ENCRYPTION_SECRET
    ? await encryptString(input.api_key, env.ENCRYPTION_SECRET)
    : null
  await env.DB.prepare(
    `INSERT INTO model_settings (user_id, provider_name, base_url, model_name, api_key_encrypted, iv, key_version, enabled, allow_repo_metadata, allow_user_notes, allow_readme_content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       provider_name = excluded.provider_name,
       base_url = excluded.base_url,
       model_name = excluded.model_name,
       api_key_encrypted = COALESCE(excluded.api_key_encrypted, model_settings.api_key_encrypted),
       iv = COALESCE(excluded.iv, model_settings.iv),
       key_version = COALESCE(excluded.key_version, model_settings.key_version),
       enabled = excluded.enabled,
       allow_repo_metadata = excluded.allow_repo_metadata,
       allow_user_notes = excluded.allow_user_notes,
       allow_readme_content = excluded.allow_readme_content,
       updated_at = excluded.updated_at`,
  ).bind(
    userId,
    input.provider_name ?? 'openai-compatible',
    input.base_url,
    input.model_name,
    encrypted?.encrypted ?? null,
    encrypted?.iv ?? null,
    encrypted?.key_version ?? null,
    input.enabled ? 1 : 0,
    input.allow_repo_metadata ?? true ? 1 : 0,
    input.allow_user_notes ? 1 : 0,
    input.allow_readme_content ? 1 : 0,
    now,
    now,
  ).run()
  return input
}

export type SyncMode = 'sync' | 'repair'

export async function startSyncJob(env: { DB?: D1Database }, userId: string, mode: SyncMode = 'sync') {
  if (!env.DB) throw new Error('D1 DB is required')
  const existing = await env.DB.prepare(
    `SELECT id, status, mode, processed_count, total_count, page, cursor, retry_after, rate_limited_until
     FROM sync_jobs
     WHERE user_id = ? AND status IN ('pending','running','paused')
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(userId).first<Record<string, unknown>>()
  if (existing) return existing

  const current = currentIso()
  let state = await readSyncState(env, userId)
  if (!state) state = await createSyncState(env, userId)

  const id = `sync_${Date.now()}`
  const page = mode === 'repair' ? 1 : state.baseline_complete ? 1 : Number(state.baseline_next_page || 1)
  const cursor = mode === 'repair' ? null : state.baseline_complete ? state.last_starred_at : null
  await env.DB.prepare(
    `INSERT INTO sync_jobs (id, user_id, status, mode, cursor, page, processed_count, total_count, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?, ?, 0, NULL, ?, ?)`,
  ).bind(id, userId, mode, cursor, page, current, current).run()
  return { id, status: 'pending', mode, cursor, page, processed_count: 0, total_count: null, retry_after: null, rate_limited_until: null }
}

export async function readSyncState(env: { DB?: D1Database }, userId: string) {
  if (!env.DB) throw new Error('D1 DB is required')
  return env.DB.prepare(
    `SELECT user_id, baseline_complete, baseline_next_page, last_starred_at, last_repair_at
     FROM github_sync_state WHERE user_id = ?`,
  ).bind(userId).first<{ user_id: string; baseline_complete: number; baseline_next_page: number; last_starred_at: string | null; last_repair_at: string | null }>()
}

export async function createSyncState(env: { DB?: D1Database }, userId: string) {
  if (!env.DB) throw new Error('D1 DB is required')
  const current = currentIso()
  await env.DB.prepare(
    `INSERT OR IGNORE INTO github_sync_state (user_id, baseline_complete, baseline_next_page, created_at, updated_at)
     VALUES (?, 0, 1, ?, ?)`,
  ).bind(userId, current, current).run()
  return readSyncState(env, userId) as Promise<{ user_id: string; baseline_complete: number; baseline_next_page: number; last_starred_at: string | null; last_repair_at: string | null }>
}

export async function updateSyncState(env: { DB?: D1Database }, userId: string, input: { baselineComplete?: boolean; baselineNextPage?: number; lastStarredAt?: string | null; lastRepairAt?: string | null }) {
  if (!env.DB) throw new Error('D1 DB is required')
  const current = currentIso()
  const existing = await readSyncState(env, userId)
  const baselineComplete = input.baselineComplete === undefined ? Number(existing?.baseline_complete ?? 0) : input.baselineComplete ? 1 : 0
  const baselineNextPage = input.baselineNextPage ?? Number(existing?.baseline_next_page ?? 1)
  const lastStarredAt = input.lastStarredAt ?? existing?.last_starred_at ?? null
  const lastRepairAt = input.lastRepairAt ?? existing?.last_repair_at ?? null
  await env.DB.prepare(
    `INSERT INTO github_sync_state (user_id, baseline_complete, baseline_next_page, last_starred_at, last_repair_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       baseline_complete = excluded.baseline_complete,
       baseline_next_page = excluded.baseline_next_page,
       last_starred_at = excluded.last_starred_at,
       last_repair_at = excluded.last_repair_at,
       updated_at = excluded.updated_at`,
  ).bind(userId, baselineComplete, baselineNextPage, lastStarredAt, lastRepairAt, current, current).run()
}

export async function acquireSyncJobLock(env: { DB?: D1Database }, userId: string, jobId: string) {
  if (!env.DB) throw new Error('D1 DB is required')
  const lockId = `lock_${crypto.randomUUID?.() ?? Date.now()}`
  const current = currentIso()
  const expires = futureIso(60_000)
  const result = await env.DB.prepare(
    `UPDATE sync_jobs
     SET status = 'running', locked_at = ?, locked_by = ?, expires_at = ?, started_at = COALESCE(started_at, ?), updated_at = ?
     WHERE user_id = ? AND id = ?
       AND status IN ('pending','running','paused')
       AND (locked_at IS NULL OR expires_at IS NULL OR expires_at < ?)`,
  ).bind(current, lockId, expires, current, current, userId, jobId, current).run()
  if (result.meta.changes === 0) return null
  return env.DB.prepare(
    `SELECT id, status, mode, cursor, page, processed_count, total_count, locked_by, retry_after, rate_limited_until, created_at
     FROM sync_jobs WHERE user_id = ? AND id = ?`,
  ).bind(userId, jobId).first<Record<string, unknown>>()
}

export async function advanceSyncJob(env: { DB?: D1Database }, userId: string, jobId: string, input: { processedDelta: number; hasMore: boolean; page: number }) {
  if (!env.DB) throw new Error('D1 DB is required')
  const current = currentIso()
  const nextStatus = input.hasMore ? 'running' : 'success'
  await env.DB.prepare(
    `UPDATE sync_jobs
     SET status = ?, page = ?, processed_count = processed_count + ?, total_count = CASE WHEN ? = 1 THEN total_count ELSE processed_count + ? END,
       locked_at = NULL, locked_by = NULL, expires_at = NULL, retry_after = NULL, rate_limited_until = NULL,
       finished_at = CASE WHEN ? = 'success' THEN ? ELSE finished_at END, updated_at = ?
     WHERE user_id = ? AND id = ?`,
  ).bind(nextStatus, input.page + 1, input.processedDelta, input.hasMore ? 1 : 0, input.processedDelta, nextStatus, current, current, userId, jobId).run()
  return getSyncJob(env, userId, jobId)
}

export async function pauseSyncJobForRateLimit(env: { DB?: D1Database }, userId: string, jobId: string, retryAfterSeconds: number | null) {
  if (!env.DB) throw new Error('D1 DB is required')
  const current = currentIso()
  const retryUntil = futureIso((retryAfterSeconds ?? 60) * 1000)
  await env.DB.prepare(
    `UPDATE sync_jobs
     SET status = 'paused', retry_after = ?, rate_limited_until = ?, locked_at = NULL, locked_by = NULL, expires_at = NULL, updated_at = ?
     WHERE user_id = ? AND id = ?`,
  ).bind(retryAfterSeconds, retryUntil, current, userId, jobId).run()
  return getSyncJob(env, userId, jobId)
}

export async function failSyncJob(env: { DB?: D1Database }, userId: string, jobId: string, message: string) {
  if (!env.DB) throw new Error('D1 DB is required')
  const current = currentIso()
  await env.DB.prepare(
    `UPDATE sync_jobs
     SET status = 'failed', retry_count = retry_count + 1, error_message = ?, locked_at = NULL, locked_by = NULL, expires_at = NULL, updated_at = ?
     WHERE user_id = ? AND id = ?`,
  ).bind(message, current, userId, jobId).run()
  return getSyncJob(env, userId, jobId)
}

export async function finishSyncJob(env: { DB?: D1Database }, userId: string, jobId: string) {
  if (!env.DB) throw new Error('D1 DB is required')
  const current = currentIso()
  await env.DB.prepare(
    "UPDATE sync_jobs SET status = 'success', processed_count = COALESCE(total_count, processed_count, 0), locked_at = NULL, locked_by = NULL, expires_at = NULL, finished_at = ?, updated_at = ? WHERE user_id = ? AND id = ?",
  ).bind(current, current, userId, jobId).run()
  return getSyncJob(env, userId, jobId)
}

function mapD1Repo(row: Record<string, unknown>) {
  const groups = JSON.parse(String(row.groups_json ?? '[]')) as Array<{ id: string; name: string; color?: string }>
  return {
    id: String(row.id),
    github_id: Number(row.github_id),
    full_name: String(row.full_name),
    owner: String(row.owner),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    language: row.language ? String(row.language) : null,
    stars_count: Number(row.stars_count),
    forks_count: Number(row.forks_count),
    html_url: String(row.html_url),
    starred_at: String(row.starred_at),
    is_starred: Boolean(row.is_starred),
    groups,
    summary: row.summary_content ? { kind: row.summary_kind, content: row.summary_content, short_content: row.summary_short_content ?? row.summary_content, detail_content: row.summary_detail_content ?? row.summary_content } : undefined,
  }
}

function slugId(name: string) {
  const ascii = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const hash = Array.from(name).reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) >>> 0, 7).toString(36).slice(0, 6)
  return ascii ? `${ascii}-${hash}` : `g_${hash}`
}

export async function upsertGitHubRepository(env: { DB?: D1Database }, userId: string, repo: {
  github_id: number
  full_name: string
  owner: string
  name: string
  description: string | null
  language: string | null
  stars_count: number
  forks_count: number
  open_issues_count: number | null
  is_archived: number
  is_fork: number
  html_url: string
  pushed_at: string | null
  github_created_at: string | null
  github_updated_at: string | null
}, starredAt: string) {
  if (!env.DB) return
  const id = `repo_${repo.github_id}`
  const current = currentIso()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO repositories (id, github_id, full_name, owner, name, description, language, topics_json, stars_count, forks_count, open_issues_count, is_archived, is_fork, html_url, pushed_at, github_created_at, github_updated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(github_id) DO UPDATE SET full_name = excluded.full_name, owner = excluded.owner, name = excluded.name, description = excluded.description, language = excluded.language, stars_count = excluded.stars_count, forks_count = excluded.forks_count, open_issues_count = excluded.open_issues_count, is_archived = excluded.is_archived, is_fork = excluded.is_fork, html_url = excluded.html_url, pushed_at = excluded.pushed_at, github_updated_at = excluded.github_updated_at, updated_at = excluded.updated_at`,
    ).bind(id, repo.github_id, repo.full_name, repo.owner, repo.name, repo.description, repo.language, repo.stars_count, repo.forks_count, repo.open_issues_count, repo.is_archived, repo.is_fork, repo.html_url, repo.pushed_at, repo.github_created_at, repo.github_updated_at, current, current),
    env.DB.prepare(
      `INSERT INTO user_repositories (user_id, repository_id, is_starred, starred_at, last_synced_at, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT(user_id, repository_id) DO UPDATE SET is_starred = 1, starred_at = excluded.starred_at, unstarred_at = NULL, last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at`,
    ).bind(userId, id, starredAt, current, current, current),
  ])
}

export async function setStarState(env: { DB?: D1Database }, userId: string, fullName: string, isStarred: boolean) {
  if (!env.DB) return
  const current = currentIso()
  await env.DB.prepare(
    `UPDATE user_repositories
     SET is_starred = ?, unstarred_at = CASE WHEN ? = 0 THEN ? ELSE NULL END, updated_at = ?
     WHERE user_id = ? AND repository_id = (SELECT id FROM repositories WHERE full_name = ?)`,
  ).bind(isStarred ? 1 : 0, isStarred ? 1 : 0, current, current, userId, fullName).run()
}



export async function markReposUnstarredNotSyncedSince(env: { DB?: D1Database }, userId: string, syncedSince: string) {
  if (!env.DB) throw new Error('D1 DB is required')
  const current = currentIso()
  const result = await env.DB.prepare(
    `UPDATE user_repositories
     SET is_starred = 0, unstarred_at = ?, updated_at = ?
     WHERE user_id = ? AND is_starred = 1 AND (last_synced_at IS NULL OR last_synced_at < ?)`,
  ).bind(current, current, userId, syncedSince).run()
  return result.meta.changes ?? 0
}

export async function readReposForStarCheck(env: { DB?: D1Database }, userId: string, limit: number) {
  if (!env.DB) return []
  const result = await env.DB.prepare(
    `SELECT r.full_name
     FROM user_repositories ur
     JOIN repositories r ON r.id = ur.repository_id
     WHERE ur.user_id = ? AND ur.is_starred = 1
     ORDER BY COALESCE(ur.last_synced_at, ''), ur.starred_at
     LIMIT ?`,
  ).bind(userId, limit).all<{ full_name: string }>()
  return result.results.map((row) => row.full_name)
}

export async function markRepoStarChecked(env: { DB?: D1Database }, userId: string, fullName: string, isStarred: boolean) {
  if (!env.DB) return
  const current = currentIso()
  await env.DB.prepare(
    `UPDATE user_repositories
     SET is_starred = ?, last_synced_at = ?, unstarred_at = CASE WHEN ? = 0 THEN ? ELSE NULL END, updated_at = ?
     WHERE user_id = ? AND repository_id = (SELECT id FROM repositories WHERE full_name = ?)`,
  ).bind(isStarred ? 1 : 0, current, isStarred ? 1 : 0, current, current, userId, fullName).run()
}

export async function deleteUserSummary(env: { DB?: D1Database }, userId: string, repositoryId: string) {
  if (!env.DB) return false
  await env.DB.prepare("DELETE FROM summaries WHERE user_id = ? AND repository_id = ? AND kind = 'user'").bind(userId, repositoryId).run()
  return true
}

export async function getSyncJob(env: { DB?: D1Database }, userId: string, jobId: string) {
  if (!env.DB) throw new Error('D1 DB is required')
  return env.DB.prepare(
    `SELECT id, status, mode, cursor, page, processed_count, total_count, retry_after, rate_limited_until, error_message, locked_at, expires_at
     FROM sync_jobs WHERE user_id = ? AND id = ?`,
  ).bind(userId, jobId).first<Record<string, unknown>>()
}

export async function startSummaryJob(env: { DB?: D1Database }, userId: string, targetType: string, targetRef: string | null) {
  if (!env.DB) throw new Error('D1 DB is required')
  const current = currentIso()
  const id = `sum_${Date.now()}`
  const repositoryIds = targetType === 'repo' && targetRef
    ? [targetRef]
    : await readRepositoryIdsMissingSummary(env, userId, 500)

  await env.DB.prepare(
    `INSERT INTO summary_jobs (id, user_id, status, target_type, target_ref, total_count, processed_count, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?, ?, 0, ?, ?)`,
  ).bind(id, userId, targetType, targetRef, repositoryIds.length, current, current).run()

  if (repositoryIds.length) {
    await env.DB.batch(repositoryIds.map((repositoryId) => env.DB!.prepare(
      `INSERT OR IGNORE INTO summary_job_items (job_id, repository_id, status, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?)`,
    ).bind(id, repositoryId, current, current)))
  }

  return { id, status: repositoryIds.length ? 'pending' : 'success', target_type: targetType, target_ref: targetRef, total_count: repositoryIds.length, processed_count: 0, failed_count: 0 }
}

async function readRepositoryIdsMissingSummary(env: { DB?: D1Database }, userId: string, limit: number) {
  if (!env.DB) return []
  const result = await env.DB.prepare(
    `SELECT ur.repository_id
     FROM user_repositories ur
     WHERE ur.user_id = ? AND ur.is_starred = 1
       AND NOT EXISTS (
         SELECT 1 FROM summaries s
         WHERE s.user_id = ur.user_id AND s.repository_id = ur.repository_id AND s.kind IN ('ai', 'fallback')
       )
     ORDER BY ur.starred_at DESC
     LIMIT ?`,
  ).bind(userId, limit).all<{ repository_id: string }>()
  return result.results.map((row) => row.repository_id)
}

export async function finishSummaryItem(env: { DB?: D1Database }, userId: string, jobId: string, repositoryId: string, status: 'success' | 'failed', errorMessage: string | null = null) {
  if (!env.DB) throw new Error('D1 DB is required')
  const current = currentIso()
  await env.DB.batch([
    env.DB.prepare('UPDATE summary_job_items SET status = ?, error_message = ?, updated_at = ? WHERE job_id = ? AND repository_id = ?').bind(status, errorMessage, current, jobId, repositoryId),
    env.DB.prepare('UPDATE summary_jobs SET processed_count = processed_count + 1, updated_at = ? WHERE user_id = ? AND id = ?').bind(current, userId, jobId),
  ])
  await env.DB.prepare(
    `UPDATE summary_jobs
     SET status = CASE WHEN processed_count >= total_count THEN 'success' ELSE status END,
         finished_at = CASE WHEN processed_count >= total_count THEN ? ELSE finished_at END,
         updated_at = ?
     WHERE user_id = ? AND id = ?`,
  ).bind(current, current, userId, jobId).run()
  return getSummaryJob(env, userId, jobId)
}

export async function getSummaryJob(env: { DB?: D1Database }, userId: string, jobId: string) {
  if (!env.DB) throw new Error('D1 DB is required')
  return env.DB.prepare(
    `SELECT sj.id, sj.status, sj.total_count, sj.processed_count,
      (SELECT COUNT(*) FROM summary_job_items sji WHERE sji.job_id = sj.id AND sji.status = 'failed') AS failed_count
     FROM summary_jobs sj WHERE sj.user_id = ? AND sj.id = ?`,
  ).bind(userId, jobId).first<Record<string, unknown>>()
}

export async function readRepoDetail(env: { DB?: D1Database }, userId: string, repositoryId: string) {
  const repos = await readRepos(env, userId, 'all', null, 1, 1000)
  return repos.items.find((item) => String(item.id) === repositoryId || String(item.github_id) === repositoryId)
}

export async function readRepoSummaries(env: { DB?: D1Database }, userId: string, repositoryId: string) {
  if (!env.DB) return []
  const result = await env.DB.prepare(
    `SELECT kind, content, model_name, created_at, updated_at
     FROM summaries
     WHERE user_id = ? AND repository_id = ?
     ORDER BY CASE kind WHEN 'user' THEN 1 WHEN 'ai' THEN 2 ELSE 3 END`,
  ).bind(userId, repositoryId).all()
  return result.results
}

export async function groupIdsExist(env: { DB?: D1Database }, userId: string, groupIds: string[]) {
  if (!env.DB) throw new Error('D1 DB is required')
  if (!groupIds.length) return true
  const placeholders = groupIds.map(() => '?').join(',')
  const result = await env.DB.prepare(`SELECT id FROM groups WHERE user_id = ? AND id IN (${placeholders})`).bind(userId, ...groupIds).all<{ id: string }>()
  return result.results.length === new Set(groupIds).size
}

export async function saveGeneratedSummary(env: { DB?: D1Database }, userId: string, repositoryId: string, kind: 'ai' | 'fallback', summary: { short: string; detail: string } | string, modelName?: string | null) {
  if (!env.DB) throw new Error('D1 DB is required')
  const current = currentIso()
  const short = typeof summary === 'string' ? summary.slice(0, 120) : summary.short
  const detail = typeof summary === 'string' ? summary : summary.detail
  await env.DB.prepare(
    `INSERT INTO summaries (id, user_id, repository_id, kind, content, short_content, detail_content, model_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, repository_id, kind) DO UPDATE SET content = excluded.content, short_content = excluded.short_content, detail_content = excluded.detail_content, model_name = excluded.model_name, updated_at = excluded.updated_at`,
  ).bind(`sum_${kind}_${repositoryId}`, userId, repositoryId, kind, detail, short, detail, modelName ?? null, current, current).run()
  return { kind, content: detail, short_content: short, detail_content: detail }
}

export async function getSummaryJobTarget(env: { DB?: D1Database }, userId: string, jobId: string) {
  if (!env.DB) return null
  const row = await env.DB.prepare(
    `SELECT sji.repository_id
     FROM summary_jobs sj
     JOIN summary_job_items sji ON sji.job_id = sj.id
     WHERE sj.user_id = ? AND sj.id = ?
     AND sji.status = 'pending'
     ORDER BY sji.created_at ASC
     LIMIT 1`,
  ).bind(userId, jobId).first<{ repository_id: string }>()
  return row ?? null
}

export async function readModelSettings(env: { DB?: D1Database }, userId: string) {
  if (!env.DB) return null
  return env.DB.prepare(
    `SELECT provider_name, base_url, model_name, api_key_encrypted, iv, key_version, enabled, allow_repo_metadata, allow_user_notes
     FROM model_settings WHERE user_id = ?`,
  ).bind(userId).first<Record<string, unknown>>()
}


function currentIso() {
  return new Date().toISOString()
}

function futureIso(ms: number) {
  return new Date(Date.now() + ms).toISOString()
}
