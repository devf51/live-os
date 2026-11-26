import { useCallback, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { api } from './api'
import { Button } from '@/components/ui/button'

export type Load<T> = { data: T | null; error: boolean; reload: () => void; setData: Dispatch<SetStateAction<T | null>> }

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
export function Screen({ loads, children }: { loads: Pick<Load<unknown>, 'data' | 'error' | 'reload'>[]; children: ReactNode }) {
  const failed = loads.some((l) => l.error)
  const ready = loads.every((l) => l.data !== null)
  return (
    <main className="flex min-h-0 flex-1 flex-col px-4">
      {failed ? (
        <div className="grid gap-3 py-4">
          <p role="alert" className="text-destructive">ขออภัย โหลดข้อมูลไม่ได้ ลองใหม่อีกครั้งนะ</p>
          <Button onClick={() => loads.forEach((l) => l.reload())}>ลองใหม่</Button>
        </div>
      ) : ready ? children : null}
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{!failed && !ready ? 'กำลังโหลด…' : ''}</p>
    </main>
  )
}
