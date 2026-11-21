// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../src/App'
import { Settings } from '../src/pages/Settings'
import { needsIosInstall } from '../src/push'
import * as push from '../src/push'

vi.mock('../src/push', async (orig) => ({ ...(await orig<typeof push>()), enablePush: vi.fn(async () => 'ok' as const) }))

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status })
let loggedIn: boolean
beforeEach(() => {
  loggedIn = false
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/auth/login') { loggedIn = true; return json(200, { ok: true }) }
    if (url.startsWith('/chat/messages')) return json(200, [])
    return loggedIn ? json(200, { ok: true }) : json(401, { error: 'unauthorized' })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36'

it('needsIosInstall', () => {
  expect(needsIosInstall(IPHONE, false)).toBe(true)
  expect(needsIosInstall(ANDROID, false)).toBe(false)
  expect(needsIosInstall(IPHONE, true)).toBe(false)
})

it('401 shows login, then login shows the five-page nav', async () => {
  render(<App />)
  const pw = await screen.findByLabelText('รหัสผ่าน')
  await userEvent.type(pw, 'secret')
  await userEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }))
  const nav = await screen.findByRole('navigation')
  for (const n of ['แชท', 'วันนี้', 'เงิน', 'นิสัย', 'ตั้งค่า']) expect(nav.textContent).toContain(n)
  expect(nav.querySelectorAll('button')).toHaveLength(5)
})

it('settings button calls enablePush', async () => {
  render(<Settings onLogout={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: 'เปิดการแจ้งเตือน' }))
  await waitFor(() => expect(push.enablePush).toHaveBeenCalled())
  expect(await screen.findByText('เปิดการแจ้งเตือนแล้ว')).toBeTruthy()
})
