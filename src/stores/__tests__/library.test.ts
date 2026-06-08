import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLibraryStore } from '../library'

describe('library store without example data', () => {
  beforeEach(() => {
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
