import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ password }) })
      onDone()
    } catch (err) {
      const s = err instanceof ApiError ? err.status : 0
      setError(s === 429 ? 'ลองหลายครั้งแล้ว รอสักครู่แล้วลองใหม่นะ' : s === 401 ? 'รหัสผ่านไม่ตรง ลองอีกทีนะ' : 'ขออภัย เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง')
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto grid max-w-sm gap-3 p-6 pt-16">
      <h1 className="text-2xl font-semibold">สวัสดี 👋</h1>
      <p>ใส่รหัสผ่านเพื่อเข้าไปคุยกันต่อ</p>
      <form onSubmit={submit} className="grid gap-3">
        <label htmlFor="pw">รหัสผ่าน</label>
        <Input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <Button type="submit" disabled={busy}>เข้าสู่ระบบ</Button>
      </form>
    </main>
  )
}
