import type { LlmClient, LlmResult } from './llm.js'

type Input = Parameters<LlmClient['interpret']>[0]

/** Scripted stand-in: a text -> result map, or a function (may throw, or never resolve). */
export class FakeLlm implements LlmClient {
  readonly calls: Input[] = []
  constructor(private script: Record<string, LlmResult> | ((input: Input) => LlmResult | Promise<LlmResult>)) {}
  async interpret(input: Input): Promise<LlmResult> {
    this.calls.push(input)
    if (typeof this.script === 'function') return this.script(input)
    const r = this.script[input.text]
    if (!r) throw new Error(`FakeLlm: no script for "${input.text}"`)
    return r
  }
}
