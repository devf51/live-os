import type { Kysely, Selectable } from 'kysely'
import { bangkokDay, bangkokDayRange } from '@live-os/shared/time'
import type { Schema } from '../db/schema.js'

type Db = Kysely<Schema>
const WEEK = 7 * 24 * 3600_000 // Bangkok has no DST, so +7 days is exactly one wall-clock week

export class PlannerError extends Error {
  constructor(readonly code: 'invalid' | 'not_found', message: string) {
    super(message)
  }
}

export interface EventInput { title: string; kind: 'class' | 'appointment'; startsAt: Date; endsAt?: Date; repeatWeekly: boolean; leadMinutes?: number }
export interface EventRow { id: number; title: string; kind: 'class' | 'appointment'; startsAt: Date; endsAt: Date | null; repeatWeekly: boolean; leadMinutes: number | null }
export interface TaskInput { title: string; priority: 1 | 2 | 3 | 4; dueAt?: Date }
export interface TaskRow { id: number; title: string; priority: number; dueAt: Date | null; status: 'todo' | 'done' }

const insertId = (r: { insertId?: bigint }) => Number(r.insertId)

export async function addEvent(db: Db, e: EventInput & { sourceMessageId?: number }): Promise<{ id: number }> {
  if (e.endsAt && e.endsAt <= e.startsAt) throw new PlannerError('invalid', 'endsAt must be after startsAt')
  const r = await db.insertInto('events').values({
    title: e.title, kind: e.kind, starts_at: e.startsAt, ends_at: e.endsAt ?? null, repeat_weekly: e.repeatWeekly,
    lead_minutes: e.leadMinutes ?? null, source_message_id: e.sourceMessageId ?? null, deleted_at: null,
  }).executeTakeFirstOrThrow()
  return { id: insertId(r) }
}

export async function addTask(db: Db, t: TaskInput & { sourceMessageId?: number }): Promise<{ id: number }> {
  const r = await db.insertInto('tasks').values({
    title: t.title, priority: t.priority, due_at: t.dueAt ?? null, status: 'todo',
    source_message_id: t.sourceMessageId ?? null, deleted_at: null,
  }).executeTakeFirstOrThrow()
  return { id: insertId(r) }
}

const toEvent = (r: Selectable<Schema['events']>): EventRow => ({
  id: Number(r.id), title: r.title, kind: r.kind, startsAt: r.starts_at, endsAt: r.ends_at,
  repeatWeekly: Boolean(r.repeat_weekly), leadMinutes: r.lead_minutes === null ? null : Number(r.lead_minutes),
})
const toTask = (r: Selectable<Schema['tasks']>): TaskRow => ({
  id: Number(r.id), title: r.title, priority: Number(r.priority), dueAt: r.due_at, status: r.status,
})

export async function listEvents(db: Db): Promise<EventRow[]> {
  const rows = await db.selectFrom('events').selectAll().where('deleted_at', 'is', null).orderBy('starts_at').orderBy('id').execute()
  return rows.map((r) => toEvent(r))
}

export async function listTasks(db: Db, status?: 'todo' | 'done'): Promise<TaskRow[]> {
  let q = db.selectFrom('tasks').selectAll().where('deleted_at', 'is', null)
  if (status) q = q.where('status', '=', status)
  return (await q.orderBy('id').execute()).map((r) => toTask(r))
}

async function requireEvent(db: Db, id: number): Promise<EventRow> {
  const r = await db.selectFrom('events').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst()
  if (!r) throw new PlannerError('not_found', `event ${id} not found`)
  return toEvent(r)
}

async function requireTask(db: Db, id: number): Promise<void> {
  const r = await db.selectFrom('tasks').select('id').where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst()
  if (!r) throw new PlannerError('not_found', `task ${id} not found`)
}

export async function updateEvent(
  db: Db, id: number, p: Partial<Omit<EventInput, 'endsAt' | 'leadMinutes'>> & { endsAt?: Date | null; leadMinutes?: number | null },
): Promise<void> {
  const cur = await requireEvent(db, id)
  const startsAt = p.startsAt ?? cur.startsAt
  const endsAt = p.endsAt === undefined ? cur.endsAt : p.endsAt
  if (endsAt && endsAt <= startsAt) throw new PlannerError('invalid', 'endsAt must be after startsAt')
  const set = {
    ...(p.title !== undefined && { title: p.title }),
    ...(p.kind !== undefined && { kind: p.kind }),
    ...(p.startsAt !== undefined && { starts_at: p.startsAt }),
    ...(p.endsAt !== undefined && { ends_at: p.endsAt }),
    ...(p.repeatWeekly !== undefined && { repeat_weekly: p.repeatWeekly }),
    ...(p.leadMinutes !== undefined && { lead_minutes: p.leadMinutes }),
  }
  if (Object.keys(set).length) await db.updateTable('events').set(set).where('id', '=', id).execute()
}

export async function updateTask(
  db: Db, id: number, p: Partial<Omit<TaskInput, 'dueAt'>> & { dueAt?: Date | null; status?: 'todo' | 'done' },
): Promise<void> {
  await requireTask(db, id)
  const set = {
    ...(p.title !== undefined && { title: p.title }),
    ...(p.priority !== undefined && { priority: p.priority }),
    ...(p.dueAt !== undefined && { due_at: p.dueAt }),
    ...(p.status !== undefined && { status: p.status }),
  }
  if (Object.keys(set).length) await db.updateTable('tasks').set(set).where('id', '=', id).execute()
}

export async function deleteEvent(db: Db, id: number): Promise<void> {
  await requireEvent(db, id)
  await db.updateTable('events').set({ deleted_at: new Date() }).where('id', '=', id).execute()
}

export async function deleteTask(db: Db, id: number): Promise<void> {
  await requireTask(db, id)
  await db.updateTable('tasks').set({ deleted_at: new Date() }).where('id', '=', id).execute()
}

/** Occurrences in the half-open range [from, to); never before startsAt. */
export function occurrencesBetween(e: { startsAt: Date; repeatWeekly: boolean }, from: Date, to: Date): Date[] {
  const s = e.startsAt.getTime()
  if (!e.repeatWeekly) return s >= from.getTime() && s < to.getTime() ? [e.startsAt] : []
  const out: Date[] = []
  for (let t = s + Math.max(0, Math.ceil((from.getTime() - s) / WEEK)) * WEEK; t < to.getTime(); t += WEEK) out.push(new Date(t))
  return out
}

export async function listToday(db: Db, now: Date): Promise<{ kind: 'event' | 'task'; id: number; title: string; at: Date | null }[]> {
  const [from, to] = bangkokDayRange(bangkokDay(now))
  const events = await db.selectFrom('events').selectAll().where('deleted_at', 'is', null)
    .where((eb) => eb.or([eb.and([eb('repeat_weekly', '=', false), eb('starts_at', '>=', from)]), eb('repeat_weekly', '=', true)]))
    .where('starts_at', '<', to).execute()
  const tasks = await db.selectFrom('tasks').selectAll().where('deleted_at', 'is', null).where('status', '=', 'todo')
    .where('due_at', '>=', from).where('due_at', '<', to).execute()
  const items: { kind: 'event' | 'task'; id: number; title: string; at: Date | null }[] = [
    ...events.flatMap((r) => {
      const e = toEvent(r)
      return occurrencesBetween(e, from, to).map((at) => ({ kind: 'event' as const, id: e.id, title: e.title, at }))
    }),
    ...tasks.map((r) => ({ kind: 'task' as const, id: Number(r.id), title: r.title, at: r.due_at })),
  ]
  const key = (x: { at: Date | null }) => x.at?.getTime() ?? Infinity
  return items.sort((a, b) => key(a) - key(b) || a.id - b.id)
}
