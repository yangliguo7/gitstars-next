export interface GitHubRepoPayload {
  id: number
  full_name: string
  owner: { login: string }
  name: string
  description: string | null
  language: string | null
  stargazers_count: number
  forks_count: number
  open_issues_count?: number
  archived?: boolean
  fork?: boolean
  html_url: string
  pushed_at?: string
  created_at?: string
  updated_at?: string
}

export interface GitHubStarredRepoPayload {
  starred_at: string
  repo: GitHubRepoPayload
}

export class GitHubApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter: number | null = null,
    public rateLimitReset: string | null = null,
  ) {
    super(message)
  }
}

export async function githubRequest<T>(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'GitStars-MVP',
      ...init.headers,
    },
  })
  if (response.status === 204) return null as T
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after')
    const reset = response.headers.get('x-ratelimit-reset')
    const retryAfterSeconds = retryAfter ? Number(retryAfter) : reset ? Math.max(1, Number(reset) - Math.floor(Date.now() / 1000)) : null
    throw new GitHubApiError(response.status, `GitHub ${response.status}${retryAfter ? ` retry-after=${retryAfter}` : ''}`, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null, reset)
  }
  return response.json<T>()
}

export function normalizeGitHubRepo(repo: GitHubRepoPayload) {
  const [owner, name] = repo.full_name.split('/')
  return {
    github_id: repo.id,
    full_name: repo.full_name,
    owner: owner || repo.owner.login,
    name: name || repo.name,
    description: repo.description,
    language: repo.language,
    stars_count: repo.stargazers_count,
    forks_count: repo.forks_count,
    open_issues_count: repo.open_issues_count ?? null,
    is_archived: repo.archived ? 1 : 0,
    is_fork: repo.fork ? 1 : 0,
    html_url: repo.html_url,
    pushed_at: repo.pushed_at ?? null,
    github_created_at: repo.created_at ?? null,
    github_updated_at: repo.updated_at ?? null,
  }
}
