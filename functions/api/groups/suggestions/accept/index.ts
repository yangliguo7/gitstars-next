import { addReposToGroup, createGroup, readGroups, readModelSettings, readRepos } from '../../../_shared/d1'
import { decryptString } from '../../../_shared/crypto'
import { assignRepositoriesToGroupsWithModel } from '../../../_shared/ai'
import { requireUser } from '../../../_shared/current-user'
import { requireCsrf, readJson } from '../../../_shared/http'
import { fail, ok } from '../../../_shared/response'

interface SuggestionInput {
  name?: string
  reason?: string
  examples?: string[]
}

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const body = await readJson<{ suggestions?: SuggestionInput[] }>(request)
  const suggestions = (body?.suggestions ?? []).filter((item) => item.name?.trim())
  if (!suggestions.length) return fail('VALIDATION_ERROR', 'suggestions are required', 422)

  const [existingGroups, repoResult, model] = await Promise.all([
    readGroups(env as { DB?: D1Database }, user.id),
    readRepos(env as { DB?: D1Database }, user.id, 'all', null, 1, 1000),
    readModelSettings(env as { DB?: D1Database }, user.id),
  ])
  const apiKey = model?.enabled && model?.api_key_encrypted && model?.iv && (env as Env).ENCRYPTION_SECRET
    ? await decryptString(String(model.api_key_encrypted), String(model.iv), (env as Env).ENCRYPTION_SECRET!)
    : null
  if (!apiKey) return fail('MODEL_CONFIG_MISSING', '请先配置大模型，再用 AI 自动落组', 422)

  let aiAssignments: Awaited<ReturnType<typeof assignRepositoriesToGroupsWithModel>> = []
  try {
    aiAssignments = await assignRepositoriesToGroupsWithModel({
      provider: model?.provider_name ? String(model.provider_name) : null,
      baseUrl: model?.base_url ? String(model.base_url) : null,
      apiKey,
      modelName: model?.model_name ? String(model.model_name) : null,
      groups: suggestions.map((item) => ({ name: item.name!.trim(), reason: item.reason?.trim() || '', score: 80 })),
      repositories: repoResult.items.map((repo) => ({
        full_name: repo.full_name,
        description: repo.description,
        language: repo.language,
        summary: repo.summary ? {
          content: String(repo.summary.content ?? ''),
          short_content: String(repo.summary.short_content ?? ''),
          detail_content: String(repo.summary.detail_content ?? ''),
        } : null,
      })),
      timeoutMs: Number((env as Record<string, unknown>).MODEL_REQUEST_TIMEOUT_MS ?? 120000),
      maxBytes: Number((env as Record<string, unknown>).MODEL_RESPONSE_MAX_BYTES ?? 500000),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 仓库落组失败'
    if (message.includes('429')) return fail('RATE_LIMITED', '模型服务限流，分组尚未入库，请稍后再试', 429)
    return fail('MODEL_REQUEST_FAILED', message, 422)
  }
  if (!aiAssignments.length) return fail('MODEL_REQUEST_FAILED', 'AI 没有返回仓库落组结果，分组尚未入库', 422)


  const existingByName = new Map(existingGroups.map((group) => [String(group.name).toLowerCase(), group as Record<string, unknown>]))
  const createdGroups: unknown[] = []
  let assignedCount = 0
  const savedGroups = new Map<string, Record<string, unknown>>()
  for (const suggestion of suggestions) {
    const name = suggestion.name!.trim()
    const description = suggestion.reason?.trim() || `${name} repositories`
    const existing = existingByName.get(name.toLowerCase())
    const group = existing ?? await createGroup(env as { DB?: D1Database }, user.id, { name, description, color: 'blue', icon: 'folder' })
    existingByName.set(name.toLowerCase(), group as Record<string, unknown>)
    savedGroups.set(name, group as Record<string, unknown>)
    if (!existing) createdGroups.push(group)
  }

  const reposByName = new Map(repoResult.items.map((repo) => [String(repo.full_name).toLowerCase(), String(repo.id)]))
  const aiAssignedRepoIds = new Set<string>()
  for (const assignment of aiAssignments) {
    const repositoryId = reposByName.get(assignment.full_name.toLowerCase())
    if (!repositoryId) continue
    aiAssignedRepoIds.add(repositoryId)
    for (const groupName of assignment.groups) {
      const group = savedGroups.get(groupName)
      if (!group) continue
      assignedCount += (await addReposToGroup(env as { DB?: D1Database }, user.id, String(group.id), [repositoryId])).length
    }
  }

  // AI 必须覆盖所有仓库；若模型漏掉少量仓库，用候选语义兜底，避免生成后仍大量未分组。
  for (const suggestion of suggestions) {
    const group = savedGroups.get(suggestion.name!.trim())
    if (!group) continue
    const fallbackIds = matchRepositoriesForSuggestion(repoResult.items, suggestion).filter((id) => !aiAssignedRepoIds.has(id))
    assignedCount += (await addReposToGroup(env as { DB?: D1Database }, user.id, String(group.id), fallbackIds)).length
  }

  return ok({ groups: createdGroups, assigned_count: assignedCount, ai_assigned_count: aiAssignments.length }, { status: 201 })
}

function matchRepositoriesForSuggestion(repos: Array<Record<string, unknown>>, suggestion: SuggestionInput) {
  const exampleSet = new Set((suggestion.examples ?? []).map((item) => item.toLowerCase()))
  const keywords = extractKeywords(`${suggestion.name ?? ''} ${suggestion.reason ?? ''}`)
  const matches = repos.filter((repo) => {
    const fullName = String(repo.full_name ?? '').toLowerCase()
    if (exampleSet.has(fullName)) return true
    const summary = repo.summary as { content?: unknown; short_content?: unknown; detail_content?: unknown } | undefined
    const haystack = [
      repo.full_name,
      repo.description,
      repo.language,
      summary?.short_content,
      summary?.detail_content,
      summary?.content,
    ].filter(Boolean).join(' ').toLowerCase()
    return keywords.some((keyword) => haystack.includes(keyword))
  })
  return matches.map((repo) => String(repo.id)).slice(0, 120)
}

function extractKeywords(value: string) {
  const dictionary: Record<string, string[]> = {
    AI: ['ai', 'llm', 'agent', 'openai', 'claude', 'langchain', '模型', '智能', '大语言'],
    前端: ['frontend', 'react', 'vue', 'ui', 'css', 'component', '前端', '组件'],
    数据: ['data', 'database', 'dbt', 'airflow', 'sql', 'etl', '数据'],
    系统: ['system', 'design', 'algorithm', 'learning', '系统', '算法', '学习'],
    开发者: ['dev', 'developer', 'cli', 'terminal', 'ide', 'tool', '开发', '效率'],
    网络: ['network', 'proxy', 'server', 'monitor', 'security', 'web', '网络', '安全'],
    多媒体: ['video', 'audio', 'image', 'media', 'pdf', '媒体', '图像', '视频', '音频'],
    文档: ['doc', 'pdf', 'office', 'form', '文档', '办公'],
    爬虫: ['scrap', 'crawl', 'spider', 'download', 'crawler', '爬虫', '抓取'],
    后端: ['backend', 'api', 'server', 'fastapi', 'node', '后端'],
  }
  const lowered = value.toLowerCase()
  const keywords = new Set<string>()
  for (const [signal, words] of Object.entries(dictionary)) {
    if (lowered.includes(signal.toLowerCase()) || words.some((word) => lowered.includes(word))) {
      words.forEach((word) => keywords.add(word))
    }
  }
  value.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((word) => word.length >= 3).forEach((word) => keywords.add(word))
  return [...keywords].slice(0, 24)
}
