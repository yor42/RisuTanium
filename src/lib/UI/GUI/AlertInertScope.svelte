<script lang="ts">
    import type { Snippet } from 'svelte'
    import { alertStore } from 'src/ts/stores.svelte'
    import { coversPage } from 'src/ts/alertEscape'
    import { taskShown } from 'src/ts/alertTask.svelte'

    interface Props {
        children?: Snippet
    }

    const { children }: Props = $props()
</script>

<!-- Inert while an alert that covers the page, or a task card, is shown: nothing inside takes focus, clicks or key targets. -->
<div style="display: contents" inert={coversPage($alertStore.type) || taskShown()}>
    {@render children?.()}
</div>
