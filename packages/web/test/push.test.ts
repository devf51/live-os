// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { enablePush, keyBytes } from '../src/push'
import { parsePushPayload, resolveClickUrl } from '../src/sw-logic'

afterEach(() => vi.unstubAllGlobals())

it('keyBytes decodes url-safe base64 without padding', () => {
  // bytes fb ff fe -> "+//+" standard, "-__-" url-safe; "-w" -> fb (needs padding)
  expect([...keyBytes('-__-')]).toEqual([0xfb, 0xff, 0xfe])
  expect([...keyBytes('-w')]).toEqual([0xfb])
})

function stubPush(opts: { permission?: string; sw?: boolean; pm?: boolean; notif?: boolean } = {}) {
  const subscribe = vi.fn(async () => ({ toJSON: () => ({ endpoint: 'https://p/e', keys: { p256dh: 'a', auth: 'b' } }) }))
  const fetchMock = vi.fn(async (url: string) =>
    new Response(JSON.stringify(url === '/push/vapid-key' ? { key: '-__-' } : { ok: true }), { status: 200 }),
  )
  vi.stubGlobal('fetch', fetchMock)
  if (opts.sw !== false) Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve({ pushManager: { subscribe } }) }, configurable: true })
  else delete (navigator as unknown as Record<string, unknown>).serviceWorker
  if (opts.pm !== false) vi.stubGlobal('PushManager', class {})
  else delete (window as unknown as Record<string, unknown>).PushManager
  if (opts.notif !== false) vi.stubGlobal('Notification', { requestPermission: async () => opts.permission ?? 'granted' })
  else delete (window as unknown as Record<string, unknown>).Notification
  return { subscribe, fetchMock }
}

it('enablePush: unsupported when an API is missing', async () => {
  stubPush({ pm: false })
  expect(await enablePush()).toBe('unsupported')
  stubPush({ notif: false })
  expect(await enablePush()).toBe('unsupported')
  stubPush({ sw: false })
  expect(await enablePush()).toBe('unsupported')
})

it('enablePush: denied when permission not granted', async () => {
  const { fetchMock } = stubPush({ permission: 'denied' })
  expect(await enablePush()).toBe('denied')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('enablePush: gets key then posts the subscription', async () => {
  const { subscribe, fetchMock } = stubPush()
  expect(await enablePush()).toBe('ok')
  expect([...(subscribe.mock.calls[0] as unknown as [{ applicationServerKey: Uint8Array }])[0].applicationServerKey]).toEqual([0xfb, 0xff, 0xfe])
  expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/push/vapid-key', '/push/subscribe'])
  const init = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1]
  expect(init.method).toBe('POST')
  const body = JSON.parse(init.body as string)
  expect(body.endpoint).toBe('https://p/e')
  expect(body.keys).toEqual({ p256dh: 'a', auth: 'b' })
})

it('parsePushPayload never throws and returns strings', () => {
  const d = { title: 'live os', body: '', url: '/' }
  expect(parsePushPayload(undefined)).toEqual(d)
  expect(parsePushPayload(null)).toEqual(d)
  expect(parsePushPayload({ json: () => { throw new Error('x') } })).toEqual(d)
  expect(parsePushPayload({ json: () => ({ title: 'hi' }) })).toEqual({ ...d, title: 'hi' })
  expect(parsePushPayload({ json: () => ({ title: 1, body: {}, url: null }) })).toEqual(d)
  expect(parsePushPayload({ json: () => 'str' })).toEqual(d)
})

it('resolveClickUrl keeps same-origin, rejects others', () => {
  const o = 'https://app.example'
  expect(resolveClickUrl('/money?x=1#a', o)).toBe('/money?x=1#a')
  expect(resolveClickUrl('https://app.example/today', o)).toBe('/today')
  expect(resolveClickUrl('https://evil.example/x', o)).toBe('/')
  expect(resolveClickUrl('http://[bad', o)).toBe('/')
})
