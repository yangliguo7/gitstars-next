import { describe, expect, it } from 'vitest'
import { defaultGroupSuggestions, repoGroupSuggestions } from '../grouping'

describe('grouping fallback', () => {
  it('suggests default groups from repo metadata', () => {
    const suggestions = defaultGroupSuggestions([
      { full_name: 'vueuse/vueuse', language: 'TypeScript', description: 'Vue utilities' },
      { full_name: 'ai/agent', language: 'Python', description: 'LLM agent framework' },
    ])
    expect(suggestions.map((item) => item.name)).toContain('Frontend Systems')
    expect(suggestions.map((item) => item.name)).toContain('AI Tooling')
  })

  it('limits single repo group suggestions to 3', () => {
    expect(repoGroupSuggestions({ full_name: 'cloudflare/workers-sdk', description: 'worker cli database', language: 'TypeScript' }).length).toBeLessThanOrEqual(3)
  })
})
