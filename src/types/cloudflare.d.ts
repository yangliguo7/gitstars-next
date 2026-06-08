/// <reference types="@cloudflare/workers-types" />

declare global {
  interface Env {
    DB?: D1Database
    CACHE?: KVNamespace
    GITHUB_CLIENT_ID?: string
    GITHUB_CLIENT_SECRET?: string
    ENCRYPTION_SECRET?: string
    DEV_GITHUB_TOKEN?: string
  }

  type PagesFunction<Params extends string | Record<string, string> = string, Data = unknown> = import('@cloudflare/workers-types').PagesFunction<Env, Params, Data>
}

export {}
