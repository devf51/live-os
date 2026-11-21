import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppDeps } from '../app.js'
import { ChatError, handleMessage, undoMessage } from './chat.js'

const body = z.object({ text: z.string().trim().min(1).max(2000) })
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
const id = z.coerce.number().int().positive()

export function registerChatRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db } = deps
  const now = deps.now ?? (() => new Date())
  app.register(async (r) => {
    r.setErrorHandler((err, _req, reply) => {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
      if (err instanceof ChatError) return reply.code(err.code === 'not_found' ? 404 : 409).send({ error: err.message })
      throw err
    })
    r.post('/chat', async (req, reply) => {
      const b = body.parse(req.body)
      if (!deps.llm) return reply.code(503).send({ error: 'ยังไม่ได้ตั้งค่าโมเดล' })
      return handleMessage({ db, llm: deps.llm, now, log: (event, detail) => app.log.warn({ ...detail, event }) }, b.text)
    })
    r.get('/chat/messages', async (req) => {
      const { limit } = limitQuery.parse(req.query)
      const rows = await db.selectFrom('chat_messages').selectAll().orderBy('id', 'desc').limit(limit).execute()
      return rows.reverse().map((m) => ({
        id: Number(m.id), role: m.role, text: m.text, createdAt: m.created_at.toISOString(),
        undoable: m.role === 'bot' && !m.undone_at && (JSON.parse(m.actions_json ?? '[]') as { table: string }[]).some((c) => c.table !== 'categories'),
      }))
    })
    r.post('/chat/actions/:id/undo', async (req) => {
      await undoMessage({ db, now }, id.parse((req.params as { id: string }).id))
      return { ok: true }
    })
  })
}
