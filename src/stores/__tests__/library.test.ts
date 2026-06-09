import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/gitstars-api', () => ({
  acceptGroupSuggestions: vi.fn(),
  autoAssignGroups: vi.fn().mockResolvedValue({ assigned_count: 0, created_groups: [], considered_count: 0 }),
  createGroup: vi.fn(),
  deleteGroup: vi.fn(),
  getDefaultGroupSuggestions: vi.fn(),
  getGroups: vi.fn(),
  getMe: vi.fn(),
  getSettings: vi.fn(),
  getRepoGroupSuggestions: vi.fn(),
  getRepos: vi.fn(),
  mapApiRepo: vi.fn((repo) => ({
    id: repo.github_id,
    storageId: repo.id,
    owner: repo.owner,
    name: repo.name,
    description: repo.description ?? '',
    stars: repo.stars_count,
    growth: 'synced',
    language: repo.language ?? 'Unknown',
    starredAt: repo.starred_at,
    groups: repo.groups.map((group: { id: string }) => group.id),
    aiSummary: repo.summary?.short_content ?? repo.summary?.content,
    aiDetailSummary: repo.summary?.detail_content ?? repo.summary?.content,
    homepage: repo.html_url,
  })),
  renameGroup: vi.fn(),
  saveModelSettings: vi.fn(),
  saveRepoGroups: vi.fn(),
  saveUserSummary: vi.fn(),
  starRepo: vi.fn(),
  startMissingSummaries: vi.fn(),
  startSummary: vi.fn(),
  startSync: vi.fn(),
  stepSummary: vi.fn(),
  stepSync: vi.fn(),
  testModelSettings: vi.fn(),
  unstarRepo: vi.fn(),
}))

import { createPinia, setActivePinia } from 'pinia'
import { autoAssignGroups, getGroups, getMe, getRepos, startSync } from '../../services/gitstars-api'
import { useLibraryStore } from '../library'

describe('library store without example data', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('starts empty before GitHub sync', () => {
    const store = useLibraryStore()
    expect(store.repos).toEqual([])
    expect(store.groups).toEqual([])
    expect(store.filteredRepos).toEqual([])
    expect(store.counts.all).toBe(0)
  })

  it('command can still switch view and theme', () => {
    const store = useLibraryStore()
    store.runCommand('show ungrouped')
    expect(store.filter).toBe('ungrouped')
    store.runCommand('dark mode')
    expect(store.theme).toBe('dark')
  })

  it('opens model settings before syncing without model config', async () => {
    const store = useLibraryStore()
    await store.syncGitHub()
    expect(store.settingsOpen).toBe(true)
    expect(store.settingsPanel).toBe('model')
    expect(store.loadError).toContain('Model Settings')
    expect(store.syncing).toBe(false)
  })

  it('skips sync auto grouping when the user has no groups yet', async () => {
    vi.mocked(getMe).mockResolvedValue({ csrf_token: 'csrf', user: { login: 'octo', avatar_url: null }, settings: { default_view: 'all', model_enabled: true } })
    vi.mocked(getGroups).mockResolvedValue({ items: [] })
    vi.mocked(getRepos).mockResolvedValue({ items: [syncedRepo()], page: 1, page_size: 100, total: 1 })
    vi.mocked(startSync).mockResolvedValue({ job: { id: 'sync_1', status: 'success', processed_count: 1, total_count: 1 } })

    const store = useLibraryStore()
    await store.loadFromApi()
    await store.syncGitHub()

    expect(autoAssignGroups).not.toHaveBeenCalled()
  })

  it('runs sync auto grouping when the user already has groups', async () => {
    vi.mocked(getMe).mockResolvedValue({ csrf_token: 'csrf', user: { login: 'octo', avatar_url: null }, settings: { default_view: 'all', model_enabled: true } })
    vi.mocked(getGroups).mockResolvedValue({ items: [{ id: 'grp_ai', name: 'AI 工具', description: 'AI repositories', color: 'blue' }] })
    vi.mocked(getRepos).mockResolvedValue({ items: [syncedRepo()], page: 1, page_size: 100, total: 1 })
    vi.mocked(startSync).mockResolvedValue({ job: { id: 'sync_1', status: 'success', processed_count: 1, total_count: 1 } })

    const store = useLibraryStore()
    await store.loadFromApi()
    await store.syncGitHub()

    expect(autoAssignGroups).toHaveBeenCalledTimes(1)
  })

  it('connect action redirects to GitHub OAuth start', () => {
    const store = useLibraryStore()
    const original = window.location
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { href: '', assign }, writable: true })
    store.loginWithGitHub()
    expect(window.location.href).toBe('/api/auth/github/start')
    Object.defineProperty(window, 'location', { value: original, writable: true })
  })
})

function syncedRepo() {
  return {
    id: 'repo_1',
    github_id: 1,
    full_name: 'octo/repo',
    owner: 'octo',
    name: 'repo',
    description: 'A synced repo',
    language: 'TypeScript',
    stars_count: 42,
    html_url: 'https://github.com/octo/repo',
    starred_at: '2026-06-09T00:00:00.000Z',
    is_starred: true,
    groups: [],
    summary: { kind: 'ai' as const, content: '摘要', short_content: '摘要', detail_content: '详细摘要' },
  }
}
