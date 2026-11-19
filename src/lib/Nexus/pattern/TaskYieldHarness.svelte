<script lang="ts">
    // Test-only: the real AlertComp and the real TaskHost wired as App.svelte wires them, with an opener button outside both.
    import AlertComp from '../../Others/AlertComp.svelte'
    import TaskHost from './TaskHost.svelte'
    import { alertStore } from '../../../ts/stores.svelte'
    import { coversPage } from '../../../ts/alertEscape'
</script>

<button type="button" data-test="opener">Open</button>
{#if $alertStore.type !== 'none'}
    <AlertComp />
{/if}
<TaskHost yielded={coversPage($alertStore.type)} />
