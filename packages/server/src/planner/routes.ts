import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppDeps } from '../app.js'
import {
  addEvent, addTask, deleteEvent, deleteTask, listEvents, listTasks, listToday, PlannerError, updateEvent, updateTask,
} from './planner.js'

const iso = z.string().datetime({ offset: true }).transform((s) => new Date(s))
const id = z.coerce.number().int().positive()
const title = z.string().min(1).max(200)
const eventFields = {
  title, kind: z.enum(['class', 'appointment']), startsAt: iso, endsAt: iso,
  repeatWeekly: z.boolean(), leadMinutes: z.number().int().min(0).max(10080),
}
const createEvent = z.object({ ...eventFields, endsAt: eventFields.endsAt.optional(), repeatWeekly: z.boolean().default(false), leadMinutes: eventFields.leadMinutes.optional() }).strict()
const patchEvent = z.object({ ...eventFields, endsAt: iso.nullable(), leadMinutes: eventFields.leadMinutes.nullable() }).partial().strict()
const taskFields = { title, priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), dueAt: iso }
const createTask = z.object({ ...taskFields, dueAt: iso.optional() }).strict()
const patchTask = z.object({ ...taskFields, dueAt: iso.nullable(), status: z.enum(['todo', 'done']) }).partial().strict()
const statusQuery = z.object({ status: z.enum(['todo', 'done']).optional() })

export function registerPlannerRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db } = deps
  // encapsulated plugin: the root auth hook still applies, the error mapping stays local
  app.register(async (r) => {
    r.setErrorHandler((err, _req, reply) => {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
      if (err instanceof PlannerError) return reply.code(err.code === 'not_found' ? 404 : 400).send({ error: err.message })
      throw err
    })
    const pid = (req: { params: unknown }) => id.parse((req.params as { id: string }).id)

    r.get('/events', async () => listEvents(db))
    r.post('/events', async (req, reply) => reply.code(201).send(await addEvent(db, createEvent.parse(req.body))))
    r.patch('/events/:id', async (req, reply) => {
      await updateEvent(db, pid(req), patchEvent.parse(req.body))
      return reply.code(200).send({ ok: true })
    })
    r.delete('/events/:id', async (req, reply) => {
      await deleteEvent(db, pid(req))
      return reply.code(204).send()
    })

    r.get('/tasks', async (req) => listTasks(db, statusQuery.parse(req.query).status))
    r.post('/tasks', async (req, reply) => reply.code(201).send(await addTask(db, createTask.parse(req.body))))
    r.patch('/tasks/:id', async (req, reply) => {
      await updateTask(db, pid(req), patchTask.parse(req.body))
      return reply.code(200).send({ ok: true })
    })
    r.delete('/tasks/:id', async (req, reply) => {
      await deleteTask(db, pid(req))
      return reply.code(204).send()
    })

    r.get('/today', async () =>
      (await listToday(db, deps.now?.() ?? new Date())).map((x) => ({ ...x, at: x.at ? x.at.toISOString() : null })))
  })
}
