import type { LlmResult } from '../chat/actions.js'

export type { LlmResult }

/** The model only translates Thai into proposed actions; it never sees DB ids and never writes. */
export interface LlmClient {
  interpret(input: { text: string; nowIso: string; recent: { role: 'user' | 'bot'; text: string }[] }): Promise<LlmResult>
}
