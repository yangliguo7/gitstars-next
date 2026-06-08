import { describe, expect, it } from 'vitest'
import { decryptString, encryptString, sha256Hex } from '../crypto'

describe('crypto helpers', () => {
  it('encrypts and decrypts secret without plaintext in ciphertext', async () => {
    const secret = 'sk-test-secret'
    const encrypted = await encryptString(secret, 'dev-encryption-key')
    expect(encrypted.encrypted).not.toContain(secret)
    await expect(decryptString(encrypted.encrypted, encrypted.iv, 'dev-encryption-key')).resolves.toBe(secret)
  })

  it('uses different iv for same plaintext', async () => {
    const first = await encryptString('same-secret', 'dev-encryption-key')
    const second = await encryptString('same-secret', 'dev-encryption-key')
    expect(first.iv).not.toBe(second.iv)
    expect(first.encrypted).not.toBe(second.encrypted)
  })

  it('fails decrypt with wrong key', async () => {
    const encrypted = await encryptString('secret', 'right-key')
    await expect(decryptString(encrypted.encrypted, encrypted.iv, 'wrong-key')).rejects.toThrow()
  })

  it('hashes csrf token deterministically', async () => {
    await expect(sha256Hex('csrf')).resolves.toBe(await sha256Hex('csrf'))
  })
})
