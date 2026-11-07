<script module lang="ts">
    import type { MergedKind } from '../../ts/studio/mergedView'

    // The kinds the engine merges across owners. Scripts are left out: their run order is not claimed.
    export const COMBINED_KINDS: readonly MergedKind[] = ['regex', 'lore', 'toggles']

    // A combined entry is selected through the screen's owner key. The prefix cannot collide with a real owner key,
    // which always starts with an owner type.
    const COMBINED_PREFIX = 'combined:'

    export function combinedKeyOf(kind: MergedKind): string {
        return `${COMBINED_PREFIX}${kind}`
    }

    export function combinedKindOf(ownerKey: string | null): MergedKind | null {
        if (ownerKey === null || !ownerKey.startsWith(COMBINED_PREFIX)) return null
        return COMBINED_KINDS.find((kind) => combinedKeyOf(kind) === ownerKey) ?? null
    }
</script>

<script lang="ts">
    import { language } from '../../lang'
    import { buildMergedView } from '../../ts/studio/mergedView'
    import type { OwnerModel } from '../../ts/studio/ownerModel'
    import { TREE_PAGE_SIZE, selectStudioNode, showMoreStudioRows, studioScreen } from '../../ts/studio/studioScreen.svelte'
    import { itemLabelOf, kindLabelOf } from './TreeRow.svelte'

    interface Props {
        model: OwnerModel
        kind: MergedKind
    }

    let { model, kind }: Props = $props()

    // The order, the numbering and the count of parts that cannot be shown all come from the merged view.
    const group = $derived(buildMergedView(model).groups.find((candidate) => candidate.kind === kind))
    const rows = $derived(group ? group.rows() : [])
    const pageKey = $derived(`c:${kind}`)
    const shown = $derived(Math.min(rows.length, TREE_PAGE_SIZE * ((studioScreen.pages[pageKey] ?? 0) + 1)))
</script>

{#if group}
    <div data-part="studio-combined" data-kind={kind} class="flex flex-col gap-3 p-4">
        <h2 data-part="studio-combined-title" class="text-lg font-bold">{kindLabelOf(kind)} - {language.studioMerged}</h2>
        <p class="text-sm text-textcolor2">{language.studioMergedOrdered}</p>
        {#if group.unshownSegments > 0}
            <p data-part="studio-combined-partial" class="text-sm text-textcolor2">{language.studioMergedPartial(group.unshownSegments)}</p>
        {/if}
        <ul class="flex flex-col">
            {#each rows.slice(0, shown) as row (row.item.id)}
                <li>
                    <button
                        type="button"
                        data-part="studio-combined-row"
                        data-item-id={row.item.id}
                        data-numbered={row.ordinal !== null}
                        class="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded px-2 text-start hover:bg-selected"
                        onclick={() => selectStudioNode(row.ownerKey, kind, row.item.id)}
                    >
                        <span data-part="studio-combined-ordinal" class="w-10 shrink-0 text-end text-xs text-textcolor2">{row.ordinal ?? row.position}</span>
                        <span class="min-w-0 flex-1 truncate">{itemLabelOf(row.item)}</span>
                        <span class="shrink-0 text-xs text-textcolor2">{model.ownerByKey(row.ownerKey)?.name ?? ''}</span>
                    </button>
                </li>
            {/each}
        </ul>
        {#if shown < rows.length}
            <button type="button" data-part="studio-combined-more" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={() => showMoreStudioRows(pageKey)}>
                {language.studioShowMore(Math.min(TREE_PAGE_SIZE, rows.length - shown))}
            </button>
        {/if}
    </div>
{/if}
