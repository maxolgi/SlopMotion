import {
  Show,
  createContext,
  createEffect,
  onCleanup,
  useContext,
  type ParentProps,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import { X } from 'lucide-solid'
import { cn } from '@/lib/utils'

// ─── Hand-rolled Dialog primitive (Solid port of the shadcn surface) ─────────

type DialogProps = ParentProps<{
  open: boolean
  onOpenChange?: (open: boolean) => void
}>

const DialogContext = createContext<{ close: () => void }>()

export function Dialog(props: DialogProps) {
  const close = () => props.onOpenChange?.(false)

  createEffect(() => {
    if (!props.open) return
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeydown)
    onCleanup(() => window.removeEventListener('keydown', onKeydown))
  })

  return (
    <DialogContext.Provider value={{ close }}>
      <Show when={props.open}>
        <Portal>{props.children}</Portal>
      </Show>
    </DialogContext.Provider>
  )
}

export function DialogContent(props: ParentProps<{ class?: string }>) {
  const ctx = useContext(DialogContext)
  return (
    <>
      <div class="fixed inset-0 z-50 bg-black/60" onClick={() => ctx?.close()} />
      <div
        role="dialog"
        aria-modal="true"
        class={cn(
          'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg',
          props.class,
        )}
      >
        {props.children}
        <button
          class="absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:outline-hidden"
          onClick={() => ctx?.close()}
        >
          <X class="size-4" />
          <span class="sr-only">Close</span>
        </button>
      </div>
    </>
  )
}

export function DialogHeader(props: ParentProps<{ class?: string }>) {
  return (
    <div class={cn('flex flex-col gap-2 text-center sm:text-left', props.class)}>
      {props.children}
    </div>
  )
}

export function DialogTitle(props: ParentProps<{ class?: string }>) {
  return <h2 class={cn('text-lg leading-none font-semibold', props.class)}>{props.children}</h2>
}

export function DialogDescription(props: ParentProps<{ class?: string }>) {
  return <p class={cn('text-muted-foreground text-sm', props.class)}>{props.children}</p>
}
