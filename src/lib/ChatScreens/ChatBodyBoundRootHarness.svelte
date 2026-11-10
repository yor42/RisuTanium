<script lang="ts">
    // Test-only host that wires `bodyRoot` the way Chat.svelte does: a `$state(null)` bound to the wrapper with
    // `bind:this`, passed to the body inside that wrapper.
    import type { ComponentProps } from 'svelte'
    import ChatBody from './ChatBody.svelte'

    let { bodyProps }: { bodyProps: Omit<ComponentProps<typeof ChatBody>, 'bodyRoot'> } = $props()
    let root = $state<HTMLElement | null>(null)
</script>

<span bind:this={root}><ChatBody {...bodyProps} bodyRoot={root} /></span>
