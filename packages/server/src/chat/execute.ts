import type { Kysely } from 'kysely'
import { formatBaht } from '@live-os/shared/money'
import { bangkokDay, bangkokMonthKey } from '@live-os/shared/time'
import type { Schema } from '../db/schema.js'
import { addCategory, addTransaction, findCategory, monthSummary } from '../ledger/ledger.js'
import { addEvent, addTask } from '../planner/planner.js'
import { findHabitByName, HabitError, logHabit } from '../habits/habits.js'
import type { Action } from './actions.js'

export interface Created { table: 'transactions' | 'events' | 'tasks' | 'habit_logs' | 'categories'; id: number; habitId?: number; day?: string }

/** A question for the user instead of a write: aborts (rolls back) the whole message. */
export class AskError extends Error {}

const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const p2 = (n: number) => String(n).padStart(2, '0')
const yearOf = (d: Date) => Number(bangkokDay(d).slice(0, 4))
/** e.g. "ศุกร์ 27 พ.ย. 15:00" in Asia/Bangkok (fixed UTC+7); the year is added when it is not the current Bangkok year. */
export function formatWhen(d: Date, now: Date, withTime = true): string {
  const b = new Date(d.getTime() + 7 * 3600_000)
  const year = yearOf(d) === yearOf(now) ? '' : ` ${b.getUTCFullYear()}`
  return `${DAYS[b.getUTCDay()]} ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}${year}${withTime ? ` ${p2(b.getUTCHours())}:${p2(b.getUTCMinutes())}` : ''}`
}

const DAY_MS = 86400_000
const implausible = (what: string, d: Date, now: Date) => new AskError(`${what} ${formatWhen(d, now)} ดูไม่ถูกต้อง ช่วยบอกวันที่อีกครั้งได้ไหมครับ ยังไม่ได้จดอะไร`)
/** Event/task dates must fall in [thisYear-1, thisYear+5] (Bangkok); `allowPast` exempts the lower bound (repeating class). */
function checkYear(what: string, d: Date, now: Date, allowPast = false) {
  const y = yearOf(now), x = yearOf(d)
  if ((!allowPast && x < y - 1) || x > y + 5) throw implausible(what, d, now)
}

type Db = Kysely<Schema>

/** Runs every action on `db` (a transaction); replies are built from the rows read back, never from model text. */
export async function executeActions(db: Db, actions: Action[], ctx: { now: Date; messageId: number }): Promise<{ lines: string[]; created: Created[] }> {
  const lines: string[] = []
  const created: Created[] = []
  const today = bangkokDay(ctx.now)
  for (const a of actions) {
    switch (a.type) {
      case 'add_transaction': {
        const cat = await findCategory(db, a.category)
        if (!cat) throw new AskError(`ไม่มีหมวด "${a.category}" ครับ อยากให้สร้างหมวดใหม่ไหม (รายจ่ายหรือรายรับ)?`)
        if (a.occurredAt.getTime() > ctx.now.getTime() + DAY_MS || a.occurredAt.getTime() < ctx.now.getTime() - 366 * DAY_MS) throw implausible('วันที่', a.occurredAt, ctx.now)
        const kindOf = (await db.selectFrom('categories').select('kind').where('id', '=', cat.id).executeTakeFirstOrThrow()).kind
        if (kindOf !== a.kind) throw new AskError(`หมวด "${a.category}" ไม่ตรงกับประเภท${a.kind === 'expense' ? 'รายจ่าย' : 'รายรับ'} ลองระบุหมวดอื่นนะครับ ยังไม่ได้จดอะไรเลย`)
        const { id } = await addTransaction(db, { categoryId: cat.id, kind: a.kind, amountSatang: a.amountSatang, occurredAt: a.occurredAt, note: a.note, sourceMessageId: ctx.messageId })
        const r = await db.selectFrom('transactions as t').innerJoin('categories as c', 'c.id', 't.category_id')
          .select(['t.amount_satang', 't.note', 't.kind', 'c.name', 't.occurred_at']).where('t.id', '=', id).executeTakeFirstOrThrow()
        lines.push(`จดแล้ว: ${r.note ?? (r.kind === 'income' ? 'รายรับ' : 'รายจ่าย')} ${formatBaht(Number(r.amount_satang))} (${r.name})${bangkokDay(r.occurred_at) === today ? '' : ` วันที่ ${formatWhen(r.occurred_at, ctx.now, false)}`}`)
        created.push({ table: 'transactions', id })
        break
      }
      case 'add_event': {
        if (a.kind === 'appointment' && a.startsAt < ctx.now) throw new AskError(`วันที่ผ่านไปแล้ว (${formatWhen(a.startsAt, ctx.now)}) ตั้งใจให้เป็นวันไหนครับ`)
        checkYear('นัด', a.startsAt, ctx.now, a.repeatWeekly)
        const { id } = await addEvent(db, { title: a.title, kind: a.kind, startsAt: a.startsAt, endsAt: a.endsAt, repeatWeekly: a.repeatWeekly, leadMinutes: a.leadMinutes, sourceMessageId: ctx.messageId })
        const r = await db.selectFrom('events').select(['title', 'starts_at', 'kind', 'repeat_weekly']).where('id', '=', id).executeTakeFirstOrThrow()
        lines.push(`${r.kind === 'class' ? 'จดคลาสแล้ว' : 'จดนัดแล้ว'}: ${r.title} ${formatWhen(r.starts_at, ctx.now)}${r.repeat_weekly ? ' (ทุกสัปดาห์)' : ''}`)
        created.push({ table: 'events', id })
        break
      }
      case 'add_task': {
        if (a.dueAt) checkYear('กำหนดส่ง', a.dueAt, ctx.now)
        const { id } = await addTask(db, { title: a.title, priority: a.priority, dueAt: a.dueAt, sourceMessageId: ctx.messageId })
        const r = await db.selectFrom('tasks').select(['title', 'due_at']).where('id', '=', id).executeTakeFirstOrThrow()
        lines.push(`จดงานแล้ว: ${r.title}${r.due_at ? ` กำหนด ${formatWhen(r.due_at, ctx.now)}` : ''}`)
        created.push({ table: 'tasks', id })
        break
      }
      case 'log_habit': {
        const h = await findHabitByName(db, a.name)
        if (!h) throw new AskError(`ยังไม่มีนิสัย "${a.name}" ครับ อยากให้สร้างก่อนไหม?`)
        const d = a.day ?? today
        const find = () => db.selectFrom('habit_logs').select('id').where('habit_id', '=', h.id).where('day', '=', d).executeTakeFirst()
        if (await find()) { lines.push(`ติ๊กไว้แล้ว: ${h.name}`); break } // pre-existing log: not ours, so not undoable
        try {
          await logHabit(db, h.id, d, today)
        } catch (e) {
          if (e instanceof HabitError) throw new AskError(`ติ๊กนิสัย "${h.name}" วันที่ ${d} ไม่ได้ครับ (วันที่ไม่ถูกต้องหรือยังมาไม่ถึง) ช่วยบอกวันที่อีกครั้งได้ไหม`)
          throw e
        }
        created.push({ table: 'habit_logs', id: Number((await find())!.id), habitId: h.id, day: d })
        lines.push(`ติ๊กนิสัยแล้ว: ${h.name}`)
        break
      }
      case 'add_category': {
        const existing = await findCategory(db, a.name)
        if (existing) {
          lines.push(`มีหมวดนี้อยู่แล้ว: ${(await db.selectFrom('categories').select('name').where('id', '=', existing.id).executeTakeFirstOrThrow()).name}`)
          break
        }
        const { id } = await addCategory(db, a.name, a.kind)
        created.push({ table: 'categories', id })
        lines.push(`สร้างหมวดแล้ว: ${(await db.selectFrom('categories').select('name').where('id', '=', id).executeTakeFirstOrThrow()).name}`)
        break
      }
      case 'query_month': {
        const s = await monthSummary(db, a.month)
        lines.push(`${a.month === bangkokMonthKey(ctx.now) ? 'เดือนนี้' : `เดือน ${a.month} `}ใช้ไป ${formatBaht(s.expenseSatang)} รับ ${formatBaht(s.incomeSatang)}`)
        break
      }
    }
  }
  return { lines, created }
}
