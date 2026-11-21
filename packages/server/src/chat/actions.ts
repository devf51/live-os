import { z } from 'zod'
import { normalizeYear } from '@live-os/shared/time'

// Buddhist-era years (> 2400) are normalised FIRST (2569 -> 2026), then validated, so leap days are judged in the real year.
const normYear = (v: unknown) => (typeof v === 'string' ? v.replace(/^\d{4}/, (y) => String(normalizeYear(Number(y)))) : v)
const realDate = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === s.slice(0, 10) // no silent roll-over (02-29 -> 03-01)
const iso = z.preprocess(normYear, z.string().datetime({ offset: true }).refine(realDate, 'not a real date')).transform((s) => new Date(s))
const day = z.preprocess(normYear, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(realDate, 'not a real date'))
const kind = z.enum(['income', 'expense'])
const name = z.string().trim().min(1).max(100)

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_transaction'), kind, amountSatang: z.number().int().positive(), category: name, occurredAt: iso, note: z.string().trim().max(255).optional() }),
  z.object({
    type: z.literal('add_event'), title: name, kind: z.enum(['class', 'appointment']), startsAt: iso, endsAt: iso.optional(),
    repeatWeekly: z.boolean().default(false), leadMinutes: z.number().int().min(0).max(10080).optional(),
  }),
  z.object({ type: z.literal('add_task'), title: name, priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), dueAt: iso.optional() }),
  z.object({ type: z.literal('log_habit'), name, day: day.optional() }),
  z.object({ type: z.literal('add_category'), name, kind }),
  z.object({ type: z.literal('query_month'), month: z.preprocess(normYear, z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)) }),
])

export const llmResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('actions'), actions: z.array(actionSchema).min(1).max(20) }),
  z.object({ kind: z.literal('ask'), question: z.string() }),
  z.object({ kind: z.literal('chat'), reply: z.string() }),
])

export type Action = z.output<typeof actionSchema>
export type LlmResult = z.input<typeof llmResultSchema>
