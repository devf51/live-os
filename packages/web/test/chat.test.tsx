// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Chat } from '../src/pages/Chat'

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status })
type Route = (init?: RequestInit) => Response | Promise<Response>
let routes: Record<string, Route>
let fetchMock: ReturnType<typeof vi.fn>
const LIST = '/chat/messages?limit=50'
const calls = (url: string) => fetchMock.mock.calls.filter((c) => c[0] === url)
beforeEach(() => {
  routes = {}
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const r = routes[url]
    return r ? r(init) : json(404)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const U = { id: 1, role: 'user', text: 'กินข้าว 80 บาท', createdAt: '2026-11-20T05:05:00Z', undoable: false }
const B = { id: 2, role: 'bot', text: 'จดแล้ว 80 บาท', createdAt: '2026-11-20T05:05:02Z', undoable: true }
const input = () => screen.getByLabelText('พิมพ์เล่าให้ฟังได้เลย…') as HTMLTextAreaElement

it('empty state shows examples', async () => {
  routes[LIST] = () => json(200, [])
  render(<Chat />)
  expect(await screen.findByText('ศุกร์หน้าบ่ายสามหมอฟัน')).toBeTruthy()
  expect(screen.getByText('กินข้าว 80 บาท')).toBeTruthy()
  expect(screen.getByText('วันนี้ออกกำลังกายแล้ว')).toBeTruthy()
})

it('loads in order with sender labels and Bangkok times', async () => {
  routes[LIST] = () => json(200, [U, B])
  render(<Chat />)
  const items = within(await screen.findByRole('log', { name: 'บทสนทนา' })).getAllByRole('listitem')
  expect(items[0].textContent).toContain('คุณ')
  expect(items[0].textContent).toContain('กินข้าว 80 บาท')
  expect(items[0].textContent).toContain('12:05')
  expect(items[1].textContent).toContain('ผู้ช่วย')
  expect(items[1].textContent).toContain('12:05')
})

it('send flow: optimistic bubble, thinking placeholder, disabled, then reply', async () => {
  routes[LIST] = () => json(200, [])
  let resolve!: (r: Response) => void
  routes['/chat'] = () => new Promise<Response>((r) => { resolve = r })
  render(<Chat />)
  await screen.findByRole('log')
  await userEvent.type(input(), '  กินข้าว 80 บาท  ')
  await userEvent.click(screen.getByRole('button', { name: 'ส่ง' }))
  expect(await screen.findByText('กำลังคิด…')).toBeTruthy()
  expect(screen.getByText('กินข้าว 80 บาท')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'ส่ง' }) as HTMLButtonElement).disabled).toBe(true)
  expect(input().value).toBe('')
  expect(calls('/chat')[0][1].body).toBe(JSON.stringify({ text: 'กินข้าว 80 บาท' }))
  resolve(json(200, { reply: 'จดแล้วจ้า', messageId: 9, undoable: true }))
  expect(await screen.findByText('จดแล้วจ้า')).toBeTruthy()
  expect(screen.queryByText('กำลังคิด…')).toBeNull()
  expect(screen.getByRole('button', { name: 'ยกเลิก' })).toBeTruthy()
  await waitFor(() => expect((screen.getByRole('button', { name: 'ส่ง' }) as HTMLButtonElement).disabled).toBe(false))
})

it('Enter sends, Shift+Enter does not; whitespace sends nothing', async () => {
  routes[LIST] = () => json(200, [])
  routes['/chat'] = () => json(200, { reply: 'ok', messageId: 3, undoable: false })
  render(<Chat />)
  await screen.findByRole('log')
  await userEvent.type(input(), '   {Enter}')
  await userEvent.type(input(), '{Shift>}{Enter}{/Shift}')
  expect(calls('/chat')).toHaveLength(0)
  await userEvent.clear(input())
  await userEvent.type(input(), 'a{Shift>}{Enter}{/Shift}b')
  expect(input().value).toBe('a\nb')
  expect(calls('/chat')).toHaveLength(0)
  await userEvent.type(input(), '{Enter}')
  expect(await screen.findByText('ok')).toBeTruthy()
  expect(calls('/chat')).toHaveLength(1)
})

it('failure restores the text and alerts, nothing lost', async () => {
  routes[LIST] = () => json(200, [])
  routes['/chat'] = () => json(500)
  render(<Chat />)
  await screen.findByRole('log')
  await userEvent.type(input(), 'ซื้อนม{Enter}')
  expect((await screen.findByRole('alert')).textContent).toBe('ส่งไม่สำเร็จ ลองใหม่อีกครั้งนะ')
  expect(input().value).toBe('ซื้อนม')
  expect(screen.queryByText('กำลังคิด…')).toBeNull()
})

it('503 shows the server notice and restores the text', async () => {
  routes[LIST] = () => json(200, [])
  routes['/chat'] = () => json(503, { error: 'ยังไม่ได้ตั้งค่าโมเดล' })
  render(<Chat />)
  await screen.findByRole('log')
  await userEvent.type(input(), 'ซื้อนม{Enter}')
  expect(await screen.findByText('ยังไม่ได้ตั้งค่าโมเดล')).toBeTruthy()
  expect(input().value).toBe('ซื้อนม')
})

it('undo marks the bubble cancelled and hides buttons', async () => {
  routes[LIST] = () => json(200, [U, B])
  routes['/chat/actions/2/undo'] = () => json(200, { ok: true })
  render(<Chat />)
  await userEvent.click(await screen.findByRole('button', { name: 'ยกเลิก' }))
  expect(await screen.findByText('ยกเลิกแล้ว')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'ยกเลิก' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'แก้' })).toBeNull()
  expect(calls('/chat/actions/2/undo')[0][1].method).toBe('POST')
})

it('409 is treated as already cancelled', async () => {
  routes[LIST] = () => json(200, [U, B])
  routes['/chat/actions/2/undo'] = () => json(409)
  render(<Chat />)
  await userEvent.click(await screen.findByRole('button', { name: 'ยกเลิก' }))
  expect(await screen.findByText('ยกเลิกแล้ว')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('undo failure keeps buttons and alerts', async () => {
  routes[LIST] = () => json(200, [U, B])
  routes['/chat/actions/2/undo'] = () => json(500)
  render(<Chat />)
  await userEvent.click(await screen.findByRole('button', { name: 'ยกเลิก' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'ยกเลิก' }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.getByRole('button', { name: 'แก้' })).toBeTruthy()
})

it('double-click on ยกเลิก sends one request', async () => {
  routes[LIST] = () => json(200, [U, B])
  routes['/chat/actions/2/undo'] = () => json(200, { ok: true })
  render(<Chat />)
  await userEvent.dblClick(await screen.findByRole('button', { name: 'ยกเลิก' }))
  await screen.findByText('ยกเลิกแล้ว')
  expect(calls('/chat/actions/2/undo')).toHaveLength(1)
})

it('แก้ undoes then fills the composer with the previous user text and focuses it', async () => {
  routes[LIST] = () => json(200, [U, B])
  routes['/chat/actions/2/undo'] = () => json(200, { ok: true })
  render(<Chat />)
  await userEvent.click(await screen.findByRole('button', { name: 'แก้' }))
  await screen.findByText('ยกเลิกแล้ว')
  expect(calls('/chat/actions/2/undo')).toHaveLength(1)
  expect(input().value).toBe('กินข้าว 80 บาท')
  expect(document.activeElement).toBe(input())
})

it('renders bot text as literal text', async () => {
  routes[LIST] = () => json(200, [{ ...B, text: '<b>x</b>', undoable: false }])
  const { container } = render(<Chat />)
  expect(await screen.findByText(/<b>x<\/b>/)).toBeTruthy()
  expect(container.querySelector('b')).toBeNull()
})

it('load error shows retry which refetches', async () => {
  routes[LIST] = () => json(500)
  render(<Chat />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  routes[LIST] = () => json(200, [])
  await userEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }))
  expect(await screen.findByRole('log')).toBeTruthy()
  expect(calls(LIST)).toHaveLength(2)
})
