<script lang="ts">
    // Test-only host for the window error guard. It mirrors AlertComp: the alert store is read through `$store` inside a
    // $derived, so a store write reaches this component through a store subscriber. A text field inside an {#if} block is
    // removed by a state change while it holds focus, and its raw focusout listener throws during that removal.
    import type { Writable } from 'svelte/store'

    let { alertLike }: { alertLike: Writable<string> } = $props()

    let shown = $state(true)
    const text = $derived($alertLike)

    export function hide(): void {
        shown = false
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
