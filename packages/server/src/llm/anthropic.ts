import Anthropic from '@anthropic-ai/sdk'
import type { LlmClient, LlmResult } from './llm.js'
import { buildSystem } from './prompt.js'

export const FALLBACK_QUESTION = 'ขอโทษนะ ไม่แน่ใจว่าหมายถึงอะไร ช่วยบอกอีกทีได้ไหม?'

/** The slice of the SDK we use, so tests can inject a fake; the request itself is typed against the SDK. */
export type AnthropicLike = Pick<Anthropic, 'messages'>

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object' as const, properties, required })
const name = { type: 'string', minLength: 1, maxLength: 100 }
const dt = { type: 'string', description: 'ISO 8601 datetime with +07:00 offset' }
const kind = { type: 'string', enum: ['income', 'expense'] }
// Hand-written (not z.toJSONSchema): zod's output drops required on preprocessed dates and inlines huge regexes.
// The server re-validates with actionSchema; test/anthropic.test.ts guards against drift.
const action = {
  oneOf: [
    obj({ type: { const: 'add_transaction' }, kind, amountSatang: { type: 'integer', minimum: 1, description: 'baht x 100' }, category: { ...name, description: "exact name from the user's list" }, occurredAt: dt, note: { type: 'string', maxLength: 255 } },
      ['type', 'kind', 'amountSatang', 'category', 'occurredAt']),
    obj({ type: { const: 'add_event' }, title: name, kind: { type: 'string', enum: ['class', 'appointment'] }, startsAt: dt, endsAt: dt, repeatWeekly: { type: 'boolean' }, leadMinutes: { type: 'integer', minimum: 0, maximum: 10080 } },
      ['type', 'title', 'kind', 'startsAt']),
    obj({ type: { const: 'add_task' }, title: name, priority: { type: 'integer', enum: [1, 2, 3, 4], description: '1 highest, default 3' }, dueAt: dt }, ['type', 'title', 'priority']),
    obj({ type: { const: 'log_habit' }, name: { ...name, description: "exact name from the user's habits" }, day: { type: 'string', description: 'YYYY-MM-DD, omit for today' } }, ['type', 'name']),
    obj({ type: { const: 'add_category' }, name, kind }, ['type', 'name', 'kind']),
    obj({ type: { const: 'query_month' }, month: { type: 'string', description: 'YYYY-MM' } }, ['type', 'month']),
  ],
}
export const TOOL = {
  name: 'record',
  description: 'Return the parsed result: kind "actions" (with actions), "ask" (with question) or "chat" (with reply).',
  input_schema: obj({ kind: { type: 'string', enum: ['actions', 'ask', 'chat'] }, actions: { type: 'array', items: action, minItems: 1, maxItems: 20 }, question: { type: 'string' }, reply: { type: 'string' } }, ['kind']),
} satisfies Anthropic.Tool

type Turn = { role: 'user' | 'assistant'; content: string }
/** History is context only: merge same-role neighbours, start with a user turn, DROP a dangling trailing user turn (never merge it into the current text), skip empty turns. */
export function toMessages(recent: { role: 'user' | 'bot'; text: string }[], text: string): Turn[] {
  const out: Turn[] = []
  for (const m of recent) {
    if (!m.text.trim()) continue // the API rejects empty content
    const role = m.role === 'bot' ? 'assistant' : 'user'
    const last = out.at(-1)
    if (last?.role === role) last.content += `\n${m.text}`
    else if (last || role === 'user') out.push({ role, content: m.text })
  }
  if (out.at(-1)?.role === 'user') out.pop()
  out.push({ role: 'user', content: text })
  return out
}

export class AnthropicLlm implements LlmClient {
  private client: AnthropicLike
  private model: string
  private maxTokens: number
  constructor(o: { apiKey?: string; model?: string; client?: AnthropicLike; timeoutMs?: number; maxTokens?: number; fetch?: typeof fetch } = {}) {
    this.client = o.client ?? new Anthropic({ apiKey: o.apiKey, timeout: o.timeoutMs ?? 15_000, maxRetries: 0, logLevel: 'warn', fetch: o.fetch }) // no SDK retries: handleMessage's own guard would fire while the SDK kept retrying (and billing)
    this.model = o.model || 'claude-haiku-5-5'
    this.maxTokens = o.maxTokens ?? 1024
  }

  // API errors propagate: handleMessage turns them into the apology + a sanitised log event.
  async interpret(input: Parameters<LlmClient['interpret']>[0]): Promise<LlmResult> {
    // No temperature/top_p/top_k: this API version rejects them (typed request: an invalid param fails tsc).
    const req: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model, max_tokens: this.maxTokens,
      system: buildSystem(input.nowIso, input.context),
      messages: toMessages(input.recent, input.text),
      tools: [TOOL], tool_choice: { type: 'tool', name: 'record' },
    }
    const res = await this.client.messages.create(req)
    if (res?.stop_reason !== 'tool_use') return { kind: 'ask', question: FALLBACK_QUESTION } // max_tokens/refusal: output may be partial
    const blocks = Array.isArray(res.content) ? (res.content as { type?: string; name?: string; input?: unknown }[]) : []
    const inp = blocks.find((b) => b?.type === 'tool_use' && b.name === 'record')?.input as { kind?: unknown } | null | undefined
    if (inp && typeof inp === 'object' && (inp.kind === 'actions' || inp.kind === 'ask' || inp.kind === 'chat')) return inp as LlmResult // handleMessage validates the rest
    return { kind: 'ask', question: FALLBACK_QUESTION }
  }
}
