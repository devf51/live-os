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
  // The auth hook sits on the root instance, so any route registered anywhere
  // (later tasks: just `app.register(...)` here) is protected, 404s included.
  authRoutes(app, deps, deps.now ?? (() => new Date()), deps.secureCookie ?? process.env.NODE_ENV !== 'test')
  return app
}
