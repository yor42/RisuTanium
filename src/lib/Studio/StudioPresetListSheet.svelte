<script lang="ts">
    import { onMount } from 'svelte'
    import { FolderPlusIcon, PlusIcon, XIcon } from '@lucide/svelte'
    import { language } from '../../lang'
    import { groupPresetsByFolder, presetIndexById } from '../../ts/storage/presetListOps'
    import { slotBadgeFor } from '../../ts/storage/presetMeta'
    import { presetOwnerKey } from '../../ts/studio/edit/presetTarget'
    import { refusalTextOf } from '../../ts/studio/edit/studioToasts'
    import { ownerKeyOf } from '../../ts/studio/ownerModel'
    import { commitSlotPlan, copyPresetById, createFolder, deleteFolderById, deletePresetById, dropPresetOnById, exportBundleByIds, exportPresetById, importPresetsFromPicker, moveFolderBy, movePresetStepById, movePresetToFolderById, moveToFolderWithUndo, newPreset, planSlotForPreset, renameFolder, renamePresetById, useInChats, type PresetListResult } from '../../ts/studio/presetListActions'
    import { fillLang } from '../../lang/fill'
    import { readCollapsedFolders, writeCollapsedFolders } from '../../ts/studio/presetFolderCollapse'
    import { registerStudioPresetSheetBack } from '../../ts/studio/studioBack.svelte'
    import { selectStudioNode, setStudioPresetSheetOpen } from '../../ts/studio/studioScreen.svelte'
    import { DBState } from '../../ts/stores.svelte'
    import StudioPresetFolderHeader from './StudioPresetFolderHeader.svelte'
    import StudioPresetRow from './StudioPresetRow.svelte'

    // The "Manage presets" sheet over the Studio tree. It holds only ids and UI state; the rows are derived from the
    // preset list on every render, and every action resolves its preset by id when it runs. The page behind it stays
    // usable (no inert, no focus trap), and the toast stack is not held back.
    registerStudioPresetSheetBack()

    let menuId = $state<string | null>(null)
    let renamingId = $state<string | null>(null)
    let renameText = $state('')
    let highlightId = $state<string | null>(null)
    let message = $state<string | null>(null)
    let busy = $state(false)
    let moveId = $state<string | null>(null)
    let slotId = $state<string | null>(null)
    let pendingSlot = $state<{ id: string, n: number } | null>(null)
    let selectMode = $state(false)
    let selectedIds = $state<string[]>([])
    let exporting = $state(false)
    let folderFormOpen = $state(false)
    let folderText = $state('')
    let collapsed = $state(readCollapsedFolders())
    let closeButton = $state<HTMLButtonElement | undefined>()

    const presets = $derived(DBState.db.botPresets ?? [])
    // The selection holds preset ids, so a reorder or a removal while selecting never shifts it.
    const selectedCount = $derived(presets.filter((preset) => typeof preset?.id === 'string' && selectedIds.includes(preset.id)).length)
    const allSelected = $derived(presets.length > 0 && selectedCount === presets.length)
    const pendingPlan = $derived(pendingSlot === null ? null : planSlotForPreset(pendingSlot.id, pendingSlot.n))
    // Each row carries its id from the render that built it, so a tap before the next render still names its own preset.
    // The section key is the folder id (a repeat of an id, which only damaged data has, gets its position), so a folder's open
    // menu moves with the folder when the folders are reordered or one is deleted.
    const sections = $derived(groupPresetsByFolder(DBState.db).map((section, at, all) => ({
        key: section.folder === null ? 'loose' : all.findIndex((other) => other.folder?.id === section.folder?.id) === at ? section.folder.id : section.folder.id + '#' + at,
        folder: section.folder,
        rows: section.indices.flatMap((index) => {
            const id = DBState.db.botPresets[index]?.id
            return typeof id === 'string' && id !== '' ? [{ index, id }] : []
        }),
    })))
    const folders = $derived((DBState.db.presetFolders ?? []).map((folder) => ({ id: folder.id, name: folder.name })))
    const FAILURE_TEXT = {
        gone: () => language.studioRefusalPresetGone,
        required: () => language.studioPresetFolderRequired,
        'folder-gone': () => language.studioPresetFolderGone,
    }

    onMount(() => closeButton?.focus())

    function reset(): void {
        menuId = null
        renamingId = null
        moveId = null
        slotId = null
    }

    // A refused action says why; a done one clears the line. A cancelled delete and the only-preset refusal were
    // already answered by the confirm and the alert.
    function noted(result: PresetListResult): boolean {
        message = result.ok === false && result.reason in FAILURE_TEXT ? FAILURE_TEXT[result.reason as keyof typeof FAILURE_TEXT]() : null
        return result.ok
    }

    function open(id: string): void {
        const index = presetIndexById(DBState.db.botPresets, id)
        if (index === -1) {
            message = language.studioRefusalPresetGone
            return
        }
        setStudioPresetSheetOpen(false)
        selectStudioNode(ownerKeyOf('preset', String(index)), null, null)
    }

    function create(): void {
        reset()
        const result = newPreset()
        if (noted(result) && result.ok && result.id !== undefined) highlightId = result.id
    }

    function use(id: string): void {
        noted(useInChats(id))
        menuId = null
    }

    function copy(id: string): void {
        const result = copyPresetById(id)
        if (noted(result) && result.ok && result.id !== undefined) highlightId = result.id
        menuId = null
    }

    async function remove(id: string): Promise<void> {
        busy = true
        try {
            noted(await deletePresetById(id))
            reset()
        } finally {
            busy = false
        }
    }

    async function rename(id: string): Promise<void> {
        busy = true
        try {
            const result = await renamePresetById(id, renameText)
            if (result.ok === false) {
                message = refusalTextOf(result, presetOwnerKey(id))
                return
            }
            message = null
            reset()
        } catch (error) {
            console.error(error)
            message = language.studioRefusalUnknown
        } finally {
            busy = false
        }
    }

    function toggleMenu(id: string): void {
        renamingId = null
        moveId = null
        slotId = null
        menuId = menuId === id ? null : id
    }

    function startRename(id: string): void {
        const current = DBState.db.botPresets.find((preset) => preset?.id === id)
        renameText = typeof current?.name === 'string' ? current.name : ''
        renamingId = id
    }

    function toggleFolder(id: string): void {
        const next = new Set(collapsed)
        if (!next.delete(id)) next.add(id)
        collapsed = next
        writeCollapsedFolders(next)
    }

    function addFolder(): void {
        const result = createFolder(folderText)
        if (!noted(result)) return
        folderText = ''
        folderFormOpen = false
    }

    function renameFolderTo(id: string, text: string): boolean {
        return noted(renameFolder(id, text))
    }

    async function removeFolder(id: string): Promise<void> {
        busy = true
        try {
            noted(await deleteFolderById(id))
        } finally {
            busy = false
        }
    }

    function newInFolder(folderId: string): void {
        reset()
        const created = newPreset()
        if (!created.ok || created.id === undefined) return
        highlightId = created.id
        noted(movePresetToFolderById(created.id, folderId))
    }

    function moveTo(id: string, folderId: string | undefined): void {
        noted(moveToFolderWithUndo(id, folderId))
        reset()
    }

    // A slot another preset holds opens the swap confirm instead of writing; the swap is planned again, by id, when it is pressed.
    function chooseSlot(id: string, n: number | null): void {
        const own = slotBadgeFor(DBState.db.botPresets, presetIndexById(DBState.db.botPresets, id))
        const planned = planSlotForPreset(id, n, n === null ? own : undefined)
        reset()
        if (!planned.ok) {
            message = language.studioRefusalPresetGone
            return
        }
        message = null
        if (n !== null && planned.holder !== null) {
            pendingSlot = { id, n }
            return
        }
        commitSlotPlan(planned.plan)
    }

    function swapSlot(): void {
        const draft = pendingSlot
        pendingSlot = null
        if (!draft) return
        const planned = planSlotForPreset(draft.id, draft.n)
        if (!planned.ok) {
            message = language.studioRefusalPresetGone
            return
        }
        message = null
        commitSlotPlan(planned.plan)
    }

    function setSelectMode(on: boolean): void {
        selectMode = on
        selectedIds = []
        reset()
    }

    function toggleSelected(id: string): void {
        selectedIds = selectedIds.includes(id) ? selectedIds.filter((other) => other !== id) : [...selectedIds, id]
    }

    function toggleAll(): void {
        selectedIds = allSelected ? [] : presets.flatMap((preset) => typeof preset?.id === 'string' ? [preset.id] : [])
    }

    // Import and export report through the alerts classic raises; a refusal here only says the preset is gone.
    async function guarded(work: () => Promise<PresetListResult>): Promise<boolean> {
        if (busy || exporting) return false
        busy = true
        exporting = true
        try {
            return noted(await work())
        } catch (error) {
            console.error(error)
            message = language.studioRefusalUnknown
            return false
        } finally {
            busy = false
            exporting = false
        }
    }

    async function exportSelected(): Promise<void> {
        if (selectedCount === 0) return
        if (await guarded(() => exportBundleByIds(presets.flatMap((preset) => typeof preset?.id === 'string' && selectedIds.includes(preset.id) ? [preset.id] : [])))) setSelectMode(false)
    }

    async function openClassic(): Promise<void> {
        const { openInClassicEditor } = await import('../../ts/studio/classicLinks.svelte')
        openInClassicEditor('preset', null)
    }

    function step(id: string, direction: -1 | 1): void {
        noted(movePresetStepById(id, direction))
        reset()
    }

    function dropOn(targetId: string, sourceId: string): void {
        noted(dropPresetOnById(sourceId, targetId))
        reset()
    }

    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
</script>

<div data-part="studio-preset-layer" class="absolute inset-0 z-30 flex items-end justify-center bg-black/40 p-3 sm:items-center">
    <div role="dialog" aria-labelledby="studio-preset-list-title" data-part="studio-preset-list-sheet" class="flex max-h-full w-full max-w-md flex-col gap-3 overflow-y-auto rounded-md border border-darkborderc bg-darkbg p-4 text-textcolor">
        <div class="flex items-center gap-2">
            <h2 id="studio-preset-list-title" class="flex-1 text-lg font-bold">{language.studioPresetListManage}</h2>
            <button bind:this={closeButton} type="button" data-part="studio-preset-list-close" class="flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-selected cursor-pointer" aria-label={language.studioPresetListClose} onclick={() => setStudioPresetSheetOpen(false)}>
                <XIcon size={18} aria-hidden="true" />
            </button>
        </div>
        <div class="flex flex-wrap gap-2">
            <button type="button" data-part="studio-preset-new" class="{buttonClass} flex items-center gap-1" disabled={busy} onclick={create}>
                <PlusIcon size={16} aria-hidden="true" />{language.studioPresetListNew}
            </button>
            <button type="button" data-part="studio-preset-import" class={buttonClass} disabled={busy} onclick={() => void guarded(importPresetsFromPicker)}>{language.import}</button>
            <button type="button" data-part="studio-preset-select-mode" class={buttonClass} aria-pressed={selectMode} disabled={busy} onclick={() => setSelectMode(!selectMode)}>{language.presetBundleSelect}</button>
            <button type="button" data-part="studio-preset-folder-new" class="{buttonClass} flex items-center gap-1" disabled={busy} onclick={() => { folderFormOpen = !folderFormOpen }}>
                <FolderPlusIcon size={16} aria-hidden="true" />{language.studioPresetFolderNew}
            </button>
        </div>
        {#if selectMode}
            <div data-part="studio-preset-select-bar" class="flex flex-wrap items-center gap-2">
                <button type="button" data-part="studio-preset-select-all" class={buttonClass} aria-pressed={allSelected} onclick={toggleAll}>{language.presetBundleAll}</button>
                <button type="button" data-part="studio-preset-export-selected" class={buttonClass} disabled={selectedCount === 0 || exporting} onclick={() => void exportSelected()}>{fillLang(language.presetBundleExport, { count: selectedCount })}</button>
                <button type="button" data-part="studio-preset-select-cancel" class={buttonClass} onclick={() => setSelectMode(false)}>{language.cancel}</button>
            </div>
        {/if}
        {#if folderFormOpen}
            <form data-part="studio-preset-folder-form" class="flex flex-wrap items-center gap-2" onsubmit={(event) => { event.preventDefault(); addFolder() }}>
                <input type="text" data-part="studio-preset-folder-input" aria-label={language.studioPresetFolderName} class="min-h-11 min-w-0 flex-1 rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor" value={folderText} oninput={(event) => { folderText = event.currentTarget.value }} />
                <button type="submit" data-part="studio-preset-folder-add" class={buttonClass}>{language.add}</button>
            </form>
        {/if}
        {#if message}
            <p role="status" data-part="studio-preset-message" class="text-sm text-draculared">{message}</p>
        {/if}
        {#if pendingPlan && pendingPlan.ok && pendingPlan.holder}
            <div data-part="studio-preset-slot-conflict" class="flex flex-col gap-1 rounded-md border border-draculared p-2 text-sm">
                <span class="text-textcolor">{language.settingsShellHkConflict(pendingPlan.holder.name)}</span>
                <span class="text-textcolor2">{language.settingsShellHkSwapOutcome(pendingPlan.holder.name, pendingPlan.moverSlot !== undefined ? language.settingsShellHkPresetSlot(pendingPlan.moverSlot) : language.settingsShellHkSlotNone)}</span>
                <div class="flex gap-2">
                    <button type="button" data-part="studio-preset-slot-swap" class={buttonClass} onclick={swapSlot}>{language.settingsShellHkSwap}</button>
                    <button type="button" data-part="studio-preset-slot-cancel" class={buttonClass} onclick={() => { pendingSlot = null }}>{language.cancel}</button>
                </div>
            </div>
        {/if}
        <ul data-part="studio-preset-list" class="flex flex-col gap-1">
            {#each sections as section, at (section.key)}
                {#if section.folder}
                    {@const folder = section.folder}
                    <StudioPresetFolderHeader
                        id={folder.id}
                        name={folder.name}
                        count={section.rows.length}
                        collapsed={collapsed.has(folder.id)}
                        first={at === 0}
                        last={at === folders.length - 1}
                        {busy}
                        ontoggle={() => toggleFolder(folder.id)}
                        onrename={(text) => renameFolderTo(folder.id, text)}
                        onnewpreset={() => newInFolder(folder.id)}
                        ondelete={() => void removeFolder(folder.id)}
                        onmoveup={() => { noted(moveFolderBy(folder.id, -1)) }}
                        onmovedown={() => { noted(moveFolderBy(folder.id, 1)) }}
                    />
                {:else if folders.length > 0}
                    <li data-part="studio-preset-loose-heading" class="px-2 pt-1 text-sm text-textcolor2">{language.studioPresetNoFolder}</li>
                {/if}
                {#if !section.folder || !collapsed.has(section.folder.id)}
                    {#each section.rows as { index, id }, rowAt (index)}
                        <StudioPresetRow
                            {id}
                            active={index === DBState.db.botPresetsId}
                            slot={slotBadgeFor(presets, index)}
                            highlighted={highlightId === id}
                            menuOpen={menuId === id}
                            renaming={renamingId === id}
                            {renameText}
                            {busy}
                            {folders}
                            folderId={section.folder?.id}
                            moveOpen={moveId === id}
                            slotOpen={slotId === id}
                            selecting={selectMode}
                            selected={selectedIds.includes(id)}
                            onselect={() => toggleSelected(id)}
                            onexport={() => { reset(); void guarded(() => exportPresetById(id)) }}
                            first={rowAt === 0}
                            last={rowAt === section.rows.length - 1}
                            onopen={() => open(id)}
                            onmenu={() => toggleMenu(id)}
                            onuse={() => use(id)}
                            oncopy={() => copy(id)}
                            onrename={() => startRename(id)}
                            onmoveopen={() => { moveId = id }}
                            onmoveto={(target) => moveTo(id, target)}
                            onslotopen={() => { slotId = id }}
                            onslot={(n) => chooseSlot(id, n)}
                            onup={() => step(id, -1)}
                            ondown={() => step(id, 1)}
                            ondropon={(sourceId) => dropOn(id, sourceId)}
                            ondelete={() => void remove(id)}
                            onrenametext={(text) => { renameText = text }}
                            onrenamesubmit={() => void rename(id)}
                            onrenamecancel={() => { renamingId = null }}
                        />
                    {/each}
                {/if}
            {/each}
        </ul>
        <p data-part="studio-preset-classic-note" class="text-sm text-textcolor2">{language.studioPresetClassicOnly}</p>
        <button type="button" data-part="studio-preset-classic-button" class={buttonClass} onclick={() => void openClassic()}>{language.studioOpenClassic}</button>
        <p class="text-sm text-textcolor2">{language.quickPreset}</p>
    </div>
</div>
