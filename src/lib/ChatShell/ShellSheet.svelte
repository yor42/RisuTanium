<script lang="ts">
    import { tick, untrack, type Snippet } from 'svelte'
    import { language } from 'src/lang'
    import { backCloseHandler, registerBackHandler } from '../../ts/backHandlers'
    import { isTopmostShell, makeInert, registerShell, returnFocus, trapTab, watchFocus } from '../Nexus/pattern/patternFocus'
    import { asShellFocus } from '../../ts/chatShell/shellFocus'
    import { createSheetDrag, type SheetRelease } from '../../ts/chatShell/sheetDrag'

    interface Props {
        open: boolean
        kind: 'sheet' | 'menu'
        // `tall` fills 92 % of the height; `side` is a 380 px panel on the right from 900 px up and `tall` below it.
        mode?: 'bottom' | 'action' | 'wide-menu' | 'tall' | 'side'
        anchor?: { x: number; y: number }
        // Read only by `wide-menu`: `above` anchors the panel's bottom edge to the opener's top edge instead of hanging it below.
        placement?: 'below' | 'above'
        label: string
        opener?: HTMLElement | null
        background?: readonly HTMLElement[]
        inertOutside?: boolean
        // Asked before Escape closes the sheet: true means an inner layer (a field being edited) consumed the key.
        innerescape?: () => boolean
        // The sheet's layer element, for a caller that has to hold it inert behind a layer of its own.
        layer?: HTMLElement
        onclose: () => void
        children: Snippet
    }

    let { open, kind, mode = 'bottom', anchor, placement = 'below', label, opener = null, background = [], inertOutside = false, innerescape, layer = $bindable(), onclose, children }: Props = $props()
    let panel = $state<HTMLElement>()
    let popupPosition = $state<{ left: number; top?: number; bottom?: number; maxHeight?: number }>({ left: 0, top: 0 })
    const token = {}
    let closing = false

    // Above placement anchors the panel's bottom edge to the opener's top edge; the list scrolls inside the panel.
    // Anchoring by `bottom` keeps the panel on the opener when the window height changes, and the resize listener re-reads the opener's rect.
    $effect(() => {
        if (!open || mode !== 'wide-menu' || !panel) return
        const shell = panel
        const above = placement === 'above'
        const place = () => {
            const bounds = opener?.getBoundingClientRect()
            const point = anchor ?? (bounds ? { x: bounds.left, y: above ? bounds.top : bounds.bottom } : { x: 0, y: 0 })
            const left = Math.max(0, Math.min(point.x, window.innerWidth - shell.offsetWidth))
            popupPosition = above
                ? { left, bottom: window.innerHeight - point.y, maxHeight: point.y }
                : { left, top: Math.max(0, Math.min(point.y, window.innerHeight - shell.offsetHeight)) }
        }
        place()
        if (!above) return
        window.addEventListener('resize', place)
        return () => window.removeEventListener('resize', place)
    })

    // Everything that shares an ancestor with the layer but is not on its path, so a sheet hosted where the caller has no list stays modal.
    function outsideLayer(shell: HTMLElement): HTMLElement[] {
        const outside: HTMLElement[] = []
        let node: HTMLElement | null = shell.parentElement
        while (node && node !== document.body) {
            const parent: HTMLElement | null = node.parentElement
            if (!parent) break
            for (const sibling of Array.from(parent.children)) {
                if (sibling !== node && sibling instanceof HTMLElement && !['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'].includes(sibling.tagName)) outside.push(sibling)
            }
            node = parent
        }
        return outside
    }

    function close(): void {
        if (!open || closing) return
        closing = true
        onclose()
    }

    // A long press opens the sheet under the finger: the click the browser synthesises when that touch lifts lands on the scrim and must not close it.
    // Only a touch that began before the sheet opened is the opener's; a later tap on the scrim is a deliberate dismissal.
    const SCRIM_TOUCH_GRACE_MS = 400
    let touchActive = false
    let touchStartedAt = -Infinity
    let touchEndedAt = -Infinity
    let openedAt = Infinity
    $effect(() => {
        const isTouch = (event: PointerEvent) => event.pointerType === 'touch' || event.pointerType === 'pen'
        const down = (event: PointerEvent) => { if (isTouch(event)) { touchActive = true; touchStartedAt = performance.now() } }
        const up = (event: PointerEvent) => { if (isTouch(event)) { touchActive = false; touchEndedAt = performance.now() } }
        document.addEventListener('pointerdown', down, true)
        document.addEventListener('pointerup', up, true)
        document.addEventListener('pointercancel', up, true)
        return () => {
            document.removeEventListener('pointerdown', down, true)
            document.removeEventListener('pointerup', up, true)
            document.removeEventListener('pointercancel', up, true)
        }
    })
    // Drag down by the handle (CHORE-726). The section follows the finger; `moved` stays set for the rest of this open so the entry
    // animation can never take the transform back; a release travels to rest or off screen, then the sheet closes the normal way.
    const drag = createSheetDrag()
    let dragPointer: number | null = null
    let dragHeight = 0
    let dragY = $state(0)
    let dragging = $state(false)
    let moved = $state(false)
    let settle = $state<SheetRelease | null>(null)
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    function resetDrag(): void {
        clearTimeout(settleTimer)
        settleTimer = undefined
        drag.cancel()
        dragPointer = null
        dragHeight = 0
        dragY = 0
        dragging = false
        moved = false
        settle = null
    }
    function onHandleDown(event: PointerEvent): void {
        if (event.pointerType === 'mouse' || dragPointer !== null || settle !== null || closing) return
        dragPointer = event.pointerId
        dragHeight = panel?.offsetHeight ?? 0
        ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
        drag.down(event.clientY, event.timeStamp)
    }
    function onHandleMove(event: PointerEvent): void {
        if (event.pointerId !== dragPointer) return
        const offset = drag.move(event.clientY, event.timeStamp)
        if (!drag.engaged()) return
        dragging = true
        moved = true
        dragY = offset
    }
    function onHandleUp(event: PointerEvent): void {
        if (event.pointerId !== dragPointer) return
        dragPointer = null
        const release = drag.up(event.clientY, event.timeStamp, dragHeight)
        if (dragging) void finishDrag(release)
    }
    // A cancel or a lost capture ends only the gesture still in progress; after a release the pointer is no longer the sheet's.
    function onHandleCancel(event: PointerEvent): void {
        if (event.pointerId !== dragPointer) return
        dragPointer = null
        drag.cancel()
        if (dragging) void finishDrag('stay')
    }
    // The longest transition the section now has, read after the settle state is applied; 0 when none resolves.
    function settleMs(): number {
        if (!panel) return 0
        const values = getComputedStyle(panel).transitionDuration.split(',').map((part) => {
            const text = part.trim()
            const amount = parseFloat(text)
            return Number.isFinite(amount) ? (text.endsWith('ms') ? amount : amount * 1000) : 0
        })
        return Math.max(0, ...values)
    }
    async function finishDrag(release: SheetRelease): Promise<void> {
        dragging = false
        settle = release
        if (release === 'stay') dragY = 0
        await tick()
        if (settle !== release) return
        const done = () => {
            settleTimer = undefined
            if (release === 'close') close()
            else { settle = null; dragY = 0 }
        }
        const ms = settleMs()
        if (ms > 0) settleTimer = setTimeout(done, ms)
        else done()
    }
    function sheetTransform(): string | undefined {
        if (settle === 'close') return 'translateY(100%)'
        return dragging || settle !== null ? `translateY(${dragY}px)` : undefined
    }
    function scrimDrag(): string | undefined {
        if (settle === 'close') return '1'
        if (!dragging || dragHeight <= 0) return undefined
        return String(Math.min(1, dragY / dragHeight))
    }

    function scrimClick(): void {
        const fromOpeningTouch = touchStartedAt <= openedAt && (touchActive || performance.now() - touchEndedAt < SCRIM_TOUCH_GRACE_MS)
        if (!fromOpeningTouch) close()
    }

    $effect(() => {
        const shell = open ? panel : undefined
        if (!shell) return
        closing = false
        untrack(() => resetDrag())
        openedAt = performance.now()
        const savedOpener = untrack(() => opener)
        const restoreInert = makeInert(untrack(() => inertOutside ? outsideLayer(shell) : background))
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
                if (!event.repeat && !event.isComposing && event.keyCode !== 229 && innerescape?.() !== true) close()
                return
            }
            trapTab(event, shell)
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => {
            untrack(() => resetDrag())
            window.removeEventListener('keydown', onKeyDown, true)
            stopWatching()
            unregisterBack()
            unregisterShell()
            restoreInert()
            const restored = asShellFocus(() => returnFocus(savedOpener))
            document.dispatchEvent(new CustomEvent('chat:sheetclosed', { detail: { kind, opener: savedOpener, restored } }))
        }
    })
</script>

{#if open}
    <div bind:this={layer} data-part="chat-sheet-layer" data-mode={mode} data-settle={settle ?? undefined} style:--sheet-drag={scrimDrag()}>
        <button data-part="chat-sheet-scrim" aria-label={language.cancel} onclick={scrimClick}></button>
        <section bind:this={panel} data-part="chat-sheet" data-mode={mode} style:left={mode === 'wide-menu' ? `${popupPosition.left}px` : undefined} style:top={mode === 'wide-menu' && popupPosition.top !== undefined ? `${popupPosition.top}px` : undefined} style:bottom={mode === 'wide-menu' && popupPosition.bottom !== undefined ? `${popupPosition.bottom}px` : undefined} style:max-height={mode === 'wide-menu' && popupPosition.maxHeight !== undefined ? `${popupPosition.maxHeight}px` : undefined} role={kind === 'menu' ? 'menu' : 'dialog'} aria-label={label} aria-modal={kind === 'menu' ? undefined : 'true'} tabindex="-1" style:transform={sheetTransform()} data-dragging={dragging ? '' : undefined} data-moved={moved ? '' : undefined}>
            {#if mode !== 'wide-menu'}
                <!-- The handle is a touch affordance only: Back, Escape and the scrim stay the accessible ways to close. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div data-part="chat-sheet-handle" aria-hidden="true" onpointerdown={onHandleDown} onpointermove={onHandleMove} onpointerup={onHandleUp} onpointercancel={onHandleCancel} onlostpointercapture={onHandleCancel}></div>
            {/if}
            {@render children()}
        </section>
    </div>
{/if}

<style>
    [data-part="chat-sheet-layer"] { position: fixed; inset: 0; z-index: var(--pattern-z-layer); display: flex; align-items: end; justify-content: center; }
    [data-part="chat-sheet-scrim"] { position: absolute; inset: 0; width: 100%; background: var(--color-scrim); opacity: calc(var(--opacity-scrim) * (1 - var(--sheet-drag, 0))); border: 0; }
    [data-part="chat-sheet"] { position: relative; width: 100%; max-height: 100%; overflow: auto; padding: var(--sheet-padding-bottom) var(--sheet-padding-x); border-radius: var(--radius-sheet) var(--radius-sheet) 0 0; background: var(--color-surface-sheet); color: var(--nexus-text); border: 1px solid var(--nexus-edge); animation: sheet-in var(--chat-dur-base) var(--chat-ease-out) both; }
    [data-part="chat-sheet"][data-mode="action"] { max-height: 60%; }
    [data-part="chat-sheet"][data-mode="tall"], [data-part="chat-sheet"][data-mode="side"] { height: 92%; max-height: 92%; }
    [data-part="chat-sheet"][data-mode="action"] :global([data-destructive-group]) { position: sticky; bottom: 0; background: var(--color-surface-sheet); }
    [data-part="chat-sheet"][data-mode="wide-menu"] { position: fixed; width: min(100%, var(--sheet-width-popup)); border-radius: var(--radius-popup); }
    @media (min-width: 900px) { [data-part="chat-sheet"] { max-width: var(--sheet-width-tall); border-radius: var(--radius-sheet); margin-bottom: var(--space-16); } [data-part="chat-sheet"][data-mode="wide-menu"] { margin-bottom: 0; } }
    @media (min-width: 900px) { [data-part="chat-sheet-layer"][data-mode="side"] { justify-content: flex-end; align-items: stretch; } [data-part="chat-sheet"][data-mode="side"] { width: var(--sheet-width-panel); max-width: var(--sheet-width-panel); height: 100%; max-height: 100%; margin-bottom: 0; border-radius: var(--radius-sheet) 0 0 var(--radius-sheet); } }
    @keyframes sheet-in { from { transform: translateY(var(--space-16)); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    @keyframes sheet-fade { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { :global(html:not(.rm-off)) [data-part="chat-sheet"] { animation: sheet-fade var(--chat-dur-fast) var(--chat-ease-out) both; } }
    :global(html.rm) [data-part="chat-sheet"] { animation: sheet-fade var(--chat-dur-fast) var(--chat-ease-out) both; }
    :global(html[data-low-power]) [data-part="chat-sheet"], :global(html.nexus-low-power) [data-part="chat-sheet"] { animation: sheet-fade var(--dur-lowpower-cap) var(--chat-ease-out) both; }
    @media (prefers-reduced-motion: reduce) { :global(html:not(.rm-off)[data-low-power]) [data-part="chat-sheet"] { animation: sheet-fade var(--chat-dur-fast) var(--chat-ease-out) both; } }
    :global(html.rm[data-low-power]) [data-part="chat-sheet"] { animation: sheet-fade var(--chat-dur-fast) var(--chat-ease-out) both; }
    :global(html.rm.nexus-low-power) [data-part="chat-sheet"] { animation: sheet-fade var(--chat-dur-fast) var(--chat-ease-out) both; }
    /* Drag down by the handle (CHORE-726): only transform and opacity move. */
    /* The handle scrolls with the content: callers keep their own sticky title bars at the top of the sheet. */
    [data-part="chat-sheet-handle"] { height: var(--size-touch); margin: calc(-1 * var(--sheet-padding-bottom)) calc(-1 * var(--sheet-padding-x)) 0; display: flex; align-items: center; justify-content: center; background: var(--color-surface-sheet); touch-action: none; }
    [data-part="chat-sheet-handle"]::before { content: ''; width: var(--size-19); height: var(--stroke-heavy); border-radius: var(--radius-pill); background: var(--nexus-edge-strong); }
    @media (min-width: 900px) { [data-part="chat-sheet"][data-mode="side"] [data-part="chat-sheet-handle"] { display: none; } }
    [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet"], [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet-scrim"] { transition: transform var(--chat-dur-base) var(--chat-ease-out), opacity var(--chat-dur-base) var(--chat-ease-out); }
    @media (prefers-reduced-motion: reduce) { :global(html:not(.rm-off)) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet"], :global(html:not(.rm-off)) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet-scrim"] { transition-duration: var(--chat-dur-fast); } }
    :global(html.rm) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet"], :global(html.rm) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet-scrim"] { transition-duration: var(--chat-dur-fast); }
    :global(html[data-low-power]) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet"], :global(html[data-low-power]) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet-scrim"], :global(html.nexus-low-power) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet"], :global(html.nexus-low-power) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet-scrim"] { transition-duration: var(--dur-lowpower-cap); }
    @media (prefers-reduced-motion: reduce) { :global(html:not(.rm-off)[data-low-power]) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet"], :global(html:not(.rm-off)[data-low-power]) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet-scrim"], :global(html:not(.rm-off).nexus-low-power) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet"], :global(html:not(.rm-off).nexus-low-power) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet-scrim"] { transition-duration: var(--chat-dur-fast); } }
    :global(html.rm[data-low-power]) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet"], :global(html.rm[data-low-power]) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet-scrim"], :global(html.rm.nexus-low-power) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet"], :global(html.rm.nexus-low-power) [data-part="chat-sheet-layer"][data-settle] [data-part="chat-sheet-scrim"] { transition-duration: var(--chat-dur-fast); }
    [data-part="chat-sheet"][data-dragging] { transition: none; }
    /* Once moved, the entry animation stays off for this open: it must lose to nothing, or its fill would take the transform back. */
    [data-part="chat-sheet"][data-moved] { animation: none !important; }
</style>
