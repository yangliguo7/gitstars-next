import type { Group, Repository, SettingsPanel } from '../types/domain'

export interface ApiSuccess<T> {
  ok: true
  data: T
}

export interface ApiFailure {
  ok: false
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure

export interface RepoListResponse {
  items: ApiRepository[]
  page: number
  page_size: number
  total: number
}

export interface ApiRepository {
  id: string
  github_id: number
  full_name: string
  owner: string
  name: string
  description: string | null
  language: string | null
  stars_count: number
  html_url: string
  starred_at: string
  is_starred: boolean
  groups: Array<{ id: string; name: string; color?: string }>
  summary?: { kind: 'user' | 'ai' | 'fallback'; content: string; short_content?: string; detail_content?: string }
}

let csrfToken = readCookie('gitstars_csrf')

export async function getMe() {
  const data = await request<{ csrf_token: string | null; user: { login: string; avatar_url: string | null } | null; settings: { default_view: string; model_enabled: boolean } }>('/api/me')
  csrfToken = data.csrf_token ?? readCookie('gitstars_csrf')
  return data
}

export async function getRepos(view: string, groupId = '') {
  const pageSize = 100
  const first = await getReposPage(view, groupId, 1, pageSize)
  const items = [...first.items]
  const pageCount = Math.ceil(first.total / pageSize)
  for (let page = 2; page <= pageCount; page += 1) {
    items.push(...(await getReposPage(view, groupId, page, pageSize)).items)
  }
  return { ...first, items, page: 1, page_size: pageSize }
}

async function getReposPage(view: string, groupId: string, page: number, pageSize: number) {
  const params = new URLSearchParams({ view, page: String(page), page_size: String(pageSize) })
  if (groupId) params.set('group_id', groupId)
  return request<RepoListResponse>(`/api/repos?${params}`)
}

export async function getGroups() {
  return request<{ items: Group[] }>('/api/groups')
}

export async function createGroup(name: string, description?: string) {
  return request<{ group: Group }>('/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name, description, color: 'blue', icon: 'folder' }),
  })
}

export async function deleteGroup(groupId: string) {
  return request<{ deleted: boolean }>(`/api/groups/${groupId}`, { method: 'DELETE' })
}

export async function saveRepoGroups(repoId: number | string, groupIds: string[]) {
  return request<{ repository_id: string; group_ids: string[] }>(`/api/repos/${encodeURIComponent(String(repoId))}/groups`, {
    method: 'PUT',
    body: JSON.stringify({ group_ids: groupIds }),
  })
}

export async function saveUserSummary(repoId: number | string, shortContent: string, detailContent: string) {
  return request<{ summary: { kind: 'user'; content: string; short_content: string; detail_content: string } }>(`/api/repos/${encodeURIComponent(String(repoId))}/summary/user`, {
    method: 'PUT',
    body: JSON.stringify({ short_content: shortContent, detail_content: detailContent, content: detailContent }),
  })
}

export async function startSync(mode: 'sync' | 'repair' = 'sync') {
  return request<{ job: SyncJob }>('/api/sync/start', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  })
}

export interface SyncJob {
  id: string
  status: string
  mode?: string
  processed_count: number
  total_count: number | null
}

export interface SummaryJob {
  id: string
  status: string
  total_count: number
  processed_count: number
  failed_count: number
}

export async function starRepo(owner: string, name: string) {
  return request<{ full_name: string; is_starred: boolean }>(`/api/repos/${owner}/${name}/star`, { method: 'POST' })
}

export async function unstarRepo(owner: string, name: string) {
  return request<{ full_name: string; is_starred: boolean }>(`/api/repos/${owner}/${name}/star`, { method: 'DELETE' })
}

export async function stepSync(jobId: string) {
  return request<{ job: SyncJob }>('/api/sync/step', {
    method: 'POST',
    body: JSON.stringify({ job_id: jobId }),
  })
}

export async function autoAssignGroups(createMissing = true) {
  return request<{ assigned_count: number; created_groups: Group[]; proposed_groups?: GroupSuggestion[]; considered_count: number; needs_confirmation?: boolean }>('/api/groups/auto-assign', {
    method: 'POST',
    body: JSON.stringify({ create_missing: createMissing }),
  })
}

export function mapApiRepo(repo: ApiRepository): Repository {
  const [owner, name] = repo.full_name.split('/')
  return {
    id: repo.github_id,
    storageId: repo.id,
    owner: owner || repo.owner,
    name: name || repo.name,
    description: repo.description ?? '',
    stars: repo.stars_count,
    growth: 'synced',
    language: repo.language ?? 'Unknown',
    starredAt: repo.starred_at,
    groups: repo.groups.map((group) => group.id),
    aiSummary: repo.summary?.kind === 'ai' || repo.summary?.kind === 'fallback' ? repo.summary.short_content ?? repo.summary.content : undefined,
    aiDetailSummary: repo.summary?.kind === 'ai' || repo.summary?.kind === 'fallback' ? repo.summary.detail_content ?? repo.summary.content : undefined,
    userSummary: repo.summary?.kind === 'user' ? repo.summary.short_content ?? repo.summary.content : undefined,
    userDetailSummary: repo.summary?.kind === 'user' ? repo.summary.detail_content ?? repo.summary.content : undefined,
    homepage: repo.html_url,
  }
}

export function settingsPanelToPath(panel: SettingsPanel) {
  return panel === 'model' ? '/api/settings/model' : '/api/settings'
}

export async function getSettings() {
  return request<{ model: { enabled: boolean; provider_name: string; base_url: string; model_name: string; api_key_masked: string } }>('/api/settings')
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const response = await fetch(path, {
    ...init,
    method,
    headers: {
      'content-type': 'application/json',
      ...(method === 'GET' ? {} : { 'x-csrf-token': csrfToken }),
      ...init.headers,
    },
  })
  const payload = await response.json<ApiResponse<T>>()
  if (!payload.ok) throw new Error(`${payload.error.code}: ${payload.error.message}`)
  return payload.data
}

export async function saveModelSettings(input: {
  baseUrl: string
  modelName: string
  apiKey?: string
  enabled?: boolean
}) {
  const providerName = input.baseUrl.includes('/anthropic') ? 'anthropic' : 'openai-compatible'
  return request<{ model: { base_url: string; model_name: string; api_key_masked: string } }>('/api/settings/model', {
    method: 'PUT',
    body: JSON.stringify({
      enabled: input.enabled ?? true,
      provider_name: providerName,
      base_url: input.baseUrl,
      model_name: input.modelName,
      api_key: input.apiKey || undefined,
      allow_repo_metadata: true,
      allow_user_notes: false,
      allow_readme_content: false,
    }),
  })
}

export async function renameGroup(groupId: string, name: string) {
  return request<{ group: Group }>(`/api/groups/${groupId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export async function startSummary(repoId: number | string) {
  return request<{ job: SummaryJob }>('/api/summaries/start', {
    method: 'POST',
    body: JSON.stringify({ target_type: 'repo', target_ref: String(repoId) }),
  })
}

export async function startMissingSummaries() {
  return request<{ job: SummaryJob }>('/api/summaries/start', {
    method: 'POST',
    body: JSON.stringify({ target_type: 'filter', target_ref: 'missing' }),
  })
}

export async function stepSummary(jobId: string) {
  return request<{ job: SummaryJob }>('/api/summaries/step', {
    method: 'POST',
    body: JSON.stringify({ job_id: jobId }),
  })
}

export interface GroupSuggestion {
  name: string
  reason: string
  score: number
  repo_count_estimate?: number
  examples?: string[]
}

export async function getDefaultGroupSuggestions() {
  return request<{ suggestions: GroupSuggestion[]; review?: { approved: boolean; issues: string[] } }>('/api/groups/suggestions')
}


export async function acceptGroupSuggestions(suggestions: GroupSuggestion[]) {
  return request<{ groups: Group[]; assigned_count: number; ai_assigned_count?: number; review?: { approved: boolean; issues: string[] } }>('/api/groups/suggestions/accept', {
    method: 'POST',
    body: JSON.stringify({ suggestions }),
  })
}

export async function getRepoGroupSuggestions(repoId: number | string) {
  return request<{ suggestions: GroupSuggestion[] }>(`/api/repos/${encodeURIComponent(String(repoId))}/group-suggestions`)
}

export async function getRepoReadme(owner: string, name: string) {
  return request<{ content: string; path: string | null; html_url: string | null }>(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/readme`)
}


function readCookie(name: string) {
  return document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.split('=')[1] ?? ''
}

export async function testModelSettings(input: { baseUrl: string; modelName: string; apiKey?: string }) {
  const providerName = input.baseUrl.includes('/anthropic') ? 'anthropic' : 'openai-compatible'
  return request<{ connected: boolean; latency_ms: number; model_name: string }>('/api/settings/model/test', {
    method: 'POST',
    body: JSON.stringify({ provider_name: providerName, base_url: input.baseUrl, model_name: input.modelName, api_key: input.apiKey || undefined }),
  })
}
