import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import type { Kysely } from 'kysely'
import type { Schema } from './db/schema.js'
import { authRoutes } from './auth/routes.js'

export interface AppDeps {
  db: Kysely<Schema>
  ownerPasswordHash: string
  sessionSecret: string
  llm?: unknown // placeholder; narrowed by a later task
  sender?: unknown // placeholder; narrowed by a later task
  now?: () => Date
  secureCookie?: boolean // default: true unless NODE_ENV=test
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify()
  app.register(cookie)
  // Plugin scope: the onRequest hook in authRoutes protects every route registered
  // in this scope, so later tasks add `app.register(...)` lines below it.
  app.register(async (scope) => {
    authRoutes(scope, deps, deps.now ?? (() => new Date()), deps.secureCookie ?? process.env.NODE_ENV !== 'test')
    // later tasks: scope.register(todayRoutes, deps) etc.
  })
  return app
}
