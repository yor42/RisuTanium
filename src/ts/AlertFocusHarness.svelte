<script lang="ts">
    // Test-only host that mounts the alert the way App does: page controls inside AlertInertScope, AlertComp beside it
    // while the store holds an alert, and the focus-return installer running. `scoped` false leaves the controls outside
    // AlertInertScope.
    import AlertInertScope from '../lib/UI/GUI/AlertInertScope.svelte'
    import AlertComp from '../lib/Others/AlertComp.svelte'
    import { alertStore } from './stores.svelte'
    import { installAlertFocusReturn } from './alertFocusReturn'

    interface Props {
        scoped?: boolean
    }

    const { scoped = true }: Props = $props()

    $effect(() => installAlertFocusReturn())
</script>

{#snippet controls()}
    <button id="opener" type="button">opener</button>
    <textarea id="field"></textarea>
    <button id="other" type="button">other</button>
{/snippet}

{#if scoped}
    <AlertInertScope>
        {@render controls()}
    </AlertInertScope>
{:else}
    {@render controls()}
{/if}
{#if $alertStore.type !== 'none'}
    <AlertComp />
{/if}
