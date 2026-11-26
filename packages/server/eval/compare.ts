import { bangkokDay } from '@live-os/shared/time'
import { llmResultSchema } from '../src/chat/actions.js'
import type { EvalCase } from './cases.js'

const DATE_FIELD: Record<string, string> = { add_transaction: 'occurredAt', add_event: 'startsAt', add_task: 'dueAt', log_habit: 'day' }
const bkkTime = (t: Date) => new Date(t.getTime() + 7 * 3600_000).toISOString().slice(11, 16)

type Exp = NonNullable<EvalCase['expect']['actions']>[number]
/** Returns the list of mismatches (empty = pass); `money`/`date` flag which kinds of field were checked. */
function compareAction(exp: Exp, got: Record<string, unknown> | undefined, i: number) {
  const diffs: string[] = []
  const flags = { money: false, date: false, moneyOk: true, dateOk: true }
  const fail = (what: string, e: unknown, g: unknown, k: 'moneyOk' | 'dateOk' | null) => { diffs.push(`#${i} ${what}: expected ${JSON.stringify(e)}, got ${JSON.stringify(g)}`); if (k) flags[k] = false }
  if (!got) { fail('action', exp.type, undefined, null); return { diffs, ...flags } }
  if (got.type !== exp.type) { fail('type', exp.type, got.type, null); return { diffs, ...flags } }
  for (const k of ['kind', 'category', 'name', 'month', 'repeatWeekly'] as const) if (exp[k] !== undefined && got[k] !== exp[k]) fail(k, exp[k], got[k], null)
  if ((exp.type === 'add_event' || exp.type === 'add_task') && !(typeof got.title === 'string' && got.title.trim())) fail('title', 'non-empty', got.title, null) // title is never compared exactly
  if (exp.amountSatang !== undefined) {
    flags.money = true
    if (got.amountSatang !== exp.amountSatang) fail('amountSatang', exp.amountSatang, got.amountSatang, 'moneyOk')
  }
  if (exp.date !== undefined) {
    flags.date = true
    const raw = got[DATE_FIELD[exp.type] ?? ''] // after the server's parse: Date for ISO fields, 'YYYY-MM-DD' for log_habit.day
    const gotDate = raw instanceof Date ? bangkokDay(raw) : typeof raw === 'string' ? raw : undefined
    if (gotDate !== exp.date) fail('date', exp.date, raw instanceof Date ? raw.toISOString() : raw, 'dateOk')
    else if (exp.time && !(raw instanceof Date && bkkTime(raw) === exp.time)) fail('time', exp.time, raw instanceof Date ? raw.toISOString() : raw, 'dateOk')
  }
  return { diffs, ...flags }
}

/** Scores what the SERVER would accept: the model output goes through the same zod schema as handleMessage (year normalisation included); a rejection is a FAIL. */
export function compare(c: EvalCase, rawGot: unknown) {
  const exp = c.expect.actions ?? []
  const wantMoney = exp.some((e) => e.amountSatang !== undefined)
  const wantDate = exp.some((e) => e.date !== undefined)
  const parsed = llmResultSchema.safeParse(rawGot)
  if (!parsed.success) {
    const why = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}:${i.code}`).join(', ')
    return { pass: false, diffs: [`server would reject the output (${why})`], money: wantMoney, moneyOk: false, date: wantDate, dateOk: false }
  }
  const got = parsed.data as { kind: string; actions?: Record<string, unknown>[] }
  const diffs: string[] = []
  let money = false, moneyOk = true, date = false, dateOk = true
  if (got.kind !== c.expect.kind) diffs.push(`kind: expected ${c.expect.kind}, got ${got.kind}`)
  else if (c.expect.actions) {
    const g = got.actions ?? []
    if (g.length !== exp.length) diffs.push(`action count: expected ${exp.length}, got ${g.length}`)
    exp.forEach((e, i) => {
      const r = compareAction(e, g[i], i)
      diffs.push(...r.diffs); money ||= r.money; date ||= r.date; moneyOk &&= r.moneyOk; dateOk &&= r.dateOk
    })
  }
  return { pass: diffs.length === 0, diffs, money, moneyOk, date, dateOk }
}
