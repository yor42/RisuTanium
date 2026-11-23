<script lang="ts">
    import { onMount } from 'svelte'
    import { language } from '../../lang'
    import { registerStudioRiskyBack } from '../../ts/studio/studioBack.svelte'
    import { answerStudioRisky } from '../../ts/studio/studioScreen.svelte'

    // The confirm sheet of a risky setting, over the restore sheet and the History panel. It exists only while an ask is
    // pending: its Back layer lives exactly as long, and its destruction, by whatever close path, ends the layer. Initial
    // focus is Cancel. Every close answers the ask: Cancel, Back, Esc, the visit's end and a change of owner answer
    // false; Turn on answers true.
    interface Props {
        // The name of the module the ask is about.
        name: string
    }

    let { name }: Props = $props()

    registerStudioRiskyBack()

    let cancelButton = $state<HTMLButtonElement | undefined>()

    onMount(() => {
        cancelButton?.focus()
    })

    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
</script>

<div data-part="studio-risky-layer" class="absolute inset-0 z-40 flex items-end justify-center bg-black/40 p-3 sm:items-center">
    <div role="dialog" aria-labelledby="studio-risky-title" data-part="studio-risky-sheet" class="flex max-h-full w-full max-w-md flex-col gap-3 overflow-y-auto rounded-md border border-darkborderc bg-darkbg p-4 text-textcolor">
        <h2 id="studio-risky-title" class="text-lg font-bold">{language.studioModAdvLowLevelAskTitle}</h2>
        <p class="text-sm text-textcolor2">{language.studioModAdvLowLevelAskBody(name)}</p>
        <div class="flex justify-end gap-2">
            <button bind:this={cancelButton} type="button" class={buttonClass} data-part="studio-risky-cancel" onclick={() => answerStudioRisky(false)}>{language.cancel}</button>
            <button type="button" class={buttonClass} data-part="studio-risky-confirm" onclick={() => answerStudioRisky(true)}>{language.studioModAdvLowLevelAskConfirm}</button>
        </div>
    </div>
</div>
