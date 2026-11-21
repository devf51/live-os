import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { bangkokDay } from '@live-os/shared/time'
import type { AppDeps } from '../app.js'
import { addHabit, deleteHabit, HabitError, habitsDue, isValidDay, logHabit, normalizeFreq, updateHabit } from './habits.js'

const id = z.coerce.number().int().positive()
const name = z.string().trim().min(1).max(100)
const freqType = z.enum(['daily', 'per_week', 'weekdays'])
const createHabit = z.object({ name, freqType, freqValue: z.string() }).strict()
  .refine((h) => normalizeFreq(h.freqType, h.freqValue) !== null, { message: 'invalid freqValue for freqType', path: ['freqValue'] })
const patchHabit = z.object({ name, freqType, freqValue: z.string() }).partial().strict() // merged state is validated in updateHabit
const logBody = z.object({ day: z.string().refine(isValidDay, 'day must be a valid YYYY-MM-DD').optional() }).strict()

export function registerHabitRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db } = deps
  const today = () => bangkokDay(deps.now?.() ?? new Date())
  app.register(async (r) => {
    r.setErrorHandler((err, _req, reply) => {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
      if (err instanceof HabitError) return reply.code(err.code === 'not_found' ? 404 : 400).send({ error: err.message })
      throw err
    })
    const pid = (req: { params: unknown }) => id.parse((req.params as { id: string }).id)

    r.get('/habits', async () => habitsDue(db, today()))
    r.post('/habits', async (req, reply) => reply.code(201).send(await addHabit(db, createHabit.parse(req.body))))
    r.patch('/habits/:id', async (req, reply) => {
      await updateHabit(db, pid(req), patchHabit.parse(req.body))
      return reply.code(200).send({ ok: true })
    })
    r.delete('/habits/:id', async (req, reply) => {
      await deleteHabit(db, pid(req))
      return reply.code(204).send()
    })
    r.post('/habits/:id/logs', async (req, reply) => {
      const habitId = pid(req)
      const day = logBody.parse(req.body ?? {}).day ?? today()
      await logHabit(db, habitId, day, today())
      return reply.code(200).send({ ok: true })
    })
  })
}
