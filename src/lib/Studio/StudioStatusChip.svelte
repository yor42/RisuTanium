<script lang="ts">
    import { language } from '../../lang'
    import type { SaveAck } from '../../ts/studio/edit/saveAck.svelte'

    // The save state of the visit's edits. The live region exists even while the chip is empty, so a new state is
    // announced. "Saved" is shown only after a commit covered the edit; a failure or an unconfirmed save stays
    // until Retry.
    interface Props {
        ack: Pick<SaveAck, 'display' | 'canRetry' | 'retry'> | null
    }

    let { ack }: Props = $props()

    const display = $derived(ack ? ack.display : 'idle')
    const retryable = $derived(ack ? ack.canRetry() : false)

    function textOf(state: typeof display): string {
        switch (state) {
            case 'saved': return language.studioChipSaved
            case 'pending': return language.studioChipSaving
            case 'failed': return language.studioChipFailed
            case 'unconfirmed': return language.studioChipUnconfirmed
            case 'changedElsewhere': return language.studioChipChangedElsewhere
            case 'idle': return ''
        }
    }
</script>

<span role="status" data-part="studio-chip" data-state={display} class="inline-flex items-center gap-1 text-sm text-textcolor2">
    {#if display !== 'idle'}
        <span data-part="studio-chip-text" class={display === 'failed' || display === 'unconfirmed' ? 'text-draculared' : ''}>{textOf(display)}</span>
        {#if retryable}
            <span aria-hidden="true">·</span>
            <button type="button" data-part="studio-chip-retry" class="min-h-11 rounded-md px-2 underline hover:bg-selected cursor-pointer" onclick={() => ack?.retry()}>{language.studioChipRetry}</button>
        {/if}
    {/if}
</span>
