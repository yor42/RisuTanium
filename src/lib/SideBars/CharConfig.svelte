<script lang="ts">
    import { DBState, selectedCharID } from 'src/ts/stores.svelte';
    import CharConfigPanel from './CharConfigPanel.svelte';

    interface Props {
        // The Studio row sits at the top; a host that already offers Studio itself passes false.
        studioEntry?: boolean;
    }

    let { studioEntry = true }: Props = $props();
</script>

<!-- The panel's script effects and markup read the selected character without a check. Mounted only while the
     selection names a character, it is torn down before any of them can run against a removed or cleared one. -->
{#if DBState.db.characters?.[$selectedCharID]}
    <CharConfigPanel {studioEntry} />
{/if}
