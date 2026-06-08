import { readJson } from '../_shared/http'
import { ok } from '../_shared/response'

export const onRequestPost: PagesFunction = async ({ request }) => {
  const body = await readJson<{ input?: string }>(request)
  const input = body?.input?.toLowerCase().trim() ?? ''
  if (input.includes('ungroup')) return ok({ action: 'navigate', target: '/?view=ungrouped' })
  if (input.includes('recent')) return ok({ action: 'navigate', target: '/?view=recent' })
  if (input.includes('sync')) return ok({ action: 'sync', target: '/api/sync/start' })
  if (input.includes('dark')) return ok({ action: 'theme', target: 'dark' })
  return ok({ action: 'search', target: input.replace(/^search\s+/, '') })
}
