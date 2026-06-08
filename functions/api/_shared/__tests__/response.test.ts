import { describe, expect, it } from 'vitest'
import { fail, ok } from '../response'

describe('api response helpers', () => {
  it('returns success response shape', async () => {
    const response = ok({ value: 1 })
    await expect(response.json()).resolves.toEqual({ ok: true, data: { value: 1 } })
  })

  it('returns failure response shape and status', async () => {
    const response = fail('VALIDATION_ERROR', 'bad input', 422)
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
  })
})
