<script lang="ts">
    // Test-only host for the window error guard, template-handler variant. It mirrors AlertComp: the alert store is read
    // through `$store` inside a $derived, so a store write reaches this component through a store subscriber. A text field
    // inside an {#if} block is removed by a state change while it holds focus, and its delegated `onfocusout` template
    // handler throws during that removal.
    import type { Writable } from 'svelte/store'

    let { alertLike }: { alertLike: Writable<string> } = $props()

    let shown = $state(true)
    const text = $derived($alertLike)

    export function hide(): void {
        shown = false
    }
</script>

<div>
    {#if shown}
        <input data-part="field" onfocusout={() => { throw new Error('boom') }} />
    {/if}
    <p data-part="alert">{text}</p>
</div>
