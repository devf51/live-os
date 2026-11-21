import { useRef, useState } from 'react'
import { api } from '../api'
import { useLoad, Screen } from '../useLoad'

type Habit = { id: number; name: string; done: boolean }

export function Habits() {
  const l = useLoad<Habit[]>('/habits')
  const [err, setErr] = useState('')
  const pending = useRef(new Set<number>())
  const mark = (id: number, done: boolean) => l.setData((prev) => prev && prev.map((h) => (h.id === id ? { ...h, done } : h)))

  async function tap(h: Habit) {
    if (pending.current.has(h.id)) return
    pending.current.add(h.id)
    setErr('')
    mark(h.id, true)
    try {
      await api(`/habits/${h.id}/logs`, { method: 'POST' })
    } catch {
      mark(h.id, false)
      setErr(`ยังจดว่าทำ "${h.name}" ไม่ได้ ลองใหม่อีกครั้งนะ`)
    } finally {
      pending.current.delete(h.id)
    }
  }

  return (
    <Screen title="นิสัย" loads={[l]}>
      {err && <p role="alert" className="error">{err}</p>}
      {l.data?.length ? (
        <ul className="plain">
          {l.data.map((h) => (
            <li key={h.id}>
              <button className={h.done ? 'habit done' : 'habit'} disabled={h.done} onClick={() => tap(h)}>
                <span aria-hidden="true">{h.done ? '✅' : '⚪'}</span> {h.name}{h.done ? ' (ทำแล้ว)' : ''}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>ยังไม่มีนิสัยที่ติดตาม บอกในแชทได้เลยนะ</p>
      )}
    </Screen>
  )
}
