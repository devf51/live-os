import type { Kysely } from 'kysely'
import type { Schema } from '../db/schema.js'
import type { LlmClient } from '../llm/llm.js'
import { deleteTransaction, LedgerError } from '../ledger/ledger.js'
import { deleteEvent, deleteTask, PlannerError } from '../planner/planner.js'
import { unlogHabit } from '../habits/habits.js'
import { llmResultSchema } from './actions.js'
import { AskError, executeActions, type Created } from './execute.js'

type Db = Kysely<Schema>
export interface ChatDeps { db: Db; llm: LlmClient; now: () => Date; timeoutMs?: number; log?: (event: string, detail: Record<string, unknown>) => void }

export class ChatError extends Error {
  constructor(readonly code: 'not_found' | 'conflict', message: string) {
    super(message)
  }
}

const APOLOGY = 'ขอโทษครับ ตอนนี้ระบบแปลข้อความมีปัญหา ยังไม่ได้จดอะไร ลองใหม่อีกครั้งได้ไหมครับ'
const UNSURE = 'ขอโทษครับ ไม่แน่ใจว่าจะจดอะไร ช่วยพิมพ์อีกครั้งได้ไหมครับ ยังไม่ได้จดอะไร'
const FAILED = 'จดไม่สำเร็จครับ ข้อมูลอาจไม่ถูกต้อง ยังไม่ได้จดอะไรเลย ลองพิมพ์ใหม่อีกครั้งนะครับ'
const EMPTY = 'ไม่แน่ใจว่าหมายถึงอะไรครับ ช่วยพิมพ์ใหม่อีกครั้งได้ไหม'
const UNDOABLE = new Set(['transactions', 'events', 'tasks', 'habit_logs'])

// Stable identifiers only (name/code/errno/status): driver and client messages embed user text, so never log them.
const errInfo = (e: unknown) => {
  const x = (e ?? {}) as { code?: unknown; errno?: unknown; status?: unknown }
  const pick = (v: unknown) => (typeof v === 'string' ? v.slice(0, 64) : typeof v === 'number' ? v : undefined)
  return { name: e instanceof Error ? e.name : typeof e, code: pick(x.code), errno: pick(x.errno), status: pick(x.status) }
}
const parseCreated = (json: string | null): Created[] => (json ? (JSON.parse(json) as Created[]) : [])
const hasUndoable = (c: Created[]) => c.some((x) => UNDOABLE.has(x.table))

async function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('llm timeout'), { name: 'LlmTimeout' })), ms) })])
  } finally {
    clearTimeout(t)
  }
}

async function storeBot(db: Db, text: string, created: Created[] = []) {
  const r = await db.insertInto('chat_messages')
    .values({ role: 'bot', text, actions_json: created.length ? JSON.stringify(created) : null, undone_at: null }).executeTakeFirstOrThrow()
  return { reply: text, messageId: Number(r.insertId), undoable: hasUndoable(created) }
}

export async function handleMessage(deps: ChatDeps, text: string): Promise<{ reply: string; messageId: number; undoable: boolean }> {
  const { db, llm, now } = deps
  const recent = (await db.selectFrom('chat_messages').select(['role', 'text']).orderBy('id', 'desc').limit(10).execute()).reverse() // before storing: excludes this message
  const userId = Number((await db.insertInto('chat_messages').values({ role: 'user', text, actions_json: null, undone_at: null }).executeTakeFirstOrThrow()).insertId)
  const at = now()
  const nowIso = new Date(at.getTime() + 7 * 3600_000).toISOString().replace(/\.\d{3}Z$/, '+07:00')

  let raw: unknown
  try {
    raw = await timeout(llm.interpret({ text, nowIso, recent }), deps.timeoutMs ?? 20_000)
  } catch (e) {
    deps.log?.('llm_error', errInfo(e))
    return storeBot(db, APOLOGY)
  }
  const parsed = llmResultSchema.safeParse(raw) // never trust the model's shape
  if (!parsed.success) {
    deps.log?.('llm_schema_invalid', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })) })
    return storeBot(db, UNSURE)
  }
  const r = parsed.data
  if (r.kind !== 'actions') return storeBot(db, (r.kind === 'ask' ? r.question : r.reply).trim().slice(0, 2000) || EMPTY)

  try {
    return await db.transaction().execute(async (trx) => {
      const { lines, created } = await executeActions(trx, r.actions, { now: at, messageId: userId })
      return storeBot(trx, lines.join('\n'), created) // bot message commits with the rows, so undo is always reachable
    })
  } catch (e) {
    if (!(e instanceof AskError)) deps.log?.('action_error', errInfo(e))
    return storeBot(db, e instanceof AskError ? e.message : FAILED) // everything rolled back
  }
}

const gone = (e: unknown) => (e instanceof LedgerError || e instanceof PlannerError) && e.code === 'not_found'

export async function undoMessage(deps: { db: Db; now?: () => Date }, botMessageId: number): Promise<void> {
  await deps.db.transaction().execute(async (trx) => {
    const m = await trx.selectFrom('chat_messages').select(['role', 'actions_json', 'undone_at']).where('id', '=', botMessageId).forUpdate().executeTakeFirst()
    const created = m?.role === 'bot' ? parseCreated(m.actions_json) : []
    if (!m || !hasUndoable(created)) throw new ChatError('not_found', 'nothing to undo')
    if (m.undone_at) throw new ChatError('conflict', 'already undone')
    for (const c of created) {
      try {
        if (c.table === 'transactions') await deleteTransaction(trx, c.id)
        else if (c.table === 'events') await deleteEvent(trx, c.id)
        else if (c.table === 'tasks') await deleteTask(trx, c.id)
        else if (c.table === 'habit_logs') await unlogHabit(trx, c.habitId!, c.day!)
      } catch (e) {
        if (!gone(e)) throw e // already deleted by hand: fine
      }
    }
    await trx.updateTable('chat_messages').set({ undone_at: (deps.now ?? (() => new Date()))() }).where('id', '=', botMessageId).execute()
  })
}
