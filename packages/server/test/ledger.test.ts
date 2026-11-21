import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import { testDb } from './helpers/testDb.js'
import type { Schema } from '../src/db/schema.js'
import { buildApp } from '../src/app.js'
import { hashPassword } from '../src/auth/auth.js'
import {
  addCategory, addTransaction, budgetCrossings, deleteTransaction, findCategory,
  LedgerError, listRecentTransactions, monthSummary, restoreTransaction, seedDefaultCategories, setBudget, updateTransaction,
} from '../src/ledger/ledger.js'

let db: Kysely<Schema>
let food: number
beforeAll(async () => { db = await testDb() })
afterAll(async () => { await db.destroy() })
beforeEach(async () => {
  await db.deleteFrom('budgets').execute()
  await db.deleteFrom('transactions').execute()
  await db.deleteFrom('categories').execute()
  food = (await addCategory(db, 'อาหาร', 'expense')).id
})
const at = (s: string) => new Date(s)
const spend = (amountSatang: number, occurredAt = '2026-11-15T05:00:00Z', categoryId = food) =>
  addTransaction(db, { categoryId, kind: 'expense', amountSatang, occurredAt: at(occurredAt) })

describe('categories', () => {
  it('addCategory returns existing on duplicate; findCategory', async () => {
    expect((await addCategory(db, 'อาหาร', 'expense')).id).toBe(food)
    expect(await findCategory(db, 'อาหาร')).toEqual({ id: food })
    expect(await findCategory(db, 'nope')).toBeNull()
  })
  it('seedDefaultCategories is idempotent', async () => {
    await seedDefaultCategories(db)
    await seedDefaultCategories(db)
    const rows = await db.selectFrom('categories').selectAll().execute()
    expect(rows.length).toBe(10)
    expect(rows.filter((r) => r.kind === 'income').map((r) => r.name).sort()).toEqual(['รายรับอื่นๆ', 'เงินเดือน'].sort())
  })
})

describe('transactions + summary', () => {
  it('80 baht counts, numbers are numbers', async () => {
    const { id } = await spend(8000)
    expect(typeof id).toBe('number')
    const s = await monthSummary(db, '2026-11')
    expect(s.expenseSatang).toBe(8000)
    expect(typeof s.expenseSatang).toBe('number')
    expect(s.incomeSatang).toBe(0)
    expect(s.byCategory).toEqual([{ categoryId: food, name: 'อาหาร', spentSatang: 8000, limitSatang: null }])
    expect(typeof s.byCategory[0]!.categoryId).toBe('number')
  })
  it('soft delete excludes, restore counts again', async () => {
    const { id } = await spend(8000)
    await deleteTransaction(db, id)
    expect((await monthSummary(db, '2026-11')).expenseSatang).toBe(0)
    await restoreTransaction(db, id)
    expect((await monthSummary(db, '2026-11')).expenseSatang).toBe(8000)
  })
  it('Bangkok month boundary', async () => {
    await spend(100, '2026-11-30T17:30:00Z')
    expect((await monthSummary(db, '2026-12')).expenseSatang).toBe(100)
    expect((await monthSummary(db, '2026-11')).expenseSatang).toBe(0)
    await spend(200, '2026-11-30T16:59:59Z')
    expect((await monthSummary(db, '2026-11')).expenseSatang).toBe(200)
  })
  it('rejects non-positive / non-integer amounts', async () => {
    for (const a of [0, -5, 1.5, NaN]) await expect(spend(a)).rejects.toThrow()
  })
  it('income vs expense, budget-only category listed with limit', async () => {
    const sal = (await addCategory(db, 'เงินเดือน', 'income')).id
    const trip = (await addCategory(db, 'เดินทาง', 'expense')).id
    await addTransaction(db, { categoryId: sal, kind: 'income', amountSatang: 3000000, occurredAt: at('2026-11-02T00:00:00Z') })
    await setBudget(db, trip, '2026-11', 50000)
    await setBudget(db, trip, '2026-11', 60000) // upsert
    const s = await monthSummary(db, '2026-11')
    expect(s.incomeSatang).toBe(3000000)
    expect(s.byCategory).toEqual([{ categoryId: trip, name: 'เดินทาง', spentSatang: 0, limitSatang: 60000 }])
  })
  it('budgetCrossings 80 then 100', async () => {
    await setBudget(db, food, '2026-11', 100000)
    await spend(79999)
    expect(await budgetCrossings(db, '2026-11')).toEqual([])
    await spend(1)
    expect(await budgetCrossings(db, '2026-11')).toEqual([{ categoryId: food, level: 80 }])
    await spend(20000)
    expect(await budgetCrossings(db, '2026-11')).toEqual([{ categoryId: food, level: 80 }, { categoryId: food, level: 100 }])
  })
})

describe('kind mismatch', () => {
  let inc: number
  beforeEach(async () => { inc = (await addCategory(db, 'เงินเดือน', 'income')).id })
  const tx = (kind: 'income' | 'expense', categoryId: number) =>
    addTransaction(db, { categoryId, kind, amountSatang: 100, occurredAt: at('2026-11-15T05:00:00Z') })
  it('add rejects both directions, accepts matching', async () => {
    await expect(tx('expense', inc)).rejects.toThrow(LedgerError)
    await expect(tx('income', food)).rejects.toThrow(LedgerError)
    await tx('income', inc)
    await tx('expense', food)
  })
  it('update rejects kind-only and category-only mismatches, row unchanged', async () => {
    const { id } = await tx('expense', food)
    await expect(updateTransaction(db, id, { kind: 'income' })).rejects.toThrow(LedgerError)
    await expect(updateTransaction(db, id, { categoryId: inc })).rejects.toThrow(LedgerError)
    const row = await db.selectFrom('transactions').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
    expect([row.kind, Number(row.category_id)]).toEqual(['expense', food])
    await updateTransaction(db, id, { kind: 'income', categoryId: inc })
  })
  it('setBudget rejects income category', async () => {
    await expect(setBudget(db, inc, '2026-11', 100)).rejects.toThrow(LedgerError)
  })
})

describe('listRecentTransactions', () => {
  it('newest first, limit, excludes deleted, typed', async () => {
    await spend(1, '2026-11-01T00:00:00Z')
    const b = await spend(2, '2026-11-03T00:00:00Z')
    await spend(3, '2026-11-02T00:00:00Z')
    await deleteTransaction(db, b.id)
    const all = await listRecentTransactions(db, 20)
    expect(all.map((t) => t.amountSatang)).toEqual([3, 1])
    expect(all[0]).toEqual({ id: expect.any(Number), categoryName: 'อาหาร', kind: 'expense', amountSatang: 3, occurredAt: '2026-11-02T00:00:00.000Z', note: null })
    expect(await listRecentTransactions(db, 1)).toHaveLength(1)
  })
})

describe('routes', () => {
  let app: ReturnType<typeof buildApp>
  let cookies: Record<string, string>
  beforeAll(async () => {
    app = buildApp({ db, ownerPasswordHash: await hashPassword('pw'), sessionSecret: 'test-secret-test-secret' })
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'pw' } })
    cookies = { [res.cookies[0]!.name]: res.cookies[0]!.value }
  })
  const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, payload, cookies })

  it('401 without session', async () => {
    for (const u of ['/transactions', '/budgets?month=2026-11', '/summary/month']) {
      expect((await app.inject({ url: u })).statusCode).toBe(401)
    }
  })
  it('POST/GET/PATCH/DELETE transaction', async () => {
    const c = await req('POST', '/transactions', { categoryId: food, kind: 'expense', amountSatang: 5000, occurredAt: '2026-11-15T05:00:00Z', note: 'ข้าว' })
    expect(c.statusCode).toBe(201)
    const { id } = c.json()
    expect(typeof id).toBe('number')
    expect((await req('PATCH', `/transactions/${id}`, { amountSatang: 7000 })).statusCode).toBe(200)
    const list = (await req('GET', '/transactions?limit=10')).json()
    expect(list).toEqual([{ id, categoryName: 'อาหาร', kind: 'expense', amountSatang: 7000, occurredAt: '2026-11-15T05:00:00.000Z', note: 'ข้าว' }])
    expect((await req('GET', '/summary/month?month=2026-11')).json().expenseSatang).toBe(7000)
    expect((await req('DELETE', `/transactions/${id}`)).statusCode).toBe(204)
    expect((await req('GET', '/transactions')).json()).toEqual([])
    expect((await req('DELETE', `/transactions/${id}`)).statusCode).toBe(404)
    expect((await req('DELETE', '/transactions/999999')).statusCode).toBe(404)
    expect((await req('PATCH', '/transactions/999999', { amountSatang: 1 })).statusCode).toBe(404)
  })
  it('validates input with 400', async () => {
    const ok = { categoryId: food, kind: 'expense', amountSatang: 100, occurredAt: '2026-11-15T05:00:00Z' }
    for (const bad of [{ ...ok, amountSatang: 0 }, { ...ok, amountSatang: -1 }, { ...ok, amountSatang: 1.5 }, { ...ok, kind: 'x' }, { ...ok, occurredAt: 'yesterday' }, { ...ok, categoryId: 999999 }]) {
      expect((await req('POST', '/transactions', bad)).statusCode).toBe(400)
    }
    expect((await req('PATCH', '/transactions/1', { amountSatang: 0 })).statusCode).toBe(400)
    for (const u of ['/transactions?limit=0', '/transactions?limit=101', '/transactions?limit=abc', '/summary/month?month=2026-13', '/budgets?month=2026-1']) {
      expect((await req('GET', u)).statusCode).toBe(400)
    }
    expect((await req('PUT', '/budgets', { categoryId: food, month: '2026-00', limitSatang: 100 })).statusCode).toBe(400)
    expect((await req('PUT', '/budgets', { categoryId: food, month: '2026-11', limitSatang: 0 })).statusCode).toBe(400)
  })
  it('kind mismatch is 400', async () => {
    const inc = (await addCategory(db, 'เงินเดือน', 'income')).id
    const body = { categoryId: inc, kind: 'expense', amountSatang: 100, occurredAt: '2026-11-15T05:00:00Z' }
    expect((await req('POST', '/transactions', body)).statusCode).toBe(400)
    const { id } = (await req('POST', '/transactions', { ...body, categoryId: food })).json()
    expect((await req('PATCH', `/transactions/${id}`, { categoryId: inc })).statusCode).toBe(400)
    expect((await req('PUT', '/budgets', { categoryId: inc, month: '2026-11', limitSatang: 100 })).statusCode).toBe(400)
  })
  it('budgets PUT/GET and summary default month', async () => {
    expect((await req('PUT', '/budgets', { categoryId: food, month: '2026-11', limitSatang: 100000 })).statusCode).toBe(204)
    expect((await req('GET', '/budgets?month=2026-11')).json()).toEqual([{ categoryId: food, month: '2026-11', limitSatang: 100000 }])
    const s = (await req('GET', '/summary/month')).json()
    expect(s).toEqual({ incomeSatang: 0, expenseSatang: 0, byCategory: expect.any(Array) })
  })
})
