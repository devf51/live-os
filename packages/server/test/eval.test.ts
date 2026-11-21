import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadCases } from '../eval/cases.js'

describe('eval case file', () => {
  it('is well-formed: >= 40 cases, unique ids, critical cases present', () => {
    const cases = loadCases()
    expect(cases.length).toBeGreaterThanOrEqual(40)
    expect(cases.filter((c) => c.critical).length).toBeGreaterThanOrEqual(20)
    expect(new Set(cases.map((c) => c.expect.kind))).toEqual(new Set(['actions', 'ask', 'chat']))
  })
  it('--dry runs without an API key; a real run without a key fails fast', () => {
    const cwd = fileURLToPath(new URL('..', import.meta.url))
    const env = { ...process.env, ANTHROPIC_API_KEY: '' }
    const dry = execFileSync(process.execPath, ['--import', 'tsx', 'eval/run-eval.ts', '--dry'], { cwd, env, encoding: 'utf8' })
    expect(dry).toContain('dry run ok')
    expect(() => execFileSync(process.execPath, ['--import', 'tsx', 'eval/run-eval.ts'], { cwd, env, encoding: 'utf8', stdio: 'pipe' })).toThrow(/ANTHROPIC_API_KEY is not set/)
  }, 30_000)
})

describe('eval compare', () => {
  const c = loadCases().find((x) => x.id === 'ev-tomorrow-9')!
  const ev = (startsAt: string) => ({ kind: 'actions', actions: [{ type: 'add_event', kind: 'appointment', title: 'หมอฟัน', startsAt }] })
  it('compares Bangkok date and time, not UTC', async () => {
    const { compare } = await import('../eval/compare.js')
    expect(compare(c, ev('2026-11-22T09:00:00+07:00')).pass).toBe(true)
    expect(compare(c, ev('2026-11-22T02:00:00Z')).pass).toBe(true)
    expect(compare(c, ev('2026-11-23T09:00:00+07:00'))).toMatchObject({ pass: false, dateOk: false })
    expect(compare(c, ev('2026-11-22T10:00:00+07:00')).pass).toBe(false)
    expect(compare(c, { kind: 'ask' }).pass).toBe(false)
  })
  it('flags wrong amounts', async () => {
    const { compare } = await import('../eval/compare.js')
    const t = loadCases().find((x) => x.id === 'amt-plain')!
    const got = (amountSatang: number) => ({ kind: 'actions', actions: [{ type: 'add_transaction', kind: 'expense', category: 'อาหาร', amountSatang, occurredAt: '2026-11-21T12:00:00+07:00' }] })
    expect(compare(t, got(8000)).pass).toBe(true)
    expect(compare(t, got(80))).toMatchObject({ pass: false, money: true, moneyOk: false })
  })
})
