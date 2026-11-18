<script lang="ts">
    import { untrack } from 'svelte'
    import { language } from '../../lang'
    import { classicDestinationOf, openInClassicEditor } from '../../ts/studio/classicLinks.svelte'
    import { itemSectionsOf, type TextField } from '../../ts/studio/itemText'
    import { currentModuleAck, currentVisitAck } from '../../ts/studio/history/studioHistoryService.svelte'
    import { ownerSourceFor, readTextSources } from '../../ts/studio/ownerSource.svelte'
    import { applyStudioTarget, clearStudioSelection, studioScreen } from '../../ts/studio/studioScreen.svelte'
    import { moduleListOf, moduleRefIdsOf } from '../../ts/process/moduleRefList'
    import { isModuleStub } from '../../ts/storage/moduleStub'
    import { isStudioModuleLoading, requestStudioModuleLoad } from '../../ts/studio/assets/moduleStubLoad.svelte'
    import { clearOpenModuleId, moduleRowOf, publishOpenModuleId } from '../../ts/studio/assets/openModuleForm.svelte'
    import { moduleSlotsWithId } from '../../ts/studio/edit/assetSetters'
    import { DBState } from '../../ts/stores.svelte'
    import StudioAssetList, { type EnabledModuleAssets } from './assets/StudioAssetList.svelte'
    import StudioModuleAssetForm from './assets/StudioModuleAssetForm.svelte'
    import StudioChatNoteForm from './StudioChatNoteForm.svelte'
    import StudioCharacterForm from './StudioCharacterForm.svelte'
    import StudioExampleForm from './StudioExampleForm.svelte'
    import StudioCombined, { combinedKindOf } from './StudioCombined.svelte'
    import StudioStatusChip from './StudioStatusChip.svelte'
    import StudioToggleBuilder from './StudioToggleBuilder.svelte'
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
    // What the asset subtree is given are named primitives, never the owner or kind node: those are rebuilt with every
    // model rebuild, and a subtree that read them would reset its filter, selection and open panels each time.
    const ownerKey = $derived(owner?.key ?? null)
    const characterId = $derived(studioScreen.chaId)
    // A module owner's row in the module list. The owner id of a later row sharing an id is `id#row`, so the stored id and
    // the slot come from the row itself (never cut out of the owner id), and only these two primitives go on.
    const moduleRow = $derived(owner?.type === 'module' ? moduleRowOf(DBState.db.modules ?? [], owner.id) : null)
    const moduleRawId = $derived(moduleRow?.id ?? null)
    const moduleSlotIndex = $derived(moduleRow?.index ?? null)
    // The owner key while the selected owner is a module that is not loaded, else null. The effect below reads this and
    // nothing else, so a rebuild of the model that leaves the key as it was does not ask for the load again.
    const stubToLoad = $derived(owner?.type === 'module' && owner.stub && !owner.restricted ? owner.key : null)
    const stubLoading = $derived(stubToLoad !== null && isStudioModuleLoading(moduleRawId))

    // A module that is not loaded is loaded when it is selected. A refused load leaves it as it is and asks no more.
    $effect(() => {
        const key = stubToLoad
        if (key === null) return
        untrack(() => {
            if (moduleRawId !== null) void requestStudioModuleLoad(moduleRawId)
        })
    })

    // The raw id of the selected module while it can take writes: loaded and not private, on any kind (or none yet). A
    // module that is not loaded or is private publishes nothing. These two are primitives, so a rebuild of the model that
    // leaves them as they were does not run the effect below again.
    const openableModuleId = $derived(owner?.type === 'module' && !owner.restricted && !owner.stub ? moduleRawId : null)
    // True while another module row holds the same id: such an id names several slots, so no write may target it.
    const moduleIdShared = $derived(openableModuleId !== null && moduleSlotsWithId(DBState.db.modules, openableModuleId).length > 1)

    // The history service accepts a module write only while the module's id is published, and the History panel reaches
    // its steps through it. Each run publishes with a new token and clears by that token, so a run that ends after a newer
    // one began never clears the newer one's id. Deselecting, selecting another owner, a module that stops being loaded
    // and the detail unmounting all end with null published. The effect reads only the two primitives above, never the
    // owner or kind node.
    $effect(() => {
        const id = openableModuleId
        const shared = moduleIdShared
        const token = publishOpenModuleId(shared ? null : id)
        return () => clearOpenModuleId(token)
    })

    // The enabled modules' loaded assets in module order, as the engine's own module asset list reads them.
    function enabledModuleAssets(): EnabledModuleAssets[] {
        return moduleListOf(moduleRefIdsOf())
            .filter((row) => !isModuleStub(row))
            .map((row) => ({ id: row.id, name: row.name, assets: row.assets ?? [] }))
    }
    const roleLabel = $derived(owner ? ownerRoleLabelOf(owner.type) : null)
    const destination = $derived(owner && !owner.restricted ? classicDestinationOf(owner.type, kindNode?.kind ?? null) : null)
    // The live forms: the character's basic info, its asset list, and the chat owner's own screen. None exists for a
    // private or not-loaded owner; the forms re-check privacy themselves at every render.
    const characterFormLive = $derived(owner?.type === 'character' && !owner.restricted && !owner.stub && kindNode?.kind === 'basic')
    const assetFormLive = $derived(owner?.type === 'character' && !owner.restricted && !owner.stub && kindNode?.kind === 'display')
    const chatFormLive = $derived(owner?.type === 'chat' && !owner.restricted && !owner.stub && studioScreen.selectedKind === null)
    // The advanced kind of a loaded character: its example dialogue is the one live part of it.
    const exampleFormLive = $derived(owner?.type === 'character' && !owner.restricted && !owner.stub && kindNode?.kind === 'advanced')
    const formLive = $derived(characterFormLive || assetFormLive || exampleFormLive || chatFormLive)
    // The toggle list builder of a character, or of a module while its id is published (loaded, private-free and not
    // shared). A preset's toggles keep the read-only text until their write exists.
    const characterToggleBuilderLive = $derived(owner?.type === 'character' && !owner.restricted && !owner.stub && kindNode?.kind === 'toggles')
    const moduleToggleBuilderLive = $derived(openableModuleId !== null && !moduleIdShared && kindNode?.kind === 'toggles')
    const toggleBuilderLive = $derived(characterToggleBuilderLive || moduleToggleBuilderLive)
    // A module whose id several rows share: its toggles stay read-only text, as its assets do.
    const moduleToggleShared = $derived(openableModuleId !== null && moduleIdShared && kindNode?.kind === 'toggles')
    // A loaded module's asset list. It is no part of `formLive`: that carries the character's save chip.
    const moduleAssetFormLive = $derived(owner?.type === 'module' && !owner.restricted && !owner.stub && kindNode?.kind === 'display' && moduleRawId !== null && moduleSlotIndex !== null)

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
            <h2 id="studio-detail-title" data-part="studio-detail-title" class="min-w-0 break-words text-lg font-bold">{owner.name !== '' ? owner.name : (roleLabel ?? owner.name)}</h2>
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
                {#if stubLoading}
                    <p role="status" data-part="studio-asset-module-loading" class="text-textcolor2">{language.studioAssetModuleLoading}</p>
                {:else}
                    <p data-part="studio-detail-notloaded" class="text-textcolor2">{language.studioNotLoaded}</p>
                {/if}
            {/if}
            {#if kindNode}
                <p data-part="studio-detail-kind" class="font-bold">{kindLabelOf(kindNode.kind)}</p>
                {#if kindNode.count + kindNode.folderCount === 0 && !assetFormLive && !moduleAssetFormLive && !toggleBuilderLive}
                    <p class="text-textcolor2">{language.studioEmptyKind}</p>
                {:else if kindNode.kind === 'lore' || kindNode.kind === 'regex'}
                    <p class="text-textcolor2">{language.studioItemCount(kindNode.count)}</p>
                {/if}
            {/if}
            {#if item}
                <p data-part="studio-detail-item" class="break-words font-bold">{itemLabelOf(item)}</p>
            {/if}
            {#if itemText && !toggleBuilderLive}
                <pre data-part="studio-detail-text" class="whitespace-pre-wrap break-words rounded-md border border-darkborderc bg-darkbg p-3 font-sans">{itemText.shown}</pre>
                {#if itemText.cut}
                    <p data-part="studio-detail-truncated" class="text-sm text-textcolor2">{language.studioTruncated(DETAIL_TEXT_LIMIT)}</p>
                {/if}
            {/if}
            {#if characterToggleBuilderLive}
                <StudioStatusChip ack={currentVisitAck()} />
                <!-- Keyed by the owner: a new owner builds the port, stem and keys again, and the old builder closes its step. -->
                {#key ownerKey}
                    <StudioToggleBuilder target={{ kind: 'character', chaId: studioScreen.chaId }} />
                {/key}
            {:else if moduleToggleBuilderLive && moduleRawId !== null}
                <StudioStatusChip ack={currentModuleAck()} />
                {#key ownerKey}
                    <StudioToggleBuilder target={{ kind: 'module', moduleId: moduleRawId }} />
                {/key}
            {/if}
            {#if moduleToggleShared}
                <p role="status" data-part="studio-toggle-module-shared" class="text-sm text-textcolor2">{language.studioRefusalModuleSharedId}</p>
            {/if}
            {#if formLive}
                <StudioStatusChip ack={currentVisitAck()} />
                <!-- A new visit clears the selection first, so its form is built again over its own ack. -->
                {#if characterFormLive}
                    <StudioCharacterForm chaId={studioScreen.chaId} />
                {:else if assetFormLive}
                    <!-- Keyed by the owner: a new owner builds the list again, with a new filter, selection and panels. -->
                    {#key ownerKey}
                        <StudioAssetList chaId={characterId} enabledModules={enabledModuleAssets} />
                    {/key}
                {:else if exampleFormLive}
                    <StudioExampleForm chaId={studioScreen.chaId} />
                {:else if owner}
                    <StudioChatNoteForm chaId={studioScreen.chaId} chatId={owner.id} />
                {/if}
            {:else if moduleAssetFormLive && moduleRawId !== null && moduleSlotIndex !== null}
                <!-- Keyed by the owner, as the character's list is; the module's id and slot are primitives, never the owner node. -->
                {#key ownerKey}
                    <StudioModuleAssetForm moduleId={moduleRawId} slotIndex={moduleSlotIndex} enabledModules={enabledModuleAssets} />
                {/key}
            {:else if !toggleBuilderLive}
                <p data-part="studio-detail-readonly" class="text-sm text-textcolor2">{language.studioReadOnlyNote}</p>
            {/if}
            {#if destination && !stubLoading}
                <div>
                    <button type="button" data-part="studio-detail-classic" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={openClassic}>
                        {owner.type === 'module' && owner.stub ? language.studioOpenModules : language.studioOpenClassic}
                    </button>
                </div>
            {/if}
        {/if}
    {/if}
</div>
