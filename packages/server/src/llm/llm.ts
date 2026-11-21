import type { LlmResult } from '../chat/actions.js'

export type { LlmResult }

/** The model only translates Thai into proposed actions; it never sees DB ids and never writes. */
/** The user's own category and habit names: the server resolves both BY NAME, so the model must pick from these. */
export interface LlmContext { categories: { name: string; kind: 'income' | 'expense' }[]; habits: string[] }

export interface LlmClient {
  interpret(input: { text: string; nowIso: string; recent: { role: 'user' | 'bot'; text: string }[]; context: LlmContext }): Promise<LlmResult>
}
