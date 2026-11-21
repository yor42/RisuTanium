<script lang="ts">
    import { onDestroy } from 'svelte'
    import { createWindowHost, type WindowHost } from '../../../ts/windowing/windowHost.svelte'
    import WindowedSegment from './WindowedSegment.svelte'

    // Test harness for WindowedSegment: one root with a section per entry of `segments`, inside
    // an optional scroller. `scroller`: 'nearest' wraps the root in an `overflow-y: auto` box the
    // host finds itself, 'own' passes that box through the host option, 'window' has no box.
    interface Props {
        segments: string[][]
        fixedPx?: number
        fallback?: number
        heights?: Map<string, number>
        pinned?: string[]
        tag?: 'ul' | 'ol' | 'div'
        scroller?: 'nearest' | 'own' | 'window'
        gap?: number
        onHost?: (host: WindowHost) => void
    }

    let { segments, fixedPx, fallback = 50, heights, pinned = [], tag = 'div', scroller = 'nearest', gap = 0, onHost }: Props = $props()

    let root = $state<HTMLElement | null>(null)
    let box = $state<HTMLElement | null>(null)
    const host = createWindowHost({
        root: () => root,
        scroller: scroller === 'own' ? () => box : 'nearest',
    })
    onHost?.(host)
    onDestroy(() => host.dispose())
</script>

{#snippet sections()}
    <section bind:this={root} data-testid="root" style="margin: 0">
        {#each segments as keys, i (i)}
            <WindowedSegment
                {host}
                {keys}
                {tag}
                {pinned}
                height={fixedPx !== undefined ? { fixed: fixedPx } : { fallback, heights }}
                data-testid="segment-{i}"
                style="display: flex; flex-direction: column; row-gap: {gap}px"
            >
                {#snippet item(key, index)}
                    <button type="button" data-testid="row-{key}">{key}@{index}</button>
                {/snippet}
            </WindowedSegment>
        {/each}
    </section>
{/snippet}

{#if scroller === 'window'}
    {@render sections()}
{:else}
    <div bind:this={box} data-testid="box" style={scroller === 'nearest' ? 'overflow-y: auto; height: 300px' : 'height: 300px'}>
        {@render sections()}
    </div>
{/if}
