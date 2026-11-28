<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { language } from '../../lang'
    import { openInClassicEditor } from '../../ts/studio/classicLinks.svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { objRefusalText } from '../../ts/studio/edit/objListCopy'
    import { classifyRegexList } from '../../ts/studio/edit/regexEntry'
    import { regexAdd, regexDelete, regexDuplicate, regexMove, type RegexMove, type RegexOp } from '../../ts/studio/edit/regexListOps'
    import { createStudioToasts, refusalTextOf } from '../../ts/studio/edit/studioToasts'
    import { beginPresetAck, currentPresetAck, endPresetAck, type PresetAckHolder } from '../../ts/studio/edit/presetAck.svelte'
    import { presetOwnerKey, presetRegexRows, presetStateOf } from '../../ts/studio/edit/presetTarget'
    import { characterOwnerKey, moduleOwnerKey, type OwnerKey } from '../../ts/studio/history/ownerPhase'
    import {
        beginModuleAck,
        beginOwnerVisit,
        currentModuleAck,
        currentVisitAck,
        ensureStudioHistory,
        getStudioHistoryService,
    } from '../../ts/studio/history/studioHistoryService.svelte'
    import type { StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { ownerKeyOf, regexIndexOfItemId, regexItemIdOf } from '../../ts/studio/ownerModel'
    import { openStudioListRow, setStudioSelection, studioScreen } from '../../ts/studio/studioScreen.svelte'
    import { DBState } from '../../ts/stores.svelte'
    import Help from '../Others/Help.svelte'
    import StudioRegexForm from './StudioRegexForm.svelte'
    import StudioRegexList, { type RegexFocusRequest, type RegexTarget } from './StudioRegexList.svelte'
    import StudioStatusChip from './StudioStatusChip.svelte'

    // The regex scripts of one character, module or preset: a plain row list while no script is selected, the item editor
    // while one is. Every persisted write goes through the form or the list operations, which read the live list at each use.
    interface Props {
        ownerType: 'character' | 'module' | 'preset'
        // The preset's stable id (its row index moves); read only for a preset.
        presetId?: string | null
        ownerId: string
        chaId: string
        moduleId: string | null
        moduleSlotIndex: number | null
        // The selected item of this owner's regex kind; null while the list shows.
        itemId: string | null
    }

    let { ownerType, presetId = null, ownerId, chaId, moduleId, moduleSlotIndex, itemId }: Props = $props()

    const ownerKey = untrack(() => ownerKeyOf(ownerType, ownerId))
    const PRESET_KEY_PREFIX = ownerKeyOf('preset', '')

    // The selection key and the row part of item ids. A character or module never moves, so its mount-time key stands. A
    // preset's row moves with reorders, so its key is read from the selection at each use, and null (no selection, or one
    // that is not a preset) means nothing is selected or opened on its behalf.
    function selectionKey(): string | null {
        if (ownerType !== 'preset') return ownerKey
        const key = studioScreen.selectedOwnerKey
        return key !== null && key.startsWith(PRESET_KEY_PREFIX) && key.length > PRESET_KEY_PREFIX.length ? key : null
    }
    function itemOwnerId(): string | null {
        if (ownerType !== 'preset') return ownerId
        const key = selectionKey()
        return key === null ? null : key.slice(PRESET_KEY_PREFIX.length)
    }

    // A preset pane is keyed by its pinned id, so the id it acks is fixed at mount; null for a character or module.
    const ackPresetId = untrack(() => (ownerType === 'preset' ? presetId : null))
    const ackHolder: PresetAckHolder = { label: 'regex pane' }

    const service = $derived(getStudioHistoryService())
    const character = $derived.by(() => {
        const found = DBState.db.characters?.find((candidate) => candidate?.chaId === chaId)
        return found && found.type !== 'group' ? found : undefined
    })
    const moduleBody = $derived.by(() => {
        if (ownerType !== 'module' || moduleSlotIndex === null) return undefined
        const body = DBState.db.modules?.[moduleSlotIndex]
        return body !== undefined && body.id === moduleId ? body : undefined
    })
    // The history owner of this list; null while none exists (no such character, a module that is not at its slot).
    const owner = $derived.by((): OwnerKey | null => {
        if (ownerType === 'preset') return presetId !== null && presetStateOf(presetId) !== null ? presetOwnerKey(presetId) : null
        if (character === undefined) return null
        if (ownerType === 'character') return characterOwnerKey(chaId)
        return moduleId !== null && moduleBody !== undefined ? moduleOwnerKey(moduleId) : null
    })

    $effect(() => {
        const key = owner
        if (!service) {
            ensureStudioHistory()
            return
        }
        if (key === null) return
        untrack(() => {
            beginOwnerVisit(key)
            if (ownerType === 'module' && moduleId !== null) beginModuleAck(moduleId)
            if (ackPresetId !== null) beginPresetAck(ackPresetId, studioScreen.visitId, ackHolder)
        })
    })

    const view = $derived(service && owner !== null ? service.view(owner) : null)
    const editable = $derived(view?.editable === true)

    // The live list, read at each use so a row is the live one and never a snapshot. An absent list reads as empty; any
    // other stored value is returned as it is, so the classification can name it.
    function readLive(): unknown {
        if (ownerType === 'preset') return presetId === null ? [] : presetRegexRows(presetId) ?? []
        const list: unknown = ownerType === 'character' ? character?.customscript : moduleBody?.regex
        return list === undefined ? [] : list
    }

    const listClass = $derived(classifyRegexList(readLive()))
    const rows = $derived(listClass.kind === 'rows' ? listClass.rows : [])
    const rowsRaw = $derived.by((): readonly unknown[] => {
        const list = readLive()
        return Array.isArray(list) ? list : []
    })

    const openIndex = $derived.by(() => {
        if (itemId === null) return undefined
        const id = itemOwnerId()
        return id === null ? undefined : regexIndexOfItemId(id, itemId)
    })
    const openClass = $derived(openIndex === undefined ? undefined : rows[openIndex])
    const formOpen = $derived(openClass !== undefined && openClass.kind === 'ok')

    // A selected script that is gone, or that is not an editable row any more, leaves the list showing: the selection
    // is cleared so Back and the tree do not point at it.
    $effect(() => {
        if (itemId === null) return
        if (formOpen) return
        untrack(() => {
            const key = selectionKey()
            if (key !== null) setStudioSelection(key, 'regex', null)
        })
    })

    function openRow(index: number): void {
        const key = selectionKey()
        const id = itemOwnerId()
        if (key === null || id === null) return
        openStudioListRow({ ownerKey: key, kind: 'regex' }, key, regexItemIdOf(id, index))
    }

    // ---------------------------------------------------------------- list operations

    const toasts = createStudioToasts({ service: getStudioHistoryService })
    let refusal = $state<string | null>(null)
    let focusRequest = $state.raw<RegexFocusRequest | null>(null)
    // Set by Add: the editor it opens takes focus on its name field, once.
    let focusNewName = $state(false)

    // Every own write of the list goes through here; the live row is read at the moment of the action.
    function runOp(op: RegexOp): StudioResult {
        if (!service || owner === null || !editable) return { ok: false, reason: 'loading' }
        const result = service.objEdit(owner, op.build)
        refusal = result.ok === false ? (objRefusalText(result) ?? refusalTextOf(result, owner)) : null
        return result
    }

    function nameOfRow(row: unknown): string {
        const name = typeof row === 'object' && row !== null ? (row as Record<string, unknown>).comment : undefined
        return typeof name === 'string' && name !== '' ? name : language.sidebarUi.unnamedScript
    }

    function addScript(): void {
        const op = regexAdd()
        const result = runOp(op)
        const index = op.landed()
        if (result.ok === false || result.unchanged === true || index === null) return
        focusNewName = true
        openRow(index)
        void afterFlush().then(() => { focusNewName = false })
    }

    function moveScript({ index, expected, twins }: RegexTarget, move: RegexMove): void {
        const op = regexMove(expected, index, move, twins)
        const result = runOp(op)
        if (result.ok === true && result.unchanged !== true) focusRequest = { index: op.landed(), control: 'menu' }
        else focusRequest = { index, control: 'menu' }
    }

    function duplicateScript({ index, expected, twins }: RegexTarget): void {
        const op = regexDuplicate(expected, index, twins)
        const result = runOp(op)
        if (result.ok === true && result.unchanged !== true) focusRequest = { index: op.landed(), control: 'menu' }
        else focusRequest = { index, control: 'menu' }
    }

    // No confirm: the row goes to the deleted list at once, one toast offers Undo, and focus moves to the next row, else the
    // previous one.
    function deleteScript({ index, expected, twins }: RegexTarget): void {
        const row = expected
        const count = rowsRaw.length
        const op = regexDelete(expected, index, twins)
        const result = runOp(op)
        if (result.ok === false || result.unchanged === true) {
            focusRequest = { index, control: 'menu' }
            return
        }
        const deletedId = op.landedDeletedId()
        if (deletedId !== null && owner !== null) toasts.postDeleted(owner, deletedId, language.studioRegexDeleted(nameOfRow(row)), language.studioRegexToastRestored)
        focusRequest = { index: index < count - 1 ? index : index > 0 ? index - 1 : null, control: 'name' }
    }

    // The pane is keyed by its owner, so a selection change destroys it; a pick that resolves afterwards writes nothing.
    let importing = $state(false)
    let destroyed = false
    onDestroy(() => {
        destroyed = true
        // Only this pane's share of the preset ack ends; a builder of the same preset keeps its own.
        if (ackPresetId !== null) endPresetAck(ackPresetId, ackHolder)
    })

    // The history key of this pane's owner, built from its props because `owner` is null once the owner is gone; the
    // refusal text picks its preset or module wording from it.
    function goneOwnerKey(): OwnerKey | undefined {
        if (ownerType === 'preset') return presetId === null ? undefined : presetOwnerKey(presetId)
        if (ownerType === 'character') return characterOwnerKey(chaId)
        return moduleId === null ? undefined : moduleOwnerKey(moduleId)
    }

    // The picker opens only for an owner that can take the write now. After the pick, the write goes through the pane's own
    // runner, which re-reads owner, editable and service; an owner that went away during the pick shows the gone text.
    async function importScripts(): Promise<void> {
        if (!(service && owner !== null && editable && listClass.kind === 'rows' && !importing)) return
        importing = true
        try {
            const { runRegexImport } = await import('../../ts/studio/edit/regexFileActions')
            await runRegexImport(
                () => !destroyed,
                (op) => {
                    if (owner === null) {
                        refusal = refusalTextOf({ reason: 'gone' }, goneOwnerKey())
                        return { ok: false, reason: 'gone' }
                    }
                    return runOp(op)
                },
            )
        } finally {
            importing = false
        }
    }

    async function exportScripts(): Promise<void> {
        const list = readLive()
        if (!Array.isArray(list) || list.length === 0) return
        const { runRegexExport } = await import('../../ts/studio/edit/regexFileActions')
        await runRegexExport(list)
    }

    function openClassic(): void {
        openInClassicEditor(ownerType, 'regex')
    }
</script>

<div data-part="studio-regex-pane" class="flex flex-col gap-3">
    {#if ownerType === 'preset' && presetId !== null && presetStateOf(presetId)?.active === false}
        <p role="status" data-part="studio-regex-preset-not-in-chat" class="text-sm text-textcolor2">{language.studioRegexPresetNotInChat}</p>
    {/if}
    {#if owner !== null}
        <StudioStatusChip ack={ownerType === 'preset' ? currentPresetAck(ackPresetId) : ownerType === 'module' ? currentModuleAck() : currentVisitAck()} />
    {/if}
    {#if formOpen && openIndex !== undefined}
        {#key itemId}
            <StudioRegexForm index={openIndex} {readLive} {editable} {service} {owner} focusName={focusNewName} />
        {/key}
    {:else}
        {#if listClass.kind !== 'rows'}
            <h3 data-part="studio-regex-heading" class="font-bold">{language.regexScript} <Help key="regexScript" /></h3>
            <p role="status" data-part="studio-regex-not-editable" class="text-sm text-textcolor2">{language.studioRegexListNotEditable}</p>
            <div>
                <button type="button" data-part="studio-regex-classic" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={openClassic}>
                    {language.studioOpenClassic}
                </button>
            </div>
        {:else}
            <StudioRegexList
                classes={listClass.rows}
                readRows={() => rowsRaw}
                {editable}
                {focusRequest}
                onopen={openRow}
                onadd={addScript}
                onimport={importScripts}
                onexport={exportScripts}
                {importing}
                onmove={moveScript}
                onduplicate={duplicateScript}
                ondelete={deleteScript}
                onfocused={() => { focusRequest = null }}
            />
            {#if refusal !== null}
                <p role="alert" data-part="studio-regex-list-refusal" class="text-sm text-draculared">{refusal}</p>
            {/if}
        {/if}
    {/if}
</div>
