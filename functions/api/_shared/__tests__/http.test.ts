import { describe, expect, it } from 'vitest'
import { requireCsrf } from '../http'
import { sha256Hex } from '../crypto'

describe('requireCsrf', () => {
  it('allows GET without csrf', async () => {
    await expect(requireCsrf(new Request('https://app.test/api/repos'))).resolves.toBeUndefined()
  })

  it('rejects write without csrf', async () => {
    const response = await requireCsrf(new Request('https://app.test/api/groups', { method: 'POST' }))
    expect(response?.status).toBe(403)
  })

  it('rejects mismatched origin', async () => {
    const response = await requireCsrf(new Request('https://app.test/api/groups', { method: 'POST', headers: { origin: 'https://evil.test', 'x-csrf-token': 'csrf_test' } }))
    expect(response?.status).toBe(403)
  })

  it('allows same origin with csrf', async () => {
    const token = 'csrf_test'
    const env = fakeEnv(await sha256Hex(token))
    const response = await requireCsrf(new Request('https://app.test/api/groups', { method: 'POST', headers: { origin: 'https://app.test', 'x-csrf-token': token, cookie: 'gitstars_session=sess_1' } }), env)
    expect(response).toBeUndefined()
  })
})


function fakeEnv(hash: string) {
  return {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ csrf_token_hash: hash }),
        }),
      }),
    } as unknown as D1Database,
  }
}
