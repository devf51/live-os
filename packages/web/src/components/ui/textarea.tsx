import * as React from 'react'
import { cn } from '@/lib/utils'

export function Textarea({ className, ref, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea ref={ref} className={cn('flex max-h-32 min-h-11 w-full resize-none rounded-2xl border border-border bg-card px-3 py-2.5 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', className)} {...props} />
}
