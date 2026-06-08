import { requireCsrf, readJson } from '../../_shared/http'
import { fail, ok } from '../../_shared/response'
import { validateModelBaseUrl } from '../../_shared/ssrf'
import { upsertModelSettings } from '../../_shared/d1'
import { requireUser } from '../../_shared/current-user'

export const onRequestPut: PagesFunction = async ({ request, env }) => {
  const csrfError = await requireCsrf(request, env as { DB?: D1Database })
  if (csrfError) return csrfError
  const body = await readJson<{ enabled?: boolean; provider_name?: string; base_url?: string; model_name?: string; api_key?: string; allow_repo_metadata?: boolean; allow_user_notes?: boolean; allow_readme_content?: boolean }>(request)
  if (!body?.base_url || !body.model_name) return fail('VALIDATION_ERROR', 'base_url and model_name are required', 422)
  const urlError = validateModelBaseUrl(body.base_url)
  if (urlError) return fail('MODEL_REQUEST_BLOCKED', urlError, 422)
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  await upsertModelSettings(env as { DB?: D1Database; ENCRYPTION_SECRET?: string }, user.id, { ...body, base_url: body.base_url, model_name: body.model_name })
  return ok({
    model: {
      enabled: body.enabled ?? true,
      provider_name: body.provider_name ?? 'openai-compatible',
      base_url: body.base_url,
      model_name: body.model_name,
      api_key_masked: body.api_key ? 'sk-****saved' : 'unchanged',
      allow_repo_metadata: body.allow_repo_metadata ?? true,
      allow_user_notes: body.allow_user_notes ?? false,
      allow_readme_content: body.allow_readme_content ?? false,
    },
  })
}
