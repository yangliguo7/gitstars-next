import { generateRepositorySummaryWithModel } from '../../_shared/ai'
import { requireCsrf, readJson } from '../../_shared/http'
import { fail, ok } from '../../_shared/response'
import { requireUser } from '../../_shared/current-user'
import { decryptString } from '../../_shared/crypto'
import { finishSummaryItem, getSummaryJob, getSummaryJobTarget, readModelSettings, readRepoDetail, saveGeneratedSummary } from '../../_shared/d1'

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const body = await readJson<{ job_id?: string }>(request)
  if (!body?.job_id) return fail('VALIDATION_ERROR', 'job_id is required', 422)

  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError

  const target = await getSummaryJobTarget(env as { DB?: D1Database }, user.id, body.job_id)
  if (!target?.repository_id) {
    const job = await getSummaryJob(env as { DB?: D1Database }, user.id, body.job_id)
    return ok({ job })
  }

  const repositoryId = target.repository_id
  try {
    const repo = await readRepoDetail(env as { DB?: D1Database }, user.id, repositoryId)
    if (!repo) throw new Error('repository not found')

    const model = await readModelSettings(env as { DB?: D1Database }, user.id)
    const modelEnabled = Boolean(model?.enabled)
    const apiKey = modelEnabled && model?.api_key_encrypted && model?.iv && (env as Env).ENCRYPTION_SECRET
      ? await decryptString(String(model.api_key_encrypted), String(model.iv), (env as Env).ENCRYPTION_SECRET!)
      : null

    if (!apiKey) throw new Error('MODEL_CONFIG_MISSING: 请先配置大模型')
    const generated = await generateRepositorySummaryWithModel({
      provider: model?.provider_name ? String(model.provider_name) : null,
      baseUrl: model?.base_url ? String(model.base_url) : null,
      apiKey,
      modelName: model?.model_name ? String(model.model_name) : null,
      repository: { full_name: repo.full_name, description: repo.description, language: repo.language },
      timeoutMs: Number((env as Record<string, unknown>).MODEL_REQUEST_TIMEOUT_MS ?? 60000),
      maxBytes: Number((env as Record<string, unknown>).MODEL_RESPONSE_MAX_BYTES ?? 200000),
    })

    await saveGeneratedSummary(env as { DB?: D1Database }, user.id, repositoryId, 'ai', generated, model?.model_name ? String(model.model_name) : null)
    return ok({ job: await finishSummaryItem(env as { DB?: D1Database }, user.id, body.job_id, repositoryId, 'success') })
  } catch (error) {
    return ok({ job: await finishSummaryItem(env as { DB?: D1Database }, user.id, body.job_id, repositoryId, 'failed', error instanceof Error ? error.message : 'summary failed') })
  }
}
