const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function randomToken(prefix = '') {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return `${prefix}${base64Url(bytes)}`
}

export async function encryptString(value: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await importAesKey(secret)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(value))
  return { encrypted: base64Url(new Uint8Array(encrypted)), iv: base64Url(iv), key_version: 'v1' }
}

export async function decryptString(encrypted: string, iv: string, secret: string) {
  const key = await importAesKey(secret)
  const value = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(iv) },
    key,
    fromBase64Url(encrypted),
  )
  return textDecoder.decode(value)
}

async function importAesKey(secret: string) {
  const hash = await crypto.subtle.digest('SHA-256', textEncoder.encode(secret))
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
