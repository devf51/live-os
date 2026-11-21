import { z } from 'zod'
import { normalizeYear } from '@live-os/shared/time'

// ISO datetime WITH offset; Buddhist-era years (> 2400) are normalised, e.g. 2569 -> 2026.
const iso = z.string().datetime({ offset: true }).transform((s) => new Date(s.replace(/^\d{4}/, (y) => String(normalizeYear(Number(y))))))
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((s) => s.replace(/^\d{4}/, (y) => String(normalizeYear(Number(y)))))
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
  z.object({ type: z.literal('query_month'), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
])

export const llmResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('actions'), actions: z.array(actionSchema).min(1) }),
  z.object({ kind: z.literal('ask'), question: z.string() }),
  z.object({ kind: z.literal('chat'), reply: z.string() }),
])

export type Action = z.output<typeof actionSchema>
export type LlmResult = z.input<typeof llmResultSchema>
