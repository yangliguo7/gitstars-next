import { validateModelBaseUrl } from './ssrf'

export interface SummaryModelResult {
  summary: string
  confidence: number
  keywords: string[]
  risk_flags: string[]
}

export interface DualSummaryResult {
  short: string
  detail: string
  confidence: number
  keywords: string[]
  risk_flags: string[]
}

export interface GroupSuggestionResult {
  name: string
  reason: string
  score: number
  repo_count_estimate?: number
  examples?: string[]
}

export interface RepoGroupAssignmentResult {
  full_name: string
  groups: string[]
}

export interface GroupPlanReviewResult {
  approved: boolean
  issues: string[]
  groups: GroupSuggestionResult[]
}

export interface AssignmentReviewResult {
  approved: boolean
  issues: string[]
  assignments: RepoGroupAssignmentResult[]
}

export interface AutoGroupAssignmentPlan {
  new_groups: GroupSuggestionResult[]
  assignments: RepoGroupAssignmentResult[]
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_BYTES = 200_000

export function fallbackSummary(input: { full_name?: string; description?: string | null; language?: string | null }) {
  const name = input.full_name ?? '这个仓库'
  const language = input.language ? `${input.language} 项目` : '开源项目'
  const description = input.description?.trim() || '暂无 GitHub 描述'
  return `${name} 是一个 ${language}。${description}。适合先放入待确认分组，再按实际用途补充备注。`
}

export function fallbackDualSummary(input: { full_name?: string; description?: string | null; language?: string | null }) {
  const detail = fallbackSummary(input)
  const name = input.full_name ?? '这个仓库'
  const language = input.language ? `${input.language} 项目` : '开源项目'
  const short = `${name} 是一个${language}，用途需结合 README 或人工备注进一步确认。`.slice(0, 120)
  return { short, detail, confidence: 0.35, keywords: [], risk_flags: ['fallback'] }
}

export type ModelProvider = 'openai-compatible' | 'anthropic'

export async function generateSummaryWithModel(input: SummaryInput) {
  return (await generateRepositorySummaryWithModel(input)).detail
}

export async function generateRepositorySummaryWithModel(input: SummaryInput): Promise<DualSummaryResult> {
  if (!input.baseUrl || !input.apiKey || !input.modelName) return fallbackDualSummary(input.repository)
  const urlError = validateModelBaseUrl(input.baseUrl)
  if (urlError) throw new Error(urlError)

  const fetcher = input.fetcher ?? fetch
  const first = await requestSummaryJson(input, fetcher)
  const parsed = parseDualSummaryResult(first) ?? parsePlainSummaryResult(first)
  if (parsed) return parsed

  const retried = await requestSummaryJson({ ...input, retry: true }, fetcher)
  return parseDualSummaryResult(retried) ?? parsePlainSummaryResult(retried) ?? fallbackDualSummary(input.repository)
}

export async function testModelConnection(input: Omit<SummaryInput, 'repository'> & { fetcher?: typeof fetch }) {
  if (!input.baseUrl || !input.apiKey || !input.modelName) throw new Error('baseUrl, modelName and apiKey are required')
  const urlError = validateModelBaseUrl(input.baseUrl)
  if (urlError) throw new Error(urlError)
  const started = Date.now()
  const fetcher = input.fetcher ?? fetch
  const content = await requestModelContent({
    ...input,
    repository: { full_name: 'gitstars/test', description: 'connection check', language: 'TypeScript' },
    test: true,
    timeoutMs: input.timeoutMs ?? 15_000,
    maxBytes: input.maxBytes ?? 20_000,
  }, fetcher)
  if (!content.trim()) throw new Error('invalid_response')
  return { latency_ms: Date.now() - started }
}

export async function generateGroupSuggestionsWithModel(input: Omit<SummaryInput, 'repository'> & {
  repositories: Array<{
    full_name?: string
    description?: string | null
    language?: string | null
    summary?: { content?: string; short_content?: string; detail_content?: string } | null
  }>
  fetcher?: typeof fetch
}) {
  if (!input.baseUrl || !input.apiKey || !input.modelName) throw new Error('MODEL_CONFIG_MISSING')
  const urlError = validateModelBaseUrl(input.baseUrl)
  if (urlError) throw new Error(urlError)
  const fetcher = input.fetcher ?? fetch
  const context = buildGroupSuggestionContext(input.repositories)
  const system = '你是 GitStars 的开源项目分类架构师。必须只返回 JSON，不要 Markdown，不要解释。格式：{"groups":[{"name":"中文分组名","reason":"中文边界说明","score":90,"repo_count_estimate":12,"examples":["owner/repo"]}]}。任务：为用户长期管理 GitHub Star 生成一版最终可保存的中文分组体系。分类原则：1) 按“用途/使用场景”优先，其次按技术栈，不按语言名分组；2) 输出 7-10 个分组；3) 每组目标覆盖 4-60 个仓库；4) 单组不要超过全部仓库的 28%；5) 禁止过宽名称：开发工具、效率工具、开源项目、工具集合、其他、杂项、未分类；6) 禁止过窄名称：单个库、单个框架、单一产品；7) 相邻分组必须有清晰边界，reason 说明“包含什么/不包含什么”；8) name 必须中文，4-8 个汉字，不要英文混杂；9) examples 给 2-4 个代表仓库；10) 输出前自检并直接修正：重叠则合并或改名，过宽则拆，过窄则并入相邻组。'
  const user = `请根据下面 GitHub Star 数据生成最终中文分组体系。仓库名列表接近全量，样本摘要用于理解主题。只返回最终分组，不要输出审核意见、问题列表或过程。\n\n${context}`
  const raw = await requestCustomModelContent(input, fetcher, system, user, 4096)
  const parsed = parseGroupSuggestions(raw)
  if (parsed.length) return parsed

  const compact = buildCompactGroupSuggestionContext(input.repositories)
  const retried = await requestCustomModelContent(input, fetcher, system, `上次没有返回可解析分组。不要输出思考过程，只返回 JSON，生成 7-10 个边界清晰的最终中文候选分组。\n\n${compact}`, 4096)
  return parseGroupSuggestions(retried)
}


export async function assignRepositoriesToGroupsWithModel(input: Omit<SummaryInput, 'repository'> & {
  repositories: Array<{
    full_name?: string
    description?: string | null
    language?: string | null
    summary?: { content?: string; short_content?: string; detail_content?: string } | null
  }>
  groups: GroupSuggestionResult[]
  fetcher?: typeof fetch
}) {
  if (!input.baseUrl || !input.apiKey || !input.modelName) throw new Error('MODEL_CONFIG_MISSING')
  const urlError = validateModelBaseUrl(input.baseUrl)
  if (urlError) throw new Error(urlError)
  const fetcher = input.fetcher ?? fetch
  const system = '你是 GitStars 的仓库分组专家。必须只返回 JSON，不要 Markdown，不要解释。格式：{"assignments":[{"full_name":"owner/repo","groups":["中文分组名"]}]}。任务：把每个 GitHub Star 仓库分配到用户已确认的分组。规则：1) 每个仓库至少分到 1 个最相关分组；2) 最多 2 个分组；3) groups 必须来自给定分组名，不能新建；4) 不确定时选最接近用途的分组；5) 不要输出未分组/其他。'
  const groupLines = input.groups.map((group, index) => `${index + 1}. ${group.name}: ${group.reason}`).join('\n')
  const assignments: RepoGroupAssignmentResult[] = []
  const chunks = chunkArray(input.repositories, 320)
  for (const chunk of chunks) {
    const repoLines = chunk.map((repo, index) => {
      const summary = repo.summary?.short_content || repo.summary?.detail_content || repo.summary?.content || repo.description || ''
      return `${index + 1}. ${repo.full_name || 'unknown'} | ${repo.language || 'Unknown'} | ${String(summary).replace(/\s+/g, ' ').slice(0, 70)}`
    }).join('\n')
    const raw = await requestCustomModelContent(input, fetcher, system, `已确认分组：\n${groupLines}\n\n待分配仓库：\n${repoLines}`, 8192)
    assignments.push(...parseRepoGroupAssignments(raw, input.groups.map((group) => group.name)))
  }
  return assignments
}

export async function autoAssignRepositoriesToGroupsWithModel(input: Omit<SummaryInput, 'repository'> & {
  repositories: Array<{
    full_name?: string
    description?: string | null
    language?: string | null
    summary?: { content?: string; short_content?: string; detail_content?: string } | null
  }>
  groups: GroupSuggestionResult[]
  fetcher?: typeof fetch
}): Promise<AutoGroupAssignmentPlan> {
  if (!input.baseUrl || !input.apiKey || !input.modelName) throw new Error('MODEL_CONFIG_MISSING')
  const urlError = validateModelBaseUrl(input.baseUrl)
  if (urlError) throw new Error(urlError)
  const fetcher = input.fetcher ?? fetch
  const system = '你是 GitStars 的自动分组专家。必须只返回 JSON，不要 Markdown，不要解释。格式：{"new_groups":[{"name":"中文分组名","reason":"中文原因","score":90}],"assignments":[{"full_name":"owner/repo","groups":["中文分组名"]}]}。任务：把新同步且未分组的 GitHub Star 仓库落入已有分组；只有没有合适已有分组时，才创建新的中文分组。规则：1) 每个仓库至少 1 个组，最多 2 个组；2) 优先使用已有分组；3) 新分组必须中文、表达用途或技术方向，不要“其他/杂项/未分类”；4) assignments.groups 只能使用已有分组名或 new_groups 中的分组名；5) 不确定时创建具体但不过细的新分组。'
  const groupLines = input.groups.length
    ? input.groups.map((group, index) => `${index + 1}. ${group.name}: ${group.reason}`).join('\n')
    : '暂无已有分组'
  const assignments: RepoGroupAssignmentResult[] = []
  const newGroups = new Map<string, GroupSuggestionResult>()
  const chunks = chunkArray(input.repositories, 120)
  for (const chunk of chunks) {
    const repoLines = chunk.map((repo, index) => {
      const summary = repo.summary?.short_content || repo.summary?.detail_content || repo.summary?.content || repo.description || ''
      return `${index + 1}. ${repo.full_name || 'unknown'} | ${repo.language || 'Unknown'} | ${String(summary).replace(/\s+/g, ' ').slice(0, 90)}`
    }).join('\n')
    const raw = await requestCustomModelContent(input, fetcher, system, `已有分组：\n${groupLines}\n\n待自动落组仓库：\n${repoLines}`, 8192)
    const parsed = parseAutoGroupAssignmentPlan(raw, input.groups.map((group) => group.name))
    parsed.new_groups.forEach((group) => newGroups.set(group.name, group))
    assignments.push(...parsed.assignments)
  }
  return { new_groups: [...newGroups.values()], assignments }
}


export async function reviewGroupSuggestionsWithModel(input: Omit<SummaryInput, 'repository'> & {
  repositories: Array<{ full_name?: string; description?: string | null; language?: string | null; summary?: { content?: string; short_content?: string; detail_content?: string } | null }>
  groups: GroupSuggestionResult[]
  fetcher?: typeof fetch
}): Promise<GroupPlanReviewResult> {
  if (!input.baseUrl || !input.apiKey || !input.modelName) throw new Error('MODEL_CONFIG_MISSING')
  const urlError = validateModelBaseUrl(input.baseUrl)
  if (urlError) throw new Error(urlError)
  const fetcher = input.fetcher ?? fetch
  const system = '你是 GitStars 分组方案终审专家。只返回 JSON：{"approved":true,"issues":[],"groups":[{"name":"中文名","reason":"中文边界说明","score":90,"repo_count_estimate":12,"examples":["owner/repo"]}]}。不要把问题留给用户，必须直接产出修正后的最终分组。终审规则：1) 保留 7-10 个组；2) 合并重叠组；3) 拆分过宽组；4) 过窄组并入相邻用途组；5) 分组名 4-8 个中文汉字；6) reason 必须说明边界，避免泛泛而谈；7) 禁止其他/杂项/未分类/开发工具/效率工具这类宽泛名称。issues 必须返回空数组。'
  const context = buildCompactGroupSuggestionContext(input.repositories)
  const groupJson = JSON.stringify(input.groups)
  const raw = await requestCustomModelContent(input, fetcher, system, `Star 数据：\n${context}\n\n待审核分组：\n${groupJson}`, 4096)
  const parsed = parseGroupPlanReview(raw)
  return parsed.groups.length ? parsed : { approved: true, issues: [], groups: input.groups }
}

export async function reviewRepoGroupAssignmentsWithModel(input: Omit<SummaryInput, 'repository'> & {
  repositories: Array<{ full_name?: string; description?: string | null; language?: string | null; summary?: { content?: string; short_content?: string; detail_content?: string } | null }>
  groups: GroupSuggestionResult[]
  assignments: RepoGroupAssignmentResult[]
  fetcher?: typeof fetch
}): Promise<AssignmentReviewResult> {
  if (!input.baseUrl || !input.apiKey || !input.modelName) throw new Error('MODEL_CONFIG_MISSING')
  const urlError = validateModelBaseUrl(input.baseUrl)
  if (urlError) throw new Error(urlError)
  const fetcher = input.fetcher ?? fetch
  const system = '你是 GitStars 仓库落组审核专家。只返回 JSON：{"approved":true,"issues":[],"assignments":[{"full_name":"owner/repo","groups":["中文分组名"]}]}。审核并修正仓库落组：每个仓库至少 1 个组、最多 2 个组；groups 必须来自给定分组名；修正明显错分；补齐漏分；不要未分组/其他。'
  const groupLines = input.groups.map((group) => `${group.name}: ${group.reason}`).join('\n')
  const repoNames = input.repositories.map((repo) => repo.full_name || 'unknown').join(', ')
  const assignmentsJson = JSON.stringify(input.assignments)
  const raw = await requestCustomModelContent(input, fetcher, system, `可用分组：\n${groupLines}\n\n全部仓库名：\n${repoNames}\n\n待审核落组：\n${assignmentsJson}`, 8192)
  const parsed = parseAssignmentReview(raw, input.groups.map((group) => group.name))
  return parsed.assignments.length ? parsed : { approved: true, issues: [], assignments: input.assignments }
}

function buildGroupSuggestionContext(repositories: Array<{
  full_name?: string
  description?: string | null
  language?: string | null
  summary?: { content?: string; short_content?: string; detail_content?: string } | null
}>) {
  const languageCounts = new Map<string, number>()
  repositories.forEach((repo) => {
    const language = repo.language || 'Unknown'
    languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1)
  })
  const languages = [...languageCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([language, count]) => `${language}:${count}`)
    .join(', ')
  const allNames = repositories
    .map((repo) => repo.full_name || 'unknown')
    .slice(0, 300)
    .join(', ')
  const samples = balancedRepoSamples(repositories, 60).map((repo, index) => {
    const summary = repo.summary?.short_content || repo.summary?.detail_content || repo.summary?.content || repo.description || ''
    return `${index + 1}. ${repo.full_name || 'unknown'} | ${repo.language || 'Unknown'} | ${String(summary).replace(/\s+/g, ' ').slice(0, 60)}`
  }).join('\n')
  return `总数：${repositories.length}\n语言分布：${languages}\n全量仓库名：${allNames}\n代表样本：\n${samples}`
}

function buildCompactGroupSuggestionContext(repositories: Array<{
  full_name?: string
  description?: string | null
  language?: string | null
  summary?: { content?: string; short_content?: string; detail_content?: string } | null
}>) {
  const names = repositories.map((repo) => repo.full_name || 'unknown').slice(0, 300).join(', ')
  const samples = balancedRepoSamples(repositories, 35).map((repo) => {
    const summary = repo.summary?.short_content || repo.summary?.content || repo.description || ''
    return `${repo.full_name || 'unknown'}(${repo.language || 'Unknown'}): ${String(summary).replace(/\s+/g, ' ').slice(0, 45)}`
  }).join('\n')
  return `总数：${repositories.length}\n仓库名：${names}\n样本：\n${samples}`
}

function balancedRepoSamples<T extends { language?: string | null; summary?: { content?: string; short_content?: string; detail_content?: string } | null; description?: string | null }>(repositories: T[], limit: number) {
  const buckets = new Map<string, T[]>()
  repositories.forEach((repo) => {
    const language = repo.language || 'Unknown'
    const bucket = buckets.get(language) ?? []
    bucket.push(repo)
    buckets.set(language, bucket)
  })
  const sortedBuckets = [...buckets.values()].sort((a, b) => b.length - a.length)
  const selected: T[] = []
  let round = 0
  while (selected.length < limit) {
    let added = false
    for (const bucket of sortedBuckets) {
      const repo = bucket[round]
      if (repo) {
        selected.push(repo)
        added = true
        if (selected.length >= limit) break
      }
    }
    if (!added) break
    round += 1
  }
  return selected.sort((a, b) => repoContextScore(b) - repoContextScore(a)).slice(0, limit)
}

function repoContextScore(repo: { summary?: { content?: string; short_content?: string; detail_content?: string } | null; description?: string | null }) {
  const summary = repo.summary?.short_content || repo.summary?.detail_content || repo.summary?.content || ''
  return (summary ? 2 : 0) + (repo.description ? 1 : 0)
}

interface SummaryInput {
  baseUrl?: string | null
  apiKey?: string | null
  modelName?: string | null
  provider?: string | null
  repository: { full_name?: string; description?: string | null; language?: string | null }
  fetcher?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
}

async function requestSummaryJson(input: SummaryInput & { retry?: boolean }, fetcher: typeof fetch) {
  return requestModelContent(input, fetcher)
}

async function requestModelContent(input: SummaryInput & { retry?: boolean; test?: boolean }, fetcher: typeof fetch) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('model request timeout'), timeoutMs)
  try {
    const provider = detectProvider(input)
    const response = provider === 'anthropic'
      ? await requestAnthropicContent(input, fetcher, controller.signal)
      : await requestOpenAiContent(input, fetcher, controller.signal)
    if (!response.ok) throw new Error(`model request failed: ${response.status}`)
    const body = await readBoundedText(response, input.maxBytes ?? DEFAULT_MAX_BYTES)
    return provider === 'anthropic' ? parseAnthropicContent(body) : parseOpenAiContent(body)
  } finally {
    clearTimeout(timer)
  }
}

function detectProvider(input: SummaryInput): ModelProvider {
  if (input.provider === 'anthropic') return 'anthropic'
  return input.baseUrl?.includes('/anthropic') ? 'anthropic' : 'openai-compatible'
}

function modelMessages(input: SummaryInput & { retry?: boolean; test?: boolean }) {
  return input.test ? [
    { role: 'user', content: 'Connection test. Reply OK.' },
  ] : [
    {
      role: 'system',
      content: '你是 GitStars 的开源项目分析助手。必须只返回 JSON 对象，不要 Markdown，不要解释：{"short":"...","detail":"...","confidence":0.0,"keywords":[],"risk_flags":[]}。short 必须是中文一句话，50 字以内，直接说明仓库是干什么的，适合放在卡片上一眼看懂。detail 必须是中文 3-5 句，说明用途、适合人群、核心能力、可如何分组。只能基于仓库名称、描述、语言等输入信息，不要编造事实，不要使用 emoji。',
    },
    {
      role: 'user',
      content: `${input.retry ? '上次返回不是合法 JSON，请重试。' : ''}请为这个 GitHub Star 仓库生成中文简短摘要和详细摘要：${JSON.stringify(input.repository)}`,
    },
  ]
}

async function requestOpenAiContent(input: SummaryInput & { retry?: boolean; test?: boolean }, fetcher: typeof fetch, signal: AbortSignal) {
  return fetcher(`${input.baseUrl!.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'api-key': input.apiKey!,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: input.modelName,
      messages: input.test ? [
        { role: 'system', content: 'Return plain text OK only.' },
        { role: 'user', content: 'Connection test. Reply OK.' },
      ] : modelMessages(input),
      response_format: input.test ? undefined : { type: 'json_object' },
      max_completion_tokens: input.test ? 32 : 480,
      max_tokens: input.test ? 64 : 1600,
      thinking: { type: 'disabled' },
      stream: false,
    }),
  })
}

async function requestAnthropicContent(input: SummaryInput & { retry?: boolean; test?: boolean }, fetcher: typeof fetch, signal: AbortSignal) {
  const messages = modelMessages(input)
  const system = messages.find((message) => message.role === 'system')?.content
  const userMessages = messages.filter((message) => message.role !== 'system')
  return fetcher(`${input.baseUrl!.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    signal,
    headers: {
      'x-api-key': input.apiKey!,
      authorization: `Bearer ${input.apiKey}`,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: input.modelName,
      system,
      messages: userMessages,
      max_tokens: input.test ? 64 : 1600,
      thinking: { type: 'disabled' },
      stream: false,
    }),
  })
}

async function requestCustomModelContent(input: Omit<SummaryInput, 'repository'>, fetcher: typeof fetch, system: string, user: string, maxTokens: number) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('model request timeout'), timeoutMs)
  try {
    const provider = detectProvider({ ...input, repository: {} })
    const response = provider === 'anthropic'
      ? await fetcher(`${input.baseUrl!.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'x-api-key': input.apiKey!,
          authorization: `Bearer ${input.apiKey}`,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: input.modelName,
          system,
          messages: [{ role: 'user', content: user }],
          max_tokens: maxTokens,
          thinking: { type: 'disabled' },
          stream: false,
        }),
      })
      : await fetcher(`${input.baseUrl!.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          'api-key': input.apiKey!,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: input.modelName,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_object' },
          max_tokens: maxTokens,
          max_completion_tokens: maxTokens,
          stream: false,
        }),
      })
    if (!response.ok) throw new Error(`model request failed: ${response.status}`)
    const body = await readBoundedText(response, input.maxBytes ?? DEFAULT_MAX_BYTES)
    return parseModelResponseContent(body, provider)
  } finally {
    clearTimeout(timer)
  }
}

function parseOpenAiContent(body: string) {
  return parseModelResponseContent(body, 'openai-compatible')
}

function parseAnthropicContent(body: string) {
  return parseModelResponseContent(body, 'anthropic')
}

function parseModelResponseContent(body: string, provider: ModelProvider) {
  const text = body.trim()
  if (!text) return ''
  const sse = parseSseContent(text, provider)
  if (sse) return sse
  try {
    const json = JSON.parse(text) as Record<string, unknown>
    return normalizeResponseJson(json, provider)
  } catch {
    return text
  }
}

function normalizeResponseJson(json: Record<string, unknown>, provider: ModelProvider) {
  const direct = normalizeModelContent(json.content)
    || normalizeModelContent(json.output_text)
    || normalizeModelContent(json.completion)
    || normalizeModelContent(json.text)
  if (direct) return direct

  const choices = json.choices
  if (Array.isArray(choices)) {
    const content = choices.map((choice) => {
      const item = choice as { message?: { content?: unknown }; delta?: { content?: unknown }; text?: unknown }
      return normalizeModelContent(item.message?.content) || normalizeModelContent(item.delta?.content) || normalizeModelContent(item.text)
    }).join('').trim()
    if (content) return content
  }

  const output = json.output
  if (Array.isArray(output)) {
    const content = output.map((item) => {
      const block = item as { content?: unknown; text?: unknown }
      return normalizeModelContent(block.content) || normalizeModelContent(block.text)
    }).join('').trim()
    if (content) return content
  }

  const message = json.message
  if (message && typeof message === 'object') {
    const content = normalizeModelContent((message as { content?: unknown }).content)
    if (content) return content
  }

  return provider === 'anthropic' ? normalizeModelContent(json.content) : ''
}

function parseSseContent(text: string, provider: ModelProvider) {
  if (!text.includes('data:')) return ''
  return text.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return []
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') return []
    try {
      return [normalizeResponseJson(JSON.parse(payload) as Record<string, unknown>, provider)]
    } catch {
      return []
    }
  }).join('').trim()
}

function normalizeModelContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (typeof content === 'number' && Number.isFinite(content)) return String(content)
  if (Array.isArray(content)) return content.map((part) => normalizeModelContent(part)).join('').trim()
  if (content && typeof content === 'object') {
    const object = content as Record<string, unknown>
    return normalizeModelContent(object.text)
      || normalizeModelContent(object.content)
      || normalizeModelContent(object.output_text)
      || normalizeModelContent(object.value)
      || normalizeModelContent(object.data)
  }
  return ''
}

async function readBoundedText(response: Response, maxBytes: number) {
  const reader = response.body?.getReader()
  if (!reader) return response.text()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) throw new Error('model response too large')
    chunks.push(value)
  }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

function parsePlainSummaryResult(raw: string): DualSummaryResult | null {
  const detail = raw.trim().replace(/^```(?:json)?|```$/g, '').trim()
  if (!detail || detail.length < 8 || /^ok$/i.test(detail) || !hasChinese(detail)) return null
  const firstSentence = detail.split(/[。！？\n]/).find(Boolean)?.trim() || detail
  const short = firstSentence.length > 80 ? `${firstSentence.slice(0, 77)}...` : firstSentence
  return { short, detail: detail.slice(0, 800), confidence: 0.55, keywords: [], risk_flags: ['plain_text_model_response'] }
}

export function parseSummaryResult(raw: string): SummaryModelResult | null {
  const parsed = parseDualSummaryResult(raw)
  if (!parsed) return null
  return { summary: parsed.detail, confidence: parsed.confidence, keywords: parsed.keywords, risk_flags: parsed.risk_flags }
}

export function parseDualSummaryResult(raw: string): DualSummaryResult | null {
  try {
    const text = raw.trim()
    const jsonText = text.startsWith('{') ? text : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
    const parsed = JSON.parse(jsonText) as Partial<DualSummaryResult & { summary: string }>
    const detail = typeof parsed.detail === 'string' ? parsed.detail.trim() : typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
    const short = typeof parsed.short === 'string' ? parsed.short.trim() : detail.slice(0, 80)
    if (!detail || !short) return null
    if (!hasChinese(short) || !hasChinese(detail)) return null
    if (short.length > 160 || detail.length > 800) return null
    return {
      short,
      detail,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter((item): item is string => typeof item === 'string').slice(0, 8) : [],
      risk_flags: Array.isArray(parsed.risk_flags) ? parsed.risk_flags.filter((item): item is string => typeof item === 'string').slice(0, 6) : [],
    }
  } catch {
    return null
  }
}



export function parseGroupPlanReview(raw: string): GroupPlanReviewResult {
  try {
    const parsed = JSON.parse(extractJsonPayload(raw)) as Record<string, unknown>
    const groups = parseGroupSuggestions(JSON.stringify({ groups: Array.isArray(parsed.groups) ? parsed.groups : [] }))
    return {
      approved: typeof parsed.approved === 'boolean' ? parsed.approved : groups.length > 0,
      issues: Array.isArray(parsed.issues) ? parsed.issues.filter((item): item is string => typeof item === 'string').slice(0, 12) : [],
      groups,
    }
  } catch {
    return { approved: false, issues: ['审核输出无法解析'], groups: [] }
  }
}

export function parseAssignmentReview(raw: string, allowedGroups: string[]): AssignmentReviewResult {
  try {
    const parsed = JSON.parse(extractJsonPayload(raw)) as Record<string, unknown>
    return {
      approved: typeof parsed.approved === 'boolean' ? parsed.approved : true,
      issues: Array.isArray(parsed.issues) ? parsed.issues.filter((item): item is string => typeof item === 'string').slice(0, 12) : [],
      assignments: parseRepoGroupAssignments(JSON.stringify({ assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [] }), allowedGroups),
    }
  } catch {
    return { approved: false, issues: ['落组审核输出无法解析'], assignments: [] }
  }
}

export function parseRepoGroupAssignments(raw: string, allowedGroups: string[]): RepoGroupAssignmentResult[] {
  try {
    const parsed = JSON.parse(extractJsonPayload(raw)) as unknown
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { assignments?: unknown })?.assignments)
        ? (parsed as { assignments: unknown[] }).assignments
        : Array.isArray((parsed as { repositories?: unknown })?.repositories)
          ? (parsed as { repositories: unknown[] }).repositories
          : []
    const allowed = new Set(allowedGroups)
    const seen = new Set<string>()
    return rows.flatMap((item) => {
      const row = item as Record<string, unknown>
      const fullName = firstString(row, ['full_name', 'fullName', 'repo', 'repository', 'name']).trim()
      const groups = firstArray(row, ['groups', 'group_names', 'groupNames', 'categories'])
        .map((value) => typeof value === 'string' ? value.trim() : firstString(value as Record<string, unknown>, ['name']))
        .filter((name) => allowed.has(name))
        .slice(0, 2)
      if (!fullName || !fullName.includes('/') || !groups.length || seen.has(fullName.toLowerCase())) return []
      seen.add(fullName.toLowerCase())
      return [{ full_name: fullName, groups }]
    })
  } catch {
    return []
  }
}

export function parseAutoGroupAssignmentPlan(raw: string, existingGroups: string[]): AutoGroupAssignmentPlan {
  try {
    const parsed = JSON.parse(extractJsonPayload(raw)) as Record<string, unknown>
    const newGroups = parseGroupSuggestions(JSON.stringify({ groups: Array.isArray(parsed.new_groups) ? parsed.new_groups : [] }))
    const knownGroups = new Set([...existingGroups, ...newGroups.map((group) => group.name)])
    for (const name of readAssignmentGroupNames(parsed)) {
      if (!knownGroups.has(name) && hasChinese(name)) {
        newGroups.push({ name: name.slice(0, 16), reason: 'AI 根据新同步仓库自动创建此分组', score: 70 })
        knownGroups.add(name)
      }
    }
    const allowedGroups = [...existingGroups, ...newGroups.map((group) => group.name)]
    return {
      new_groups: newGroups,
      assignments: parseRepoGroupAssignments(JSON.stringify({ assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [] }), allowedGroups),
    }
  } catch {
    return { new_groups: [], assignments: [] }
  }
}

function readAssignmentGroupNames(parsed: Record<string, unknown>) {
  const rows = Array.isArray(parsed.assignments) ? parsed.assignments : []
  const names = new Set<string>()
  rows.forEach((item) => {
    const row = item as Record<string, unknown>
    firstArray(row, ['groups', 'group_names', 'groupNames', 'categories'])
      .map((value) => typeof value === 'string' ? value.trim() : firstString(value as Record<string, unknown>, ['name']).trim())
      .filter(Boolean)
      .forEach((name) => names.add(name))
  })
  return [...names]
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

export function parseGroupSuggestions(raw: string): GroupSuggestionResult[] {
  try {
    const parsed = JSON.parse(extractJsonPayload(raw)) as unknown
    const groups = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { groups?: unknown })?.groups)
        ? (parsed as { groups: unknown[] }).groups
        : Array.isArray((parsed as { suggestions?: unknown })?.suggestions)
          ? (parsed as { suggestions: unknown[] }).suggestions
          : Array.isArray((parsed as { 分组?: unknown })?.分组)
            ? (parsed as { 分组: unknown[] }).分组
            : Array.isArray((parsed as { 建议?: unknown })?.建议)
              ? (parsed as { 建议: unknown[] }).建议
              : []
    if (!groups.length) return []
    const seen = new Set<string>()
    return groups.flatMap((item) => {
      const group = item as Record<string, unknown>
      const rawName = firstString(group, ['name', 'title', 'group_name', 'groupName', '名称', '分组名']).trim()
      const rawReason = firstString(group, ['reason', 'description', 'rationale', 'why', '原因', '理由', '说明']).trim()
      const name = hasChinese(rawName) ? rawName : hasChinese(rawReason) ? translateCommonGroupName(rawName) : ''
      const reason = hasChinese(rawReason) ? rawReason : 'AI 根据收藏仓库主题、用途和摘要生成此候选分组'
      if (!name || !hasChinese(name) || seen.has(name)) return []
      seen.add(name)
      const score = readNumber(group, ['score', 'confidence', '置信度', '评分'], 70)
      const repoCount = readOptionalNumber(group, ['repo_count_estimate', 'repoCountEstimate', 'repo_count', 'count', '覆盖数量', '仓库数量'])
      const rawExamples = firstArray(group, ['examples', 'example_repos', 'exampleRepos', 'repos', 'repositories', '示例', '代表仓库'])
      const examples = rawExamples.map((value) => typeof value === 'string' ? value : firstString(value as Record<string, unknown>, ['full_name', 'fullName', 'name']))
        .filter((value) => value.includes('/'))
        .slice(0, 4)
      const suggestion: GroupSuggestionResult = {
        name: name.slice(0, 16),
        reason: reason.slice(0, 120),
        score: Math.max(0, Math.min(100, Math.round(score))),
      }
      if (repoCount !== undefined) suggestion.repo_count_estimate = Math.max(0, Math.round(repoCount))
      if (examples.length) suggestion.examples = examples
      return [suggestion]
    }).slice(0, 12)
  } catch {
    return []
  }
}

function extractJsonPayload(raw: string) {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  const starts = [objectStart, arrayStart].filter((index) => index >= 0)
  const start = starts.length ? Math.min(...starts) : -1
  if (start < 0) throw new Error('json payload missing')
  const end = text[start] === '[' ? text.lastIndexOf(']') : text.lastIndexOf('}')
  if (end <= start) throw new Error('json payload incomplete')
  return text.slice(start, end + 1)
}

function firstString(group: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = group[key]
    if (typeof value === 'string') return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function firstArray(group: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = group[key]
    if (Array.isArray(value)) return value
  }
  return []
}

function readNumber(group: Record<string, unknown>, keys: string[], fallback: number) {
  return readOptionalNumber(group, keys) ?? fallback
}

function readOptionalNumber(group: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = group[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const number = Number(value.replace(/%$/, ''))
      if (Number.isFinite(number)) return number
    }
  }
  return undefined
}

function translateCommonGroupName(value: string) {
  const normalized = value.toLowerCase()
  if (!normalized) return ''
  if (normalized.includes('front') || normalized.includes('ui') || normalized.includes('vue') || normalized.includes('react')) return '前端工程'
  if (normalized.includes('ai') || normalized.includes('llm') || normalized.includes('agent') || normalized.includes('model')) return 'AI 工具'
  if (normalized.includes('devops') || normalized.includes('infra') || normalized.includes('cloud') || normalized.includes('deploy')) return '基础设施'
  if (normalized.includes('database') || normalized.includes('data') || normalized.includes('sql')) return '数据存储'
  if (normalized.includes('cli') || normalized.includes('terminal') || normalized.includes('shell')) return '命令行工具'
  if (normalized.includes('productivity') || normalized.includes('developer') || normalized.includes('tool')) return '开发效率'
  if (normalized.includes('backend') || normalized.includes('server') || normalized.includes('api')) return '后端服务'
  if (normalized.includes('mobile') || normalized.includes('ios') || normalized.includes('android')) return '移动开发'
  if (normalized.includes('security') || normalized.includes('auth')) return '安全认证'
  if (normalized.includes('test') || normalized.includes('quality')) return '测试质量'
  return ''
}

function hasChinese(value: string) {
  return /[\u4e00-\u9fff]/.test(value)
}
