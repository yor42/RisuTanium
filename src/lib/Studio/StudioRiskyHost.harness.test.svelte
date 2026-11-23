<script lang="ts">
    import StudioAdvancedForm from './StudioAdvancedForm.svelte'
    import StudioRiskyProbe from './StudioRiskyProbe.harness.test.svelte'
    import StudioScreen from './StudioScreen.svelte'
    import type { StudioHistoryStep } from '../../ts/studio/historyStepContext'

    // The Studio screen over the advanced character form, as the detail pane mounts it: the prompts section, then the
    // details section with the risky section last.
    let { expose }: { expose: (context: StudioHistoryStep) => void } = $props()
</script>

<StudioScreen>
    {#snippet tree()}
        <p>tree</p>
    {/snippet}
    {#snippet detail()}
        <StudioAdvancedForm chaId="A" section="prompts" />
        <StudioAdvancedForm chaId="A" section="details" />
        <StudioRiskyProbe {expose} />
    {/snippet}
</StudioScreen>
