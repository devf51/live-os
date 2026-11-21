import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import type { Kysely } from 'kysely'
import type { Schema } from './db/schema.js'
import { authRoutes } from './auth/routes.js'
import { registerLedgerRoutes } from './ledger/routes.js'
import { registerPlannerRoutes } from './planner/routes.js'
import { registerHabitRoutes } from './habits/routes.js'
import { registerReminderRoutes } from './reminders/routes.js'
import { registerPushRoutes } from './push/routes.js'
import { registerChatRoutes } from './chat/routes.js'
import type { LlmClient } from './llm/llm.js'
import type { PushSender } from './push/push.js'

export interface AppDeps {
  db: Kysely<Schema>
  ownerPasswordHash: string
  sessionSecret: string
  llm?: LlmClient
  sender: PushSender
  vapidPublicKey: string
  now?: () => Date
  secureCookie?: boolean // default: true unless NODE_ENV=test
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify()
  app.register(cookie)
  // The auth hook sits on the root instance, so any route registered anywhere
  // (later tasks: just `app.register(...)` here) is protected, 404s included.
  authRoutes(app, deps, deps.now ?? (() => new Date()), deps.secureCookie ?? process.env.NODE_ENV !== 'test')
  registerLedgerRoutes(app, deps)
  registerPlannerRoutes(app, deps)
  registerHabitRoutes(app, deps)
  registerReminderRoutes(app, deps)
  registerPushRoutes(app, deps)
  registerChatRoutes(app, deps)
  return app
}
