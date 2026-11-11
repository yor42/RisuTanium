<script lang="ts">
    // Test-only host for the window error guard. It mirrors AlertComp: the alert store is read through `$store` inside a
    // $derived, so a store write reaches this component through a store subscriber. A text field inside an {#if} block is
    // removed by a state change while it holds focus, and its raw focusout listener throws during that removal.
    import type { Writable } from 'svelte/store'

    let { alertLike }: { alertLike: Writable<string> } = $props()

    let shown = $state(true)
    const text = $derived($alertLike)

    // The removal is driven from an effect: a write made inside an effect re-runs the {#if} block eagerly in either
    // scheduler, so the raw listener throws on the block effect's stack, where the guard must defer its report.
    // The counter lets a test prove the removal went through this effect and not a direct write.
    let hideRequested = $state(false)
    let effectHides = 0
    $effect(() => {
        if (hideRequested) {
            effectHides++
            shown = false
        }
    })

    export function hide(): void {
        hideRequested = true
    }

    export function effectHideCount(): number {
        return effectHides
    }

    function throwingListener(node: HTMLElement) {
        const listener = () => { throw new Error('boom') }
        node.addEventListener('focusout', listener)
        return { destroy() { node.removeEventListener('focusout', listener) } }
    }
</script>

<div>
    {#if shown}
        <input data-part="field" use:throwingListener />
    {/if}
    <p data-part="alert">{text}</p>
</div>
