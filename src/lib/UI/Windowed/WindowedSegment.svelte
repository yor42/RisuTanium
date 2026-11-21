<script lang="ts">
    import { onDestroy, untrack, type Snippet } from 'svelte'
    import type { HTMLAttributes } from 'svelte/elements'
    import { overscanFor, pinsOnlyWindow, pruneHeights, segmentLayout, segmentSlices, segmentWindow, spacerElementPx } from '../../../ts/windowing/listWindow'
    import type { WindowHost } from '../../../ts/windowing/windowHost.svelte'

    /**
     * One windowed run of rows inside a `createWindowHost` root; the contract (scroller, band,
     * anchoring, pins, reveal) is documented in `windowHost.svelte.ts`.
     *
     * Rendering: a flex-column-like container (the owner supplies the `gap` class) holding
     * spacers and item wrappers. A spacer is an `aria-hidden` item-tag element with
     * `data-window-spacer` and `overflow-anchor: none`. An item wrapper carries
     * `data-window-key`, `aria-setsize` = `keys.length` and `aria-posinset` = position in `keys`
     * + 1, and is the measured box: put spacing between rows in the container's gap, not in a
     * margin of the row, because a margin is not part of a border box.
     */
    interface Props extends Omit<HTMLAttributes<HTMLElement>, 'class'> {
        host: WindowHost
        /** Unique, in data order. */
        keys: readonly string[]
        /** `{ fixed }`: one height, never measured. `{ fallback, heights? }`: measured; `heights` may be shared and pruned by the caller. */
        height: { fixed: number } | { fallback: number; heights?: Map<string, number> }
        /** Keys kept mounted wherever the band is; keys not in `keys` are ignored. */
        pinned?: readonly string[]
        /** `div` (default) gets `role="list"` and `role="listitem"` wrappers. */
        tag?: 'ul' | 'ol' | 'div'
        itemClass?: string
        class?: string
        /** `index` is the position of `key` in `keys`. */
        item: Snippet<[key: string, index: number]>
    }

    let { host, keys, height, pinned = [], tag = 'div', itemClass = '', class: className = '', item, ...rest }: Props = $props()

    // The host, and whether `height` is `{ fixed }` or `{ fallback }` (measured), are fixed for the life of the segment.
    const slot = untrack(() => host).createSegment()
    onDestroy(() => slot.dispose())

    let element = $state<HTMLElement | null>(null)
    $effect(() => {
        const el = element
        if (!el) {
            return
        }
        slot.bind(el)
        return () => slot.bind(null)
    })

    const noHeights: ReadonlyMap<string, number> = new Map()
    const ownHeights = new Map<string, number>()
    const fixed = $derived('fixed' in height)
    const fallbackPx = $derived('fixed' in height ? height.fixed : height.fallback)
    const heights = $derived.by((): Map<string, number> => {
        if ('fixed' in height) {
            return ownHeights
        }
        return height.heights ?? ownHeights
    })

    // A map the segment owns is pruned here; a map the caller passes is pruned by the caller,
    // who may share it with other segments.
    $effect(() => {
        const live = keys
        if ('fixed' in height || height.heights === undefined) {
            untrack(() => pruneHeights(ownHeights, live))
        }
    })

    const layout = $derived.by(() => {
        void slot.measuredTick
        return segmentLayout(keys, fixed ? noHeights : heights, fallbackPx, slot.gap)
    })
    const pins = $derived.by(() => {
        const all = [...pinned]
        if (host.focusedKey !== null) {
            all.push(host.focusedKey)
        }
        if (host.revealKey !== null) {
            all.push(host.revealKey)
        }
        return all
    })
    // Until the element's top is read the segment cannot tell where the band is: only pins mount.
    const win = $derived(
        slot.measured
            ? segmentWindow(layout, host.bandTop - slot.top, host.bandHeight, overscanFor(host.phase, host.bandHeight, fallbackPx), pins)
            : pinsOnlyWindow(layout, pins),
    )
    const slices = $derived(segmentSlices(layout, win))
    const itemTag = $derived(tag === 'div' ? 'div' : 'li')

    $effect(() => {
        const next = keys
        untrack(() => slot.keysChanged(next))
    })

    $effect(() => {
        const mounted = new Set<string>()
        for (const slice of slices) {
            if (slice.kind === 'item') {
                mounted.add(slice.key)
            }
        }
        untrack(() => slot.setMounted(mounted))
    })

    function measure(node: HTMLElement, param: { key: string; heights: Map<string, number> }) {
        return fixed ? { destroy() {} } : slot.measure(node, param)
    }
</script>

<svelte:element this={tag} bind:this={element} role={tag === 'div' ? 'list' : undefined} class={className} {...rest}>
    {#each slices as slice (slice.kind === 'spacer' ? `s:${slice.key}` : `i:${slice.key}`)}
        {#if slice.kind === 'spacer'}
            {@const px = spacerElementPx(slice.height, slot.gap)}
            <svelte:element
                this={itemTag}
                aria-hidden="true"
                role="presentation"
                data-window-spacer
                style="height: {px}px; min-height: {px}px; overflow-anchor: none;"
            ></svelte:element>
        {:else}
            {@const index = layout.indexByKey.get(slice.key) ?? 0}
            <svelte:element
                this={itemTag}
                role={tag === 'div' ? 'listitem' : undefined}
                class="flow-root {itemClass}"
                aria-setsize={keys.length}
                aria-posinset={index + 1}
                data-window-key={slice.key}
                use:measure={{ key: slice.key, heights }}
            >
                {@render item(slice.key, index)}
            </svelte:element>
        {/if}
    {/each}
</svelte:element>
