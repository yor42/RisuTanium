<script lang="ts">
    import HomeShell from './HomeShell.svelte'

    let { epoch }: { epoch: number } = $props()
</script>

{#key epoch}
    <HomeShell />
{/key}
