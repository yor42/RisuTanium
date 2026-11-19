<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { language } from '../../lang'
    import { itemSectionsOf } from '../../ts/studio/itemText'
    import { buildMergedView } from '../../ts/studio/mergedView'
    import type { OwnerModel, OwnerNode } from '../../ts/studio/ownerModel'
    import { readTextSources } from '../../ts/studio/ownerSource.svelte'
    import { TREE_PAGE_SIZE, closeStudioTogglePreview, selectStudioNode, showMoreStudioRows, studioScreen } from '../../ts/studio/studioScreen.svelte'
    import { DBState } from '../../ts/stores.svelte'
    import { appToggleOwners } from '../../ts/studio/toggleAppOwners'
    import { buildToggleCombined, type CombinedEntry, type CombinedSource, type CombinedSourceInput } from '../../ts/studio/toggleCombined'
    import { tagLabelOf } from './TreeRow.svelte'

    // The toggles of every source of the chat, one list per source, with the keys that more than one source defines
    // marked. Each source is read on its own. Reads only: opening a source changes the selection and nothing else.
    interface Props {
        model: OwnerModel
    }

    let { model }: Props = $props()

    // The other characters and presets that define a key are read once per visit of this view.
    const appOwners = untrack(() => appToggleOwners(model.character.id, DBState.db.botPresetsId))

    function togglesItemOf(owner: OwnerNode): { id: string | null, text: string | null } {
        if (owner.restricted || owner.stub) return { id: null, text: null }
        const item = owner.kinds().find((node) => node.kind === 'toggles')?.items()[0]
        if (item === undefined) return { id: null, text: '' }
        const sources = readTextSources(studioScreen.chaId)
        const sections = sources === null ? null : itemSectionsOf(owner, item, sources)
        return { id: item.id, text: sections === null ? null : sections.map((section) => section.text).join('') }
    }

    // The merged view fixes the order of the active sources; the modules that are off follow in model order.
    const owners = $derived.by(() => {
        const active = buildMergedView(model).groups.find((group) => group.kind === 'toggles')?.segments ?? []
        return {
            active: active.map((key) => model.ownerByKey(key)).filter((owner): owner is OwnerNode => owner !== undefined),
            off: model.otherModules,
        }
    })
    const itemIds = $derived(new Map([...owners.active, ...owners.off].map((owner) => [owner.key, togglesItemOf(owner).id])))
    const combined = $derived.by(() => {
        const inputOf = (owner: OwnerNode): CombinedSourceInput => ({ ownerKey: owner.key, name: owner.name, tags: owner.tags, text: togglesItemOf(owner).text })
        return buildToggleCombined(owners.active.map(inputOf), owners.off.map(inputOf), appOwners)
    })

    const pageKey = 'c:toggles'
    const total = $derived([...combined.active, ...combined.off].reduce((sum, source) => sum + source.entries.length, 0))
    const shown = $derived(Math.min(total, TREE_PAGE_SIZE * ((studioScreen.pages[pageKey] ?? 0) + 1)))

    // The entries of each source that fit in the pages shown so far, in listing order.
    function visibleOf(list: readonly CombinedSource[], before: number): { source: CombinedSource, entries: readonly CombinedEntry[] }[] {
        let used = before
        return list.map((source) => {
            const room = Math.max(0, shown - used)
            used += source.entries.length
            return { source, entries: source.entries.slice(0, room) }
        })
    }
    const activeShown = $derived(visibleOf(combined.active, 0))
    const offShown = $derived(visibleOf(combined.off, combined.active.reduce((sum, source) => sum + source.entries.length, 0)))

    function open(ownerKey: string): void {
        selectStudioNode(ownerKey, 'toggles', itemIds.get(ownerKey) ?? null)
    }

    // The sheet reads the chat panel's sources, a heavy module this view does not otherwise need: it is loaded with the
    // first opening, as the chat loads its own panel.
    let previewSheet = $state.raw<typeof import('./StudioTogglePreview.svelte').default | null>(null)
    $effect(() => {
        if (!studioScreen.togglePreviewOpen || previewSheet !== null) return
        let live = true
        // A failed load must not leave the flag and the Back layer up with no sheet drawn.
        void import('./StudioTogglePreview.svelte').then((loaded) => { if (live) previewSheet = loaded.default }).catch((error) => {
            console.error(error)
            if (live) closeStudioTogglePreview()
        })
        return () => { live = false }
    })

    function togglePreview(): void {
        if (studioScreen.togglePreviewOpen) closeStudioTogglePreview()
        else studioScreen.togglePreviewOpen = true
    }

    // The sheet is rendered here, so it ends with this view; the Back layer that follows the flag must not outlive it.
    onDestroy(() => {
        if (studioScreen.togglePreviewOpen) studioScreen.togglePreviewOpen = false
    })
</script>

{#snippet listing(parts: { source: CombinedSource, entries: readonly CombinedEntry[] }[], dimmed: boolean)}
    {#each parts as part (part.source.ownerKey)}
        <section data-part="studio-tg-combined-source" data-owner-key={part.source.ownerKey} data-off={dimmed ? '' : undefined} class={`flex flex-col gap-1 ${dimmed ? 'opacity-60' : ''}`}>
            <button type="button" data-part="studio-tg-combined-header" class="flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-2 rounded px-2 text-start hover:bg-selected" onclick={() => open(part.source.ownerKey)}>
                <span class="min-w-0 break-words font-bold">{part.source.name}</span>
                {#each part.source.tags as tag}
                    <span class="rounded border border-darkborderc px-1 text-xs text-textcolor2">{tagLabelOf(tag)}</span>
                {/each}
                <span class="ms-auto shrink-0 text-xs text-textcolor2">{part.source.entries.length}</span>
            </button>
            {#if part.source.unclosedGroup}
                <p data-part="studio-tg-combined-unclosed" class="px-2 text-sm text-textcolor2">{language.studioTgCombinedUnclosed}</p>
            {/if}
            {#if part.source.unreadable > 0}
                <p data-part="studio-tg-combined-unreadable" class="px-2 text-sm text-textcolor2">{language.studioTgUnreadableCount(part.source.unreadable)}</p>
            {/if}
            <ul class="flex flex-col">
                {#each part.entries as entry, index (entry.line)}
                    {#if entry.group !== null && entry.group !== (index > 0 ? part.entries[index - 1].group : null)}
                        <li data-part="studio-tg-combined-group" class="px-2 pt-1 text-xs font-bold text-textcolor2">{entry.group}</li>
                    {/if}
                    <li>
                        <button type="button" data-part="studio-tg-combined-entry" data-key={entry.key} class="flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-2 rounded px-2 text-start hover:bg-selected" onclick={() => open(part.source.ownerKey)}>
                            <span class="min-w-0 break-words">{entry.label !== '' ? entry.label : language.studioTgUnnamed}</span>
                            <span class="font-mono text-xs text-textcolor2">{entry.key}</span>
                            {#if entry.shared.length > 0}
                                <span data-part="studio-tg-combined-shared" class="rounded border border-darkborderc px-1 text-xs text-textcolor2">{language.studioTgCombinedShared(entry.shared.join(', '))}</span>
                            {/if}
                        </button>
                    </li>
                {/each}
            </ul>
        </section>
    {/each}
{/snippet}

<div data-part="studio-tg-combined" class="flex flex-col gap-3">
    <button type="button" data-part="studio-tg-combined-all" aria-expanded={studioScreen.togglePreviewOpen} class="min-h-11 self-start rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={togglePreview}>{language.studioTgCombinedAll}</button>
    {#if total === 0}
        <p data-part="studio-tg-combined-empty" class="text-textcolor2">{language.studioTgCombinedEmpty}</p>
    {/if}
    {@render listing(activeShown, false)}
    {#if combined.off.length > 0}
        <h3 data-part="studio-tg-combined-off" class="font-bold">{language.studioTgCombinedOff}</h3>
        {@render listing(offShown, true)}
    {/if}
    {#if shown < total}
        <button type="button" data-part="studio-combined-more" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={() => showMoreStudioRows(pageKey)}>
            {language.studioShowMore(Math.min(TREE_PAGE_SIZE, total - shown))}
        </button>
    {/if}
    {#if studioScreen.togglePreviewOpen && previewSheet}
        {@const Sheet = previewSheet}
        <Sheet chaId={model.character.id} current={null} />
    {/if}
</div>
