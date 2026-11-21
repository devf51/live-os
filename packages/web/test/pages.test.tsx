// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Today } from '../src/pages/Today'
import { Money } from '../src/pages/Money'
import { Habits } from '../src/pages/Habits'

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status })
type Route = (init?: RequestInit) => Response | Promise<Response>
let routes: Record<string, Route>
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  routes = {}
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const r = routes[url]
    return r ? r(init) : json(404)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('Today empty shows friendly message', async () => {
  routes['/today'] = () => json(200, [])
  render(<Today />)
  expect(await screen.findByText('วันนี้ไม่มีอะไร')).toBeTruthy()
})

it('Today lists items in given order with Bangkok times, untimed last as given', async () => {
  routes['/today'] = () => json(200, [
    { kind: 'event', id: 1, title: 'ประชุม', at: '2026-11-20T02:00:00Z' },
    { kind: 'task', id: 2, title: 'ซื้อนม', at: null },
  ])
  render(<Today />)
  const items = await screen.findAllByRole('listitem')
  expect(items).toHaveLength(2)
  expect(items[0].textContent).toContain('09:00')
  expect(items[0].textContent).toContain('ประชุม')
  expect(items[1].textContent).toContain('ซื้อนม')
  expect(items[1].textContent).not.toMatch(/\d\d:\d\d/)
})

it('shows loading while pending, error + retry refetches', async () => {
  let resolve!: (r: Response) => void
  routes['/today'] = () => new Promise<Response>((r) => { resolve = r })
  render(<Today />)
  expect(screen.getByRole('status').textContent).toContain('กำลังโหลด')
  resolve(json(500))
  expect(await screen.findByRole('alert')).toBeTruthy()
  routes['/today'] = () => json(200, [])
  await userEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }))
  expect(await screen.findByText('วันนี้ไม่มีอะไร')).toBeTruthy()
})

it('Habits tap posts log and marks done', async () => {
  routes['/habits'] = () => json(200, [{ id: 3, name: 'ดื่มน้ำ', done: false }, { id: 4, name: 'เดิน', done: true }])
  routes['/habits/3/logs'] = () => json(201, {})
  render(<Habits />)
  const btn = await screen.findByRole('button', { name: /ดื่มน้ำ/ })
  await userEvent.click(btn)
  expect(fetchMock).toHaveBeenCalledWith('/habits/3/logs', expect.objectContaining({ method: 'POST' }))
  expect(await screen.findByRole('button', { name: /ดื่มน้ำ.*ทำแล้ว/ })).toBeTruthy()
})

it('Habits failure reverts and shows error', async () => {
  routes['/habits'] = () => json(200, [{ id: 3, name: 'ดื่มน้ำ', done: false }])
  routes['/habits/3/logs'] = () => json(500)
  render(<Habits />)
  await userEvent.click(await screen.findByRole('button', { name: /ดื่มน้ำ/ }))
  expect((await screen.findByRole('alert')).textContent).toContain('ลองใหม่')
  expect(screen.queryByRole('button', { name: /ทำแล้ว/ })).toBeNull()
  expect(screen.getByRole('button', { name: /ดื่มน้ำ/ })).toBeTruthy()
})

it('Habits empty', async () => {
  routes['/habits'] = () => json(200, [])
  render(<Habits />)
  expect(await screen.findByText(/ยังไม่มีนิสัย/)).toBeTruthy()
})

const summary = {
  incomeSatang: 3000000,
  expenseSatang: 850000,
  byCategory: [
    { categoryId: 1, name: 'อาหาร', spentSatang: 80000, limitSatang: 100000 },
    { categoryId: 2, name: 'เดินทาง', spentSatang: 150000, limitSatang: 100000 },
    { categoryId: 3, name: 'ของใช้', spentSatang: 40000, limitSatang: 100000 },
    { categoryId: 4, name: 'อื่นๆ', spentSatang: 12000, limitSatang: null },
  ],
}
it('Money shows totals, budget bars with text levels, no bar without limit, recent list', async () => {
  routes['/summary/month'] = () => json(200, summary)
  routes['/transactions?limit=10'] = () => json(200, [
    { id: 9, categoryName: 'อาหาร', kind: 'expense', amountSatang: 8000, occurredAt: '2026-11-20T02:00:00Z', note: 'ข้าวมันไก่' },
  ])
  render(<Money />)
  expect(await screen.findByText('30000 บาท')).toBeTruthy()
  expect(screen.getByText('8500 บาท')).toBeTruthy()
  const cat = (n: string) => screen.getByRole('listitem', { name: n })
  expect(within(cat('อาหาร')).getByText(/ใกล้เต็มงบ/)).toBeTruthy()
  expect(within(cat('เดินทาง')).getByText(/เกินงบ/)).toBeTruthy()
  expect(within(cat('ของใช้')).queryByText(/ใกล้เต็มงบ|เกินงบ/)).toBeNull()
  expect(within(cat('อาหาร')).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('80')
  expect(within(cat('เดินทาง')).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
  expect(within(cat('อื่นๆ')).queryByRole('progressbar')).toBeNull()
  expect(within(cat('อื่นๆ')).getByText('120 บาท')).toBeTruthy()
  expect(screen.getByText('รายการล่าสุด')).toBeTruthy()
  expect(screen.getByText(/ข้าวมันไก่/)).toBeTruthy()
  expect(screen.getByText('-80 บาท')).toBeTruthy()
})

it('Money error retry', async () => {
  routes['/summary/month'] = () => json(500)
  routes['/transactions?limit=10'] = () => json(200, [])
  render(<Money />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  routes['/summary/month'] = () => json(200, summary)
  await userEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }))
  expect(await screen.findByText('30000 บาท')).toBeTruthy()
})
