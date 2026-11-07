<script lang="ts">
    // Test-only host for the keyboard watcher. It mirrors ChatShell: the watcher callback writes a rune, and a text field
    // inside an {#if} block is removed by a state change while it holds focus (the chat rename field on Enter).
    import { onMount, tick } from 'svelte'
    import type { HostIme } from '../../android/hostBridge'
    import { watchSoftKeyboard } from '../softKeyboard'

    let { ime }: { ime: HostIme } = $props()

    let keyboardOpen = $state(false)
    let renaming = $state(true)
    let root: HTMLDivElement
    let button = $state<HTMLButtonElement>()

    onMount(() => watchSoftKeyboard(root, window, (open) => { keyboardOpen = open }, ime))

    function onkeydown(event: KeyboardEvent): void {
        if (event.key !== 'Enter') return
        renaming = false
        tick().then(() => button?.focus())
    }
</script>

<div bind:this={root} data-keyboard={keyboardOpen || undefined}>
    {#if renaming}
        <input data-part="name" type="text" {onkeydown} />
    {:else}
        <button bind:this={button} data-part="done">done</button>
    {/if}
</div>
