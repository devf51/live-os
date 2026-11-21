import { bangkokDay } from '@live-os/shared/time'
import type { EvalCase } from './cases.js'

const DATE_FIELD: Record<string, string> = { add_transaction: 'occurredAt', add_event: 'startsAt', add_task: 'dueAt', log_habit: 'day' }
const bkkTime = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(11, 16)

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
    const raw = got[DATE_FIELD[exp.type] ?? '']
    const t = typeof raw === 'string' ? new Date(raw) : undefined
    const gotDate = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : t && !isNaN(+t) ? bangkokDay(t) : undefined
    if (gotDate !== exp.date) fail('date', exp.date, raw, 'dateOk')
    else if (exp.time && !(typeof raw === 'string' && bkkTime(raw) === exp.time)) fail('time', exp.time, raw, 'dateOk')
  }
  return { diffs, ...flags }
}

export function compare(c: EvalCase, got: { kind?: string; actions?: Record<string, unknown>[] }) {
  const diffs: string[] = []
  let money = false, moneyOk = true, date = false, dateOk = true
  if (got.kind !== c.expect.kind) diffs.push(`kind: expected ${c.expect.kind}, got ${got.kind}`)
  else if (c.expect.actions) {
    const g = got.actions ?? []
    if (g.length !== c.expect.actions.length) diffs.push(`action count: expected ${c.expect.actions.length}, got ${g.length}`)
    c.expect.actions.forEach((e, i) => {
      const r = compareAction(e, g[i], i)
      diffs.push(...r.diffs); money ||= r.money; date ||= r.date; moneyOk &&= r.moneyOk; dateOk &&= r.dateOk
    })
  }
  return { pass: diffs.length === 0, diffs, money, moneyOk, date, dateOk }
}
