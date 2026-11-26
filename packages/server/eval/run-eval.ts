// Usage: ANTHROPIC_API_KEY=... npx tsx eval/run-eval.ts [--dry]   (from packages/server; or `npm run eval -w packages/server`)
import { AnthropicLlm } from '../src/llm/anthropic.js'
import { buildSystem } from '../src/llm/prompt.js'
import { compare } from './compare.js'
import { loadCases } from './cases.js'

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}% (${n}/${d})` : 'n/a')

async function main() {
  const dry = process.argv.includes('--dry')
  const cases = loadCases()
  if (dry) {
    for (const c of cases) buildSystem(c.nowIso, c.context)
    console.log(`dry run ok: ${cases.length} cases, ${cases.filter((c) => c.critical).length} critical, prompts build`)
    return
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { console.error('ANTHROPIC_API_KEY is not set (use --dry to validate the case file without the API)'); process.exit(2) }
  const llm = new AnthropicLlm({ apiKey, model: process.env.ANTHROPIC_MODEL })
  let pass = 0, mT = 0, mP = 0, dT = 0, dP = 0, critFail = 0
  for (const c of cases) {
    let r: ReturnType<typeof compare>
    try {
      r = compare(c, (await llm.interpret({ text: c.input, nowIso: c.nowIso, recent: [], context: c.context })) as never)
    } catch (e) {
      r = { pass: false, diffs: [`API error: ${e instanceof Error ? e.name : 'unknown'}${(e as { status?: number })?.status ? ` ${(e as { status?: number }).status}` : ''}`], money: false, moneyOk: false, date: false, dateOk: false }
    }
    if (r.pass) pass++
    else if (c.critical) critFail++
    if (r.money) { mT++; if (r.moneyOk) mP++ }
    if (r.date) { dT++; if (r.dateOk) dP++ }
    console.log(`${r.pass ? 'PASS' : 'FAIL'}${c.critical ? '*' : ' '} ${c.id}${r.pass ? '' : `\n      ${c.input}\n      ${r.diffs.join('\n      ')}`}`)
  }
  console.log(`\nOverall ${pct(pass, cases.length)} | amounts ${pct(mP, mT)} | dates ${pct(dP, dT)} | critical failures ${critFail} (* = critical)`)
  if (critFail) process.exit(1)
}
await main()
