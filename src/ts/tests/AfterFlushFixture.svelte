<script lang="ts">
    // Test-only host for `afterFlush`: one handler shape, one effect shape and one teardown shape, each recording what
    // the DOM held when the helper resolved.
    import { onDestroy } from 'svelte'
    import { afterFlush } from '../afterFlush'

    interface Props {
        // Receives the DOM state the helper saw, labelled by the shape that waited.
        record: (label: string, value: string) => void
    }
    let { record }: Props = $props()

    let layerOpen = $state(true)
    let shown = $state(false)
    let effectTrigger = $state(false)
    let marked = $state(false)
    let openerEl = $state<HTMLButtonElement>()

    const seen = (): string => document.querySelector('[data-part="shown"]') ? 'shown' : 'absent'

    // Handler shape: the update is pending when the wait starts, and the focus move needs the committed DOM.
    export function closeLayer(): void {
        layerOpen = false
        void afterFlush().then(() => openerEl?.focus())
    }

    // The update is pending when the wait starts; the reader sees whether it was committed.
    export function showThenWait(): Promise<void> {
        shown = true
        return afterFlush().then(() => record('handler', seen()))
    }

    // No update is pending: the helper must still resolve.
    export function waitIdle(): Promise<void> {
        return afterFlush()
    }

    export function triggerEffect(): void {
        effectTrigger = true
    }

    // Effect shape: the effect writes state, then waits; the write is committed when the wait resolves.
    $effect(() => {
        if (!effectTrigger) return
        marked = true
        void afterFlush().then(() => record('effect', document.querySelector('[data-part="marked"]') ? 'marked' : 'absent'))
    })

    // Teardown shape: the wait starts on the teardown stack and resolves after it.
    onDestroy(() => {
        void afterFlush().then(() => record('destroy', 'resolved'))
    })
</script>

<button type="button" data-part="opener" bind:this={openerEl}>Opener</button>
{#if layerOpen}
    <input data-part="layer" />
{/if}
{#if shown}
    <span data-part="shown">shown</span>
{/if}
{#if marked}
    <span data-part="marked">marked</span>
{/if}
