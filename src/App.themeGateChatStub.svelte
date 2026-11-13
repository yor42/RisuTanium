<script lang="ts">
    import { declareSurface } from './ts/themePack/surfaceGate.svelte'

    // Stands in for ChatScreen: it declares the chat surface the way a mounted ChatShell does, and only when asked to.
    let { declares }: { declares: boolean } = $props()

    $effect(() => (declares ? declareSurface('chat') : undefined))
</script>

<div data-stub="chat" data-declares={declares}></div>
