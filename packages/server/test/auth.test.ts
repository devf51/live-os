import { beforeAll, describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import { hashPassword, signSession, verifyPassword, verifySession } from '../src/auth/auth.js'
import { buildApp } from '../src/app.js'
import type { Schema } from '../src/db/schema.js'

const PW = 'throwaway-pw'
const SECRET = 'test-secret-test-secret'
const DAY = 86_400_000
let hash: string
const mk = () =>
  buildApp({ db: {} as unknown as Kysely<Schema>, ownerPasswordHash: hash, sessionSecret: SECRET })
const login = (app: ReturnType<typeof mk>, password: string) =>
  app.inject({ method: 'POST', url: '/auth/login', payload: { password } })

beforeAll(async () => {
  hash = await hashPassword(PW)
})

describe('password', () => {
  it('verifies right and wrong', async () => {
    expect(await verifyPassword(PW, hash)).toBe(true)
    expect(await verifyPassword('nope', hash)).toBe(false)
  })
})

describe('session token', () => {
  const t0 = new Date('2026-01-01T00:00:00Z')
  it('valid within 30 days, false after', () => {
    const tok = signSession(SECRET, t0)
    expect(verifySession(SECRET, tok, new Date(t0.getTime() + 29 * DAY))).toBe(true)
    expect(verifySession(SECRET, tok, new Date(t0.getTime() + 31 * DAY))).toBe(false)
  })
  it('rejects tampered or wrong-secret tokens', () => {
    const tok = signSession(SECRET, t0)
    const [iat, sig] = tok.split('.')
    expect(verifySession(SECRET, `${Number(iat) + 1}.${sig}`, t0)).toBe(false)
    expect(verifySession('other-secret', tok, t0)).toBe(false)
    expect(verifySession(SECRET, 'garbage', t0)).toBe(false)
  })
})

describe('routes', () => {
  it('protects routes without a cookie', async () => {
    expect((await mk().inject({ url: '/auth/me' })).statusCode).toBe(401)
  })
  it('login sets httpOnly cookie that unlocks /auth/me', async () => {
    const app = mk()
    const res = await login(app, PW)
    expect(res.statusCode).toBe(200)
    const cookie = res.cookies[0]!
    expect(cookie.httpOnly).toBe(true)
    const me = await app.inject({ url: '/auth/me', cookies: { [cookie.name]: cookie.value } })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toEqual({ ok: true })
  })
  it('five wrong attempts then the sixth is 429', async () => {
    const app = mk()
    for (let i = 0; i < 5; i++) expect((await login(app, 'bad')).statusCode).toBe(401)
    expect((await login(app, 'bad')).statusCode).toBe(429)
  })
  it('unknown paths and root-level routes registered later are protected', async () => {
    const app = mk()
    app.get('/late', async () => 'x')
    expect((await app.inject({ url: '/late' })).statusCode).toBe(401)
    expect((await app.inject({ url: '/nope' })).statusCode).toBe(401)
  })
  it('parallel wrong logins are all counted', async () => {
    const app = mk()
    const codes = (await Promise.all(Array.from({ length: 20 }, () => login(app, 'bad')))).map((r) => r.statusCode)
    expect(codes.filter((c) => c === 401).length).toBeLessThanOrEqual(5)
    expect(codes.filter((c) => c === 429).length).toBe(codes.length - codes.filter((c) => c === 401).length)
    expect((await login(app, 'bad')).statusCode).toBe(429)
  })
  it('successful login resets the counter', async () => {
    const app = mk()
    for (let i = 0; i < 3; i++) await login(app, 'bad')
    expect((await login(app, PW)).statusCode).toBe(200)
    for (let i = 0; i < 3; i++) expect((await login(app, 'bad')).statusCode).toBe(401)
  })
  it('logout is idempotent and clears the cookie', async () => {
    const res = await mk().inject({ method: 'POST', url: '/auth/logout' })
    expect(res.statusCode).toBe(204)
    expect(res.cookies[0]).toMatchObject({ name: 'session', value: '' })
  })
})
