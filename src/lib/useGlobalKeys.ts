import { onCleanup, onMount } from 'solid-js'
import { actions, getState } from '@/store/useAnimator'
import { engine } from '@/lib/animation/engine'

export function useGlobalKeys() {
  onMount(() => {
    const isTyping = (el: EventTarget | null) => {
      const node = el as HTMLElement | null
      return (
        !!node &&
        (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable)
      )
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const s = getState()
      const mod = e.ctrlKey || e.metaKey
      if (e.code === 'Space') {
        e.preventDefault()
        engine.toggle()
        return
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) actions.redo()
        else actions.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        actions.redo()
        return
      }
      if (mod && e.key.toLowerCase() === 'c') {
        actions.copySelection()
        return
      }
      if (mod && e.key.toLowerCase() === 'v') {
        actions.pasteAtPlayhead()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const hasKeys = Object.values(s.selection.keyIds).some((a) => a.length > 0)
        if (!hasKeys) return
        e.preventDefault()
        actions.deleteSelectedKeys()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown))
  })
}
