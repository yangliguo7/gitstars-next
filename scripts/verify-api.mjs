const base = process.env.GITSTARS_BASE_URL || 'http://127.0.0.1:8788'

await check('GET', '/api/me', undefined, 200, true)
await check('GET', '/api/repos?view=ungrouped', undefined, 401, false)
await check('GET', '/api/groups', undefined, 401, false)
await check('POST', '/api/sync/start', undefined, 403, false)
await check('GET', '/api/auth/github/start', undefined, 500, false)
console.log('OK unauthenticated local API has no example data and requires real GitHub OAuth')

async function check(method, path, headers, status, ok, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const payload = await response.json()
  if (response.status !== status || payload.ok !== ok) {
    console.error(`FAIL ${method} ${path}`, { status: response.status, payload })
    process.exit(1)
  }
  console.log(`OK ${method} ${path}`)
  return payload
}
