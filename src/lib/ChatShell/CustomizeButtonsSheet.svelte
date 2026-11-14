<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { GripVerticalIcon } from '@lucide/svelte'
    import ShellSheet from './ShellSheet.svelte'
    import { DEFAULT_ORDER, DEFAULT_PINNED, type ActionId, type ActionSlots } from '../../ts/chatShell/actionSlots'
    import { customizableIds, dropGap, moveVisible, reorderVisible } from '../../ts/chatShell/customizeOrder'
    import { startDragSession, type DragSession } from '../../ts/chatShell/dragSession'
    import { readHaptics, tickHaptic } from '../../ts/chatShell/haptics'
    import { currentSlots, syncSlots, updateSlots } from '../../ts/chatShell/slotsStore.svelte'
    import { language } from '../../lang'

    interface Props { open: boolean; opener?: HTMLElement | null; background?: readonly HTMLElement[]; onclose: () => void; onchange?: () => void }
    let { open, opener = null, background = [], onclose, onchange }: Props = $props()
    // A pointer must travel this far from the grip before a press becomes a drag, so a tap on the grip does nothing.
    const DRAG_SLOP_PX = 4
    syncSlots()
    let slots = $derived(currentSlots())
    let visibleIds = $derived(customizableIds(slots.order))
    let session: DragSession | null = null
    let dragId = $state<ActionId | null>(null)
    let dragGap = $state<number | null>(null)
    let armed = $state(false)
    // The line sits before row `gap`, or after the last row for the final gap; the gaps beside the dragged row show nothing.
    let drop = $derived.by(() => {
        if (!armed || dragId === null || dragGap === null) return null
        const from = visibleIds.indexOf(dragId)
        if (from < 0 || dragGap === from || dragGap === from + 1) return null
        return dragGap < visibleIds.length ? { index: dragGap, side: 'before' } : { index: visibleIds.length - 1, side: 'after' }
    })
    $effect(() => { if (open) syncSlots() })
    // A drag never outlives the open sheet: closing it cancels the drag without writing.
    $effect(() => { if (!open) untrack(() => session?.abort()) })
    onDestroy(() => session?.abort())
    // Both the row-hosted and the Settings-hosted sheet change the one shared layout, so each change starts from the latest.
    function save(next: ActionSlots): void { updateSlots(next); onchange?.() }
    const labels: Record<string, string> = {
        copy: language.copy, edit: language.edit, translate: language.translate,
        readAloud: language.chatShellReadAloud, delete: language.remove,
        branch: language.chatShellBranch, bookmark: language.bookmark,
        hideAI: language.disableMessage, newReply: language.chatShellNewReply,
        stepPrev: language.chatShellPreviousReply, stepNext: language.chatShellNextReply,
        selectText: language.chatShellSelectText,
    }
    function labelOf(id: ActionId): string { return labels[id] ?? id }
    // Every change to the shared layout cancels a live drag first, so a gap measured before the change is never applied after it.
    function pin(id: ActionId): void {
        session?.abort()
        const latest = currentSlots()
        save({ ...latest, pinned: latest.pinned.includes(id) ? latest.pinned.filter((item) => item !== id) : [...latest.pinned, id] })
    }
    function move(id: ActionId, delta: -1 | 1): void {
        session?.abort()
        const latest = currentSlots()
        const order = moveVisible(latest.order, id, delta)
        if (order) save({ ...latest, order })
    }
    function defaults(): void {
        session?.abort()
        save({ order: [...DEFAULT_ORDER], pinned: [...DEFAULT_PINNED] })
    }
    function gripDown(event: PointerEvent, id: ActionId): void {
        if (session) return
        if (event.pointerType === 'mouse' && event.button !== 0) return
        const scroller = event.currentTarget instanceof HTMLElement ? event.currentTarget.closest<HTMLElement>('[data-part="chat-sheet"]') : null
        if (!scroller) return
        event.preventDefault()
        // Rows have one height and a mid-drag order change re-renders them in place, so one measurement stays valid for the drag.
        const scrollerTop = scroller.getBoundingClientRect().top
        const mids = [...scroller.querySelectorAll('[data-part="chat-customize-action"]')].map((row) => {
            const rect = row.getBoundingClientRect()
            return rect.top - scrollerTop + scroller.scrollTop + rect.height / 2
        })
        const downY = event.clientY
        const pointerType = event.pointerType
        dragId = id
        session = startDragSession(scroller, event, {
            onpoint(clientY) {
                if (!armed && Math.abs(clientY - downY) > DRAG_SLOP_PX) armed = true
                if (armed) dragGap = dropGap(mids, clientY - scroller.getBoundingClientRect().top + scroller.scrollTop)
            },
            onend(kind) {
                try {
                    if (kind === 'commit' && armed && dragId !== null && dragGap !== null) {
                        // The drop applies to the latest shared order, never to the one seen at pointerdown.
                        const latest = currentSlots()
                        const order = reorderVisible(latest.order, dragId, dragGap)
                        if (order) {
                            save({ ...latest, order })
                            tickHaptic('commit', pointerType, readHaptics())
                        }
                    }
                } finally {
                    dragId = null
                    dragGap = null
                    armed = false
                    session = null
                }
            },
        })
    }
    // Escape during a drag cancels only the drag; the next Escape closes the sheet.
    function innerescape(): boolean {
        if (!session) return false
        session.abort()
        return true
    }
</script>

<ShellSheet {open} kind="sheet" label={language.chatShellCustomizeButtons} {opener} {background} inertOutside={background.length === 0} {onclose} {innerescape}>
    <h2>{language.chatShellCustomizeButtons}</h2>
    <p>{language.chatShellOnThisDevice}</p>
    {#each visibleIds as id, index}
        <div data-part="chat-customize-action" data-customize-dragging={armed && dragId === id ? '' : undefined} data-customize-drop={drop?.index === index ? drop.side : undefined}>
            <!-- The grip is a pointer affordance only: Move up and Move down stay the accessible path. -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="customize-grip" aria-hidden="true" data-panel-gesture="off" style:touch-action="none" onpointerdown={(event) => gripDown(event, id)}><GripVerticalIcon size={18} /></span>
            <label style:min-height="var(--size-touch)"><input type="checkbox" style:width="var(--space-12)" style:height="var(--space-12)" checked={slots.pinned.includes(id)} onchange={() => pin(id)} />{labelOf(id)}</label>
            <button type="button" aria-label={`${language.chatShellMoveUp} ${labelOf(id)}`} onclick={() => move(id, -1)}>{language.chatShellMoveUp}</button>
            <button type="button" aria-label={`${language.chatShellMoveDown} ${labelOf(id)}`} onclick={() => move(id, 1)}>{language.chatShellMoveDown}</button>
            {#if drop?.index === index}<span class="customize-drop-line" aria-hidden="true"></span>{/if}
        </div>
    {/each}
    <div data-part="chat-customize-preview">{slots.pinned.map(labelOf).join(' · ')}</div>
    <button type="button" onclick={defaults}>{language.chatShellRestoreDefaults}</button>
</ShellSheet>

<style>
    [data-part="chat-customize-action"] { position: relative; display: flex; align-items: center; gap: var(--space-7); }
    [data-part="chat-customize-action"] label { flex: 1; display: flex; align-items: center; gap: var(--space-7); }
    [data-part="chat-customize-action"] input[type="checkbox"] { flex: none; }
    [data-customize-dragging] { background: var(--nexus-surface-raised); box-shadow: var(--shadow-drag); }
    .customize-grip { flex: none; display: flex; align-items: center; justify-content: center; width: var(--size-17); height: var(--size-21); color: var(--nexus-text-muted); cursor: grab; }
    .customize-drop-line { position: absolute; left: 0; right: 0; height: var(--size-1); background: var(--nexus-accent); pointer-events: none; }
    [data-customize-drop="before"] .customize-drop-line { top: 0; }
    [data-customize-drop="after"] .customize-drop-line { bottom: 0; }
    button { min-height: var(--size-21); color: var(--nexus-text); }
</style>
