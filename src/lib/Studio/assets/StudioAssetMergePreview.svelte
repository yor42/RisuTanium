<script lang="ts" module>
    let forcedFreshForTests = false

    // Tests: reads the early "Out of date" check as fresh, so a click is decided by the click-time rebuild and compare alone.
    export function setMergeStaleForcedFreshForTests(on: boolean): void {
        forcedFreshForTests = on
    }
</script>

<script lang="ts">
    import { onDestroy, onMount, untrack } from 'svelte'
    import { language } from '../../../lang'
    import { preselectKeptName, type DuplicateGroup, type NameChoice } from '../../../ts/studio/assets/duplicateGroups'
    import {
        confirmFactsOf, groupByPlace, jumpTargetOf, MERGE_PLACE_CAP, mergeAtClick, mergeToastLine, needsConfirm, ownerSnapshotOf,
        ownerSnapshotsEqual, placeLabelOf, type MergeSource, type OwnerSnapshot,
    } from '../../../ts/studio/assets/mergeCommit'
    import type { ChatCountResult, EnablingCountResult } from '../../../ts/studio/assets/mergeCounts'
    import { buildMergePreview, type MergePreview } from '../../../ts/studio/assets/mergePreview'
    import { scanForName, type AssetKind } from '../../../ts/studio/assets/referenceScan'
    import { enumerateClassifiedTargets } from '../../../ts/studio/assets/referenceTargets'
    import type { SurvivorDeps } from '../../../ts/studio/edit/assetSetters'
    import { refusalTextOf, type StudioToasts } from '../../../ts/studio/edit/studioToasts'
    import type { OwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
    import type { OwnerKey } from '../../../ts/studio/history/ownerPhase'
    import { ownerKeyOf } from '../../../ts/studio/ownerModel'
    import { selectStudioNode } from '../../../ts/studio/studioScreen.svelte'
    import StudioAssetMergeConfirm from './StudioAssetMergeConfirm.svelte'
    import type { FinderRow } from './StudioAssetFinder.svelte'

    // The merge of one "same file, different names" group: what it would change, in the order the spec lists it, and the
    // two buttons. It builds the model from the live owner when it opens and when the kept name or Refresh asks, shows
    // it, and at Merge builds it again and writes only if the two are equal (`mergeAtClick`). The early "Out of date" check
    // re-reads the owner and disables Merge sooner; it decides nothing. The counts of chats and characters arrive later
    // and never gate Merge, except through the module confirm. The owner and kind it was opened for end it.
    interface Props {
        owner: OwnerKey
        ownerKind: 'character' | 'module'
        // The character id or module id the Studio tree names the owner by.
        ownerId: string
        kind: AssetKind
        group: DuplicateGroup<FinderRow>
        deps: SurvivorDeps
        service: Pick<OwnerHistoryService, 'assetMerge'>
        toasts: Pick<StudioToasts, 'postAssetAction'>
        source: MergeSource
        // How many places reach a file under a name; absent counts the places of the owner's own texts.
        references?: (name: string, path: string) => number
        onclose: () => void
    }

    let { owner, ownerKind, ownerId, kind, group, deps, service, toasts, source, references, onclose }: Props = $props()

    const uid = $props.id()

    interface Built {
        model: MergePreview
        snapshot: OwnerSnapshot
    }

    interface Line {
        path: string
        text: string
    }

    // The names of the group in row order with the places that use each; the kept one is preselected. A host that passes
    // `references` decides the counts; otherwise each distinct name is counted once from the owner's own scan, so the name
    // more places use is the one preselected.
    function nameChoices(): NameChoice[] {
        const owned = references === undefined ? source.targetOwner() : null
        const targets = owned === null ? null : enumerateClassifiedTargets(owned)
        const totals = new Map<string, number>()
        for (const row of group.rows) {
            let counted = 0
            if (references !== undefined) {
                counted = references(row.name, row.path)
            } else if (targets !== null && !totals.has(row.name)) {
                const scan = scanForName(targets, kind, row.name)
                counted = scan.matches.length + scan.flagged.length + scan.nameLists.length
            }
            totals.set(row.name, (totals.get(row.name) ?? 0) + counted)
        }
        return [...totals].map(([name, count]) => ({ name, references: count }))
    }

    function build(keptName: string): Built | null {
        const target = source.targetOwner()
        if (target === null) return null
        const model = buildMergePreview(target, kind, group, keptName, source.modules(), source.settings())
        return { model, snapshot: ownerSnapshotOf(target, model.array) }
    }

    const choices = untrack(nameChoices)
    let kept = $state(untrack(() => choices[preselectKeptName(choices, kind)]?.name ?? ''))
    let built = $state.raw<Built | null>(untrack(() => build(kept)))
    let clickStale = $state(false)
    let refusal = $state<string | null>(null)
    let confirmOpen = $state(false)
    let chatCount = $state.raw<ChatCountResult | null>(null)
    let enabling = $state.raw<EnablingCountResult | null>(null)
    let expanded = $state<Record<string, true>>({})

    const model = $derived(built?.model ?? null)
    const removedList = $derived(model?.removedNames.join(', ') ?? '')

    // The early check: the owner as it is now against the owner the model was built from. A different text, row or folder
    // entry disables Merge before it is pressed. It writes nothing and the click never reads it.
    const liveSnapshot = $derived.by(() => {
        const target = source.targetOwner()
        return target === null || built === null ? null : ownerSnapshotOf(target, built.model.array)
    })
    const stale = $derived(clickStale || (!forcedFreshForTests && (built === null || liveSnapshot === null || !ownerSnapshotsEqual(liveSnapshot, built.snapshot))))

    // ---------------------------------------------------------------- the counts

    let controller: AbortController | null = null

    function cancelCounts(): void {
        controller?.abort()
        controller = null
    }

    // Started from handlers and the mount, never from an effect that reads the database.
    function startCounts(): void {
        cancelCounts()
        chatCount = null
        enabling = null
        if (model === null) return
        if (model.removedNames.length === 0) {
            chatCount = { state: 'done', chats: 0, archivedChats: 0 }
            enabling = { state: 'done', characters: [], archivedCharacters: 0 }
            return
        }
        const run = new AbortController()
        controller = run
        // A job that was replaced or aborted lands nothing, whether a partial or its end.
        const current = (): boolean => controller === run && !run.signal.aborted
        const query = { kind, names: model.removedNames }
        if (ownerKind === 'character') {
            void source.countChats(query, run.signal, (partial) => { if (current()) chatCount = partial }).then((result) => { if (current()) chatCount = result }, () => {})
        } else {
            void source.countCharacters(query, run.signal, (partial) => { if (current()) enabling = partial }).then((result) => { if (current()) enabling = result }, () => {})
        }
    }

    onMount(startCounts)
    onDestroy(cancelCounts)

    let closed = false

    function close(): void {
        closed = true
        cancelCounts()
        onclose()
    }

    // The module confirm unmounts under the focus it holds, on Cancel, on a refused or stale merge and when the model goes
    // stale under it. Focus then lands on Merge, or on Cancel when Merge is disabled; focus the person moved elsewhere stays.
    let mergeButton = $state.raw<HTMLButtonElement | null>(null)
    let cancelButton = $state.raw<HTMLButtonElement | null>(null)
    let confirmShown = false
    $effect(() => {
        const shown = confirmOpen && !stale
        const hidden = confirmShown && !shown
        confirmShown = shown
        if (!hidden || closed) return
        untrack(() => {
            const active = document.activeElement
            if (active !== null && active !== document.body && active.isConnected) return
            const target = mergeButton !== null && !mergeButton.disabled ? mergeButton : cancelButton
            target?.focus()
        })
    })

    // The preview belongs to the owner and kind it was opened for.
    const openedOwner = untrack(() => owner)
    const openedKind = untrack(() => kind)
    $effect(() => {
        if (owner !== openedOwner || kind !== openedKind) untrack(close)
    })

    // ---------------------------------------------------------------- actions

    function refresh(): void {
        built = build(kept)
        clickStale = false
        refusal = null
        confirmOpen = false
        startCounts()
    }

    function chooseKept(name: string): void {
        kept = name
        refresh()
    }

    function commit(): void {
        const previewed = model
        const target = source.targetOwner()
        if (previewed === null || target === null) {
            clickStale = true
            return
        }
        confirmOpen = false
        // Read now: the toast says "at least n" for a count that has not ended when Merge is pressed.
        const line = mergeToastLine(ownerKind, previewed.removedNames, chatCount)
        const rebuild = (): MergePreview => buildMergePreview(target, kind, group, previewed.keptName, source.modules(), source.settings())
        const outcome = mergeAtClick(previewed, rebuild, (current) => service.assetMerge(owner, current, deps))
        if (outcome.kind === 'stale') {
            clickStale = true
            return
        }
        const result = outcome.result
        if (result.ok === false) {
            refusal = refusalTextOf(result)
            return
        }
        refusal = null
        if (result.unchanged !== true && result.stepId !== undefined) {
            toasts.postAssetAction(owner, result.stepId, language.studioStepAssetMerge(previewed.removedNames.join(', '), previewed.keptName), line)
        }
        close()
    }

    function onMerge(): void {
        if (ownerKind === 'module' && needsConfirm(confirmFactsOf(enabling))) {
            confirmOpen = true
            return
        }
        commit()
    }

    // The jump changes the selected kind, which ends this preview as it ends the owner's asset list.
    function jump(path: string): void {
        const target = jumpTargetOf(ownerKind, ownerId, path)
        if (target === null) return
        selectStudioNode(ownerKeyOf(ownerKind, ownerId), target.kind, target.itemId)
        close()
    }

    function focusNode(node: HTMLElement): void {
        node.focus()
    }

    // ---------------------------------------------------------------- what is shown

    const rewritten = $derived((model?.textEdits ?? []).map((edit): Line => ({ path: edit.target, text: `${edit.from} → ${edit.to}` })))
    const alreadyShows = $derived((model?.alreadyShows ?? []).map((hit): Line => ({ path: hit.path, text: hit.name })))
    const notRewritten = $derived((model?.notRewritten ?? []).map((hit): Line => ({ path: hit.path, text: hit.name })))
    const closeNames = $derived((model?.closeNames ?? []).map((entry): Line => ({ path: entry.path, text: `${entry.name}: ${entry.before ?? ''} → ${entry.after ?? ''}` })))
    const nameLists = $derived((model?.nameLists ?? []).map((hit): Line => ({ path: hit.path, text: hit.name })))
    const confirmFacts = $derived(confirmFactsOf(enabling))
    const chatsText = $derived.by((): string | null => {
        const found = chatCount?.chats ?? 0
        if (chatCount?.state !== 'done') return language.studioAssetMergeChats(language.studioAssetMergeAtLeast(found), removedList)
        return found > 0 ? language.studioAssetMergeChats(found, removedList) : null
    })
    const charactersText = $derived.by((): string | null => {
        const found = confirmFacts.hits.length
        if (!confirmFacts.finished) return language.studioAssetMergeCharacters(language.studioAssetMergeAtLeast(found))
        return found > 0 ? language.studioAssetMergeCharacters(found) : null
    })
    const folderLine = $derived(model !== null && model.kind === 'asset' && (model.folderOutcome.state === 'ok' || model.folderOutcome.state === 'absent')
        ? language.studioAssetMergeFolder(model.folderOutcome.kept ?? language.studioAssetNoFolder)
        : null)

    // The hits of one section grouped by place. Only the first `MERGE_PLACE_CAP` show until "Show more"; each place keeps its full count.
    function visibleGroups(lines: readonly Line[], all: boolean): { path: string, total: number, items: Line[] }[] {
        const totals = new Map(groupByPlace(lines).map((place) => [place.path, place.items.length]))
        return groupByPlace(all ? lines : lines.slice(0, MERGE_PLACE_CAP)).map((place) => ({ path: place.path, total: totals.get(place.path) ?? place.items.length, items: place.items }))
    }

    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
</script>

{#snippet section(id: string, title: string, lines: Line[], note?: string)}
    {#if lines.length > 0 || note !== undefined}
        <div data-part="studio-asset-merge-section" data-section={id} class="flex flex-col gap-1">
            <h4 class="font-bold">{title}</h4>
            {#if note !== undefined}
                <p class="text-sm text-textcolor2">{note}</p>
            {/if}
            {#each visibleGroups(lines, expanded[id] === true) as place (place.path)}
                <div data-part="studio-asset-merge-place" data-path={place.path} class="flex flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="min-w-0 flex-1 text-sm">{placeLabelOf(ownerKind, place.path)} · {place.total}</span>
                        <button type="button" data-part="studio-asset-merge-goto" class={buttonClass} onclick={() => jump(place.path)}>{language.studioAssetMergeGoTo}</button>
                    </div>
                    <ul class="flex flex-col gap-1 ps-3 text-sm text-textcolor2">
                        {#each place.items as item}
                            <li data-part="studio-asset-merge-hit" class="break-all">{item.text}</li>
                        {/each}
                    </ul>
                </div>
            {/each}
            {#if lines.length > MERGE_PLACE_CAP && expanded[id] !== true}
                <div>
                    <button type="button" data-part="studio-asset-merge-more" class={buttonClass} onclick={() => { expanded[id] = true }}>{language.studioShowMore(lines.length - MERGE_PLACE_CAP)}</button>
                </div>
            {/if}
        </div>
    {/if}
{/snippet}

<div data-part="studio-asset-merge-preview" data-part-critical class="flex flex-col gap-3 rounded-md border border-darkborderc p-3">
    {#if model !== null}
        <h3 class="font-bold">{language.studioAssetMergeTitle(removedList, model.keptName)}</h3>
        {#if choices.length > 1}
            <label class="flex flex-wrap items-center gap-2">
                <span id="{uid}-keep-label">{language.studioAssetMergeKeep}</span>
                <select data-part="studio-asset-merge-keep" aria-labelledby="{uid}-keep-label" aria-describedby="{uid}-keep-label" class="min-h-11 rounded-md border border-darkborderc bg-darkbg px-2 text-textcolor" value={kept} onchange={(event) => chooseKept(event.currentTarget.value)}>
                    {#each choices as choice (choice.name)}
                        <option value={choice.name}>{choice.name}</option>
                    {/each}
                </select>
            </label>
        {/if}
        {#each model.partialNames as partial (partial.name)}
            <p data-part="studio-asset-merge-partial" class="text-sm text-textcolor2">{language.studioAssetMergePartialName(partial.name, partial.rowsLeft, model.keptName)}</p>
        {/each}
        {@render section('rewritten', language.studioAssetMergeRewritten, rewritten)}
        {@render section('alreadyShows', language.studioAssetMergeAlreadyShows(model.keptName), alreadyShows)}
        {@render section('notRewritten', language.studioAssetMergeNotRewritten, notRewritten)}
        {@render section('closeNames', language.studioAssetMergeCloseNames, closeNames, model.matchedExactly ? language.studioAssetMergeModuleExact(removedList) : undefined)}
        {@render section('nameLists', language.studioAssetMergeNameLists, nameLists)}
        {#if model.modulesHolding.length > 0}
            <div data-part="studio-asset-merge-section" data-section="modules" class="flex flex-col gap-1">
                <h4 class="font-bold">{language.studioAssetMergeEnabledModules}</h4>
                <ul class="flex flex-col gap-1 text-sm text-textcolor2">
                    {#each model.modulesHolding as holding (holding.id)}
                        <li data-part="studio-asset-merge-module">{holding.name}</li>
                    {/each}
                </ul>
            </div>
        {/if}
        {#if ownerKind === 'character'}
            {#if chatsText !== null}
                <p data-part="studio-asset-merge-chats" class="text-sm text-textcolor2">{chatsText}</p>
            {/if}
            {#if (chatCount?.archivedChats ?? 0) > 0}
                <p data-part="studio-asset-merge-archived" class="text-sm text-textcolor2">{language.studioAssetMergeArchivedChats(chatCount?.archivedChats ?? 0)}</p>
            {/if}
        {:else}
            {#if charactersText !== null}
                <div data-part="studio-asset-merge-characters" class="flex flex-col gap-1 text-sm text-textcolor2">
                    <p>{charactersText}</p>
                    {#if source.enabledEverywhere()}
                        <p data-part="studio-asset-merge-enabled-all">{language.studioAssetMergeEnabledAll}</p>
                    {/if}
                    <ul class="flex flex-col gap-1">
                        {#each confirmFacts.hits as hit (hit.chaId)}
                            <li data-part="studio-asset-merge-character">{language.studioAssetMergeConfirmHit(source.characterName(hit.chaId), hit.count)}</li>
                        {/each}
                    </ul>
                </div>
            {/if}
            {#if confirmFacts.archived > 0}
                <p data-part="studio-asset-merge-archived" class="text-sm text-textcolor2">{language.studioAssetMergeArchivedCharacters(confirmFacts.archived)}</p>
            {/if}
        {/if}
        {#if folderLine !== null}
            <p data-part="studio-asset-merge-folder" class="text-sm text-textcolor2">{folderLine}</p>
        {/if}
    {/if}
    {#if stale}
        <div class="flex flex-wrap items-center gap-2">
            <span role="status" data-part="studio-asset-merge-stale" class="text-sm text-draculared">{language.studioAssetMergeStale}</span>
            <button type="button" data-part="studio-asset-merge-refresh" class={buttonClass} onclick={refresh}>{language.studioAssetMergeRefresh}</button>
        </div>
    {/if}
    {#if refusal}
        <p role="alert" data-part="studio-asset-merge-refusal" class="text-sm text-draculared">{refusal}</p>
    {/if}
    <div class="flex flex-wrap gap-2">
        <button use:focusNode bind:this={cancelButton} type="button" data-part="studio-asset-merge-cancel" class={buttonClass} onclick={close}>{language.cancel}</button>
        <button bind:this={mergeButton} type="button" data-part="studio-asset-merge-do" class={buttonClass} disabled={stale || model === null} onclick={onMerge}>{language.studioAssetMerge}</button>
    </div>
    {#if confirmOpen && !stale}
        <StudioAssetMergeConfirm facts={confirmFacts} nameOf={source.characterName} onmerge={commit} oncancel={() => { confirmOpen = false }} />
    {/if}
</div>
