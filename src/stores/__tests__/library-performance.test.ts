import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLibraryStore } from '../library'

describe('library performance smoke', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('filters 1000 repos quickly enough for local search MVP', () => {
    const store = useLibraryStore()
    store.repos = Array.from({ length: 1000 }, (_, index) => ({
      id: index + 100,
      owner: 'owner',
      name: `repo-${index}`,
      description: index % 2 ? 'Vue UI library' : 'AI agent tool',
      stars: index,
      growth: 'synced',
      language: index % 2 ? 'Vue' : 'TypeScript',
      starredAt: '2026-05-29T00:00:00Z',
      groups: index % 3 ? ['frontend'] : [],
      aiSummary: index % 2 ? '前端 UI 工具' : 'AI agent 工具',
    }))
    const started = performance.now()
    store.setQuery('agent')
    expect(store.filteredRepos.length).toBeGreaterThan(0)
    expect(performance.now() - started).toBeLessThan(80)
  })
})
