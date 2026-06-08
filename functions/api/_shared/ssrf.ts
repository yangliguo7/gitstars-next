const blockedHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

export function validateModelBaseUrl(rawUrl: string) {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'base_url must be a valid URL'
  }
  if (url.protocol !== 'https:') return 'base_url must use https'
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (blockedHosts.has(hostname)) return 'base_url cannot target local/private host'
  if (hostname.endsWith('.local')) return 'base_url cannot target .local host'
  if (isPrivateIPv4(hostname)) return 'base_url cannot target local/private host'
  if (isPrivateIPv6(hostname)) return 'base_url cannot target local/private host'
  return null
}

function isPrivateIPv4(hostname: string) {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  )
}

function isPrivateIPv6(hostname: string) {
  return hostname === '::1' || hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd')
}
