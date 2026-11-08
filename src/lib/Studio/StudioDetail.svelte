<script lang="ts">
    import { untrack } from 'svelte'
    import { language } from '../../lang'
    import { classicDestinationOf, openInClassicEditor } from '../../ts/studio/classicLinks.svelte'
    import { itemSectionsOf, type TextField } from '../../ts/studio/itemText'
    import { ownerSourceFor, readTextSources } from '../../ts/studio/ownerSource.svelte'
    import { applyStudioTarget, clearStudioSelection, studioScreen } from '../../ts/studio/studioScreen.svelte'
    import StudioCombined, { combinedKindOf } from './StudioCombined.svelte'
    import type { StudioItem } from '../../ts/studio/ownerModel'
    import { ownerRoleLabelOf } from './StudioTree.svelte'
    import { badgeLabelOf, itemLabelOf, kindLabelOf, noticeTextOf, tagLabelOf } from './TreeRow.svelte'

    // Item text is shown as text only, never as markup, and is cut so one huge entry cannot stall the page.
    const DETAIL_TEXT_LIMIT = 2000

    const source = ownerSourceFor(() => studioScreen.chaId)
    const model = $derived(source.current.model)

    // The first pane that has the model places the opening target (the phone shows only one pane at a time).
    $effect(() => {
        const current = model
        if (!current || !studioScreen.targetPending) return
        untrack(() => applyStudioTarget(current, noticeTextOf))
    })

    const combinedKind = $derived(combinedKindOf(studioScreen.selectedOwnerKey))
    const owner = $derived(model && studioScreen.selectedOwnerKey !== null ? model.ownerByKey(studioScreen.selectedOwnerKey) : undefined)
    const kindNode = $derived(owner && studioScreen.selectedKind !== null ? owner.kinds().find((node) => node.kind === studioScreen.selectedKind) : undefined)
    // A kind without a list below it (everything but lore and regex) is one item: choosing the kind shows it.
    function selectedItemOf(): StudioItem | undefined {
        if (!kindNode) return undefined
        if (studioScreen.selectedItemId !== null) return kindNode.itemById(studioScreen.selectedItemId)
        if (kindNode.kind === 'lore' || kindNode.kind === 'regex') return undefined
        const items = kindNode.items()
        return items.length === 1 ? items[0] : undefined
    }

    const item = $derived(selectedItemOf())
    const roleLabel = $derived(owner ? ownerRoleLabelOf(owner.type) : null)
    const destination = $derived(owner && !owner.restricted ? classicDestinationOf(owner.type, kindNode?.kind ?? null) : null)

    // A selected owner the model no longer has (the chat page moved, a module was removed) leaves the detail
    // empty; the selection is dropped and the notice says so.
    $effect(() => {
        const current = model
        const key = studioScreen.selectedOwnerKey
        if (!current || key === null || combinedKindOf(key) !== null) return
        if (current.ownerByKey(key)) return
        untrack(() => clearStudioSelection(language.studioNotFound))
    })

    function fieldLabelOf(field: TextField): string {
        switch (field) {
            case 'description': return language.description
            case 'firstMessage': return language.firstMessage
            case 'exampleMessage': return language.exampleMessage
            case 'systemPrompt': return language.systemPrompt
            case 'personality': return language.personality
            case 'scenario': return language.scenario
            case 'creatorNotes': return language.creatorNotes
        }
    }

    function clipped(text: string): { shown: string, cut: boolean } {
        if (text.length <= DETAIL_TEXT_LIMIT) return { shown: text, cut: false }
        let end = DETAIL_TEXT_LIMIT
        // Do not end on half of a surrogate pair.
        const last = text.charCodeAt(end - 1)
        if (last >= 0xd800 && last <= 0xdbff) end -= 1
        return { shown: text.slice(0, end), cut: true }
    }

    // Null when the text cannot be shown (private, not resident) or the item has none.
    function itemTextOf(): { shown: string, cut: boolean } | null {
        if (!owner || !item) return null
        // The model's version is read so a reload of the interface refreshes the text.
        void source.current.version
        const sources = readTextSources(studioScreen.chaId)
        if (!sources) return null
        const sections = itemSectionsOf(owner, item, sources)
        if (!sections || sections.length === 0) return null
        return clipped(sections.map((entry) => entry.field === null ? entry.text : `${fieldLabelOf(entry.field)}\n${entry.text}`).join('\n\n'))
    }

    const itemText = $derived(itemTextOf())

    function openClassic(): void {
        if (!owner) return
        openInClassicEditor(owner.type, kindNode?.kind ?? null)
    }
</script>

<div data-part="studio-detail-body" class="flex flex-col gap-3 p-4">
    {#if combinedKind !== null}
        {#if model}
            <StudioCombined {model} kind={combinedKind} />
        {/if}
        <p data-part="studio-detail-readonly" class="text-sm text-textcolor2">{language.studioReadOnlyNote}</p>
    {:else if owner}
        <div class="flex flex-wrap items-center gap-2">
            <h2 data-part="studio-detail-title" class="min-w-0 break-words text-lg font-bold">{owner.name !== '' ? owner.name : (roleLabel ?? owner.name)}</h2>
            {#if roleLabel && owner.name !== ''}
                <span data-part="studio-detail-role" class="rounded border border-darkborderc px-1 text-xs text-textcolor2">{roleLabel}</span>
            {/if}
            {#each owner.tags as tag}
                <span class="rounded border border-darkborderc px-1 text-xs text-textcolor2">{tagLabelOf(tag, owner.retiredVersion)}</span>
            {/each}
            {#each owner.badges as badge}
                <span class="rounded border border-darkborderc px-1 text-xs text-textcolor2">{badgeLabelOf(badge)}</span>
            {/each}
        </div>
        {#if owner.restricted}
            <p data-part="studio-detail-private" class="text-textcolor2">{language.sidebarUi.notAllowed}</p>
        {:else}
            {#if owner.stub}
                <p data-part="studio-detail-notloaded" class="text-textcolor2">{language.studioNotLoaded}</p>
            {/if}
            {#if kindNode}
                <p data-part="studio-detail-kind" class="font-bold">{kindLabelOf(kindNode.kind)}</p>
                {#if kindNode.count + kindNode.folderCount === 0}
                    <p class="text-textcolor2">{language.studioEmptyKind}</p>
                {:else if kindNode.kind === 'lore' || kindNode.kind === 'regex'}
                    <p class="text-textcolor2">{language.studioItemCount(kindNode.count)}</p>
                {/if}
            {/if}
            {#if item}
                <p data-part="studio-detail-item" class="break-words font-bold">{itemLabelOf(item)}</p>
            {/if}
            {#if itemText}
                <pre data-part="studio-detail-text" class="whitespace-pre-wrap break-words rounded-md border border-darkborderc bg-darkbg p-3 font-sans">{itemText.shown}</pre>
                {#if itemText.cut}
                    <p data-part="studio-detail-truncated" class="text-sm text-textcolor2">{language.studioTruncated(DETAIL_TEXT_LIMIT)}</p>
                {/if}
            {/if}
            <p data-part="studio-detail-readonly" class="text-sm text-textcolor2">{language.studioReadOnlyNote}</p>
            {#if destination}
                <div>
                    <button type="button" data-part="studio-detail-classic" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={openClassic}>
                        {owner.type === 'module' && owner.stub ? language.studioOpenModules : language.studioOpenClassic}
                    </button>
                </div>
            {/if}
        {/if}
    {/if}
</div>
