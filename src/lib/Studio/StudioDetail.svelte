<script lang="ts">
    import { untrack } from 'svelte'
    import { language } from '../../lang'
    import { classicDestinationOf, openInClassicEditor } from '../../ts/studio/classicLinks.svelte'
    import { itemSectionsOf, type TextField } from '../../ts/studio/itemText'
    import { currentModuleAck, currentVisitAck } from '../../ts/studio/history/studioHistoryService.svelte'
    import { currentPresetAck } from '../../ts/studio/edit/presetAck.svelte'
    import { presetStateOf } from '../../ts/studio/edit/presetTarget'
    import { ownerSourceFor, readTextSources } from '../../ts/studio/ownerSource.svelte'
    import { MODULE_LIST_KEY, applyStudioTarget, clearStudioSelection, followStudioPreset, openStudioModuleList, openStudioModuleOwner, studioScreen } from '../../ts/studio/studioScreen.svelte'
    import { moduleRowKeys } from '../Setting/Pages/Module/moduleListWindow'
    import { moduleListOf, moduleRefIdsOf } from '../../ts/process/moduleRefList'
    import { isModuleStub } from '../../ts/storage/moduleStub'
    import { isStudioModuleLoading, requestStudioModuleLoad } from '../../ts/studio/assets/moduleStubLoad.svelte'
    import { clearOpenModuleId, clearWithdrawnOpenModuleId, moduleRowOf, publishOpenModuleId, withdrawOpenModuleId, withdrawnOpenModuleId } from '../../ts/studio/assets/openModuleForm.svelte'
    import { moduleSlotsWithId } from '../../ts/studio/edit/assetSetters'
    import { DBState } from '../../ts/stores.svelte'
    import type { EnabledModuleAssets } from './assets/StudioAssetList.svelte'
    import StudioModuleAssetForm from './assets/StudioModuleAssetForm.svelte'
    import StudioModuleAdvancedForm from './StudioModuleAdvancedForm.svelte'
    import StudioChatNoteForm from './StudioChatNoteForm.svelte'
    import StudioCharacterForm from './StudioCharacterForm.svelte'
    import StudioGroupForm from './StudioGroupForm.svelte'
    import StudioCharacterHtmlForm from './StudioCharacterHtmlForm.svelte'
    import StudioDisplayForm from './StudioDisplayForm.svelte'
    import StudioAdvancedForm from './StudioAdvancedForm.svelte'
    import StudioExampleForm from './StudioExampleForm.svelte'
    import StudioCombined, { combinedKindOf } from './StudioCombined.svelte'
    import StudioStatusChip from './StudioStatusChip.svelte'
    import StudioToggleBuilder from './StudioToggleBuilder.svelte'
    import { ownerKeyOf, type StudioItem } from '../../ts/studio/ownerModel'
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

    // A group visit has neither of the two selections that bypass the model.
    const groupVisit = $derived(model?.character.type === 'group')
    const combinedKind = $derived(groupVisit ? null : combinedKindOf(studioScreen.selectedOwnerKey))
    // The module list page is a selection of its own: no owner, no kind, no history.
    const moduleListShown = $derived(!groupVisit && studioScreen.selectedOwnerKey === MODULE_LIST_KEY)
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
    // Every slot holding the selected module's id. Studio edits only the first holder (the slot the runtime and the
    // store2 handle `id#0` pick); a later holder is a read-only copy.
    const moduleHolders = $derived(openableModuleId !== null ? moduleSlotsWithId(DBState.db.modules, openableModuleId) : [])
    // True while the selected row is a later holder of an id several rows share: it publishes nothing, so no write lands on it.
    const moduleLaterCopy = $derived(openableModuleId !== null && moduleHolders.length > 1 && moduleHolders[0].index !== moduleSlotIndex)

    // The history service accepts a module write only while the module's id is published, and the History panel reaches
    // its steps through it. Each run publishes with a new token and clears by that token, so a run that ends after a newer
    // one began never clears the newer one's id. Deselecting, selecting another owner, a module that stops being loaded,
    // a later copy and the detail unmounting all end with null published. The effect reads only the two primitives above,
    // never the owner or kind node.
    $effect(() => {
        const id = openableModuleId
        const laterCopy = moduleLaterCopy
        const token = publishOpenModuleId(laterCopy ? null : id)
        return () => clearOpenModuleId(token)
    })

    // The first holder's place in the list while the selected row is a resident first holder: the holder count and the
    // slot index. Null for no module, a restricted module, a stub and a later copy, so a move from or to null never reads
    // as a change of first holder.
    const firstHolderSig = $derived(
        openableModuleId !== null && moduleHolders.length > 0 && moduleHolders[0].index === moduleSlotIndex && !isModuleStub(moduleHolders[0].module)
            ? `${moduleHolders.length}|${moduleHolders[0].index}`
            : null
    )
    let previousOwnerKey: string | null = null
    let previousFirstHolderSig: string | null = null
    // An outside writer changed the holders of the selected id while the same module stayed selected (a duplicate
    // appended, the first holder removed or moved): the published id may now name another row, so it is withdrawn and the
    // withdrawn effect below clears the selection. Every navigation changes the owner key and never fires; the rule needs
    // the same key and a signature on both sides, with a shared id on at least one side.
    $effect(() => {
        const key = ownerKey
        const sig = firstHolderSig
        const sharedCount = (value: string | null) => value === null ? 0 : Number(value.split('|')[0])
        const changed = key === previousOwnerKey && previousFirstHolderSig !== null && sig !== null && sig !== previousFirstHolderSig
            && (sharedCount(sig) > 1 || sharedCount(previousFirstHolderSig) > 1)
        previousOwnerKey = key
        previousFirstHolderSig = sig
        if (changed) {
            untrack(() => {
                if (openableModuleId !== null) withdrawOpenModuleId(openableModuleId)
            })
        }
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
    // The group's form is its own branch below: it carries no save chip, as the group's history is memory-only.
    const groupFormLive = $derived(owner?.type === 'group' && !owner.restricted && kindNode?.kind === 'basic')
    const characterFormLive = $derived(owner?.type === 'character' && !owner.restricted && !owner.stub && kindNode?.kind === 'basic')
    const assetFormLive = $derived(owner?.type === 'character' && !owner.restricted && !owner.stub && kindNode?.kind === 'display')
    const chatFormLive = $derived(owner?.type === 'chat' && !owner.restricted && !owner.stub && studioScreen.selectedKind === null)
    // The advanced kind of a loaded character: its example dialogue is the one live part of it.
    const exampleFormLive = $derived(owner?.type === 'character' && !owner.restricted && !owner.stub && kindNode?.kind === 'advanced')
    // The 배경 HTML kind of a loaded character mounts its form while the kind has no item yet, so it is part of `formLive` for the status chip.
    const charHtmlFormLive = $derived(owner?.type === 'character' && !owner.restricted && !owner.stub && kindNode?.kind === 'html')
    const formLive = $derived(characterFormLive || assetFormLive || exampleFormLive || chatFormLive || charHtmlFormLive)
    // The toggle list builder of a character, or of a module while its id is published (loaded, private-free and not a
    // later copy), or of the preset the selection pinned by id.
    const characterToggleBuilderLive = $derived(owner?.type === 'character' && !owner.restricted && !owner.stub && kindNode?.kind === 'toggles')
    const moduleToggleBuilderLive = $derived(openableModuleId !== null && !moduleLaterCopy && kindNode?.kind === 'toggles')
    const presetToggleBuilderLive = $derived(owner?.type === 'preset' && studioScreen.selectedPresetId !== null && kindNode?.kind === 'toggles')
    const toggleBuilderLive = $derived(characterToggleBuilderLive || moduleToggleBuilderLive || presetToggleBuilderLive)
    // The advanced form of the preset the selection pinned by id. It is no part of `formLive`: only the preset's toggle builder carries its save chip.
    const presetAdvancedFormLive = $derived(owner?.type === 'preset' && studioScreen.selectedPresetId !== null && kindNode?.kind === 'advanced')
    // A loaded module's asset list. It is no part of `formLive`: that carries the character's save chip.
    // The module's 고급 and 배경 HTML forms mount on the kind, so the html kind has its form while it has no item yet. A later
    // copy of a shared id gets the same component as a read-only view of the given slot.
    const moduleAdvancedFormLive = $derived(openableModuleId !== null && !moduleLaterCopy && kindNode?.kind === 'advanced')
    const moduleHtmlFormLive = $derived(openableModuleId !== null && !moduleLaterCopy && kindNode?.kind === 'html')
    const moduleAdvancedCopy = $derived(openableModuleId !== null && moduleLaterCopy && kindNode?.kind === 'advanced')
    const moduleHtmlCopy = $derived(openableModuleId !== null && moduleLaterCopy && kindNode?.kind === 'html')
    const moduleFormMounted = $derived(moduleAdvancedFormLive || moduleHtmlFormLive || moduleAdvancedCopy || moduleHtmlCopy)
    const moduleAssetFormLive = $derived(owner?.type === 'module' && !owner.restricted && !owner.stub && kindNode?.kind === 'display' && moduleRawId !== null && moduleSlotIndex !== null)
    // The lorebook pane of a loaded owner's lore kind: the list while no entry is selected, the entry's form otherwise.
    const lorePaneLive = $derived(owner !== undefined && !owner.restricted && !owner.stub && kindNode?.kind === 'lore' && (owner.type !== 'module' || openableModuleId !== null))
    // The regex pane of a loaded character, of a loaded module while its id is published (not a later copy), or of the
    // preset the selection pinned by id. Chat, group, private, not-loaded and later-copy owners keep the read-only view.
    const regexPaneLive = $derived(owner !== undefined && !owner.restricted && !owner.stub && kindNode?.kind === 'regex' && (owner.type === 'character' || (owner.type === 'module' && openableModuleId !== null && !moduleLaterCopy) || (owner.type === 'preset' && studioScreen.selectedPresetId !== null && presetStateOf(studioScreen.selectedPresetId) !== null)))

    const MODULE_KEY_PREFIX = ownerKeyOf('module', '')

    // An import replaced the selected module: it keeps its id, so its owner stays in the model and its form stays mounted
    // over the new content. The replace took the id away from the published slot, so the form's held text is refused; the
    // selection is dropped and the notice says the module is gone.
    $effect(() => {
        const gone = withdrawnOpenModuleId()
        if (gone === null || gone !== moduleRawId) return
        untrack(() => {
            clearWithdrawnOpenModuleId()
            clearStudioSelection(language.studioRefusalModuleGone)
        })
    })

    // A selected owner the model no longer has (the chat page moved, a module was removed) leaves the detail
    // empty; the selection is dropped and the notice says so. A module that is gone says so in its own words.
    $effect(() => {
        const current = model
        const key = studioScreen.selectedOwnerKey
        const pinned = studioScreen.selectedPresetId
        if (pinned !== null && key !== null && key.startsWith('preset:')) {
            // A pinned preset is followed by id: one holder at another row moves the key, none or several clear the selection.
            const holders = (DBState.db.botPresets ?? []).flatMap((preset, index) => preset?.id === pinned ? [index] : [])
            untrack(() => {
                if (holders.length !== 1) clearStudioSelection(language.studioRefusalPresetGone)
                else if (`preset:${holders[0]}` !== key) followStudioPreset(holders[0])
            })
            return
        }
        if (!current || key === null || key === MODULE_LIST_KEY || combinedKindOf(key) !== null) return
        if (current.ownerByKey(key)) return
        untrack(() => clearStudioSelection(key.startsWith(MODULE_KEY_PREFIX) ? language.studioRefusalModuleGone : language.studioNotFound))
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

    // The owner key a refused re-id was shown for; the status line shows only under that same selection.
    let ownIdRefusedKey = $state<string | null>(null)

    // Gives the selected later copy its own id. The row shown at the tap is captured before the helper loads (the module
    // list code reaches the import, export and file APIs, which no other Studio screen needs) and passed by reference,
    // so a list that changed during the load refuses instead of renaming another row; a selection that moved during the
    // load does nothing. The selection then follows the copy to its new owner at the same kind.
    async function giveCopyOwnId(): Promise<void> {
        const keyAtTap = ownerKey
        const rowAtTap = moduleSlotIndex === null ? undefined : DBState.db.modules?.[moduleSlotIndex]
        let ops: typeof import('../../ts/process/moduleListOps')
        try {
            ops = await import('../../ts/process/moduleListOps')
        } catch (error) {
            console.error(error)
            ownIdRefusedKey = keyAtTap
            return
        }
        if (ownerKey !== keyAtTap) return
        const made = rowAtTap ? ops.giveModuleCopyOwnId(rowAtTap) : null
        if (made === null) {
            ownIdRefusedKey = ownerKey
            return
        }
        ownIdRefusedKey = null
        const current = source.current.model
        if (current) openStudioModuleOwner(current, made, studioScreen.selectedKind)
    }

    // Held text of this detail is written before the page changes (the list is reached through the selection).
    function showInModuleList(): void {
        openStudioModuleList(moduleSlotIndex === null ? null : (moduleRowKeys(DBState.db.modules ?? [])[moduleSlotIndex] ?? null))
    }
</script>

<div data-part="studio-detail-body" class="flex flex-col gap-3 p-4">
    {#if moduleListShown}
        <!-- Loaded on first use: the page reaches the import, export and MCP code, which no other Studio screen needs. -->
        {#await import('./StudioModuleList.svelte') then loaded}
            {@const ModuleList = loaded.default}
            <ModuleList />
        {:catch}
            <p role="alert" data-part="studio-module-list-load-failed" class="text-sm text-draculared">{language.error}</p>
        {/await}
    {:else if combinedKind !== null}
        {#if model}
            <StudioCombined {model} kind={combinedKind} />
        {/if}
        <p data-part="studio-detail-readonly" class="text-sm text-textcolor2">{combinedKind === 'toggles' ? language.studioTgCombinedHint : language.studioReadOnlyNote}</p>
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
                {#if kindNode.count + kindNode.folderCount === 0 && !assetFormLive && !moduleAssetFormLive && !toggleBuilderLive && !moduleFormMounted && !lorePaneLive && !regexPaneLive && !charHtmlFormLive}
                    <p class="text-textcolor2">{language.studioEmptyKind}</p>
                {:else if (kindNode.kind === 'lore' && !lorePaneLive) || (kindNode.kind === 'regex' && !regexPaneLive)}
                    <p class="text-textcolor2">{language.studioItemCount(kindNode.count)}</p>
                {/if}
            {/if}
            {#if item && !lorePaneLive && !regexPaneLive}
                <p data-part="studio-detail-item" class="break-words font-bold">{itemLabelOf(item)}</p>
            {/if}
            {#if itemText && !toggleBuilderLive && !moduleFormMounted && !presetAdvancedFormLive && !lorePaneLive && !regexPaneLive && !charHtmlFormLive}
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
            {:else if presetToggleBuilderLive && studioScreen.selectedPresetId !== null}
                <StudioStatusChip ack={currentPresetAck(studioScreen.selectedPresetId)} />
                <!-- Keyed by the pinned id, not the row: a reorder keeps this builder, another preset builds a new one. -->
                {#key studioScreen.selectedPresetId}
                    <StudioToggleBuilder target={{ kind: 'preset', presetId: studioScreen.selectedPresetId }} />
                {/key}
            {/if}
            {#if moduleLaterCopy}
                <!-- A later copy is read-only on every kind; giving it its own id makes it the first holder of a new id. -->
                <p role="status" data-part="studio-module-shared-copy" class="text-sm text-textcolor2">{language.studioModuleSharedIdCopy}</p>
                <button type="button" data-part="studio-module-own-id" class="self-start rounded border border-darkborderc bg-darkbutton px-3 py-1 text-sm hover:bg-selected" onclick={giveCopyOwnId}>{language.studioModuleOwnId}</button>
                <p data-part="studio-module-own-id-help" class="text-sm text-textcolor2">{language.studioModuleOwnIdHelp}</p>
                {#if ownIdRefusedKey !== null && ownIdRefusedKey === ownerKey}
                    <p role="status" data-part="studio-module-own-id-refused" class="text-sm text-draculared">{language.studioModuleOwnIdRefused}</p>
                {/if}
            {/if}
            {#if formLive}
                <StudioStatusChip ack={currentVisitAck()} />
                <!-- A new visit clears the selection first, so its form is built again over its own ack. -->
                {#if characterFormLive}
                    <StudioCharacterForm chaId={studioScreen.chaId} />
                {:else if assetFormLive}
                    <!-- Keyed by the owner: a new owner builds the form again, with its own segment, filter, selection and panels. -->
                    {#key ownerKey}
                        <StudioDisplayForm chaId={characterId} enabledModules={enabledModuleAssets} />
                    {/key}
                {:else if exampleFormLive}
                    <StudioAdvancedForm chaId={studioScreen.chaId} section="prompts" />
                    <StudioExampleForm chaId={studioScreen.chaId} />
                    <StudioAdvancedForm chaId={studioScreen.chaId} section="details" />
                {:else if charHtmlFormLive}
                    {#key ownerKey}
                        <StudioCharacterHtmlForm chaId={characterId} />
                    {/key}
                {:else if owner}
                    <StudioChatNoteForm chaId={studioScreen.chaId} chatId={owner.id} />
                {/if}
            {:else if moduleAssetFormLive && moduleRawId !== null && moduleSlotIndex !== null}
                <!-- Keyed by the owner, as the character's list is; the module's id and slot are primitives, never the owner node. -->
                {#key ownerKey}
                    <StudioModuleAssetForm moduleId={moduleRawId} slotIndex={moduleSlotIndex} enabledModules={enabledModuleAssets} />
                {/key}
            {:else if moduleAdvancedFormLive || moduleHtmlFormLive}
                {#if moduleRawId !== null && moduleSlotIndex !== null}
                    <StudioStatusChip ack={currentModuleAck()} />
                    {#key ownerKey}
                        <StudioModuleAdvancedForm section={moduleAdvancedFormLive ? 'advanced' : 'html'} moduleId={moduleRawId} slotIndex={moduleSlotIndex} />
                    {/key}
                {/if}
            {:else if moduleAdvancedCopy || moduleHtmlCopy}
                {#if moduleRawId !== null && moduleSlotIndex !== null}
                    {#key ownerKey}
                        <StudioModuleAdvancedForm section={moduleAdvancedCopy ? 'advanced' : 'html'} moduleId={moduleRawId} slotIndex={moduleSlotIndex} readOnlyCopy />
                    {/key}
                {/if}
            {:else if presetAdvancedFormLive && studioScreen.selectedPresetId !== null}
                <!-- Keyed by the pinned id, not the row: a reorder keeps this form, another preset builds a new one. -->
                <!-- Loaded on first use: the form reaches the model picker and the model catalog, which no other Studio screen needs. -->
                {#key studioScreen.selectedPresetId}
                    {#await import('./StudioPresetAdvancedForm.svelte') then loaded}
                        {@const PresetForm = loaded.default}
                        <PresetForm presetId={studioScreen.selectedPresetId} />
                    {:catch}
                        <p role="alert" data-part="studio-preset-form-load-failed" class="text-sm text-draculared">{language.error}</p>
                    {/await}
                {/key}
            {:else if lorePaneLive && (owner.type === 'character' || owner.type === 'chat' || owner.type === 'module')}
                <!-- Keyed by the owner: another owner builds the pane again, with its own views, tokens and folder state. Loaded on first use: the pane reaches the alert and help layers, which no other detail form needs. -->
                {#key ownerKey}
                    {#await import('./StudioLorePane.svelte') then loaded}
                        {@const LorePane = loaded.default}
                        <LorePane ownerType={owner.type} ownerId={owner.id} chaId={studioScreen.chaId} moduleId={moduleRawId} {moduleSlotIndex} {moduleLaterCopy} itemId={studioScreen.selectedItemId} />
                    {:catch}
                        <p role="alert" data-part="studio-lore-pane-load-failed" class="text-sm text-draculared">{language.error}</p>
                    {/await}
                {/key}
            {:else if regexPaneLive && (owner.type === 'character' || owner.type === 'module')}
                <!-- Keyed by the owner: another owner builds the pane again. Loaded on first use: the pane reaches the help layer, which no other detail form needs. -->
                {#key ownerKey}
                    {#await import('./StudioRegexPane.svelte') then loaded}
                        {@const RegexPane = loaded.default}
                        <RegexPane ownerType={owner.type} ownerId={owner.id} chaId={studioScreen.chaId} moduleId={moduleRawId} {moduleSlotIndex} itemId={studioScreen.selectedItemId} />
                    {:catch}
                        <p role="alert" data-part="studio-regex-pane-load-failed" class="text-sm text-draculared">{language.error}</p>
                    {/await}
                {/key}
            {:else if regexPaneLive && owner.type === 'preset' && studioScreen.selectedPresetId !== null}
                <!-- Keyed by the pinned id, not the row: a reorder keeps this pane, another preset builds a new one. -->
                {#key studioScreen.selectedPresetId}
                    {#await import('./StudioRegexPane.svelte') then loaded}
                        {@const RegexPane = loaded.default}
                        <RegexPane ownerType="preset" presetId={studioScreen.selectedPresetId} ownerId={owner.id} chaId={studioScreen.chaId} moduleId={null} moduleSlotIndex={null} itemId={studioScreen.selectedItemId} />
                    {:catch}
                        <p role="alert" data-part="studio-regex-pane-load-failed" class="text-sm text-draculared">{language.error}</p>
                    {/await}
                {/key}
            {:else if groupFormLive}
                <StudioGroupForm chaId={studioScreen.chaId} />
            {:else if !toggleBuilderLive}
                <p data-part="studio-detail-readonly" class="text-sm text-textcolor2">{language.studioReadOnlyNote}</p>
            {/if}
            {#if owner.type === 'module'}
                <div>
                    <button type="button" data-part="studio-module-show-in-list" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={showInModuleList}>
                        {language.studioShowInModuleList}
                    </button>
                </div>
            {/if}
            <!-- A module that is not loaded has no classic link: its list operations are on the module list page. -->
            {#if destination && !stubLoading && !(owner.type === 'module' && owner.stub)}
                <div>
                    <button type="button" data-part="studio-detail-classic" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={openClassic}>
                        {language.studioOpenClassic}
                    </button>
                </div>
            {/if}
        {/if}
    {/if}
</div>
