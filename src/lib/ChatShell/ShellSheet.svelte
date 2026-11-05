<script lang="ts">
    import { untrack, type Snippet } from 'svelte'
    import { backCloseHandler, registerBackHandler } from '../../ts/backHandlers'
    import { isTopmostShell, makeInert, registerShell, returnFocus, trapTab, watchFocus } from '../Nexus/pattern/patternFocus'

    interface Props {
        open: boolean
        kind: 'sheet' | 'menu'
        label: string
        opener?: HTMLElement | null
        background?: readonly HTMLElement[]
        onclose: () => void
        children: Snippet
    }

    let { open, kind, label, opener = null, background = [], onclose, children }: Props = $props()
    let panel = $state<HTMLElement>()
    const token = {}
    let closing = false

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
    <div data-part="chat-sheet-layer" data-part-critical>
        <button data-part="chat-sheet-backdrop" aria-label={label} onclick={close}></button>
        <section bind:this={panel} data-part="chat-sheet" data-part-critical role={kind === 'menu' ? 'menu' : 'dialog'} aria-label={label} aria-modal="true" tabindex="-1">
            {@render children()}
        </section>
    </div>
{/if}

<style>
    [data-part="chat-sheet-layer"] { position: fixed; inset: 0; z-index: 60; display: flex; align-items: end; justify-content: center; }
    [data-part="chat-sheet-backdrop"] { position: absolute; inset: 0; width: 100%; background: var(--color-darkbg); opacity: .5; border: 0; }
    [data-part="chat-sheet"] { position: relative; width: 100%; max-height: min(80dvh, 640px); overflow: auto; padding: 16px; border-radius: 16px 16px 0 0; background: var(--color-bgcolor); color: var(--color-textcolor); border: 1px solid var(--color-darkborderc); }
    @media (min-width: 900px) { [data-part="chat-sheet"] { max-width: 480px; border-radius: 16px; margin-bottom: 24px; } }
    @media (prefers-reduced-motion: no-preference) { [data-part="chat-sheet"] { animation: sheet-in 200ms cubic-bezier(.2,.8,.2,1); } }
    @keyframes sheet-in { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
</style>
