import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'

export type Load<T> = { data: T | null; error: boolean; reload: () => void; setData: (d: T) => void }

export function useLoad<T>(path: string): Load<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState(false)
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    setError(false)
    api<T>(path).then((d) => live && setData(d), () => live && setError(true))
    return () => { live = false }
  }, [path, n])
  const reload = useCallback(() => { setData(null); setN((x) => x + 1) }, [])
  return { data, error, reload, setData }
}

// Shared loading / error(+retry) shell; renders children only when loaded.
export function Screen({ title, loads, children }: { title: string; loads: Pick<Load<unknown>, 'data' | 'error' | 'reload'>[]; children: ReactNode }) {
  const failed = loads.some((l) => l.error)
  const ready = loads.every((l) => l.data !== null)
  return (
    <main className="page">
      <h1>{title}</h1>
      {failed ? (
        <>
          <p role="alert" className="error">ขออภัย โหลดข้อมูลไม่ได้ ลองใหม่อีกครั้งนะ</p>
          <button onClick={() => loads.forEach((l) => l.reload())}>ลองใหม่</button>
        </>
      ) : ready ? children : <p role="status">กำลังโหลด…</p>}
    </main>
  )
}
