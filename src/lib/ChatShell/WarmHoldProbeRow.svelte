<script module lang="ts">
    // Test-only row: stands in for a message row in the list tests of the warm hold. It makes its loader at init, like
    // ChatBody does, scans its own markup before the render counts, and then scans it as rendered either at once or when
    // the test lets a slow row finish.
    export const probeConfig: { url: string, imageIdx: number | null, slowIdx: number | null, slowGate: Promise<void> | null } = {
        url: '',
        imageIdx: null,
        slowIdx: null,
        slowGate: null,
    }
</script>

<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { DEFERRED_IMAGE_PLACEHOLDER_SRC } from '../../ts/storage/assetUrlGate'
    import { createDeferredImageLoader } from '../ChatScreens/deferredAssetImages'

    let { idx }: { idx: number } = $props()
    let root = $state<HTMLDivElement>()
    const loader = createDeferredImageLoader()
    // A row's index is fixed for its life, so the test configuration is read once at init.
    const rowIdx = untrack(() => idx)
    const slowGate = probeConfig.slowIdx === rowIdx ? probeConfig.slowGate : null
    const shownUrl = probeConfig.imageIdx === rowIdx ? probeConfig.url : null
    let gone = false
    onDestroy(() => {
        gone = true
        loader.dispose()
    })

    $effect(() => {
        if (!root) {
            return
        }
        const scanned = root
        // The blank scan comes first, like ChatBody's scan before its parse resolves.
        loader.scan(scanned, false)
        if (slowGate === null) {
            loader.scan(scanned, true)
            return
        }
        void slowGate.then(() => {
            if (!gone) {
                loader.scan(scanned, true)
            }
        })
    })
</script>

<div bind:this={root}>
    {#if shownUrl !== null}
        <img data-risu-deferred-src={shownUrl} src={DEFERRED_IMAGE_PLACEHOLDER_SRC} loading="lazy" alt="">
    {/if}
</div>
