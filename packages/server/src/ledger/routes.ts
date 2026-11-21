import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { bangkokMonthKey } from '@live-os/shared/time'
import type { AppDeps } from '../app.js'
import {
  addTransaction, deleteTransaction, LedgerError, listBudgets, listRecentTransactions,
  monthSummary, setBudget, updateTransaction,
} from './ledger.js'

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM')
const amount = z.number().int().positive()
const iso = z.string().datetime({ offset: true }).transform((s) => new Date(s))
const kind = z.enum(['income', 'expense'])
const id = z.coerce.number().int().positive()

const createBody = z.object({ categoryId: z.number().int().positive(), kind, amountSatang: amount, occurredAt: iso, note: z.string().max(255).optional() })
const patchBody = z.object({ categoryId: z.number().int().positive(), kind, amountSatang: amount, occurredAt: iso, note: z.string().max(255).nullable() }).partial().strict()
const budgetBody = z.object({ categoryId: z.number().int().positive(), month, limitSatang: amount })
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) })

export function registerLedgerRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db } = deps
  // encapsulated plugin: the root auth hook still applies, the error mapping stays local
  app.register(async (r) => {
    r.setErrorHandler((err, _req, reply) => {
      if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
      if (err instanceof LedgerError) return reply.code(err.code === 'not_found' ? 404 : 400).send({ error: err.message })
      throw err
    })

    r.post('/transactions', async (req, reply) => {
      const b = createBody.parse(req.body)
      return reply.code(201).send(await addTransaction(db, b))
    })
    r.get('/transactions', async (req) => listRecentTransactions(db, limitQuery.parse(req.query).limit))
    r.patch('/transactions/:id', async (req, reply) => {
      await updateTransaction(db, id.parse((req.params as { id: string }).id), patchBody.parse(req.body))
      return reply.code(200).send({ ok: true })
    })
    r.delete('/transactions/:id', async (req, reply) => {
      await deleteTransaction(db, id.parse((req.params as { id: string }).id))
      return reply.code(204).send()
    })
    r.get('/budgets', async (req) => listBudgets(db, month.parse((req.query as { month?: string }).month)))
    r.put('/budgets', async (req, reply) => {
      const b = budgetBody.parse(req.body)
      await setBudget(db, b.categoryId, b.month, b.limitSatang)
      return reply.code(204).send()
    })
    r.get('/summary/month', async (req) => {
      const m = (req.query as { month?: string }).month
      return monthSummary(db, m === undefined ? bangkokMonthKey(new Date()) : month.parse(m))
    })
  })
}
