import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { signSession, verifyPassword, verifySession } from './auth.js'
import type { AppDeps } from '../app.js'

export const COOKIE = 'session'
const MAX_FAILS = 5
const LOCK_MS = 15 * 60 * 1000

export function authRoutes(app: FastifyInstance, deps: AppDeps, now: () => Date, secure: boolean) {
  // shortcut: in-memory, single user; upgrade if multi-user
  const fails = new Map<string, { n: number; since: number }>()

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.url.split('?')[0] === '/auth/login' || req.url.split('?')[0] === '/auth/logout') return
    const tok = req.cookies[COOKIE]
    if (!tok || !verifySession(deps.sessionSecret, tok, now())) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  })

  app.post('/auth/login', async (req, reply) => {
    const t = now().getTime()
    let f = fails.get(req.ip)
    if (f && t - f.since >= LOCK_MS) f = undefined
    if (f && f.n >= MAX_FAILS) return reply.code(429).send({ error: 'too many attempts' })
    // reserve the attempt before the await so parallel requests are all counted
    fails.set(req.ip, { n: (f?.n ?? 0) + 1, since: f?.since ?? t })

    const pw = (req.body as { password?: unknown } | null)?.password
    if (typeof pw !== 'string' || !(await verifyPassword(pw, deps.ownerPasswordHash))) {
      return reply.code(401).send({ error: 'invalid credentials' })
    }
    fails.delete(req.ip)
    return reply
      .setCookie(COOKIE, signSession(deps.sessionSecret, now()), {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure,
        maxAge: 30 * 24 * 60 * 60,
      })
      .send({ ok: true })
  })

  // idempotent: works with or without a session
  app.post('/auth/logout', async (_req, reply) => reply.clearCookie(COOKIE, { path: '/' }).code(204).send())

  app.get('/auth/me', async () => ({ ok: true }))
}
