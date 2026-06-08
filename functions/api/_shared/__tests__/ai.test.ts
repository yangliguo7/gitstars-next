import { describe, expect, it, vi } from 'vitest'
import { fallbackSummary, generateGroupSuggestionsWithModel, generateSummaryWithModel, parseGroupSuggestions, parseSummaryResult } from '../ai'

describe('fallbackSummary', () => {
  it('generates useful Chinese fallback summary from repo metadata', () => {
    const summary = fallbackSummary({ full_name: 'owner/repo', description: 'A useful tool.', language: 'TypeScript' })
    expect(summary).toContain('owner/repo')
    expect(summary).toContain('TypeScript')
    expect(summary).toContain('A useful tool')
  })
})

describe('parseSummaryResult', () => {
  it('accepts valid JSON schema', () => {
    expect(parseSummaryResult('{"summary":"Vue 工具库","confidence":0.8,"keywords":["vue"],"risk_flags":[]}')).toMatchObject({ summary: 'Vue 工具库', confidence: 0.8 })
  })

  it('rejects invalid JSON and empty summary', () => {
    expect(parseSummaryResult('not json')).toBeNull()
    expect(parseSummaryResult('{"summary":""}')).toBeNull()
  })

  it('rejects non-Chinese summaries', () => {
    expect(parseSummaryResult('{"summary":"English summary","confidence":0.8,"keywords":[],"risk_flags":[]}')).toBeNull()
  })
})

describe('parseGroupSuggestions', () => {
  it('accepts Chinese AI group suggestions', () => {
    expect(parseGroupSuggestions('{"groups":[{"name":"前端开发","reason":"包含多个 UI 和前端工具仓库","score":91}]}')).toEqual([
      { name: '前端开发', reason: '包含多个 UI 和前端工具仓库', score: 91 },
    ])
  })

  it('rejects English group names', () => {
    expect(parseGroupSuggestions('{"groups":[{"name":"Frontend","reason":"frontend repos","score":91}]}')).toEqual([])
  })


  it('accepts array or suggestions payloads and field aliases', () => {
    expect(parseGroupSuggestions('```json\n[{"title":"AI 工具","description":"覆盖模型应用仓库","confidence":"88","count":"9","repos":["owner/repo"]}]\n```')).toEqual([
      { name: 'AI 工具', reason: '覆盖模型应用仓库', score: 88, repo_count_estimate: 9, examples: ['owner/repo'] },
    ])
    expect(parseGroupSuggestions('{"suggestions":[{"group_name":"前端工程","rationale":"构建和 UI 工具","score":82}]}')).toEqual([
      { name: '前端工程', reason: '构建和 UI 工具', score: 82 },
    ])
  })

  it('accepts Chinese aliases and trailing model text', () => {
    expect(parseGroupSuggestions('{"分组":[{"名称":"数据存储","理由":"数据库和存储相关仓库","评分":"86"}]}\n已完成')).toEqual([
      { name: '数据存储', reason: '数据库和存储相关仓库', score: 86 },
    ])
  })

  it('translates common English technical group names', () => {
    expect(parseGroupSuggestions('{"groups":[{"name":"AI Tooling","reason":"模型应用工具","score":91}]}')).toEqual([
      { name: 'AI 工具', reason: '模型应用工具', score: 91 },
    ])
  })
})

describe('generateSummaryWithModel', () => {
  it('retries once after invalid JSON', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(modelResponse('not json'))
      .mockResolvedValueOnce(modelResponse('{"summary":"AI 摘要","confidence":0.9,"keywords":[],"risk_flags":[]}'))

    await expect(generateSummaryWithModel({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      modelName: 'test-model',
      repository: { full_name: 'owner/repo', description: 'desc', language: 'TypeScript' },
      fetcher: fetcher as unknown as typeof fetch,
    })).resolves.toBe('AI 摘要')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })



  it('rejects oversized model response', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('x'.repeat(20), { status: 200 }))
    await expect(generateSummaryWithModel({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      modelName: 'test-model',
      repository: { full_name: 'owner/repo', description: 'desc', language: 'TypeScript' },
      fetcher: fetcher as unknown as typeof fetch,
      maxBytes: 5,
    })).rejects.toThrow('too large')
  })

  it('falls back after invalid JSON retry', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(modelResponse('still invalid')))
    const summary = await generateSummaryWithModel({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      modelName: 'test-model',
      repository: { full_name: 'owner/repo', description: 'desc', language: 'TypeScript' },
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(summary).toContain('owner/repo')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

function modelResponse(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
}


describe('generateGroupSuggestionsWithModel', () => {
  it('accepts Anthropic endpoint returning OpenAI-compatible body', async () => {
    const fetcher = vi.fn().mockResolvedValue(modelResponse('{"groups":[{"name":"AI 工具","reason":"模型应用相关仓库","score":90}]}'))
    await expect(generateGroupSuggestionsWithModel({
      provider: 'anthropic',
      baseUrl: 'https://api.example.com/anthropic',
      apiKey: 'sk-test',
      modelName: 'test-model',
      repositories: [{ full_name: 'owner/repo', language: 'TypeScript', description: 'LLM app' }],
      fetcher: fetcher as unknown as typeof fetch,
    })).resolves.toEqual([{ name: 'AI 工具', reason: '模型应用相关仓库', score: 90 }])
  })

  it('accepts SSE model response chunks', async () => {
    const first = JSON.stringify({ choices: [{ delta: { content: '{"groups":[{"name":"前端工程","reason":"UI 工具仓库","score":88' } }] })
    const second = JSON.stringify({ choices: [{ delta: { content: '}]}' } }] })
    const body = `data: ${first}

data: ${second}

data: [DONE]

`
    const fetcher = vi.fn().mockResolvedValue(new Response(body, { status: 200 }))
    await expect(generateGroupSuggestionsWithModel({
      provider: 'anthropic',
      baseUrl: 'https://api.example.com/anthropic',
      apiKey: 'sk-test',
      modelName: 'test-model',
      repositories: [{ full_name: 'owner/repo', language: 'TypeScript', description: 'UI tool' }],
      fetcher: fetcher as unknown as typeof fetch,
    })).resolves.toEqual([{ name: '前端工程', reason: 'UI 工具仓库', score: 88 }])
  })
})
