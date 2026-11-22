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
    import { onDestroy } from 'svelte'
    import { language } from '../../lang'
    import { buildMergedView, type MergedRow } from '../../ts/studio/mergedView'
    import type { OwnerModel } from '../../ts/studio/ownerModel'
    import { afterFlush } from '../../ts/afterFlush'
    import { openStudioListRow, studioScreen, takeStudioListReveal } from '../../ts/studio/studioScreen.svelte'
    import { createWindowHost } from '../../ts/windowing/windowHost.svelte'
    import WindowedSegment from '../UI/Windowed/WindowedSegment.svelte'
    import { itemLabelOf, kindLabelOf } from './TreeRow.svelte'
    import StudioLoreTester from './StudioLoreTester.svelte'

    // One row: the 44 px touch target of a single truncated line. Rows are measured, so a larger font only moves the spacers.
    const COMBINED_ROW_FALLBACK_PX = 44

    interface Props {
        model: OwnerModel
        kind: MergedKind
    }

    let { model, kind }: Props = $props()

    // The order, the numbering and the count of parts that cannot be shown all come from the merged view.
    const group = $derived(buildMergedView(model).groups.find((candidate) => candidate.kind === kind))
    const rows = $derived(group ? group.rows() : [])
    // Every row is reachable by scrolling; only the rows near the detail's visible band are in the page.
    const rowKeys = $derived(rows.map((row) => row.item.id))
    const rowByKey = $derived(new Map(rows.map((row): [string, MergedRow] => [row.item.id, row])))

    let listRoot = $state<HTMLElement | null>(null)
    const windowHost = createWindowHost({ root: () => listRoot })
    onDestroy(() => windowHost.dispose())

    // Back from an entry opened here shows the list again: the row that opened it is scrolled into the band and focused,
    // once the segment holds the rows. A row that is no longer in the list spends the request with nothing to show.
    $effect(() => {
        const rowId = studioScreen.revealListRow
        if (rowId === null || listRoot === null) return
        if (!rowByKey.has(rowId)) {
            takeStudioListReveal(rowId)
            return
        }
        let live = true
        void afterFlush().then(() => live ? windowHost.reveal(rowId) : null).then((wrapper) => {
            if (!live) return
            takeStudioListReveal(rowId)
            wrapper?.querySelector<HTMLElement>('[data-part="studio-combined-row"]')?.focus()
        })
        return () => { live = false }
    })

    // The toggles view reads the owners' texts and the app's other owners, which the other kinds do not need: it is
    // loaded when the toggles kind is first shown.
    let togglesView = $state.raw<typeof import('./StudioToggleCombined.svelte').default | null>(null)
    $effect(() => {
        if (kind !== 'toggles' || togglesView !== null) return
        let live = true
        void import('./StudioToggleCombined.svelte').then((loaded) => { if (live) togglesView = loaded.default }).catch(console.error)
        return () => { live = false }
    })
</script>

{#if group}
    <div data-part="studio-combined" data-kind={kind} class="flex flex-col gap-3 p-4">
        <h2 data-part="studio-combined-title" class="text-lg font-bold">{kindLabelOf(kind)} - {language.studioMerged}</h2>
        <p class="text-sm text-textcolor2">{language.studioMergedOrdered}</p>
        {#if group.unshownSegments > 0}
            <p data-part="studio-combined-partial" class="text-sm text-textcolor2">{language.studioMergedPartial(group.unshownSegments)}</p>
        {/if}
        {#if kind === 'toggles'}
            {#if togglesView}
                {@const View = togglesView}
                <View {model} />
            {/if}
        {:else}
            <div bind:this={listRoot}>
                <WindowedSegment
                    host={windowHost}
                    tag="ul"
                    data-part="studio-combined-rows"
                    class="flex flex-col"
                    keys={rowKeys}
                    height={{ fallback: COMBINED_ROW_FALLBACK_PX }}
                    item={combinedRow}
                />
            </div>
            {#snippet combinedRow(key: string)}
                {@const row = rowByKey.get(key)}
                {#if row}
                    <button
                        type="button"
                        data-part="studio-combined-row"
                        data-item-id={row.item.id}
                        data-numbered={row.ordinal !== null}
                        class="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded px-2 text-start hover:bg-selected"
                        onclick={() => openStudioListRow({ ownerKey: combinedKeyOf(kind), kind }, row.ownerKey, row.item.id)}
                    >
                        <span data-part="studio-combined-ordinal" class="w-10 shrink-0 text-end text-xs text-textcolor2">{row.ordinal ?? row.position}</span>
                        <span class="min-w-0 flex-1 truncate">{itemLabelOf(row.item)}</span>
                        <span class="shrink-0 text-xs text-textcolor2">{model.ownerByKey(row.ownerKey)?.name ?? ''}</span>
                    </button>
                {/if}
            {/snippet}
        {/if}
        {#if kind === 'lore'}
            <StudioLoreTester {model} />
        {/if}
    </div>
{/if}
