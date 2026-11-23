<script lang="ts">
    import { getContext, onMount } from 'svelte'
    import { STUDIO_HISTORY_STEP, type StudioHistoryStep } from '../../ts/studio/historyStepContext'

    // Hands the screen's history-step context to the test, as a layer that replays through it would hold it.
    let { expose }: { expose: (context: StudioHistoryStep) => void } = $props()

    onMount(() => {
        expose(getContext<StudioHistoryStep>(STUDIO_HISTORY_STEP))
    })
</script>
