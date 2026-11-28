<script lang="ts">
    import { untrack } from 'svelte'
    import { language } from '../../lang'
    import { openInClassicEditor } from '../../ts/studio/classicLinks.svelte'
    import { classifyRegexList, type RegexReason, type RegexRowClass } from '../../ts/studio/edit/regexEntry'
    import { orderOf } from '../../ts/studio/edit/regexFlags'
    import { characterOwnerKey, moduleOwnerKey, type StoredOwnerKey } from '../../ts/studio/history/ownerPhase'
    import {
        beginModuleAck,
        beginOwnerVisit,
        currentModuleAck,
        currentVisitAck,
        ensureStudioHistory,
        getStudioHistoryService,
    } from '../../ts/studio/history/studioHistoryService.svelte'
    import { ownerKeyOf, regexIndexOfItemId, regexItemIdOf } from '../../ts/studio/ownerModel'
    import { openStudioListRow, setStudioSelection } from '../../ts/studio/studioScreen.svelte'
    import { DBState } from '../../ts/stores.svelte'
    import Help from '../Others/Help.svelte'
    import StudioRegexForm from './StudioRegexForm.svelte'
    import StudioStatusChip from './StudioStatusChip.svelte'

    // The regex scripts of one character or module: a plain row list while no script is selected, the item editor while one
    // is. Every persisted write goes through the form, which reads the live list at each use. The pane never writes.
    interface Props {
        ownerType: 'character' | 'module'
        ownerId: string
        chaId: string
        moduleId: string | null
        moduleSlotIndex: number | null
        // The selected item of this owner's regex kind; null while the list shows.
        itemId: string | null
    }

    let { ownerType, ownerId, chaId, moduleId, moduleSlotIndex, itemId }: Props = $props()

    const ownerKey = untrack(() => ownerKeyOf(ownerType, ownerId))

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
    const owner = $derived.by((): StoredOwnerKey | null => {
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
        })
    })

    const view = $derived(service && owner !== null ? service.view(owner) : null)
    const editable = $derived(view?.editable === true)

    // The live list, read at each use so a row is the live one and never a snapshot. An absent list reads as empty; any
    // other stored value is returned as it is, so the classification can name it.
    function readLive(): unknown {
        const list: unknown = ownerType === 'character' ? character?.customscript : moduleBody?.regex
        return list === undefined ? [] : list
    }

    const listClass = $derived(classifyRegexList(readLive()))
    const rows = $derived(listClass.kind === 'rows' ? listClass.rows : [])
    const rowsRaw = $derived.by((): readonly unknown[] => {
        const list = readLive()
        return Array.isArray(list) ? list : []
    })

    const openIndex = $derived(itemId === null ? undefined : regexIndexOfItemId(ownerId, itemId))
    const openClass = $derived(openIndex === undefined ? undefined : rows[openIndex])
    const formOpen = $derived(openClass !== undefined && openClass.kind === 'ok')

    // A selected script that is gone, or that is not an editable row any more, leaves the list showing: the selection
    // is cleared so Back and the tree do not point at it.
    $effect(() => {
        if (itemId === null) return
        if (formOpen) return
        untrack(() => setStudioSelection(ownerKey, 'regex', null))
    })

    function reasonText(reason: RegexReason): string {
        switch (reason.key) {
            case 'studioRegexWhyNotObject': return language.studioRegexWhyNotObject
            case 'studioRegexWhyField': return language.studioRegexWhyField(reason.field)
            case 'studioRegexWhyFlag': return language.studioRegexWhyFlag
            case 'studioRegexWhyAbleFlag': return language.studioRegexWhyAbleFlag
        }
    }

    function unreadableText(row: RegexRowClass): string {
        if (row.kind === 'ok') return ''
        const reasons = row.kind === 'inert' ? [row.reason] : row.reasons
        return language.studioRegexUnreadable(reasons.map(reasonText).join(', '))
    }

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
        index: number
        name: string
        stage: string
        disabled: boolean
        order: number | null
    }

    // The visible facts of a readable row. The order shows only while custom flags are on and the flag text holds one.
    function rowView(index: number): RowView | null {
        const row: unknown = rowsRaw[index]
        if (typeof row !== 'object' || row === null) return null
        const entry = row as Record<string, unknown>
        const name = typeof entry.comment === 'string' ? entry.comment : ''
        const type = entry.type
        const order = entry.ableFlag === true && typeof entry.flag === 'string' ? orderOf(entry.flag) : null
        return {
            index,
            name: name === '' ? language.sidebarUi.unnamedScript : name,
            stage: stageText(type),
            disabled: type === 'disabled',
            order,
        }
    }

    const okViews = $derived(rows.flatMap((row, index) => row.kind === 'ok' ? [rowView(index)] : []))
    const showOrderNote = $derived(okViews.some((row) => row !== null && row.order !== null))

    function openRow(index: number): void {
        openStudioListRow({ ownerKey, kind: 'regex' }, ownerKey, regexItemIdOf(ownerId, index))
    }

    function openClassic(): void {
        openInClassicEditor(ownerType, 'regex')
    }
</script>

<div data-part="studio-regex-pane" class="flex flex-col gap-3">
    {#if owner !== null}
        <StudioStatusChip ack={ownerType === 'module' ? currentModuleAck() : currentVisitAck()} />
    {/if}
    {#if formOpen && openIndex !== undefined}
        {#key itemId}
            <StudioRegexForm index={openIndex} {readLive} {editable} {service} {owner} />
        {/key}
    {:else}
        <h3 data-part="studio-regex-heading" class="font-bold">{language.regexScript} <Help key="regexScript" /></h3>
        {#if listClass.kind !== 'rows'}
            <p role="status" data-part="studio-regex-not-editable" class="text-sm text-textcolor2">{language.studioRegexListNotEditable}</p>
            <div>
                <button type="button" data-part="studio-regex-classic" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={openClassic}>
                    {language.studioOpenClassic}
                </button>
            </div>
        {:else if rows.length === 0}
            <p data-part="studio-regex-empty" class="text-textcolor2">{language.sidebarUi.noScripts}</p>
        {:else}
            {#if showOrderNote}
                <p data-part="studio-regex-order-note" class="text-sm text-textcolor2">{language.studioRegexOrderNote}</p>
            {/if}
            <ul data-part="studio-regex-list" class="flex flex-col gap-1">
                {#each rows as row, index (index)}
                    {@const shown = row.kind === 'ok' ? rowView(index) : null}
                    <li>
                        {#if row.kind === 'ok' && shown !== null}
                            <button
                                type="button"
                                data-part="studio-regex-row"
                                data-index={index}
                                class="flex min-h-11 w-full flex-wrap items-center gap-2 rounded-md border border-darkborderc px-3 py-1 text-left hover:bg-selected cursor-pointer"
                                onclick={() => openRow(index)}
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
                            </button>
                        {:else}
                            <div data-part="studio-regex-unreadable" data-index={index} class="flex min-h-11 w-full flex-wrap items-center gap-2 rounded-md border border-darkborderc px-3 py-1 text-textcolor2">
                                <span class="text-xs">{index + 1}</span>
                                {#if row.kind === 'unreadable' && row.name !== null && row.name !== ''}
                                    <span class="min-w-0 break-words font-bold">{row.name}</span>
                                {/if}
                                <span class="min-w-0 break-words">{unreadableText(row)}</span>
                            </div>
                        {/if}
                    </li>
                {/each}
            </ul>
        {/if}
    {/if}
</div>
