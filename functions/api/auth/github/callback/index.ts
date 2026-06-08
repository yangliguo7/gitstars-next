import { exchangeGitHubOAuth, loginRedirect } from '../../../_shared/auth'
import { appOrigin } from '../../../_shared/http'
import { fail } from '../../../_shared/response'

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  let returnTo = '/'
  if (state) {
    try {
      returnTo = JSON.parse(atob(state)).return_to ?? '/'
    } catch {
      returnTo = '/'
    }
  }
  const code = url.searchParams.get('code')
  if (!code) return fail('VALIDATION_ERROR', 'GitHub OAuth code is required', 422)
  const redirectUri = `${appOrigin(request)}/api/auth/github/callback`
  try {
    const { sessionId, csrfToken } = await exchangeGitHubOAuth(env as Env, code, redirectUri)
    return loginRedirect(returnTo, sessionId, csrfToken, new URL(request.url).protocol === 'https:')
  } catch (error) {
    return fail('GITHUB_ERROR', error instanceof Error ? error.message : 'GitHub OAuth failed', 500)
  }
}
