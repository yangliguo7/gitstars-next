import { decryptString } from '../../../_shared/crypto'
import { requireUser } from '../../../_shared/current-user'
import { readModelSettings } from '../../../_shared/d1'
import { requireCsrf, readJson } from '../../../_shared/http'
import { fail, ok } from '../../../_shared/response'
import { validateModelBaseUrl } from '../../../_shared/ssrf'
import { testModelConnection } from '../../../_shared/ai'

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError

  const body = await readJson<{ provider_name?: string; base_url?: string; model_name?: string; api_key?: string }>(request)
  const saved = await readModelSettings(env as { DB?: D1Database }, user.id)
  const baseUrl = body?.base_url || (saved?.base_url ? String(saved.base_url) : '')
  const modelName = body?.model_name || (saved?.model_name ? String(saved.model_name) : '')
  let apiKey = body?.api_key || ''
  if (!apiKey && saved?.api_key_encrypted && saved.iv && (env as Env).ENCRYPTION_SECRET) {
    apiKey = await decryptString(String(saved.api_key_encrypted), String(saved.iv), (env as Env).ENCRYPTION_SECRET!)
  }
  if (!baseUrl || !modelName || !apiKey) return fail('VALIDATION_ERROR', 'base_url, model_name and api_key are required', 422)
  const urlError = validateModelBaseUrl(baseUrl)
  if (urlError) return fail('MODEL_REQUEST_BLOCKED', urlError, 422)

  try {
    const result = await testModelConnection({ provider: body?.provider_name || (saved?.provider_name ? String(saved.provider_name) : null), baseUrl, modelName, apiKey })
    return ok({ connected: true, latency_ms: result.latency_ms, model_name: modelName })
  } catch (error) {
    return fail('MODEL_REQUEST_FAILED', error instanceof Error ? error.message : 'model test failed', 422)
  }
}
