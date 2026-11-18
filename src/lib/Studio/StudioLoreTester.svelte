<script lang="ts">
    import { untrack } from 'svelte'
    import { language } from '../../lang'
    import { DBState } from '../../ts/stores.svelte'
    import type { LoreTestEntry, LoreTestReason } from '../../ts/studio/loreTest'
    import { isLoreTestStale, loreTestSlot, resetLoreTestFor, runLoreTester, setLoreTestText } from '../../ts/studio/loreTestSession.svelte'
    import type { OwnerModel, OwnerNode } from '../../ts/studio/ownerModel'
    import { TREE_PAGE_SIZE, selectStudioNode, setStudioExpanded, showMoreStudioRows, studioScreen } from '../../ts/studio/studioScreen.svelte'

    interface Props {
        model: OwnerModel
    }

    let { model }: Props = $props()

    const INACTIVE_ROW = 'lt:inactive'

    const chaId = $derived(model.character.id)
    const restricted = $derived(model.character.restricted)
    // The slot belongs to one character; another character's text and result are never drawn, not even for one frame.
    const bound = $derived(!restricted && loreTestSlot.chaId === chaId)
    const text = $derived(bound ? loreTestSlot.text : '')
    const pending = $derived(bound && loreTestSlot.pending)
    const outcome = $derived(bound ? loreTestSlot.outcome : null)
    const result = $derived(outcome !== null && outcome.status === 'ok' ? outcome : null)
    const failed = $derived(bound && (loreTestSlot.error || (outcome !== null && outcome.status === 'refused')))
    const stale = $derived(result !== null && isLoreTestStale())

    $effect(() => {
        if (!restricted) {
            // The reset reads and writes the slot; only the bound character is a dependency.
            const bindTo = chaId
            untrack(() => resetLoreTestFor(bindTo))
        }
    })

    const rows = $derived((result?.entries ?? []).filter((entry) => !entry.folder))
    const activeRows = $derived.by(() => {
        const rank = (entry: LoreTestEntry): number => {
            switch (entry.outcome) {
                case 'kept': return 0
                case 'merged': return 1
                case 'injectTargetMissing': return 2
                case 'cut': return 3
                default: return 4
            }
        }
        return rows
            .filter((entry) => entry.activated)
            .sort((a, b) => rank(a) - rank(b) || (a.order ?? 0) - (b.order ?? 0) || a.index - b.index)
    })
    const inactiveRows = $derived(rows.filter((entry) => !entry.activated))
    const inactiveOpen = $derived(studioScreen.expanded[INACTIVE_ROW] ?? false)
    const inactiveShown = $derived(Math.min(inactiveRows.length, TREE_PAGE_SIZE * ((studioScreen.pages[INACTIVE_ROW] ?? 0) + 1)))

    function liveDepth(): number {
        const live = DBState.db.characters?.find((candidate) => candidate.chaId === chaId)
        return live?.loreSettings?.scanDepth ?? DBState.db.loreBookDepth
    }
    const depth = $derived(result ? result.scanDepth : liveDepth())
    const chatName = $derived(model.chat?.name ?? null)
    const hasText = $derived(text.trim() !== '')

    function hasLore(owner: OwnerNode): boolean {
        const lore = owner.kinds().find((kind) => kind.kind === 'lore')
        return lore !== undefined && lore.count + lore.folderCount > 0
    }
    // Owners whose entries a test cannot reach: active modules that are not loaded, and other modules that are
    // not loaded or would bring entries if they were on.
    const skippedModules = $derived(
        model.modules.filter((owner) => owner.stub).length
        + model.otherModules.filter((owner) => owner.stub || hasLore(owner)).length,
    )

    function reasonText(reason: LoreTestReason): string {
        switch (reason.kind) {
            case 'matched':
                if (reason.at.kind === 'typed') return language.studioLoreTestMatchedTyped(reason.key)
                if (reason.at.kind === 'message') return language.studioLoreTestMatchedMessage(reason.key, reason.at.position)
                return language.studioLoreTestMatchedEntry(reason.key, reason.at.label)
            case 'always': return language.studioLoreTestAlways
            case 'forced': return language.studioLoreTestForced(reason.decorator)
            case 'kept': return language.studioLoreTestKept
            case 'noKey': return language.studioLoreTestNoKey
            case 'noMatch':
                if (reason.query === 'secondkey') return language.studioLoreTestNoSecondMatch
                if (reason.query === 'additional') return language.studioLoreTestNoExtraMatch
                return language.studioLoreTestNoMatch
            case 'excluded': return language.studioLoreTestExcluded(reason.key)
            case 'excludedNoHit': return language.studioLoreTestExcludedNoHit(reason.decorator)
            case 'decorator': return language.studioLoreTestDecorator(reason.name)
            case 'spent': return language.studioLoreTestSpent
            case 'linkedOff': return language.studioLoreTestLinkedOff
            case 'invalidRegex': return language.studioLoreTestInvalidRegex(reason.key)
        }
    }

    function outcomeText(entry: LoreTestEntry): string | null {
        if (entry.outcome === 'cut') return language.studioLoreTestCut
        if (entry.outcome === 'injectTargetMissing') return language.studioLoreTestInjectMissing
        if (entry.outcome === 'merged') return language.studioLoreTestMerged(entry.mergedInto ?? '')
        return null
    }

    function ownerNodeOf(entry: LoreTestEntry): OwnerNode | undefined {
        const owner = entry.owner
        if (!owner) return undefined
        if (owner.type === 'character') return model.character
        if (owner.type === 'chat') return model.chat ?? undefined
        return owner.id === null ? undefined : model.ownerOf('module', owner.id)
    }

    function openEntry(entry: LoreTestEntry): void {
        const node = ownerNodeOf(entry)
        if (!node || !entry.owner) return
        selectStudioNode(node.key, 'lore', `${node.id}/lore:${entry.owner.index}`)
    }
</script>

{#snippet entryRow(entry: LoreTestEntry)}
    {@const node = ownerNodeOf(entry)}
    <li data-part="studio-lore-test-row" data-index={entry.index} data-active={entry.activated} class="flex flex-col gap-1 border-b border-darkborderc py-2">
        <div class="flex items-center gap-2">
            {#if node}
                <button
                    type="button"
                    data-part="studio-lore-test-open"
                    class="min-h-11 min-w-0 flex-1 cursor-pointer truncate rounded px-2 text-start hover:bg-selected"
                    onclick={() => openEntry(entry)}
                >{entry.label}</button>
            {:else}
                <span class="min-w-0 flex-1 truncate px-2">{entry.label}</span>
            {/if}
            <span class="shrink-0 text-xs text-textcolor2">{node?.name ?? ''}</span>
            <span data-part="studio-lore-test-state" class="shrink-0 text-xs font-bold {entry.activated ? '' : 'text-textcolor2'}">{entry.activated ? language.studioLoreTestActive : language.studioLoreTestInactive}</span>
        </div>
        <div class="flex flex-col gap-0.5 px-2 text-sm text-textcolor2">
            <span data-part="studio-lore-test-reason">{reasonText(entry.reason)}</span>
            {#each entry.warnings as warning, warningIndex (warningIndex)}
                <span data-part="studio-lore-test-warning" class="text-draculared">{language.studioLoreTestInvalidRegex(warning.key)}</span>
            {/each}
            {#if outcomeText(entry)}
                <span data-part="studio-lore-test-outcome">{outcomeText(entry)}</span>
            {/if}
            {#if entry.tokens !== null || entry.order !== null || entry.chance !== null}
                <span class="flex flex-wrap gap-x-3 text-xs">
                    {#if entry.tokens !== null}<span data-part="studio-lore-test-tokens">{language.studioLoreTestTokens(entry.tokens)}</span>{/if}
                    {#if entry.order !== null}<span data-part="studio-lore-test-order">{language.studioLoreTestOrder(entry.order)}</span>{/if}
                    {#if entry.chance !== null}<span data-part="studio-lore-test-chance">{language.studioLoreTestChance(entry.chance)}</span>{/if}
                </span>
            {/if}
        </div>
    </li>
{/snippet}

<section data-part="studio-lore-test" class="flex flex-col gap-3 border-t border-darkborderc pt-3">
    <h3 data-part="studio-lore-test-title" class="text-base font-bold">{language.studioLoreTestTitle}</h3>
    {#if restricted}
        <p data-part="studio-lore-test-private" class="text-sm text-textcolor2">{language.studioLoreTestPrivate}</p>
    {:else}
        <p data-part="studio-lore-test-caveat" class="text-sm text-textcolor2">{language.studioLoreTestCaveat}</p>
        <p data-part="studio-lore-test-scope" class="text-sm text-textcolor2">
            {#if chatName !== null}
                {hasText ? language.studioLoreTestScope(chatName, depth) : language.studioLoreTestScopeNoMessage(chatName, depth)}
            {:else}
                {hasText ? language.studioLoreTestNoChat : language.studioLoreTestNothingScanned}
            {/if}
        </p>
        {#if skippedModules > 0}
            <p data-part="studio-lore-test-modules" class="text-sm text-textcolor2">{language.studioLoreTestModulesSkipped(skippedModules)}</p>
        {/if}
        <label class="flex flex-col gap-1 text-sm">
            <span>{language.studioLoreTestInput}</span>
            <textarea
                data-part="studio-lore-test-input"
                class="min-h-24 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
                value={text}
                oninput={(event) => setLoreTestText(chaId, event.currentTarget.value)}
            ></textarea>
        </label>
        <button
            type="button"
            data-part="studio-lore-test-run"
            class="min-h-11 self-start rounded-md border border-darkborderc px-4 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50"
            disabled={pending}
            onclick={() => { void runLoreTester(model) }}
        >{pending ? language.studioLoreTestRunning : language.studioLoreTestRun}</button>
        <div data-part="studio-lore-test-results" class="flex flex-col gap-2">
            <!-- Only the short status lines are announced; the result rows are read on demand. -->
            <div data-part="studio-lore-test-status" aria-live="polite" class="flex flex-col gap-2">
                {#if pending}
                    <p data-part="studio-lore-test-pending" class="text-sm text-textcolor2">{language.studioLoreTestRunning}</p>
                {/if}
                {#if failed}
                    <p data-part="studio-lore-test-error" class="text-sm text-draculared">{language.studioLoreTestError}</p>
                {/if}
                {#if result}
                    <p data-part="studio-lore-test-budget" class="text-sm">{language.studioLoreTestBudget(result.budget.used, result.budget.limit)}</p>
                    {#if stale}
                        <p data-part="studio-lore-test-stale" class="text-sm font-bold text-draculared">{language.studioLoreTestStale}</p>
                    {/if}
                {/if}
            </div>
            {#if result}
                {#if result.attribution === 'unavailable'}
                    <p data-part="studio-lore-test-attribution" class="text-sm text-textcolor2">{language.studioLoreTestNoAttribution}</p>
                {/if}
                <div data-part="studio-lore-test-list" data-stale={stale} class="flex flex-col gap-2 {stale ? 'opacity-50' : ''}">
                    <ul data-part="studio-lore-test-active" class="flex flex-col">
                        {#each activeRows as entry (entry.index)}
                            {@render entryRow(entry)}
                        {/each}
                    </ul>
                    {#if inactiveRows.length > 0}
                        <button
                            type="button"
                            data-part="studio-lore-test-inactive-toggle"
                            aria-expanded={inactiveOpen}
                            class="min-h-11 self-start rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer"
                            onclick={() => setStudioExpanded(INACTIVE_ROW, !inactiveOpen)}
                        >{language.studioLoreTestInactiveGroup(inactiveRows.length)}</button>
                        {#if inactiveOpen}
                            <ul data-part="studio-lore-test-inactive" class="flex flex-col">
                                {#each inactiveRows.slice(0, inactiveShown) as entry (entry.index)}
                                    {@render entryRow(entry)}
                                {/each}
                            </ul>
                            {#if inactiveShown < inactiveRows.length}
                                <button
                                    type="button"
                                    data-part="studio-lore-test-more"
                                    class="min-h-11 self-start rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer"
                                    onclick={() => showMoreStudioRows(INACTIVE_ROW)}
                                >{language.studioShowMore(Math.min(TREE_PAGE_SIZE, inactiveRows.length - inactiveShown))}</button>
                            {/if}
                        {/if}
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
</section>
