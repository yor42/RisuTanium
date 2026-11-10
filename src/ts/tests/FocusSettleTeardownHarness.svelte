<script lang="ts">
    // Test-only host for focus listeners that write state while an {#if} block removes a focused field. Each field has one
    // kind of listener: a raw `addEventListener` listener writing at once, a raw listener writing through the focus settle,
    // and the two template handler forms (delegated `onfocusout`, direct `onblur`). Every listener records the focus it saw.
    import { onDestroy } from 'svelte'
    import { createFocusSettle } from '../focusSettle'

    let shown = $state(true)
    let rawSync = $state('none')
    let rawSettled = $state('none')
    let delegated = $state('none')
    let direct = $state('none')

    const focusNow = () => document.activeElement?.getAttribute('data-part') ?? 'outside'

    const settle = createFocusSettle(() => { rawSettled = focusNow() })
    onDestroy(() => settle.dispose())

    export function hide(): void {
        shown = false
    }

    export function values(): { rawSync: string, rawSettled: string, delegated: string, direct: string } {
        return { rawSync, rawSettled, delegated, direct }
    }

    function rawSyncListener(node: HTMLElement) {
        const listener = () => { rawSync = focusNow() }
        node.addEventListener('focusout', listener)
        return { destroy() { node.removeEventListener('focusout', listener) } }
    }

    function rawSettledListener(node: HTMLElement) {
        node.addEventListener('focusout', settle.schedule)
        return { destroy() { node.removeEventListener('focusout', settle.schedule) } }
    }
</script>

<div>
    {#if shown}
        <input data-part="raw-sync" use:rawSyncListener />
        <input data-part="raw-settled" use:rawSettledListener />
        <input data-part="delegated" onfocusout={() => { delegated = focusNow() }} />
        <input data-part="direct" onblur={() => { direct = focusNow() }} />
    {/if}
</div>
