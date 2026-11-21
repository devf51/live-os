import Anthropic from '@anthropic-ai/sdk'
import type { LlmClient, LlmResult } from './llm.js'
import { buildSystem } from './prompt.js'

export const FALLBACK_QUESTION = 'ขอโทษนะ ไม่แน่ใจว่าหมายถึงอะไร ช่วยบอกอีกทีได้ไหม?'

/** The slice of the SDK we use, so tests can inject a fake. */
export interface AnthropicLike { messages: { create(args: Record<string, unknown>): Promise<{ content?: unknown }> } }

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required })
const str = { type: 'string' }
const dt = { type: 'string', description: 'ISO 8601 datetime with +07:00 offset' }
const kind = { type: 'string', enum: ['income', 'expense'] }
// Hand-written (not z.toJSONSchema): zod's output drops required on preprocessed dates and inlines huge date regexes.
// The server re-validates everything with actionSchema, so this only steers the model.
const action = {
  oneOf: [
    obj({ type: { const: 'add_transaction' }, kind, amountSatang: { type: 'integer', description: 'baht x 100' }, category: { type: 'string', description: "exact name from the user's list" }, occurredAt: dt, note: str },
      ['type', 'kind', 'amountSatang', 'category', 'occurredAt']),
    obj({ type: { const: 'add_event' }, title: str, kind: { type: 'string', enum: ['class', 'appointment'] }, startsAt: dt, endsAt: dt, repeatWeekly: { type: 'boolean' }, leadMinutes: { type: 'integer' } },
      ['type', 'title', 'kind', 'startsAt']),
    obj({ type: { const: 'add_task' }, title: str, priority: { type: 'integer', enum: [1, 2, 3, 4], description: '1 highest' }, dueAt: dt }, ['type', 'title', 'priority']),
    obj({ type: { const: 'log_habit' }, name: { type: 'string', description: "exact name from the user's habits" }, day: { type: 'string', description: 'YYYY-MM-DD, default today' } }, ['type', 'name']),
    obj({ type: { const: 'add_category' }, name: str, kind }, ['type', 'name', 'kind']),
    obj({ type: { const: 'query_month' }, month: { type: 'string', description: 'YYYY-MM' } }, ['type', 'month']),
  ],
}
const TOOL = {
  name: 'record',
  description: 'Return the parsed result: kind "actions" (with actions), "ask" (with question) or "chat" (with reply).',
  input_schema: obj({ kind: { type: 'string', enum: ['actions', 'ask', 'chat'] }, actions: { type: 'array', items: action }, question: str, reply: str }, ['kind']),
}

type Turn = { role: 'user' | 'assistant'; content: string }
function toMessages(recent: { role: 'user' | 'bot'; text: string }[], text: string): Turn[] {
  const out: Turn[] = []
  for (const m of [...recent, { role: 'user' as const, text }]) {
    const role = m.role === 'bot' ? 'assistant' : 'user'
    const last = out.at(-1)
    if (last?.role === role) last.content += `\n${m.text}`
    else if (last || role === 'user') out.push({ role, content: m.text }) // first turn must be a user turn
  }
  return out
}

export class AnthropicLlm implements LlmClient {
  private client: AnthropicLike
  private model: string
  private maxTokens: number
  constructor(o: { apiKey?: string; model?: string; client?: AnthropicLike; timeoutMs?: number; maxTokens?: number } = {}) {
    this.client = o.client ?? (new Anthropic({ apiKey: o.apiKey, timeout: o.timeoutMs ?? 15_000 }) as unknown as AnthropicLike)
    this.model = o.model || 'claude-haiku-5-5'
    this.maxTokens = o.maxTokens ?? 1024
  }

  // API errors propagate: handleMessage turns them into the apology + a sanitised log event.
  async interpret(input: Parameters<LlmClient['interpret']>[0]): Promise<LlmResult> {
    const res = await this.client.messages.create({
      model: this.model, max_tokens: this.maxTokens, temperature: 0,
      system: buildSystem(input.nowIso, input.context),
      messages: toMessages(input.recent, input.text),
      tools: [TOOL], tool_choice: { type: 'tool', name: 'record' },
    })
    const blocks = Array.isArray(res?.content) ? (res.content as { type?: string; name?: string; input?: unknown }[]) : []
    const inp = blocks.find((b) => b?.type === 'tool_use' && b.name === 'record')?.input as { kind?: unknown } | null | undefined
    if (inp && typeof inp === 'object' && (inp.kind === 'actions' || inp.kind === 'ask' || inp.kind === 'chat')) return inp as LlmResult // handleMessage validates the rest
    return { kind: 'ask', question: FALLBACK_QUESTION }
  }
}
