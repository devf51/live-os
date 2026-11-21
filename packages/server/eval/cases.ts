import { z } from 'zod'
import { readFileSync } from 'node:fs'

const expectedAction = z.object({
  type: z.enum(['add_transaction', 'add_event', 'add_task', 'log_habit', 'add_category', 'query_month']),
  kind: z.string().optional(), amountSatang: z.number().int().optional(), category: z.string().optional(), name: z.string().optional(),
  month: z.string().optional(), repeatWeekly: z.boolean().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // Bangkok date of occurredAt/startsAt/dueAt/day
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(), // Bangkok HH:mm, only compared when given
}).strict()

export const caseSchema = z.object({
  id: z.string().min(1),
  input: z.string().min(1),
  nowIso: z.string().datetime({ offset: true }),
  context: z.object({
    categories: z.array(z.object({ name: z.string(), kind: z.enum(['income', 'expense']) })),
    habits: z.array(z.string()),
  }),
  expect: z.object({ kind: z.enum(['actions', 'ask', 'chat']), actions: z.array(expectedAction).min(1).optional() }),
  critical: z.boolean().optional(),
}).refine((c) => (c.expect.kind === 'actions') === !!c.expect.actions, 'actions iff kind=actions')

export type EvalCase = z.infer<typeof caseSchema>

export function loadCases(file = new URL('./thai-cases.json', import.meta.url)): EvalCase[] {
  const cases = z.array(caseSchema).parse(JSON.parse(readFileSync(file, 'utf8')))
  const ids = new Set(cases.map((c) => c.id))
  if (ids.size !== cases.length) throw new Error('duplicate case ids')
  if (cases.length < 40) throw new Error(`need at least 40 cases, have ${cases.length}`)
  if (cases.filter((c) => c.critical).length < 20) throw new Error('need at least 20 critical cases')
  return cases
}
