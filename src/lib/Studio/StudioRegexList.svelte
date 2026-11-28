<script module lang="ts">
    /** Where the list puts focus once its rows are rendered: a row's main control or its menu button, or the list itself. */
    export interface RegexFocusRequest {
        index: number | null
        control: 'name' | 'menu'
    }

    /** The row an action points at, as the list showed it when the user chose it: the index, the row's JSON and how many rows held that JSON. */
    export interface RegexTarget {
        index: number
        expected: unknown
        twins: number
    }
</script>

<script lang="ts">
    import { DownloadIcon, EllipsisIcon, PlusIcon, UploadIcon } from '@lucide/svelte'
    import { onDestroy, untrack } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import { regexUnreadableText } from '../../ts/studio/edit/objListCopy'
    import { regexTwinCount, type RegexMove } from '../../ts/studio/edit/regexListOps'
    import { toPlainJson } from '../../ts/storage/store2/codec/normalize'
    import type { RegexRowClass } from '../../ts/studio/edit/regexEntry'
    import { regexProblems } from '../../ts/studio/edit/regexCheck'
    import { orderOf } from '../../ts/studio/edit/regexFlags'
    import { registerStudioBackLayer } from '../../ts/studio/studioBack.svelte'
    import { createWindowHost } from '../../ts/windowing/windowHost.svelte'
    import Help from '../Others/Help.svelte'
    import WindowedSegment from '../UI/Windowed/WindowedSegment.svelte'

    // One row: the 44 px touch target of a single line. Rows are measured, so a larger font only moves the spacers.
    const ROW_FALLBACK_PX = 44

    // The regex list of one owner. It shows what the pane hands it and acts only through the pane's callbacks, which read
    // the live row at the moment of the action. A readable row offers every action; an unreadable object only Move and
    // Delete (nothing multiplies data Studio cannot edit); any other element none.
    interface Props {
        classes: readonly RegexRowClass[]
        // The live list, read at each use so a row is the live one and never a snapshot.
        readRows: () => readonly unknown[]
        editable: boolean
        focusRequest: RegexFocusRequest | null
        onopen: (index: number) => void
        onadd: () => void
        onimport: () => void
        onexport: () => void
        // True while the file picker or an import is pending; the import button is off so a second tap opens no second picker.
        importing: boolean
        onmove: (target: RegexTarget, move: RegexMove) => void
        onduplicate: (target: RegexTarget) => void
        ondelete: (target: RegexTarget) => void
        onfocused: () => void
    }

    let { classes, readRows, editable, focusRequest, onopen, onadd, onimport, onexport, importing, onmove, onduplicate, ondelete, onfocused }: Props = $props()

    const rowKeys = $derived(classes.map((_, index) => String(index)))

    let root = $state<HTMLElement | null>(null)
    let listRoot = $state<HTMLElement | null>(null)
    const windowHost = createWindowHost({ root: () => listRoot })
    onDestroy(() => windowHost.dispose())

    const CONTROL_PART = { name: 'studio-regex-row', menu: 'studio-regex-row-menu' } as const

    // ---------------------------------------------------------------- row text

    function stageText(value: unknown): string {
        switch (value) {
            case 'editinput': return language.editInput
            case 'editoutput': return language.editOutput
            case 'editprocess': return language.editProcess
            case 'editdisplay': return language.editDisplay
            case 'edittrans': return language.editTranslationDisplay
            case 'disabled': return language.disabled
            default: return language.studioRegexStageOther(typeof value === 'string' ? value : String(value))
        }
    }

    interface RowView {
        name: string
        stage: string
        disabled: boolean
        order: number | null
        // The engine's message when the pattern does not compile, else null.
        invalid: string | null
    }

    // The visible facts of a readable row. The order shows only while custom flags are on and the flag text holds one.
    function rowView(index: number): RowView | null {
        const row: unknown = readRows()[index]
        if (typeof row !== 'object' || row === null) return null
        const entry = row as Record<string, unknown>
        const name = typeof entry.comment === 'string' ? entry.comment : ''
        const order = entry.ableFlag === true && typeof entry.flag === 'string' ? orderOf(entry.flag) : null
        return {
            name: name === '' ? language.sidebarUi.unnamedScript : name,
            stage: stageText(entry.type),
            disabled: entry.type === 'disabled',
            order,
            invalid: typeof entry.in === 'string'
                ? regexProblems({ in: entry.in, flag: typeof entry.flag === 'string' ? entry.flag : '', ableFlag: entry.ableFlag === true }).invalid
                : null,
        }
    }

    // The name a menu label and the delete toast use: the stored name, else "unnamed script".
    function labelOf(index: number): string {
        const row: unknown = readRows()[index]
        const name = typeof row === 'object' && row !== null ? (row as Record<string, unknown>).comment : undefined
        return typeof name === 'string' && name !== '' ? name : language.sidebarUi.unnamedScript
    }

    // The row as it is now, copied: a later in-place change to the live row is then visible to the builder's check.
    function targetOf(index: number): RegexTarget {
        const rows = readRows()
        return { index, expected: toPlainJson(rows[index]), twins: regexTwinCount(rows, rows[index]) }
    }

    // ---------------------------------------------------------------- focus

    // A control that lost its row hands focus to the list root, but only when focus was in the list or on nothing.
    function focusRootIfLost(): void {
        const active = document.activeElement
        if (root !== null && (active === null || active === document.body || root.contains(active))) root.focus()
    }

    async function placeFocus(request: RegexFocusRequest, alive: () => boolean): Promise<void> {
        await afterFlush()
        if (!alive()) return
        if (request.index !== null && request.index >= 0 && request.index < readRows().length) {
            const wrapper = await windowHost.reveal(String(request.index))
            if (!alive()) return
            const target = wrapper?.querySelector<HTMLElement>(`[data-part="${CONTROL_PART[request.control]}"]`) ?? wrapper?.querySelector<HTMLElement>(`[data-part="${CONTROL_PART.menu}"]`) ?? null
            if (target !== null) {
                target.focus()
                return
            }
        }
        focusRootIfLost()
    }

    $effect(() => {
        const request = focusRequest
        if (request === null || root === null) return
        let alive = true
        void placeFocus(request, () => alive).then(() => {
            if (alive) untrack(onfocused)
        })
        return () => { alive = false }
    })

    // ---------------------------------------------------------------- the row menu

    interface Anchored {
        index: number
        target: RegexTarget
        readable: boolean
        top: number
        right: number
    }
    let menu = $state.raw<Anchored | null>(null)
    let menuElement = $state<HTMLElement | undefined>()

    function anchorOf(button: HTMLElement): { top: number; right: number } {
        const rect = button.getBoundingClientRect()
        return { top: rect.bottom, right: Math.max(0, window.innerWidth - rect.right) }
    }

    // A menu whose row is gone, or no longer holds an action, ends without writing.
    $effect(() => {
        const open = menu
        if (open === null) return
        if (open.index < classes.length && classes[open.index].kind !== 'inert' && editable) return
        untrack(() => {
            const active = document.activeElement
            const inside = active === null || active === document.body || (menuElement?.contains(active) ?? false)
            menu = null
            if (inside) focusRootIfLost()
        })
    })

    // A tap outside the menu closes it; a tap on a trigger is left to the trigger, which toggles.
    $effect(() => {
        if (menu === null) return
        function onPointerDown(event: PointerEvent): void {
            const target = event.target
            if (!(target instanceof Node)) return
            if (menuElement?.contains(target)) return
            if (target instanceof Element && target.closest('[data-part="studio-regex-row-menu"]')) return
            menu = null
        }
        window.addEventListener('pointerdown', onPointerDown, true)
        return () => window.removeEventListener('pointerdown', onPointerDown, true)
    })

    async function openMenu(index: number, button: HTMLElement): Promise<void> {
        if (menu !== null && menu.index === index) {
            closeMenu(true)
            return
        }
        menu = { index, target: targetOf(index), readable: classes[index]?.kind === 'ok', ...anchorOf(button) }
        await afterFlush()
        menuElement?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    }

    function closeMenu(returnFocus: boolean): void {
        const index = menu?.index ?? null
        menu = null
        if (returnFocus && index !== null) void placeFocus({ index, control: 'menu' }, () => true)
    }

    function onMenuKey(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeMenu(true)
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

    registerStudioBackLayer({ isOpen: () => menu !== null, close: () => closeMenu(true) })

    // A move or a duplicate from the menu closes it first; the pane places focus once the op has landed.
    function moveFromMenu(move: RegexMove): void {
        const target = menu?.target
        menu = null
        if (target !== undefined) onmove(target, move)
    }

    function duplicateFromMenu(): void {
        const target = menu?.target
        menu = null
        if (target !== undefined) onduplicate(target)
    }

    function deleteFromMenu(): void {
        const target = menu?.target
        menu = null
        if (target !== undefined) ondelete(target)
    }

    // ---------------------------------------------------------------- row keys

    function onRowKey(event: KeyboardEvent, index: number): void {
        if (event.isComposing || event.keyCode === 229 || !editable || classes[index]?.kind === 'inert') return
        const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
        if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault()
            onmove(targetOf(index), event.key === 'ArrowUp' ? 'up' : 'down')
            return
        }
        if (plain && event.key === 'Delete') {
            event.preventDefault()
            ondelete(targetOf(index))
            return
        }
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault()
            const button = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-part="studio-regex-row-menu"]')
            if (button !== null) void openMenu(index, button)
        }
    }

    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
    const iconButtonClass = 'flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
    const itemClass = 'min-h-11 w-full px-3 text-left hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
    const showOrderNote = $derived(classes.some((row, index) => row.kind === 'ok' && rowView(index)?.order != null))
</script>

<div bind:this={root} tabindex="-1" data-part="studio-regex-list-root" class="flex flex-col gap-2 outline-none">
    <h3 data-part="studio-regex-heading" class="font-bold">{language.regexScript} <Help key="regexScript" /></h3>
    <div class="flex flex-wrap items-center gap-2" data-part="studio-regex-toolbar">
        <button type="button" data-part="studio-regex-add" class="{buttonClass} flex items-center gap-1" disabled={!editable} onclick={onadd}><PlusIcon size={16} aria-hidden="true" /><span>{language.studioRegexAdd}</span></button>
        <button type="button" data-part="studio-regex-import" data-testid="studio-regex-import" class="{buttonClass} flex items-center gap-1" disabled={!editable || importing} onclick={onimport}><UploadIcon size={16} aria-hidden="true" /><span>{language.import}</span></button>
        <button type="button" data-part="studio-regex-export" data-testid="studio-regex-export" class="{buttonClass} flex items-center gap-1" disabled={classes.length === 0} onclick={onexport}><DownloadIcon size={16} aria-hidden="true" /><span>{language.export}</span></button>
    </div>
    {#if classes.length === 0}
        <p data-part="studio-regex-empty" class="text-textcolor2">{language.sidebarUi.noScripts}</p>
    {:else if showOrderNote}
        <p data-part="studio-regex-order-note" class="text-sm text-textcolor2">{language.studioRegexOrderNote}</p>
    {/if}
    <div bind:this={listRoot}>
        <WindowedSegment
            host={windowHost}
            tag="ul"
            data-part="studio-regex-list"
            class="flex flex-col gap-1"
            keys={rowKeys}
            height={{ fallback: ROW_FALLBACK_PX }}
            item={regexRow}
        />
    </div>
    {#snippet regexRow(key: string)}
        {@const index = Number(key)}
        {@const row = classes[index]}
        {#if row}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="flex items-stretch gap-1" onkeydown={(event) => onRowKey(event, index)}>
                {#if row.kind === 'ok'}
                    {@const shown = rowView(index)}
                    {#if shown !== null}
                        <button
                            type="button"
                            data-part="studio-regex-row"
                            data-index={index}
                            class="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-2 rounded-md border border-darkborderc px-3 py-1 text-left hover:bg-selected cursor-pointer"
                            onclick={() => onopen(index)}
                        >
                            <span class="text-xs text-textcolor2">{index + 1}</span>
                            <span class="min-w-0 break-words font-bold">{shown.name}</span>
                            <span class="text-xs text-textcolor2">{shown.stage}</span>
                            {#if shown.disabled}
                                <span data-part="studio-regex-disabled" class="rounded border border-darkborderc px-1 text-xs text-textcolor2">{language.disabled}</span>
                            {/if}
                            {#if shown.order !== null}
                                <span data-part="studio-regex-order-chip" class="rounded border border-darkborderc px-1 text-xs text-textcolor2">{language.sidebarUi.orderFlag} {shown.order}</span>
                            {/if}
                            {#if shown.invalid !== null}
                                <span data-part="studio-regex-invalid-chip" title={language.studioRegexInvalid(shown.invalid)} class="rounded border border-draculared px-1 text-xs text-draculared">{language.studioRegexInvalidMarker}</span>
                            {/if}
                        </button>
                    {/if}
                {:else}
                    <div data-part="studio-regex-unreadable" data-index={index} class="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-2 rounded-md border border-darkborderc px-3 py-1 text-textcolor2">
                        <span class="text-xs">{index + 1}</span>
                        {#if row.kind === 'unreadable' && row.name !== null && row.name !== ''}
                            <span class="min-w-0 break-words font-bold">{row.name}</span>
                        {/if}
                        <span class="min-w-0 break-words">{regexUnreadableText(row)}</span>
                    </div>
                {/if}
                {#if row.kind !== 'inert'}
                    <button
                        type="button"
                        data-part="studio-regex-row-menu"
                        class={iconButtonClass}
                        aria-label={language.studioRegexRowMenu(labelOf(index))}
                        aria-haspopup="menu"
                        aria-expanded={menu !== null && menu.index === index}
                        disabled={!editable}
                        onclick={(event) => openMenu(index, event.currentTarget)}
                    ><EllipsisIcon size={18} aria-hidden="true" /></button>
                {/if}
            </div>
        {/if}
    {/snippet}
    {#if menu !== null}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
            bind:this={menuElement}
            role="menu"
            tabindex="-1"
            data-part="studio-regex-menu"
            class="fixed z-50 flex min-w-48 flex-col overflow-hidden rounded-md border border-darkborderc bg-darkbg text-textcolor"
            style="top: {menu.top}px; right: {menu.right}px"
            onkeydown={onMenuKey}
        >
            <button type="button" role="menuitem" data-part="studio-regex-move-up" class={itemClass} onclick={() => moveFromMenu('up')}>{language.studioRegexMoveUp}</button>
            <button type="button" role="menuitem" data-part="studio-regex-move-down" class={itemClass} onclick={() => moveFromMenu('down')}>{language.studioRegexMoveDown}</button>
            <button type="button" role="menuitem" data-part="studio-regex-move-top" class={itemClass} onclick={() => moveFromMenu('top')}>{language.studioRegexMoveTop}</button>
            <button type="button" role="menuitem" data-part="studio-regex-move-bottom" class={itemClass} onclick={() => moveFromMenu('bottom')}>{language.studioRegexMoveBottom}</button>
            {#if menu.readable}
                <button type="button" role="menuitem" data-part="studio-regex-duplicate" class={itemClass} onclick={duplicateFromMenu}>{language.studioRegexDuplicate}</button>
            {/if}
            <button type="button" role="menuitem" data-part="studio-regex-delete" class="{itemClass} text-draculared" onclick={deleteFromMenu}>{language.studioRegexDelete}</button>
        </div>
    {/if}
</div>
