<script lang="ts">
    import { untrack, type Snippet } from 'svelte'
    import { language } from 'src/lang'
    import { backCloseHandler, registerBackHandler } from '../../ts/backHandlers'
    import { isTopmostShell, makeInert, registerShell, returnFocus, trapTab, watchFocus } from '../Nexus/pattern/patternFocus'

    interface Props {
        open: boolean
        kind: 'sheet' | 'menu'
        mode?: 'bottom' | 'action' | 'wide-menu'
        anchor?: { x: number; y: number }
        label: string
        opener?: HTMLElement | null
        background?: readonly HTMLElement[]
        onclose: () => void
        children: Snippet
    }

    let { open, kind, mode = 'bottom', anchor, label, opener = null, background = [], onclose, children }: Props = $props()
    let panel = $state<HTMLElement>()
    let popupPosition = $state({ left: 0, top: 0 })
    const token = {}
    let closing = false

    $effect(() => {
        if (!open || mode !== 'wide-menu' || !panel) return
        const point = anchor ?? (opener ? { x: opener.getBoundingClientRect().left, y: opener.getBoundingClientRect().bottom } : { x: 0, y: 0 })
        const width = panel.offsetWidth
        const height = panel.offsetHeight
        popupPosition = {
            left: Math.max(0, Math.min(point.x, window.innerWidth - width)),
            top: Math.max(0, Math.min(point.y, window.innerHeight - height)),
        }
    })

    function close(): void {
        if (!open || closing) return
        closing = true
        onclose()
    }

    $effect(() => {
        const shell = open ? panel : undefined
        if (!shell) return
        closing = false
        const savedOpener = untrack(() => opener)
        const restoreInert = makeInert(untrack(() => background))
        const unregisterShell = registerShell(token)
        const unregisterBack = registerBackHandler(backCloseHandler({
            isOpen: () => open && !closing,
            snapshot: () => open && !closing,
            close,
        }))
        const initial = shell.querySelector<HTMLElement>('[data-sheet-initial]') ?? shell
        initial.focus()
        const stopWatching = watchFocus(shell, shell, () => isTopmostShell(token))
        const onKeyDown = (event: KeyboardEvent) => {
            if (!isTopmostShell(token)) return
            if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                if (!event.repeat && !event.isComposing && event.keyCode !== 229) close()
                return
            }
            trapTab(event, shell)
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => {
            window.removeEventListener('keydown', onKeyDown, true)
            stopWatching()
            unregisterBack()
            unregisterShell()
            restoreInert()
            const restored = returnFocus(savedOpener)
            document.dispatchEvent(new CustomEvent('chat:sheetclosed', { detail: { kind, opener: savedOpener, restored } }))
        }
    })
</script>

{#if open}
    <div data-part="chat-sheet-layer" data-mode={mode}>
        <button data-part="chat-sheet-scrim" aria-label={language.cancel} onclick={close}></button>
        <section bind:this={panel} data-part="chat-sheet" data-mode={mode} style:left={mode === 'wide-menu' ? `${popupPosition.left}px` : undefined} style:top={mode === 'wide-menu' ? `${popupPosition.top}px` : undefined} role={kind === 'menu' ? 'menu' : 'dialog'} aria-label={label} aria-modal={kind === 'menu' ? undefined : 'true'} tabindex="-1">
            {@render children()}
        </section>
    </div>
{/if}

<style>
    [data-part="chat-sheet-layer"] { position: fixed; inset: 0; z-index: var(--pattern-z-layer); display: flex; align-items: end; justify-content: center; }
    [data-part="chat-sheet-scrim"] { position: absolute; inset: 0; width: 100%; background: var(--color-scrim); opacity: var(--opacity-scrim); border: 0; }
    [data-part="chat-sheet"] { position: relative; width: 100%; max-height: 100%; overflow: auto; padding: var(--sheet-padding-bottom) var(--sheet-padding-x); border-radius: var(--radius-sheet) var(--radius-sheet) 0 0; background: var(--color-surface-sheet); color: var(--nexus-text); border: 1px solid var(--nexus-edge); animation: sheet-in var(--chat-dur-base) var(--chat-ease-out) both; }
    [data-part="chat-sheet"][data-mode="action"] { max-height: 60%; }
    [data-part="chat-sheet"][data-mode="action"] :global([data-destructive-group]) { position: sticky; bottom: 0; background: var(--color-surface-sheet); }
    [data-part="chat-sheet"][data-mode="wide-menu"] { position: fixed; width: min(100%, var(--sheet-width-popup)); border-radius: var(--radius-popup); }
    @media (min-width: 900px) { [data-part="chat-sheet"] { max-width: var(--sheet-width-tall); border-radius: var(--radius-sheet); margin-bottom: var(--space-16); } [data-part="chat-sheet"][data-mode="wide-menu"] { margin-bottom: 0; } }
    @keyframes sheet-in { from { transform: translateY(var(--space-16)); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    @keyframes sheet-fade { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { [data-part="chat-sheet"] { animation: sheet-fade var(--chat-dur-fast) var(--chat-ease-out) both; } }
    :global(html.rm) [data-part="chat-sheet"] { animation: sheet-fade var(--chat-dur-fast) var(--chat-ease-out) both; }
    :global(html[data-low-power]) [data-part="chat-sheet"], :global(html.nexus-low-power) [data-part="chat-sheet"] { animation: sheet-fade var(--dur-lowpower-cap) var(--chat-ease-out) both; }
    @media (prefers-reduced-motion: reduce) { :global(html[data-low-power]) [data-part="chat-sheet"] { animation: sheet-fade var(--chat-dur-fast) var(--chat-ease-out) both; } }
    :global(html.rm[data-low-power]) [data-part="chat-sheet"] { animation: sheet-fade var(--chat-dur-fast) var(--chat-ease-out) both; }
    :global(html.rm.nexus-low-power) [data-part="chat-sheet"] { animation: sheet-fade var(--chat-dur-fast) var(--chat-ease-out) both; }
</style>
