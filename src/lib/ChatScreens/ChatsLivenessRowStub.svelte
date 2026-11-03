<script lang="ts">
    // Test-only stand-in for one chat row. It depends on the enabled-module count (the pending gate of a stub
    // module), re-keys on the GUI and chat pointers exactly as Chat.svelte does, and renders a database value so a
    // later unrelated change shows whether the row still updates.
    import { DBState, ReloadChatPointer, ReloadGUIPointer } from 'src/ts/stores.svelte'

    let { idx }: { idx: number } = $props()

    const gate = $derived(DBState.db.enabledModules.length)
</script>

{#key $ReloadGUIPointer + ($ReloadChatPointer[idx] ?? 0)}
    <span class="liveness-row" data-idx={idx} data-gate={gate}>{DBState.db.zoomsize}</span>
{/key}
