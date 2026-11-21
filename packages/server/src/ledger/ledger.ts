import { sql, type Kysely } from 'kysely'
import type { Schema } from '../db/schema.js'

type Db = Kysely<Schema>
type Kind = 'income' | 'expense'

export class LedgerError extends Error {
  constructor(readonly code: 'invalid' | 'not_found', message: string) {
    super(message)
  }
}

export interface RecentTransaction {
  id: number
  categoryName: string
  kind: Kind
  amountSatang: number
  occurredAt: string
  note: string | null
}

const DEFAULT_CATEGORIES: [string, Kind][] = [
  ...['อาหาร', 'เดินทาง', 'ที่พัก', 'ช้อปปิ้ง', 'การเรียน', 'สุขภาพ', 'บันเทิง', 'อื่นๆ'].map((n): [string, Kind] => [n, 'expense']),
  ['เงินเดือน', 'income'],
  ['รายรับอื่นๆ', 'income'],
]

// [start, end) of a Bangkok month as UTC instants. Bangkok is a fixed UTC+7 (no DST).
function monthRange(month: string): [Date, Date] {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const off = 7 * 3600_000
  return [new Date(Date.UTC(y, m - 1, 1) - off), new Date(Date.UTC(y, m, 1) - off)]
}

function checkAmount(n: number) {
  if (!Number.isSafeInteger(n) || n <= 0) throw new LedgerError('invalid', 'amountSatang must be a positive integer')
}

async function requireCategory(db: Db, id: number): Promise<{ id: number; kind: Kind }> {
  const c = await db.selectFrom('categories').select(['id', 'kind']).where('id', '=', id).executeTakeFirst()
  if (!c) throw new LedgerError('invalid', `unknown categoryId ${id}`)
  return { id: Number(c.id), kind: c.kind }
}

async function requireMatching(db: Db, categoryId: number, kind: Kind) {
  const c = await requireCategory(db, categoryId)
  if (c.kind !== kind) throw new LedgerError('invalid', `kind ${kind} does not match category kind ${c.kind}`)
}

export async function findCategory(db: Db, name: string): Promise<{ id: number } | null> {
  const r = await db.selectFrom('categories').select('id').where('name', '=', name).executeTakeFirst()
  return r ? { id: Number(r.id) } : null
}

export async function addCategory(db: Db, name: string, kind: Kind): Promise<{ id: number }> {
  await db.insertInto('categories').ignore().values({ name, kind }).execute() // UNIQUE(name) makes this race-safe
  return (await findCategory(db, name))!
}

export async function seedDefaultCategories(db: Db): Promise<void> {
  for (const [name, kind] of DEFAULT_CATEGORIES) await addCategory(db, name, kind)
}

export async function addTransaction(
  db: Db,
  t: { categoryId: number; kind: Kind; amountSatang: number; occurredAt: Date; note?: string; sourceMessageId?: number },
): Promise<{ id: number }> {
  checkAmount(t.amountSatang)
  await requireMatching(db, t.categoryId, t.kind)
  const r = await db
    .insertInto('transactions')
    .values({
      category_id: t.categoryId,
      kind: t.kind,
      amount_satang: t.amountSatang,
      occurred_at: t.occurredAt,
      note: t.note ?? null,
      source_message_id: t.sourceMessageId ?? null,
      deleted_at: null,
    })
    .executeTakeFirstOrThrow()
  return { id: Number(r.insertId) }
}

export async function updateTransaction(
  db: Db,
  id: number,
  p: { categoryId?: number; kind?: Kind; amountSatang?: number; occurredAt?: Date; note?: string | null },
): Promise<void> {
  if (p.amountSatang !== undefined) checkAmount(p.amountSatang)
  const cur = await db.selectFrom('transactions').select(['category_id', 'kind']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst()
  if (!cur) throw new LedgerError('not_found', 'transaction not found')
  await requireMatching(db, p.categoryId ?? Number(cur.category_id), p.kind ?? cur.kind) // effective values after the patch
  const set: Partial<Omit<Schema['transactions'], 'id'>> = {}
  if (p.categoryId !== undefined) set.category_id = p.categoryId
  if (p.kind !== undefined) set.kind = p.kind
  if (p.amountSatang !== undefined) set.amount_satang = p.amountSatang
  if (p.occurredAt !== undefined) set.occurred_at = p.occurredAt
  if (p.note !== undefined) set.note = p.note
  if (Object.keys(set).length) await db.updateTable('transactions').set(set).where('id', '=', id).where('deleted_at', 'is', null).execute()
}

export async function deleteTransaction(db: Db, id: number): Promise<void> {
  const r = await db
    .updateTable('transactions')
    .set({ deleted_at: new Date() })
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()
  if (Number(r.numUpdatedRows) === 0) throw new LedgerError('not_found', 'transaction not found')
}

export async function restoreTransaction(db: Db, id: number): Promise<void> {
  await db.updateTable('transactions').set({ deleted_at: null }).where('id', '=', id).execute()
}

export async function setBudget(db: Db, categoryId: number, month: string, limitSatang: number): Promise<void> {
  checkAmount(limitSatang)
  await requireMatching(db, categoryId, 'expense')
  await db
    .insertInto('budgets')
    .values({ category_id: categoryId, month, limit_satang: limitSatang })
    .onDuplicateKeyUpdate({ limit_satang: limitSatang })
    .execute()
}

export async function listBudgets(db: Db, month: string): Promise<{ categoryId: number; month: string; limitSatang: number }[]> {
  const rows = await db.selectFrom('budgets').selectAll().where('month', '=', month).orderBy('category_id').execute()
  return rows.map((r) => ({ categoryId: Number(r.category_id), month: r.month, limitSatang: Number(r.limit_satang) }))
}

async function expenseByCategory(db: Db, month: string) {
  const [from, to] = monthRange(month)
  const rows = await db
    .selectFrom('transactions')
    .select(['category_id', sql<string>`SUM(amount_satang)`.as('total')]) // DECIMAL comes back as string
    .where('kind', '=', 'expense')
    .where('deleted_at', 'is', null)
    .where('occurred_at', '>=', from)
    .where('occurred_at', '<', to)
    .groupBy('category_id')
    .execute()
  return new Map(rows.map((r) => [Number(r.category_id), Number(r.total)]))
}

export async function monthSummary(db: Db, month: string): Promise<{
  incomeSatang: number
  expenseSatang: number
  byCategory: { categoryId: number; name: string; spentSatang: number; limitSatang: number | null }[]
}> {
  const [from, to] = monthRange(month)
  const income = await db
    .selectFrom('transactions')
    .select(sql<string>`COALESCE(SUM(amount_satang), 0)`.as('total'))
    .where('kind', '=', 'income')
    .where('deleted_at', 'is', null)
    .where('occurred_at', '>=', from)
    .where('occurred_at', '<', to)
    .executeTakeFirstOrThrow()
  const spent = await expenseByCategory(db, month)
  const limits = new Map((await listBudgets(db, month)).map((b) => [b.categoryId, b.limitSatang]))
  const ids = [...new Set([...spent.keys(), ...limits.keys()])]
  const names = ids.length ? await db.selectFrom('categories').select(['id', 'name']).where('id', 'in', ids).execute() : []
  const byCategory = names
    .map((c) => ({ categoryId: Number(c.id), name: c.name, spentSatang: spent.get(Number(c.id)) ?? 0, limitSatang: limits.get(Number(c.id)) ?? null }))
    .sort((a, b) => a.categoryId - b.categoryId)
  return {
    incomeSatang: Number(income.total),
    expenseSatang: [...spent.values()].reduce((a, b) => a + b, 0),
    byCategory,
  }
}

export async function budgetCrossings(db: Db, month: string): Promise<{ categoryId: number; level: 80 | 100 }[]> {
  const spent = await expenseByCategory(db, month)
  const out: { categoryId: number; level: 80 | 100 }[] = []
  for (const b of await listBudgets(db, month)) {
    const s = spent.get(b.categoryId) ?? 0
    if (s * 100 >= b.limitSatang * 80) out.push({ categoryId: b.categoryId, level: 80 })
    if (s >= b.limitSatang) out.push({ categoryId: b.categoryId, level: 100 })
  }
  return out
}

export async function listRecentTransactions(db: Db, limit: number): Promise<RecentTransaction[]> {
  const rows = await db
    .selectFrom('transactions as t')
    .innerJoin('categories as c', 'c.id', 't.category_id')
    .select(['t.id', 'c.name', 't.kind', 't.amount_satang', 't.occurred_at', 't.note'])
    .where('t.deleted_at', 'is', null)
    .orderBy('t.occurred_at', 'desc')
    .orderBy('t.id', 'desc')
    .limit(limit)
    .execute()
  return rows.map((r) => ({
    id: Number(r.id),
    categoryName: r.name,
    kind: r.kind,
    amountSatang: Number(r.amount_satang),
    occurredAt: r.occurred_at.toISOString(),
    note: r.note,
  }))
}
