<script module lang="ts">
    // Identifies the mount a running scan belongs to; a scan whose mount is gone stops and discards its hits.
    let mountSerial = 0
</script>

<script lang="ts">
    import { onMount, tick, untrack } from 'svelte'
    import { language } from '../../lang'
    import { createOwnerSource, readTextSources } from '../../ts/studio/ownerSource.svelte'
    import { createSearchRunner, type RunnerState, type SearchWork } from '../../ts/studio/searchRunner'
    import {
        SEARCH_CHIPS,
        createSearchWork,
        placementOf,
        planSearch,
        prepareQuery,
        searchIsActive,
        unloadedCountOf,
        type MarkedSegment,
        type SearchChip,
        type SearchResult,
    } from '../../ts/studio/studioSearch'
    import { closeStudioSearch } from '../../ts/studio/studioBack.svelte'
    import {
        TREE_PAGE_SIZE,
        groupRowId,
        kindRowId,
        ownerRowId,
        selectStudioNode,
        setStudioExpanded,
        studioScreen,
    } from '../../ts/studio/studioScreen.svelte'
    import { itemLabelOf, kindLabelOf, tagLabelOf } from './TreeRow.svelte'

    const source = createOwnerSource(() => studioScreen.chaId)
    const model = $derived(source.current.model)
    const unloaded = $derived(model ? unloadedCountOf(model) : 0)

    let query = $state('')
    let chips = $state<SearchChip[]>([])
    let input: HTMLInputElement | undefined = $state()
    let run = $state<RunnerState<SearchResult>>({ results: [], more: 0, running: false })

    const prepared = $derived(prepareQuery(query))
    const active = $derived(searchIsActive(prepared, new Set(chips)))

    // A later mount, or this one ending, makes a scan that started earlier stale.
    mountSerial += 1

    const runner = createSearchRunner<SearchResult>({
        current: () => ({ visitId: mountSerial, modelVersion: source.current.version }),
        onUpdate: (state) => { run = state },
    })

    function chipLabelOf(chip: SearchChip): string {
        switch (chip) {
            case 'regex': return kindLabelOf('regex')
            case 'lore': return kindLabelOf('lore')
            case 'toggles': return kindLabelOf('toggles')
            case 'scripts': return kindLabelOf('scripts')
            case 'info': return language.studioChipInfo
        }
    }

    function buildWork(text: string, chosen: ReadonlySet<SearchChip>): SearchWork<SearchResult> | null {
        const current = source.current.model
        if (!current) return null
        return createSearchWork(planSearch(current), {
            query: prepareQuery(text),
            chips: chosen,
            labels: { kind: kindLabelOf, item: itemLabelOf },
            sources: readTextSources(studioScreen.chaId),
        })
    }

    // A new query, a new chip choice or a new model starts the scan over; the model change is also caught by a
    // running scan itself.
    $effect(() => {
        const text = query
        const chosen = new Set(chips)
        void source.current.version
        untrack(() => runner.start(text, () => buildWork(text, chosen)))
    })

    onMount(() => {
        input?.focus()
        return () => {
            mountSerial += 1
            runner.cancel()
        }
    })

    function toggleChip(chip: SearchChip): void {
        chips = chips.includes(chip) ? chips.filter((entry) => entry !== chip) : [...chips, chip]
    }

    // Shows the result in the tree and the detail, then leaves the search.
    function openResult(result: SearchResult): void {
        const current = source.current.model
        const owner = current?.ownerByKey(result.ownerKey)
        if (!current || !owner) return
        const placement = placementOf(current, owner, TREE_PAGE_SIZE)
        for (const group of placement.groups) setStudioExpanded(groupRowId(group), true)
        if (placement.page) {
            const rowId = groupRowId(placement.page.group)
            studioScreen.pages[rowId] = Math.max(studioScreen.pages[rowId] ?? 0, placement.page.index)
        }
        setStudioExpanded(ownerRowId(owner.key), true)
        const kindRow = kindRowId(owner.key, result.kind)
        setStudioExpanded(kindRow, true)
        if (result.index >= TREE_PAGE_SIZE) {
            studioScreen.pages[kindRow] = Math.max(studioScreen.pages[kindRow] ?? 0, Math.floor(result.index / TREE_PAGE_SIZE))
        }
        selectStudioNode(owner.key, result.kind, result.id)
        // The field that held focus goes with the search; focus returns to the Studio root so Esc and Ctrl+K keep working.
        const studioRoot = input?.closest<HTMLElement>('[data-part="studio"]')
        closeStudioSearch()
        void tick().then(() => studioRoot?.focus())
    }

    // An IME composition owns its Enter: it commits the text and must not open a result.
    function oninputkeydown(event: KeyboardEvent): void {
        if (event.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter') {
            event.preventDefault()
            const first = run.results[0]
            if (first) openResult(first)
        } else if (event.key === 'ArrowDown') {
            const first = resultButtons()[0]
            if (first) {
                event.preventDefault()
                first.focus()
            }
        }
    }

    function resultButtons(): HTMLElement[] {
        return Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-search"] [data-part="studio-search-result"]'))
    }

    async function onresultkeydown(event: KeyboardEvent): Promise<void> {
        if (event.isComposing || event.keyCode === 229) return
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        const buttons = resultButtons()
        const at = buttons.indexOf(event.currentTarget as HTMLElement)
        const next = buttons[at + (event.key === 'ArrowDown' ? 1 : -1)]
        await tick()
        if (next) next.focus()
        else if (event.key === 'ArrowUp') input?.focus()
    }

    const chipClass = 'min-h-11 rounded-md border border-darkborderc px-3 cursor-pointer hover:bg-selected'
</script>

{#snippet marked(segments: MarkedSegment[])}{#each segments as segment}{#if segment.marked}<mark class="rounded bg-selected text-textcolor">{segment.text}</mark>{:else}{segment.text}{/if}{/each}{/snippet}

<div data-part="studio-search-body" class="flex flex-col gap-2 p-3">
    <input
        bind:this={input}
        type="search"
        data-part="studio-search-input"
        class="min-h-11 w-full rounded-md border border-darkborderc bg-darkbg px-3 text-textcolor"
        aria-label={language.studioSearch}
        placeholder={language.studioSearchPlaceholder}
        autocomplete="off"
        spellcheck="false"
        value={query}
        oninput={(event) => { query = event.currentTarget.value }}
        onkeydown={oninputkeydown}
    />
    <div class="flex flex-wrap gap-2" role="group" aria-label={language.studioSearch}>
        {#each SEARCH_CHIPS as chip (chip)}
            <button
                type="button"
                data-part="studio-search-chip"
                data-chip={chip}
                aria-pressed={chips.includes(chip)}
                class="{chipClass} {chips.includes(chip) ? 'bg-selected' : ''}"
                onclick={() => toggleChip(chip)}
            >{chipLabelOf(chip)}</button>
        {/each}
    </div>
    <div role="status" class="flex flex-col text-sm text-textcolor2">
        {#if run.running}
            <span data-part="studio-search-running">{language.studioSearching}</span>
        {:else if active && run.results.length === 0}
            <span data-part="studio-search-empty">{language.studioSearchNoResults}</span>
        {/if}
        {#if run.more > 0}
            <span data-part="studio-search-more">{language.studioSearchMore(run.more)}</span>
        {/if}
        {#if unloaded > 0}
            <span data-part="studio-search-unloaded">{language.studioSearchUnloaded(unloaded)}</span>
        {/if}
    </div>
    {#if run.results.length > 0}
        <ul data-part="studio-search-results" class="flex max-h-[40vh] flex-col overflow-y-auto">
            {#each run.results as result (result.id)}
                <li>
                    <button
                        type="button"
                        data-part="studio-search-result"
                        data-result-id={result.id}
                        class="flex min-h-11 w-full cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1 text-start hover:bg-selected"
                        onclick={() => openResult(result)}
                        onkeydown={onresultkeydown}
                    >
                        <span class="flex w-full min-w-0 items-center gap-2">
                            <span class="min-w-0 flex-1 truncate font-bold">{@render marked(result.match.name)}</span>
                            <span class="shrink-0 text-xs text-textcolor2">{result.kindLabel}</span>
                            {#if result.off}
                                <span class="shrink-0 rounded border border-darkborderc px-1 text-xs text-textcolor2">{tagLabelOf('off')}</span>
                            {/if}
                        </span>
                        <span class="w-full truncate text-xs text-textcolor2">{result.ownerName}</span>
                        {#if result.match.snippet}
                            <span data-part="studio-search-snippet" class="w-full break-words text-sm text-textcolor2">{result.match.snippet.before ? '…' : ''}{@render marked(result.match.snippet.segments)}{result.match.snippet.after ? '…' : ''}</span>
                        {/if}
                    </button>
                </li>
            {/each}
        </ul>
    {/if}
</div>
