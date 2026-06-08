import { autoAssignRepositoriesToGroupsWithModel } from '../../_shared/ai'
import { decryptString } from '../../_shared/crypto'
import { addReposToGroup, createGroup, readGroups, readModelSettings, readRepos } from '../../_shared/d1'
import { requireUser } from '../../_shared/current-user'
import { readJson, requireCsrf } from '../../_shared/http'
import { fail, ok } from '../../_shared/response'

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const body = await readJson<{ create_missing?: boolean }>(request).catch(() => null)
  const createMissing = Boolean(body?.create_missing)

  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError

  const [existingGroups, repoResult, model] = await Promise.all([
    readGroups(env as { DB?: D1Database }, user.id),
    readRepos(env as { DB?: D1Database }, user.id, 'all', null, 1, 1000),
    readModelSettings(env as { DB?: D1Database }, user.id),
  ])
  const repos = repoResult.items.filter((repo) => repo.groups.length === 0)
  if (!repos.length) return ok({ assigned_count: 0, created_groups: [], considered_count: 0 })

  const apiKey = model?.enabled && model?.api_key_encrypted && model?.iv && (env as Env).ENCRYPTION_SECRET
    ? await decryptString(String(model.api_key_encrypted), String(model.iv), (env as Env).ENCRYPTION_SECRET!)
    : null
  if (!apiKey) return fail('MODEL_CONFIG_MISSING', '请先配置大模型，再自动落组', 422)

  let plan: Awaited<ReturnType<typeof autoAssignRepositoriesToGroupsWithModel>>
  try {
    plan = await autoAssignRepositoriesToGroupsWithModel({
      provider: model?.provider_name ? String(model.provider_name) : null,
      baseUrl: model?.base_url ? String(model.base_url) : null,
      apiKey,
      modelName: model?.model_name ? String(model.model_name) : null,
      groups: existingGroups.map((group) => ({
        name: String((group as Record<string, unknown>).name),
        reason: String((group as Record<string, unknown>).description ?? ''),
        score: 90,
      })),
      repositories: repos.map((repo) => ({
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
    const message = error instanceof Error ? error.message : 'AI 自动落组失败'
    if (message.includes('429')) return fail('RATE_LIMITED', '模型服务限流，请稍后再试', 429)
    return fail('MODEL_REQUEST_FAILED', message, 422)
  }

  if (!plan.assignments.length) return fail('MODEL_REQUEST_FAILED', 'AI 没有返回自动落组结果', 422)

  const existingByName = new Map(existingGroups.map((group) => [String((group as Record<string, unknown>).name).toLowerCase(), group as Record<string, unknown>]))
  const usedGroupNames = new Set(plan.assignments.flatMap((assignment) => assignment.groups))
  const proposedGroups = plan.new_groups
    .filter((group) => usedGroupNames.has(group.name) && !existingByName.has(group.name.toLowerCase()))
  if (proposedGroups.length && !createMissing) {
    return ok({
      assigned_count: 0,
      created_groups: [],
      proposed_groups: proposedGroups,
      considered_count: repos.length,
      needs_confirmation: true,
    })
  }
  const savedGroups = new Map<string, Record<string, unknown>>()
  const createdGroups: unknown[] = []

  for (const group of existingGroups) {
    savedGroups.set(String((group as Record<string, unknown>).name), group as Record<string, unknown>)
  }

  for (const suggestion of plan.new_groups) {
    const name = suggestion.name.trim()
    if (!usedGroupNames.has(name)) continue
    const existing = existingByName.get(name.toLowerCase())
    if (existing) {
      savedGroups.set(name, existing)
      continue
    }
    const created = await createGroup(env as { DB?: D1Database }, user.id, { name, description: suggestion.reason, color: 'blue', icon: 'folder' })
    existingByName.set(name.toLowerCase(), created as Record<string, unknown>)
    savedGroups.set(name, created as Record<string, unknown>)
    createdGroups.push(created)
  }

  const reposByName = new Map(repos.map((repo) => [String(repo.full_name).toLowerCase(), String(repo.id)]))
  let assignedCount = 0
  for (const assignment of plan.assignments) {
    const repositoryId = reposByName.get(assignment.full_name.toLowerCase())
    if (!repositoryId) continue
    for (const groupName of assignment.groups) {
      const group = savedGroups.get(groupName)
      if (!group) continue
      assignedCount += (await addReposToGroup(env as { DB?: D1Database }, user.id, String(group.id), [repositoryId])).length
    }
  }

  return ok({ assigned_count: assignedCount, created_groups: createdGroups, considered_count: repos.length }, { status: 201 })
}
