<script lang="ts">
    import { DBState } from 'src/ts/stores.svelte'

    // Compiled with experimental.async (see dynamicCompileOptions in vitest.config.ts): a pending markup await
    // keeps the effect scheduler from flushing, which is the state the pins observe.
    let { load }: { load: (name: string) => Promise<string> } = $props()
</script>

<p>{await load(DBState.db.characters[0].name)}</p>
