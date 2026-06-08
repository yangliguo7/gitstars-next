import { appOrigin } from '../../../_shared/http'
import { fail } from '../../../_shared/response'

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const url = new URL(request.url)
  const clientId = (env as Env).GITHUB_CLIENT_ID
  if (!clientId) return fail('VALIDATION_ERROR', 'GITHUB_CLIENT_ID is not configured', 500)
  const returnTo = url.searchParams.get('return_to') ?? '/'
  const state = btoa(JSON.stringify({ return_to: returnTo })).replace(/=+$/g, '')
  const redirectUri = `${appOrigin(request)}/api/auth/github/callback`
  const github = new URL('https://github.com/login/oauth/authorize')
  github.searchParams.set('client_id', clientId)
  github.searchParams.set('redirect_uri', redirectUri)
  github.searchParams.set('scope', 'read:user public_repo')
  github.searchParams.set('state', state)
  return Response.redirect(github.toString(), 302)
}
