import * as React from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn('flex h-11 w-full rounded-xl border border-border bg-card px-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', className)} {...props} />
}
