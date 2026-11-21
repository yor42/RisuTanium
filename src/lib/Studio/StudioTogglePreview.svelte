<script module lang="ts">
    import type { Definition, LineId } from '../../ts/studio/toggleDef'
    import type { ToggleTarget } from '../../ts/studio/toggleBuilder.svelte'

    /** The owner whose definition is being edited, as the builder hands it to the sheet. */
    export interface PreviewCurrent {
        target: ToggleTarget
        // The owner's own name.
        name: string
        def: Definition
        // The row open in the builder's list.
        selected: LineId | null
        // Opens a row of the list; the host decides whether it may right now and says whether it did.
        select: (id: LineId) => boolean
    }

    // The sheet shows a copy of the definition's text that follows the live one after this much quiet.
    export const PREVIEW_QUIET_MS = 150
</script>

<script lang="ts">
    import { untrack } from 'svelte'
    import { ChevronDownIcon, XIcon } from '@lucide/svelte'
    import { language } from '../../lang'
    import { toggleVarKey, valueRowsOf, type PanelGroup, type PanelValueRow } from '../../ts/chatShell/togglePanel'
    import { toggleDefaultsOf } from '../../ts/parser/toggleDefaults'
    import { getModules } from '../../ts/process/modules'
    import { isModuleStub } from '../../ts/storage/moduleStub'
    import { DBState } from '../../ts/stores.svelte'
    import { closeStudioTogglePreview } from '../../ts/studio/studioBack.svelte'
    import { lineById, textOf } from '../../ts/studio/toggleDef'
    import { joinedPreviewInputs, panelIdOf, previewSourcesOf, type PreviewSource } from '../../ts/studio/togglePreviewModel'
    import { toggleSourcesOf } from '../ChatShell/TogglesPanel.svelte'
    import StudioTogglePreviewRow from './StudioTogglePreviewRow.svelte'

    // The toggle preview sheet: the toggles as the chat panel draws them, with values that live only in this sheet.
    // It is not modal, so the builder's list stays usable beside it. Nothing here writes: a value goes to the sandbox
    // and the sandbox ends with the sheet. `current` null is the preview of everything, with no owner outlined.
    interface Props {
        chaId: string
        current: PreviewCurrent | null
    }

    let { chaId, current }: Props = $props()

    const character = $derived(DBState.db.characters?.find((candidate) => candidate?.chaId === chaId))
    const plain = $derived(character && character.type !== 'group' ? character : undefined)

    // The definition's text, taken at open and again after a pause in the typing.
    const liveText = $derived(current === null ? '' : textOf(current.def))
    let snapshot = $state(untrack(() => liveText))
    $effect(() => {
        const next = liveText
        const timer = setTimeout(() => { snapshot = next }, PREVIEW_QUIET_MS)
        return () => clearTimeout(timer)
    })
    // A selection lands on a line of the live definition, so it is made only while the copy is that definition.
    const fresh = $derived(current !== null && snapshot === liveText)

    let scope = $state<'owner' | 'all'>('owner')
    const joined = $derived(current === null || scope === 'all')
    // The values of the sandbox by toggle key: every control of a key shares one.
    let values = $state<Record<string, string>>({})
    let openGroups = $state<Record<string, boolean>>({})
    let announced = $state('')

    // The source of a module in use is part of the chat's panel; one that is not shows only in its own scope.
    const inChat = $derived.by(() => {
        if (current === null || current.target.kind === 'character') return true
        const moduleId = current.target.moduleId
        return getModules().some((module) => module && !isModuleStub(module) && module.id === moduleId)
    })
    const notInChat = $derived(current !== null && scope === 'all' && !inChat)

    // The joined scope is the chat panel's own source list, with the open owner's text in place of the stored one.
    // A source with nothing to show is left out of both scopes.
    const previewInputs = $derived.by(() => {
        if (current !== null && !joined) {
            return [{ id: 'current', kind: current.target.kind, name: current.name, text: snapshot }]
        }
        const owner = { chaId, name: plain?.name ?? '', customModuleToggle: plain?.customModuleToggle }
        return joinedPreviewInputs(toggleSourcesOf(owner), { chaId, license: plain?.license }, current === null ? null : { panelId: panelIdOf(current.target), text: snapshot })
    })
    const sources = $derived(previewSourcesOf(previewInputs).filter((source) => source.items.length > 0))
    // A toggle the sheet has no value for starts at the author's default, as the chat panel does.
    const previewDefaults = $derived(toggleDefaultsOf(previewInputs.map((input) => input.text)))
    const valueOf = (key: string): string => values[key] ?? previewDefaults.get(toggleVarKey(key)) ?? ''

    // The source that is the owner being edited, when the sheet shows it.
    const currentSourceId = $derived.by((): string | null => {
        if (current === null) return null
        if (!joined) return 'current'
        return inChat ? panelIdOf(current.target) : null
    })
    const currentSource = $derived(sources.find((source) => source.id === currentSourceId))

    // The panel uid of the row open in the builder, so the group that holds it can be open.
    const selectedUid = $derived.by((): string | null => {
        if (current === null || current.selected === null || !fresh || currentSource === undefined) return null
        const at = lineById(current.def, current.selected)?.index
        for (const [uid, index] of currentSource.lineOf) {
            if (index === at) return uid
        }
        return null
    })

    const labelCounts = $derived.by(() => {
        const counts = new Map<string, number>()
        for (const source of sources) {
            for (const row of valueRowsOf(source)) counts.set(row.label, (counts.get(row.label) ?? 0) + 1)
        }
        return counts
    })
    const unreadable = $derived(sources.reduce((sum, source) => sum + source.unreadable, 0))

    function groupOpen(group: PanelGroup): boolean {
        return openGroups[group.uid] ?? (selectedUid !== null && group.children.some((child) => child.uid === selectedUid))
    }

    function toggleGroup(group: PanelGroup): void {
        openGroups[group.uid] = !groupOpen(group)
    }

    function setValue(key: string, value: string): void {
        values[key] = value
    }

    // Focus entering a row of the owner being edited opens that row in the list; any other row changes nothing.
    function enterRow(source: PreviewSource, row: PanelValueRow): void {
        if (current === null || !fresh || source.id !== currentSourceId) return
        const index = source.lineOf.get(row.uid)
        const id = index === undefined ? undefined : current.def.lines[index]?.id
        if (id === undefined || id === current.selected) return
        // A refused selection is not announced: the list shows nothing opened.
        if (current.select(id)) announced = language.studioTgPreviewSelected(row.label)
    }

    function onkeydown(event: KeyboardEvent): void {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        closeStudioTogglePreview()
    }

    const scopeClass = (active: boolean) => `min-h-11 px-3 cursor-pointer hover:bg-selected ${active ? 'bg-selected' : ''}`
</script>

<div
    role="dialog"
    aria-labelledby="studio-tg-preview-title"
    data-part="studio-toggle-preview"
    tabindex="-1"
    {onkeydown}
    class="fixed inset-x-0 bottom-0 z-30 flex max-h-[70vh] flex-col gap-3 overflow-y-auto rounded-t-md border border-darkborderc bg-darkbg p-4 text-textcolor min-[600px]:inset-y-0 min-[600px]:start-auto min-[600px]:end-0 min-[600px]:max-h-none min-[600px]:w-full min-[600px]:max-w-md min-[600px]:rounded-none"
>
    <div class="flex items-center gap-2">
        <h2 id="studio-tg-preview-title" class="min-w-0 flex-1 text-lg font-bold">{language.studioTgPreview}</h2>
        <button type="button" data-part="studio-toggle-preview-close" class="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-darkborderc hover:bg-selected cursor-pointer" aria-label={language.studioTgPreviewClose} onclick={closeStudioTogglePreview}>
            <XIcon size={18} aria-hidden="true" />
        </button>
    </div>
    <p data-part="studio-tg-preview-note" class="text-sm text-textcolor2">{language.studioTgPreviewNote}</p>
    {#if current !== null}
        <div role="group" aria-label={language.studioTgScopeLabel} class="flex self-start overflow-hidden rounded-md border border-darkborderc">
            <button type="button" data-part="studio-tg-preview-scope-owner" aria-pressed={!joined} class={scopeClass(!joined)} onclick={() => { scope = 'owner' }}>{language.studioTgScopeOwner}</button>
            <button type="button" data-part="studio-tg-preview-scope-all" aria-pressed={joined} class={scopeClass(joined)} onclick={() => { scope = 'all' }}>{language.studioTgScopeAll}</button>
        </div>
    {/if}
    {#if notInChat}
        <p data-part="studio-tg-preview-not-in-chat" class="text-sm text-textcolor2">{language.studioTgPreviewNotInChat}</p>
    {/if}
    {#if sources.length === 0}
        <p data-part="studio-tg-preview-none" class="text-textcolor2">{language.studioTgPreviewNone}</p>
    {/if}
    {#each sources as source (source.id)}
        {@const own = source.id === currentSourceId}
        <section data-part="studio-tg-preview-source" data-source={source.id} class="flex flex-col gap-1">
            {#if joined}
                <h3 class="font-bold">{source.name}{#if source.detail !== ''}<span class="ms-2 text-sm font-normal text-textcolor2">{source.detail}</span>{/if}</h3>
            {/if}
            {#each source.items as item (item.uid)}
                {#if item.type === 'group'}
                    {@const open = groupOpen(item)}
                    <button type="button" data-part="studio-tg-preview-group" data-uid={item.uid} aria-expanded={open} class="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-start hover:bg-selected" onclick={() => toggleGroup(item)}>
                        <ChevronDownIcon size={16} aria-hidden="true" class={open ? '' : '-rotate-90'} />
                        <span class="min-w-0 flex-1 break-words font-bold">{item.label}</span>
                        <span class="shrink-0 text-xs text-textcolor2">{language.studioTgPreviewGroupCount(item.children.filter((child) => child.type === 'row').length)}</span>
                    </button>
                    {#if open}
                        <div class="flex flex-col gap-1 ps-4">
                            {#each item.children as child (child.uid)}
                                {#if child.type === 'row'}
                                    <StudioTogglePreviewRow row={child} value={valueOf(child.key)} current={own} showKey={(labelCounts.get(child.label) ?? 0) > 1} onset={(value) => setValue(child.key, value)} onfocus={() => enterRow(source, child)} />
                                {:else if child.type === 'caption'}
                                    <p data-part="studio-tg-preview-caption" class="px-2 text-sm text-textcolor2">{child.label}</p>
                                {:else}
                                    <div role="separator" data-part="studio-tg-preview-divider" class="px-2 text-xs text-textcolor2">{child.label}</div>
                                {/if}
                            {/each}
                        </div>
                    {/if}
                {:else if item.type === 'row'}
                    <StudioTogglePreviewRow row={item} value={valueOf(item.key)} current={own} showKey={(labelCounts.get(item.label) ?? 0) > 1} onset={(value) => setValue(item.key, value)} onfocus={() => enterRow(source, item)} />
                {:else if item.type === 'caption'}
                    <p data-part="studio-tg-preview-caption" class="px-2 text-sm text-textcolor2">{item.label}</p>
                {:else}
                    <div role="separator" data-part="studio-tg-preview-divider" class="px-2 text-xs text-textcolor2">{item.label}</div>
                {/if}
            {/each}
        </section>
    {/each}
    {#if unreadable > 0}
        <p data-part="studio-tg-preview-hidden" class="text-sm text-textcolor2">{language.studioTgPreviewHidden(unreadable)}</p>
    {/if}
    <p role="status" data-part="studio-tg-preview-announce" class="sr-only">{announced}</p>
</div>
