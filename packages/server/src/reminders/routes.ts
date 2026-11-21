import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppDeps } from '../app.js'
import { loadSettings, saveSettings, settingsPatch } from './settings.js'

export function registerReminderRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db } = deps
  app.register(async (r) => {
    r.setErrorHandler((err, _req, reply) => {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
      throw err
    })
    r.get('/settings', async () => loadSettings(db))
    r.put('/settings', async (req) => {
      const next = { ...(await loadSettings(db)), ...settingsPatch.parse(req.body) }
      await saveSettings(db, next)
      return next
    })
  })
}
