<script module lang="ts">
    import type { LoreTracked } from '../../ts/studio/edit/loreListModel'

    /** What an own op does to the selection once it lands (Rule L): nothing new opens, an added row opens, a delete leaves. */
    export type LoreRunEffect = 'same' | 'opens' | 'removes'
    export type LoreControl = 'name' | 'menu' | 'toggle'
    /** Where the list puts focus once the rows are rendered. The target is resolved on the live rows at that time. */
    export interface LoreFocusRequest {
        target: LoreTracked
        hint: number
        control: LoreControl
    }
</script>

<script lang="ts">
    import { ChevronDownIcon, ChevronRightIcon, EllipsisIcon, FileTextIcon, FolderIcon, FolderOpenIcon, LinkIcon, PlusIcon, FolderPlusIcon, TriangleAlertIcon } from '@lucide/svelte'
    import { onDestroy, untrack } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import {
        ancestorFolderKeys,
        displayNameOf,
        isFolderRow,
        isLinkRow,
        isLoreRow,
        loreListRows,
        moveTargets,
        resolveTracked,
        rowKeyAt,
        trackedOf,
        type LoreListRow,
        type LoreSurface,
    } from '../../ts/studio/edit/loreListModel'
    import {
        loreAddEntry,
        loreAddFolder,
        loreAlwaysActive,
        loreBulkActive,
        loreDuplicate,
        loreMove,
        type LoreMove,
        type LoreOp,
    } from '../../ts/studio/edit/loreListOps'
    import type { LoreHost } from '../../ts/studio/edit/loreListModel'
    import type { StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { loreIndexOfItemId, loreItemIdOf } from '../../ts/studio/ownerModel'
    import { openStudioListRow, studioScreen, takeStudioListReveal } from '../../ts/studio/studioScreen.svelte'
    import { registerStudioBackLayer } from '../../ts/studio/studioBack.svelte'
    import { createWindowHost } from '../../ts/windowing/windowHost.svelte'
    import WindowedSegment from '../UI/Windowed/WindowedSegment.svelte'
    import Help from '../Others/Help.svelte'

    // One row: the 44 px touch target of a single truncated line. Rows are measured, so a larger font only moves the spacers.
    const LORE_ROW_FALLBACK_PX = 44
    const INDENT_PX = 16

    // The lorebook list of one owner. It shows what the pane hands it and acts only through the pane's `runOwn` and
    // `requestDelete`. Every menu, sheet and question it opens holds the list token and the entry it was opened on (a
    // `LoreSurface`), builds only from those, and closes, writing nothing, as soon as the pane says the surface is no
    // longer live.
    interface Props {
        ownerKey: string
        ownerId: string
        host: LoreHost
        // Read at every use, so an element is the live one and never a snapshot.
        readLive: () => readonly unknown[]
        editable: boolean
        bulkEnabling: boolean
        listToken: number
        expanded: ReadonlySet<string>
        focusRequest: LoreFocusRequest | null
        surfaceIsLive: (surface: LoreSurface) => boolean
        runOwn: (op: LoreOp, effect: LoreRunEffect, surface: LoreSurface, control?: LoreControl) => StudioResult
        requestDelete: (surface: LoreSurface) => void
        onexpand: (keys: readonly string[]) => void
        ontoggle: (key: string) => void
        onfocused: () => void
    }

    let { ownerKey, ownerId, host, readLive, editable, bulkEnabling, listToken, expanded, focusRequest, surfaceIsLive, runOwn, requestDelete, onexpand, ontoggle, onfocused }: Props = $props()

    const rows = $derived(readLive())
    const visible = $derived(loreListRows(rows, expanded))
    const rowKeys = $derived(visible.map((row) => row.key))
    const rowByKey = $derived(new Map(visible.map((row): [string, LoreListRow] => [row.key, row])))

    let root = $state<HTMLElement | null>(null)
    let listRoot = $state<HTMLElement | null>(null)
    const windowHost = createWindowHost({ root: () => listRoot })
    onDestroy(() => windowHost.dispose())

    const CONTROL_PART: Record<LoreControl, string> = {
        name: 'studio-lore-row-name',
        menu: 'studio-lore-row-menu',
        toggle: 'studio-lore-row-toggle',
    }

    function labelOf(row: LoreListRow): string {
        if (row.name !== null) return row.name
        return row.kind === 'folder' ? language.sidebarUi.unnamedFolder : language.sidebarUi.unnamedLore
    }

    // ---------------------------------------------------------------- focus

    // A control that lost its row hands focus to the list root, but only when focus was in the list or on nothing: a
    // focus the user moved elsewhere stays there.
    function focusRootIfLost(): void {
        const active = document.activeElement
        if (root !== null && (active === null || active === document.body || root.contains(active))) root.focus()
    }

    async function placeFocus(request: LoreFocusRequest, alive: () => boolean): Promise<void> {
        await afterFlush()
        if (!alive()) return
        const now = readLive()
        const at = resolveTracked(now, request.target, request.hint)
        if (at !== null) {
            const wrapper = await windowHost.reveal(rowKeyAt(now, at))
            if (!alive()) return
            const target = wrapper?.querySelector<HTMLElement>(`[data-part="${CONTROL_PART[request.control]}"]`) ?? wrapper?.querySelector<HTMLElement>(`[data-part="${CONTROL_PART.name}"]`) ?? null
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

    // Back from an entry opened here shows the list again: the entry's item id becomes an index on the rows as they are
    // now, its folders open, and its row is scrolled into the band and focused. An id that is not an item of this owner
    // belongs to another list and is left alone; an item with no row spends the request with nothing shown.
    $effect(() => {
        const id = studioScreen.revealListRow
        if (id === null || listRoot === null) return
        const index = loreIndexOfItemId(ownerId, id)
        if (index === undefined) return
        let alive = true
        untrack(() => {
            const now = readLive()
            const element: unknown = now[index]
            if (index >= now.length || typeof element !== 'object' || element === null) {
                takeStudioListReveal(id)
                return
            }
            onexpand(ancestorFolderKeys(now, index))
            void afterFlush().then(async () => {
                if (!alive) return
                const after = readLive()
                if (typeof after[index] !== 'object' || after[index] === null) {
                    takeStudioListReveal(id)
                    return
                }
                const wrapper = await windowHost.reveal(rowKeyAt(after, index))
                if (!alive) return
                takeStudioListReveal(id)
                wrapper?.querySelector<HTMLElement>('[data-part="studio-lore-row-name"]')?.focus()
            })
        })
        return () => { alive = false }
    })

    // ---------------------------------------------------------------- surfaces

    interface Anchored {
        surface: LoreSurface
        top: number
        right: number
    }
    let menu = $state.raw<Anchored | null>(null)
    let bulk = $state.raw<Anchored | null>(null)
    let sheet = $state.raw<LoreSurface | null>(null)
    let menuElement = $state<HTMLElement | undefined>()
    let sheetElement = $state<HTMLElement | undefined>()

    function listSurface(index: number): LoreSurface | null {
        const target = trackedOf(rows, index)
        return target === null ? null : { token: { from: 'list', n: listToken }, target, hint: index }
    }

    function anchorOf(button: HTMLElement): { top: number; right: number } {
        const rect = button.getBoundingClientRect()
        return { top: rect.bottom, right: Math.max(0, window.innerWidth - rect.right) }
    }

    function closeSurfaces(): void {
        menu = null
        bulk = null
        sheet = null
    }

    // A surface whose view closed or whose entry is gone ends without writing. Focus moves to the list root only when it
    // was inside the closing surface or on nothing.
    $effect(() => {
        const open = menu?.surface ?? sheet ?? bulk?.surface ?? null
        if (open === null || surfaceIsLive(open)) return
        untrack(() => {
            const active = document.activeElement
            const inside = active === null || active === document.body || (menuElement?.contains(active) ?? false) || (sheetElement?.contains(active) ?? false)
            closeSurfaces()
            if (inside) focusRootIfLost()
        })
    })

    // A tap outside the menu closes it; a tap on a trigger is left to the trigger, which toggles.
    $effect(() => {
        if (menu === null && bulk === null) return
        function onPointerDown(event: PointerEvent): void {
            const target = event.target
            if (!(target instanceof Node)) return
            if (menuElement?.contains(target)) return
            if (target instanceof Element && target.closest('[data-part="studio-lore-row-menu"], [data-part="studio-lore-bulk-menu"]')) return
            closeSurfaces()
        }
        window.addEventListener('pointerdown', onPointerDown, true)
        return () => window.removeEventListener('pointerdown', onPointerDown, true)
    })

    async function openMenu(row: LoreListRow, button: HTMLElement): Promise<void> {
        if (menu !== null && menu.surface.hint === row.index) {
            closeMenu(true)
            return
        }
        const surface = listSurface(row.index)
        if (surface === null) return
        closeSurfaces()
        menu = { surface, ...anchorOf(button) }
        await afterFlush()
        menuElement?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    }

    function closeMenu(returnFocus: boolean): void {
        const surface = menu?.surface ?? sheet ?? bulk?.surface ?? null
        closeSurfaces()
        if (returnFocus && surface?.target) void placeFocus({ target: surface.target, hint: surface.hint, control: 'menu' }, () => true)
    }

    async function openBulk(button: HTMLElement): Promise<void> {
        if (bulk !== null) {
            closeBulk()
            return
        }
        closeSurfaces()
        bulk = { surface: { token: { from: 'list', n: listToken }, target: null, hint: -1 }, ...anchorOf(button) }
        await afterFlush()
        menuElement?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    }

    function closeBulk(): void {
        closeSurfaces()
        root?.querySelector<HTMLElement>('[data-part="studio-lore-bulk-menu"]')?.focus()
    }

    function onMenuKey(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            if (bulk !== null) closeBulk()
            else closeMenu(true)
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

    // A move or a duplicate from a surface: it closes first, and a result that wrote nothing gives focus back to the
    // row's menu button.
    function act(surface: LoreSurface, op: LoreOp, control: LoreControl = 'menu'): void {
        closeSurfaces()
        const result = runOwn(op, 'same', surface, control)
        if ((!result.ok || result.unchanged === true) && surface.target !== null) void placeFocus({ target: surface.target, hint: surface.hint, control: 'menu' }, () => true)
    }

    function moveFromMenu(move: LoreMove): void {
        const surface = menu?.surface
        if (surface?.target) act(surface, loreMove(surface.target, surface.hint, move))
    }

    function duplicateFromMenu(): void {
        const surface = menu?.surface
        if (surface?.target) act(surface, loreDuplicate(host, surface.target, surface.hint), 'name')
    }

    function deleteFromMenu(): void {
        const surface = menu?.surface
        closeSurfaces()
        if (surface) requestDelete(surface)
    }

    async function openSheet(): Promise<void> {
        const surface = menu?.surface
        if (!surface) return
        menu = null
        sheet = surface
        await afterFlush()
        sheetElement?.querySelector<HTMLElement>('button')?.focus()
    }

    function closeSheet(): void {
        const surface = sheet
        closeSurfaces()
        if (surface?.target) void placeFocus({ target: surface.target, hint: surface.hint, control: 'menu' }, () => true)
    }

    registerStudioBackLayer({ isOpen: () => sheet !== null, close: () => closeSheet() })

    function moveToFolder(to: string | null): void {
        const surface = sheet
        if (surface?.target) act(surface, loreMove(surface.target, surface.hint, { to }))
    }

    function onSheetKey(event: KeyboardEvent): void {
        if (event.isComposing || event.keyCode === 229) return
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        closeSheet()
    }

    function bulkAction(on: boolean): void {
        const surface = bulk?.surface
        closeSurfaces()
        if (!surface) return
        runOwn(loreBulkActive(on), 'same', surface, 'menu')
        root?.querySelector<HTMLElement>('[data-part="studio-lore-bulk-menu"]')?.focus()
    }

    // The target the sheet moves, and the folders it may move into, on the rows as they are now.
    const sheetIndex = $derived(sheet?.target ? resolveTracked(rows, sheet.target, sheet.hint) : null)
    const sheetTargets = $derived(sheetIndex === null ? [] : moveTargets(rows, sheetIndex))
    const menuIndex = $derived(menu?.surface.target ? resolveTracked(rows, menu.surface.target, menu.surface.hint) : null)
    const menuRow = $derived(menuIndex === null ? null : rows[menuIndex])

    function folderNameOf(key: string | null): string {
        if (key === null) return language.studioLoreTopLevel
        const folder = rows.find((candidate) => isFolderRow(candidate) && candidate.key === key)
        return displayNameOf(folder) ?? language.sidebarUi.unnamedFolder
    }

    // ---------------------------------------------------------------- row actions

    function openRow(row: LoreListRow): void {
        openStudioListRow({ ownerKey, kind: 'lore' }, ownerKey, loreItemIdOf(ownerId, row.index))
    }

    function isActive(row: LoreListRow): boolean {
        const element = rows[row.index]
        return isLoreRow(element) && element.alwaysActive === true
    }

    function toggleActive(row: LoreListRow): void {
        const surface = listSurface(row.index)
        if (surface === null || surface.target === null || !editable) return
        runOwn(loreAlwaysActive(surface.target, row.index, !isActive(row)), 'same', surface, 'toggle')
    }

    function addEntry(): void {
        if (!editable) return
        runOwn(loreAddEntry(null), 'opens', { token: { from: 'list', n: listToken }, target: null, hint: -1 })
    }

    function addFolder(): void {
        if (!editable) return
        runOwn(loreAddFolder(), 'opens', { token: { from: 'list', n: listToken }, target: null, hint: -1 })
    }

    function onRowKey(event: KeyboardEvent, row: LoreListRow): void {
        if (event.isComposing || event.keyCode === 229 || row.kind === 'nonEntry') return
        const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
        if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault()
            const surface = listSurface(row.index)
            if (!editable || surface === null || surface.target === null) return
            runOwn(loreMove(surface.target, row.index, event.key === 'ArrowUp' ? 'up' : 'down'), 'same', surface, 'name')
            return
        }
        if (plain && event.key === 'Delete') {
            event.preventDefault()
            const surface = listSurface(row.index)
            if (editable && surface !== null) requestDelete(surface)
            return
        }
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault()
            const button = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-part="studio-lore-row-menu"]')
            if (editable && button !== null) void openMenu(row, button)
            return
        }
        if (plain && row.kind === 'folder' && event.target instanceof Element && event.target.matches('[data-part="studio-lore-row-name"]')) {
            if ((event.key === 'ArrowRight' && !row.expanded) || (event.key === 'ArrowLeft' && row.expanded)) {
                event.preventDefault()
                toggleFolder(row)
            }
        }
    }

    function toggleFolder(row: LoreListRow): void {
        const element = rows[row.index]
        if (isFolderRow(element)) ontoggle(element.key)
    }

    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
    const iconButtonClass = 'flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
    const itemClass = 'min-h-11 w-full px-3 text-left hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
    const info = $derived(host === 'character' ? language.globalLoreInfo : host === 'chat' ? language.localLoreInfo : language.studioLoreModuleInfo)
</script>

<div bind:this={root} tabindex="-1" data-part="studio-lore-list" class="flex flex-col gap-2 outline-none">
    <div class="flex items-center gap-2">
        <h3 class="font-bold">{language.studioLoreList}</h3>
        <Help key="lorebook" />
    </div>
    <p data-part="studio-lore-info" class="text-sm text-textcolor2">{info}</p>
    <div class="flex flex-wrap items-center gap-2" data-part="studio-lore-toolbar">
        <button type="button" data-part="studio-lore-add" class="{buttonClass} flex items-center gap-1" disabled={!editable} onclick={addEntry}><PlusIcon size={16} aria-hidden="true" /><span>{language.studioLoreAddEntry}</span></button>
        <button type="button" data-part="studio-lore-add-folder" class="{buttonClass} flex items-center gap-1" disabled={!editable} onclick={addFolder}><FolderPlusIcon size={16} aria-hidden="true" /><span>{language.studioLoreAddFolder}</span></button>
        {#if bulkEnabling}
            <button
                type="button"
                data-part="studio-lore-bulk-menu"
                class={iconButtonClass}
                aria-label={language.studioLoreBulkMenu}
                aria-haspopup="menu"
                aria-expanded={bulk !== null}
                disabled={!editable}
                onclick={(event) => openBulk(event.currentTarget)}
            ><EllipsisIcon size={18} aria-hidden="true" /></button>
        {/if}
    </div>
    {#if rows.length === 0}
        <p data-part="studio-lore-empty" class="text-textcolor2">{language.studioLoreEmpty}</p>
    {/if}
    <div bind:this={listRoot}>
        <WindowedSegment
            host={windowHost}
            tag="ul"
            data-part="studio-lore-rows"
            class="flex flex-col"
            keys={rowKeys}
            height={{ fallback: LORE_ROW_FALLBACK_PX }}
            item={loreRow}
        />
    </div>
    {#snippet loreRow(key: string)}
        {@const row = rowByKey.get(key)}
        {#if row}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                data-part="studio-lore-row"
                data-row-key={row.key}
                data-index={row.index}
                data-kind={row.kind}
                class="flex min-h-11 items-center gap-1 rounded hover:bg-selected"
                style="padding-inline-start: {row.depth * INDENT_PX}px"
                onkeydown={(event) => onRowKey(event, row)}
            >
                {#if row.kind === 'folder'}
                    <button type="button" data-part="studio-lore-row-chevron" class={iconButtonClass} aria-expanded={row.expanded} aria-label={labelOf(row)} onclick={() => toggleFolder(row)}>
                        {#if row.expanded}
                            <ChevronDownIcon size={16} aria-hidden="true" />
                        {:else}
                            <ChevronRightIcon size={16} aria-hidden="true" />
                        {/if}
                    </button>
                {/if}
                {#if row.kind === 'nonEntry'}
                    <span data-part="studio-lore-row-inert" class="min-w-0 flex-1 truncate text-textcolor2">{language.studioLoreNonEntryRow}</span>
                {:else}
                    <button
                        type="button"
                        data-part="studio-lore-row-name"
                        class="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 text-start"
                        onclick={() => openRow(row)}
                    >
                        {#if row.kind === 'folder'}
                            {#if row.expanded}
                                <FolderOpenIcon size={16} aria-hidden="true" />
                            {:else}
                                <FolderIcon size={16} aria-hidden="true" />
                            {/if}
                        {:else if row.kind === 'link'}
                            <LinkIcon size={16} aria-hidden="true" />
                        {:else}
                            <FileTextIcon size={16} aria-hidden="true" />
                        {/if}
                        <span class="min-w-0 flex-1 truncate">{labelOf(row)}</span>
                        {#if row.kind === 'folder'}
                            <span data-part="studio-lore-row-count" class="shrink-0 text-xs text-textcolor2">{language.studioLoreFolderCount(row.entryCount)}</span>
                        {/if}
                    </button>
                    {#if row.duplicateId}
                        <span data-part="studio-lore-row-marker" data-marker="duplicateId" role="img" class="shrink-0 text-draculared" title={language.studioLoreDuplicateId} aria-label={language.studioLoreDuplicateId}><TriangleAlertIcon size={16} aria-hidden="true" /></span>
                    {/if}
                    {#if row.folderMissing}
                        <span data-part="studio-lore-row-marker" data-marker="folderMissing" role="img" class="shrink-0 text-draculared" title={language.studioLoreFolderMissing} aria-label={language.studioLoreFolderMissing}><TriangleAlertIcon size={16} aria-hidden="true" /></span>
                    {/if}
                    {#if row.kind !== 'link'}
                        <button
                            type="button"
                            data-part="studio-lore-row-toggle"
                            class="{iconButtonClass} px-2 text-xs {isActive(row) ? 'bg-selected' : ''}"
                            aria-pressed={isActive(row)}
                            aria-label={language.studioLoreAlwaysActiveToggle(labelOf(row))}
                            disabled={!editable}
                            onclick={() => toggleActive(row)}
                        >{language.alwaysActive}</button>
                    {/if}
                    <button
                        type="button"
                        data-part="studio-lore-row-menu"
                        class={iconButtonClass}
                        aria-label={language.studioLoreRowMenu(labelOf(row))}
                        aria-haspopup="menu"
                        aria-expanded={menu !== null && menu.surface.hint === row.index}
                        disabled={!editable}
                        onclick={(event) => openMenu(row, event.currentTarget)}
                    ><EllipsisIcon size={18} aria-hidden="true" /></button>
                {/if}
            </div>
        {/if}
    {/snippet}
    {#if menu !== null && menuIndex !== null}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
            bind:this={menuElement}
            role="menu"
            tabindex="-1"
            data-part="studio-lore-menu"
            class="fixed z-50 flex min-w-48 flex-col overflow-hidden rounded-md border border-darkborderc bg-darkbg text-textcolor"
            style="top: {menu.top}px; right: {menu.right}px"
            onkeydown={onMenuKey}
        >
            <button type="button" role="menuitem" data-part="studio-lore-move-up" class={itemClass} onclick={() => moveFromMenu('up')}>{language.studioLoreMoveUp}</button>
            <button type="button" role="menuitem" data-part="studio-lore-move-down" class={itemClass} onclick={() => moveFromMenu('down')}>{language.studioLoreMoveDown}</button>
            <button type="button" role="menuitem" data-part="studio-lore-move-top" class={itemClass} onclick={() => moveFromMenu('top')}>{language.studioLoreMoveTop}</button>
            <button type="button" role="menuitem" data-part="studio-lore-move-bottom" class={itemClass} onclick={() => moveFromMenu('bottom')}>{language.studioLoreMoveBottom}</button>
            <button type="button" role="menuitem" data-part="studio-lore-move-to-folder" class={itemClass} onclick={openSheet}>{language.studioLoreMoveToFolder}</button>
            {#if isLoreRow(menuRow) && typeof menuRow.folder === 'string' && menuRow.folder !== ''}
                <button type="button" role="menuitem" data-part="studio-lore-move-out" class={itemClass} onclick={() => moveFromMenu('out')}>{language.studioLoreMoveOut}</button>
            {/if}
            {#if isLoreRow(menuRow) && menuRow.mode !== 'folder' && !isLinkRow(menuRow)}
                <button type="button" role="menuitem" data-part="studio-lore-duplicate" class={itemClass} onclick={duplicateFromMenu}>{language.studioLoreDuplicate}</button>
            {/if}
            <button type="button" role="menuitem" data-part="studio-lore-delete" class="{itemClass} text-draculared" onclick={deleteFromMenu}>{language.studioLoreDelete}</button>
        </div>
    {/if}
    {#if bulk !== null}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
            bind:this={menuElement}
            role="menu"
            tabindex="-1"
            data-part="studio-lore-bulk-list"
            class="fixed z-50 flex min-w-48 flex-col overflow-hidden rounded-md border border-darkborderc bg-darkbg text-textcolor"
            style="top: {bulk.top}px; right: {bulk.right}px"
            onkeydown={onMenuKey}
        >
            <button type="button" role="menuitem" data-part="studio-lore-bulk-on" class={itemClass} onclick={() => bulkAction(true)}>{language.studioLoreBulkActive}</button>
            <button type="button" role="menuitem" data-part="studio-lore-bulk-off" class={itemClass} onclick={() => bulkAction(false)}>{language.studioLoreBulkKeys}</button>
        </div>
    {/if}
    {#if sheet !== null}
        <div class="fixed inset-0 z-50 flex items-end justify-center bg-bgcolor/60 sm:items-center" data-part="studio-lore-sheet-backdrop">
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div
                bind:this={sheetElement}
                role="dialog"
                aria-modal="true"
                aria-label={language.studioLoreMoveToFolder}
                tabindex="-1"
                data-part="studio-lore-sheet"
                class="flex max-h-[80vh] w-full max-w-md flex-col gap-1 overflow-y-auto rounded-t border border-darkborderc bg-bgcolor p-3 sm:rounded"
                onkeydown={onSheetKey}
            >
                {#each sheetTargets as target (target ?? '\u0000top')}
                    <button type="button" data-part="studio-lore-sheet-target" data-folder-key={target ?? ''} class={buttonClass} onclick={() => moveToFolder(target)}>{folderNameOf(target)}</button>
                {/each}
                <button type="button" data-part="studio-lore-sheet-cancel" class="min-h-11 rounded bg-darkbutton px-3 hover:bg-selected cursor-pointer" onclick={closeSheet}>{language.cancel}</button>
            </div>
        </div>
    {/if}
</div>
