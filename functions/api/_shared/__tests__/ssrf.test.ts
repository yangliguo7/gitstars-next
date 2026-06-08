import { describe, expect, it } from 'vitest'
import { validateModelBaseUrl } from '../ssrf'

describe('validateModelBaseUrl', () => {
  it('accepts https model endpoint', () => {
    expect(validateModelBaseUrl('https://api.example.com/v1')).toBeNull()
  })

  it('rejects non-https endpoint', () => {
    expect(validateModelBaseUrl('http://api.example.com/v1')).toContain('https')
  })

  it('rejects localhost and private networks', () => {
    expect(validateModelBaseUrl('https://localhost/v1')).toContain('local')
    expect(validateModelBaseUrl('https://127.0.0.1/v1')).toContain('private')
    expect(validateModelBaseUrl('https://10.0.0.2/v1')).toContain('private')
    expect(validateModelBaseUrl('https://172.16.0.2/v1')).toContain('private')
    expect(validateModelBaseUrl('https://192.168.1.2/v1')).toContain('private')
    expect(validateModelBaseUrl('https://[::1]/v1')).toContain('private')
    expect(validateModelBaseUrl('https://service.local/v1')).toContain('.local')
  })
})
