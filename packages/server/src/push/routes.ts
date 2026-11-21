import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppDeps } from '../app.js'

const subscribeBody = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(512).refine((u) => {
    const { hostname, port } = new URL(u)
    // only public push services: no IP literals, localhost or .local; default port only
    return !(port !== '' && port !== '443') && !/^[\d.]+$/.test(hostname) && !hostname.includes(':') && hostname !== 'localhost' && !hostname.endsWith('.local')
  }, 'endpoint must be a public https push-service URL'),
  expirationTime: z.number().nullish(),
  keys: z.object({ p256dh: z.string().min(1).max(255), auth: z.string().min(1).max(255) }),
})
const unsubscribeBody = z.object({ endpoint: z.string().min(1) })

export function registerPushRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db, sender } = deps
  app.register(async (r) => {
    r.setErrorHandler((err, _req, reply) => {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
      throw err
    })
    r.get('/push/vapid-key', async () => ({ key: deps.vapidPublicKey }))
    r.post('/push/subscribe', async (req) => {
      const b = subscribeBody.parse(req.body)
      const v = { p256dh: b.keys.p256dh, auth: b.keys.auth }
      await db.insertInto('push_subscriptions').values({ endpoint: b.endpoint, ...v }).onDuplicateKeyUpdate(v).execute()
      return { ok: true }
    })
    r.delete('/push/subscribe', async (req, reply) => {
      await db.deleteFrom('push_subscriptions').where('endpoint', '=', unsubscribeBody.parse(req.body).endpoint).execute()
      return reply.code(204).send()
    })
    r.post('/push/test', async () => {
      let sent = 0
      for (const s of await db.selectFrom('push_subscriptions').select(['id', 'endpoint', 'p256dh', 'auth']).execute()) {
        const out = await sender.send(s, { title: 'live os', body: 'ทดสอบการแจ้งเตือน', url: '/' })
        if (out === 'ok') sent++
        else if (out === 'gone') await db.deleteFrom('push_subscriptions').where('id', '=', s.id).execute()
      }
      return { sent }
    })
  })
}
