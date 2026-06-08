export function defaultGroupSuggestions(repos: Array<{ language?: string | null; full_name?: string; description?: string | null }>) {
  const base = new Map<string, { name: string; reason: string; score: number }>()
  for (const repo of repos) {
    const text = `${repo.full_name ?? ''} ${repo.description ?? ''} ${repo.language ?? ''}`.toLowerCase()
    if (text.includes('vue') || text.includes('react') || text.includes('ui')) base.set('frontend', { name: 'Frontend Systems', reason: 'UI / frontend repositories appear often.', score: 92 })
    if (text.includes('ai') || text.includes('llm') || text.includes('agent')) base.set('ai', { name: 'AI Tooling', reason: 'AI / LLM tooling detected.', score: 88 })
    if (text.includes('test') || text.includes('lint') || text.includes('cli') || text.includes('bench')) base.set('dev', { name: 'Dev Productivity', reason: 'Developer productivity tooling detected.', score: 84 })
    if (text.includes('cloudflare') || text.includes('worker') || text.includes('database')) base.set('backend', { name: 'Backend Infra', reason: 'Backend or cloud infrastructure detected.', score: 76 })
  }
  return [...base.values()].slice(0, 12)
}

export function repoGroupSuggestions(repo: { language?: string | null; full_name?: string; description?: string | null }) {
  return defaultGroupSuggestions([repo]).slice(0, 3)
}
