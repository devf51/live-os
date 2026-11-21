import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'

export function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ password }) })
      onDone()
    } catch (err) {
      const s = err instanceof ApiError ? err.status : 0
      setError(s === 429 ? 'ลองหลายครั้งแล้ว รอสักครู่แล้วลองใหม่นะ' : s === 401 ? 'รหัสผ่านไม่ตรง ลองอีกทีนะ' : 'ขออภัย เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง')
    }
  }

  return (
    <main className="page login">
      <h1>สวัสดี 👋</h1>
      <p>ใส่รหัสผ่านเพื่อเข้าไปคุยกันต่อ</p>
      <form onSubmit={submit}>
        <label htmlFor="pw">รหัสผ่าน</label>
        <input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit">เข้าสู่ระบบ</button>
      </form>
    </main>
  )
}
