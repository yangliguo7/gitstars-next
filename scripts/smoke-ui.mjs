const base = process.env.GITSTARS_BASE_URL || 'http://127.0.0.1:8788'
const required = [
  'GitStars',
  'Star Library, built for action.',
  'All Starred',
  'Ungrouped',
  'Recently Starred',
  'Has Summary',
  'Command',
  'Sync GitHub',
  'User settings',
  '简单摘要',
  '详细摘要',
  'Unstar',
]

const html = await fetchText(base)
const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((path) => path.startsWith('/assets/'))
const assets = await Promise.all(assetPaths.map((path) => fetchText(new URL(path, base).toString()).catch(() => '')))
const bundle = [html, ...assets].join('\n')
for (const text of required) {
  if (!bundle.includes(text)) {
    console.error(`FAIL UI missing ${text}`)
    process.exit(1)
  }
}
console.log('OK UI bundle contains design-critical text')

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} ${response.status}`)
  return response.text()
}
