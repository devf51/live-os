import type { Generated } from 'kysely'

// DATETIME columns are UTC; money is integer satang (BIGINT, returned as number by mysql2).
// *_json columns are JSON-encoded text (TEXT on both engines): JSON.stringify on write, JSON.parse on read.
type Id = Generated<number>
type Nullable<T> = T | null

export interface Schema {
  categories: { id: Id; name: string; kind: 'income' | 'expense' }
  transactions: {
    id: Id
    category_id: number
    amount_satang: number
    kind: 'income' | 'expense'
    occurred_at: Date
    note: Nullable<string>
    source_message_id: Nullable<number>
    deleted_at: Nullable<Date>
  }
  budgets: { id: Id; category_id: number; month: string; limit_satang: number }
  tasks: {
    id: Id
    title: string
    priority: number
    due_at: Nullable<Date>
    status: 'todo' | 'done'
    source_message_id: Nullable<number>
    deleted_at: Nullable<Date>
  }
  events: {
    id: Id
    title: string
    kind: 'class' | 'appointment'
    starts_at: Date
    ends_at: Nullable<Date>
    repeat_weekly: boolean
    lead_minutes: Nullable<number>
    source_message_id: Nullable<number>
    deleted_at: Nullable<Date>
  }
  habits: {
    id: Id
    name: string
    freq_type: 'daily' | 'per_week' | 'weekdays'
    freq_value: string
    deleted_at: Nullable<Date>
  }
  habit_logs: { id: Id; habit_id: number; day: string } // DATE via dateStrings
  reminders: {
    id: Id
    kind: 'event' | 'task' | 'budget'
    ref_id: number
    dedupe_key: string
    fire_at: Date
    sent_at: Nullable<Date>
    attempts: number
    level: Nullable<number> // 80 | 100 for budget reminders
    occurs_at: Nullable<Date> // event occurrence instant (UTC)
  }
  push_subscriptions: {
    id: Id
    endpoint: string
    p256dh: string
    auth: string
    created_at: Generated<Date>
  }
  chat_messages: {
    id: Id
    role: 'user' | 'bot'
    text: string
    actions_json: Nullable<string>
    undone_at: Nullable<Date>
    created_at: Generated<Date>
  }
  settings: { key: string; value_json: string }
}
