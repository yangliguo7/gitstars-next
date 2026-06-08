import { decryptString } from '../../_shared/crypto'
import { readModelSettings, readRepos } from '../../_shared/d1'
import { generateGroupSuggestionsWithModel, reviewGroupSuggestionsWithModel } from '../../_shared/ai'
import { requireUser } from '../../_shared/current-user'
import { fail, ok } from '../../_shared/response'

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const model = await readModelSettings(env as { DB?: D1Database }, user.id)
  const apiKey = model?.enabled && model?.api_key_encrypted && model?.iv && (env as Env).ENCRYPTION_SECRET
    ? await decryptString(String(model.api_key_encrypted), String(model.iv), (env as Env).ENCRYPTION_SECRET!)
    : null
  if (!apiKey) return fail('MODEL_CONFIG_MISSING', '请先配置大模型，再生成 AI 分组建议', 422)

  const repos = await readRepos(env as { DB?: D1Database }, user.id, 'all', null, 1, 1000)
  if (!repos.items.length) return ok({ suggestions: [] })

  try {
    const suggestions = await generateGroupSuggestionsWithModel({
      provider: model?.provider_name ? String(model.provider_name) : null,
      baseUrl: model?.base_url ? String(model.base_url) : null,
      apiKey,
      modelName: model?.model_name ? String(model.model_name) : null,
      repositories: repos.items.map((repo) => ({
        full_name: repo.full_name,
        description: repo.description,
        language: repo.language,
        summary: repo.summary ? {
          content: String(repo.summary.content ?? ''),
          short_content: String(repo.summary.short_content ?? ''),
          detail_content: String(repo.summary.detail_content ?? ''),
        } : null,
      })),
      timeoutMs: Number((env as Record<string, unknown>).MODEL_REQUEST_TIMEOUT_MS ?? 60000),
      maxBytes: Number((env as Record<string, unknown>).MODEL_RESPONSE_MAX_BYTES ?? 200000),
    })
    if (!suggestions.length) return fail('MODEL_REQUEST_FAILED', '模型没有返回可用中文分组，请重试或检查模型输出', 422)
    const reviewed = await reviewGroupSuggestionsWithModel({
      provider: model?.provider_name ? String(model.provider_name) : null,
      baseUrl: model?.base_url ? String(model.base_url) : null,
      apiKey,
      modelName: model?.model_name ? String(model.model_name) : null,
      repositories: repos.items.map((repo) => ({
        full_name: repo.full_name,
        description: repo.description,
        language: repo.language,
        summary: repo.summary ? {
          content: String(repo.summary.content ?? ''),
          short_content: String(repo.summary.short_content ?? ''),
          detail_content: String(repo.summary.detail_content ?? ''),
        } : null,
      })),
      groups: suggestions,
      timeoutMs: Number((env as Record<string, unknown>).MODEL_REQUEST_TIMEOUT_MS ?? 60000),
      maxBytes: Number((env as Record<string, unknown>).MODEL_RESPONSE_MAX_BYTES ?? 200000),
    })
    return ok({ suggestions: reviewed.groups, review: { approved: true, issues: [] } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 分组生成失败'
    if (message.includes('429')) return fail('RATE_LIMITED', '模型服务限流，请稍后再试', 429)
    return fail('MODEL_REQUEST_FAILED', message, 422)
  }
}
