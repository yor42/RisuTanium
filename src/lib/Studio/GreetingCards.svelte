<script lang="ts">
    import { EllipsisIcon, GripVerticalIcon } from '@lucide/svelte'
    import { onDestroy } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import type { StudioToasts } from '../../ts/studio/edit/studioToasts'
    import { createGreetingRowKeys } from '../../ts/studio/greetingRowKeys'
    import { registerGreetingReveal } from '../../ts/studio/historyFocus'
    import type { OwnerHistoryService, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import type { OwnerKey } from '../../ts/studio/history/ownerPhase'
    import type { LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import { createWindowHost } from '../../ts/windowing/windowHost.svelte'
    import WindowedSegment from '../UI/Windowed/WindowedSegment.svelte'
    import LongTextField from './LongTextField.svelte'
    import type { PreviewSourceInput } from './LongTextPreview.svelte'
    import PasteSeveralSheet from './PasteSeveralSheet.svelte'

    // The alternative first messages of the character form as cards. Every action is one history step through the
    // service's list operations; an index is read from the current rows by id when the action runs, so a list that
    // changed under the pointer or the menu never moves the wrong card.
    interface Props {
        owner: OwnerKey
        service: OwnerHistoryService | null
        editable: boolean
        greetings: readonly string[]
        ownerLabel: string
        previewSource: () => PreviewSourceInput
        toasts: StudioToasts
        // Shows or clears the refusal line for a result and says whether it landed.
        noted: (result: StudioResult) => boolean
        onresult: (result: StudioResult | null) => void
    }

    let { owner, service, editable, greetings, ownerLabel, previewSource, toasts, noted, onresult }: Props = $props()

    // Rows keep their DOM node while their text survives a list change, so a delete, undo, redo or restore mounts or
    // removes one row instead of rewriting every row after it.
    const rowKeys = createGreetingRowKeys()
    const rows = $derived(rowKeys.rows(greetings))

    let root = $state<HTMLElement | undefined>()
    // Only the cards near the view are mounted. A card is keyed by its row id, so a DOM position is never a data
    // index: the helpers below find a card by `data-row-index`, and reveal it before focusing one outside the window.
    const windowHost = createWindowHost({ root: () => root ?? null })
    onDestroy(() => windowHost.dispose())
    // History focus reaches a card outside the window through this hook.
    $effect(() => registerGreetingReveal(async (index) => {
        const row = rows[index]
        if (row) await windowHost.reveal(String(row.id))
    }))
    const CARD_FALLBACK_PX = 120
    let menuId = $state<number | null>(null)
    let announcement = $state('')
    let pasteOpen = $state(false)
    // A mouse drag in progress: the dragged row, and the position it would take (post-removal coordinates).
    let drag = $state<{ id: number; from: number; to: number } | null>(null)

    const indexOf = (id: number): number => rows.findIndex((row) => row.id === id)
    const rowKeyList = $derived(rows.map((row) => String(row.id)))
    // A drag reads every card's rect, and the open menu's card keeps its menu in the page.
    const pinnedRows = $derived.by((): string[] => {
        const open = menuId === null ? [] : [String(menuId)]
        return drag ? [...rowKeyList, ...open] : open
    })
    const rowElements = (): HTMLElement[] => (root ? Array.from(root.querySelectorAll<HTMLElement>('[data-part="studio-greeting-row"]')) : [])
    const inputAt = (index: number): HTMLElement | undefined => root?.querySelector<HTMLElement>(`[data-part="studio-greeting-input"][data-index="${index}"]`) ?? undefined
    const handleAt = (index: number): HTMLElement | undefined => root?.querySelector<HTMLElement>(`[data-part="studio-card-handle"][data-row-index="${index}"]`) ?? undefined
    const menuButtonOf = (id: number): HTMLElement | undefined => root?.querySelector<HTMLElement>(`[data-part="studio-card-menu"][data-row="${id}"]`) ?? undefined

    // Focuses a part of a card; a card outside the window is revealed (mounted) first.
    async function focusIn(index: number, find: (index: number) => HTMLElement | undefined): Promise<void> {
        let found = find(index)
        if (!found) {
            // A list change that has not reached the segment's keys yet mounts the card with the next flush.
            await afterFlush()
            found = find(index)
        }
        if (found) {
            found.focus()
            return
        }
        const row = rows[index]
        if (!row) return
        await windowHost.reveal(String(row.id))
        find(index)?.focus()
    }

    // Bound to the row's id, not its position: a row that was removed reads null, and a row that took another
    // text fails the controller's base check, so held text never lands in a neighbouring row.
    function greetingPort(id: number): LongTextWritePort {
        return {
            read: () => {
                const index = indexOf(id)
                return index < 0 ? null : rows[index].text
            },
            write: (value) => {
                const index = indexOf(id)
                return index < 0 || !service || !editable ? null : service.greetingEdit(owner, index, value)
            },
            closeStep: () => service?.closeOpenStep(owner),
        }
    }

    function announce(text: string): void {
        announcement = text
    }

    function closeMenu(): void {
        menuId = null
    }

    async function toggleMenu(id: number): Promise<void> {
        if (menuId === id) {
            closeMenu()
            return
        }
        menuId = id
        await afterFlush()
        root?.querySelector<HTMLElement>(`[data-menu-of="${id}"] [role="menuitem"]:not(:disabled)`)?.focus()
    }

    async function add(): Promise<void> {
        if (!service || !editable || !noted(service.greetingAdd(owner))) return
        await afterFlush()
        await focusIn(rows.length - 1, inputAt)
    }

    function openPaste(): void {
        if (!service || !editable) return
        closeMenu()
        pasteOpen = true
    }

    // Closing without an add changes nothing; the button takes focus back either way.
    async function closePaste(): Promise<void> {
        pasteOpen = false
        await afterFlush()
        root?.querySelector<HTMLElement>('[data-part="studio-greeting-paste"]')?.focus()
    }

    async function pasted(count: number): Promise<void> {
        pasteOpen = false
        announce('')
        await afterFlush()
        // The rows already include the appended ones: the first new card is `count` from the end.
        await focusIn(rows.length - count, inputAt)
        announce(language.ltPasteAdded(count))
    }

    async function remove(id: number): Promise<void> {
        const index = indexOf(id)
        closeMenu()
        if (index < 0 || !service || !editable || !noted(service.greetingDelete(owner, index))) return
        const op = service.view(owner).done.at(-1)?.ops.find((candidate) => candidate.op === 'listRemove')
        if (op?.op === 'listRemove') toasts.postDeleted(owner, op.deletedId)
        await afterFlush()
        // Focus goes to the row that took the place, else the one before it, else the add button.
        const landing = index < rows.length ? index : index - 1
        if (landing >= 0) await focusIn(landing, inputAt)
        else root?.querySelector<HTMLElement>('[data-part="studio-greeting-add"]')?.focus()
    }

    async function commitMove(id: number, to: number): Promise<void> {
        const from = indexOf(id)
        closeMenu()
        if (from < 0 || to < 0 || to >= rows.length || !service || !editable) return
        announce('')
        if (!noted(service.greetingMove(owner, from, to))) return
        await afterFlush()
        await focusIn(to, handleAt)
        announce(language.ltCardMoved(to + 1, rows.length))
    }

    function step(id: number, delta: -1 | 1): void {
        const from = indexOf(id)
        if (from < 0) return
        void commitMove(id, from + delta)
    }

    async function swap(id: number): Promise<void> {
        const index = indexOf(id)
        closeMenu()
        if (index < 0 || !service || !editable) return
        announce('')
        if (!noted(service.greetingSwapWithMain(owner, index))) return
        await afterFlush()
        await focusIn(indexOf(id), () => menuButtonOf(id))
        announce(language.ltCardSwapped)
    }

    async function duplicate(id: number): Promise<void> {
        const index = indexOf(id)
        closeMenu()
        if (index < 0 || !service || !editable) return
        announce('')
        if (!noted(service.greetingAppendMany(owner, [rows[index].text]))) return
        await afterFlush()
        await focusIn(rows.length - 1, inputAt)
        announce(language.ltCardCopied)
    }

    // Alt+ArrowUp and Alt+ArrowDown act on the handle and the menu button only; inside the text field they are the
    // field's own keys.
    function onCardKey(event: KeyboardEvent, id: number): void {
        if (event.isComposing || event.keyCode === 229) return
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        if (!service || !editable) return
        step(id, event.key === 'ArrowUp' ? -1 : 1)
    }

    function onMenuButtonKey(event: KeyboardEvent, id: number): void {
        if (event.key === 'Escape' && menuId === id) {
            event.stopPropagation()
            closeMenu()
            return
        }
        onCardKey(event, id)
    }

    function onMenuKey(event: KeyboardEvent, id: number): void {
        if (event.key === 'Escape') {
            event.stopPropagation()
            closeMenu()
            menuButtonOf(id)?.focus()
            return
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        const items = Array.from(event.currentTarget instanceof HTMLElement ? event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') : [])
        if (items.length === 0) return
        const at = items.indexOf(document.activeElement as HTMLElement)
        const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at <= 0 ? items.length - 1 : at - 1)
        items[next].focus()
    }

    function onMenuFocusOut(event: FocusEvent): void {
        const related = event.relatedTarget
        if (related instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(related)) return
        if (related === null) return
        closeMenu()
    }

    // The position a drop at `y` would take: the number of other rows whose middle lies above it.
    function dropTarget(y: number, from: number): number {
        let to = 0
        // Every card is mounted while a drag is on, and each is read by its data index.
        rowElements().forEach((element) => {
            const index = Number(element.getAttribute('data-row-index'))
            if (index === from) return
            const rect = element.getBoundingClientRect()
            if (rect.top + rect.height / 2 < y) to++
        })
        return to
    }

    function onDragMove(event: PointerEvent): void {
        if (!drag) return
        drag = { ...drag, to: dropTarget(event.clientY, drag.from) }
    }

    function endDrag(): void {
        drag = null
        window.removeEventListener('pointermove', onDragMove)
        window.removeEventListener('pointerup', onDragUp)
        window.removeEventListener('pointercancel', endDrag)
        window.removeEventListener('keydown', onDragKey, true)
    }

    function onDragUp(): void {
        const dragged = drag
        endDrag()
        if (dragged && dragged.to !== dragged.from) void commitMove(dragged.id, dragged.to)
    }

    function onDragKey(event: KeyboardEvent): void {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        endDrag()
    }

    // Only a mouse or a pen drags; touch reorders through the menu.
    function onHandleDown(event: PointerEvent, id: number): void {
        if (!service || !editable || event.button !== 0) return
        if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
        const from = indexOf(id)
        if (from < 0) return
        drag = { id, from, to: from }
        window.addEventListener('pointermove', onDragMove)
        window.addEventListener('pointerup', onDragUp)
        window.addEventListener('pointercancel', endDrag)
        window.addEventListener('keydown', onDragKey, true)
    }

    onDestroy(endDrag)

    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
    const iconButtonClass = 'flex min-h-11 min-w-11 items-center justify-center rounded-md border border-darkborderc hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
    const itemClass = 'min-h-11 w-full px-3 text-left hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'

    function summaryOf(text: string): string {
        const first = text.split(/\r\n?|\n/)[0].trim()
        return first === '' ? language.ltCardUntitled : first
    }
</script>

<div bind:this={root} class="flex flex-col gap-2" data-part="studio-form-greetings">
    <div class="flex items-center justify-between gap-2">
        <span class="font-bold">{language.altGreet}</span>
        <div class="flex items-center gap-2">
            <button
                type="button"
                data-part="studio-greeting-paste"
                class={buttonClass}
                disabled={!editable}
                aria-busy={editable ? undefined : 'true'}
                aria-haspopup="dialog"
                onclick={openPaste}
            >{language.ltPasteSeveral}</button>
            <button
                type="button"
                data-part="studio-greeting-add"
                class={buttonClass}
                disabled={!editable}
                aria-busy={editable ? undefined : 'true'}
                onclick={add}
            >{language.add}</button>
        </div>
    </div>
    {#if pasteOpen}
        <PasteSeveralSheet {owner} {service} {editable} isOpen={() => pasteOpen} {noted} onadded={pasted} onclose={closePaste} />
    {/if}
    <div role="status" aria-live="polite" data-part="studio-card-announce" class="sr-only">{announcement}</div>
    {#if greetings.length === 0}
        <p class="text-sm text-textcolor2">{language.studioGreetingsEmpty}</p>
    {/if}
    <WindowedSegment host={windowHost} keys={rowKeyList} height={{ fallback: CARD_FALLBACK_PX }} pinned={pinnedRows} class="flex flex-col gap-2">
    {#snippet item(key)}
        {@const id = Number(key)}
        {@const index = indexOf(id)}
        {@const text = rows[index]?.text ?? ''}
        <div class="flex flex-col gap-2">
        {#if drag && drag.to < drag.from && drag.to === index}
            <div data-part="studio-card-drop-line" class="h-0.5 rounded-full bg-selected"></div>
        {/if}
        <div class="group flex flex-col gap-1 rounded-md border border-darkborderc p-2" data-part="studio-greeting-row" data-row-index={index} data-dragging={drag?.id === id ? 'true' : undefined}>
            <div class="flex items-center gap-2">
                <button
                    type="button"
                    data-part="studio-card-handle"
                    data-row-index={index}
                    class="{iconButtonClass} touch-none select-none"
                    aria-label={language.ltCardHandle(index + 1)}
                    disabled={!editable}
                    onpointerdown={(event) => onHandleDown(event, id)}
                    onkeydown={(event) => onCardKey(event, id)}
                ><GripVerticalIcon size={18} aria-hidden="true" /></button>
                <span class="shrink-0 text-sm text-textcolor2">{index + 1}</span>
                <span data-part="studio-card-summary" class="min-w-0 flex-1 truncate text-sm">{summaryOf(text)}</span>
                <div class="relative">
                    <button
                        type="button"
                        data-part="studio-card-menu"
                        data-row={id}
                        class={iconButtonClass}
                        aria-label={language.ltCardMenu(index + 1)}
                        aria-haspopup="menu"
                        aria-expanded={menuId === id}
                        disabled={!editable}
                        onclick={() => toggleMenu(id)}
                        onkeydown={(event) => onMenuButtonKey(event, id)}
                    ><EllipsisIcon size={18} aria-hidden="true" /></button>
                    {#if menuId === id}
                        <div
                            role="menu"
                            tabindex="-1"
                            data-part="studio-card-menu-list"
                            data-menu-of={id}
                            class="absolute right-0 z-10 mt-1 flex min-w-48 flex-col overflow-hidden rounded-md border border-darkborderc bg-darkbg text-textcolor"
                            onkeydown={(event) => onMenuKey(event, id)}
                            onfocusout={onMenuFocusOut}
                        >
                            <button type="button" role="menuitem" data-part="studio-card-duplicate" class={itemClass} disabled={!editable} onclick={() => duplicate(id)}>{language.ltCardDuplicate}</button>
                            <button type="button" role="menuitem" data-part="studio-card-move-up" class={itemClass} disabled={!editable || index === 0} onclick={() => step(id, -1)}>{language.ltCardMoveUp}</button>
                            <button type="button" role="menuitem" data-part="studio-card-move-down" class={itemClass} disabled={!editable || index === rows.length - 1} onclick={() => step(id, 1)}>{language.ltCardMoveDown}</button>
                            <button type="button" role="menuitem" data-part="studio-card-swap" class={itemClass} disabled={!editable} onclick={() => swap(id)}>{language.ltMakeMain}</button>
                            <button type="button" role="menuitem" data-part="studio-greeting-delete" class="{itemClass} text-draculared" disabled={!editable} onclick={() => remove(id)}>{language.studioGreetingDelete}</button>
                        </div>
                    {/if}
                </div>
            </div>
            <LongTextField
                port={greetingPort(id)}
                part="studio-greeting-input"
                {index}
                ariaLabel={`${language.altGreet} ${index + 1}`}
                kind="greeting"
                mode="html+cbs"
                {ownerLabel}
                {previewSource}
                {editable}
                busy={!editable}
                fieldClass="min-h-20 max-h-24 group-focus-within:max-h-none w-full min-w-0 rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
                {onresult}
            />
        </div>
        {#if drag && drag.to > drag.from && drag.to === index}
            <div data-part="studio-card-drop-line" class="h-0.5 rounded-full bg-selected"></div>
        {/if}
        </div>
    {/snippet}
    </WindowedSegment>
</div>
