import { requireUser } from '../_shared/current-user'
import { readModelSettings } from '../_shared/d1'
import { ok } from '../_shared/response'

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const { user, response: authError } = await requireUser(env as { DB?: D1Database }, request)
  if (authError) return authError
  const model = await readModelSettings(env as { DB?: D1Database }, user.id)
  return ok({
    model: {
      enabled: Boolean(model?.enabled),
      provider_name: model?.provider_name ?? 'openai-compatible',
      base_url: model?.base_url ?? '',
      model_name: model?.model_name ?? '',
      api_key_masked: model?.api_key_encrypted ? 'configured' : '',
      allow_repo_metadata: model?.allow_repo_metadata ?? true,
      allow_user_notes: model?.allow_user_notes ?? false,
      allow_readme_content: model?.allow_readme_content ?? false,
    },
  })
}
