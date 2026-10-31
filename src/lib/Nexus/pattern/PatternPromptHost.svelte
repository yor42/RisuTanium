<script lang="ts">
    import { untrack } from 'svelte'
    import { alertStore } from '../../../ts/stores.svelte'
    import type { alertData } from '../../../ts/alert'
    import PatternPrompt from './PatternPrompt.svelte'

    interface Props {
        trigger?: HTMLElement | null
        background?: readonly HTMLElement[]
        lowPower?: boolean
        labels?: { cancel?: string, ok?: string }
    }

    let { trigger = null, background = [], lowPower = false, labels = {} }: Props = $props()

    let shown = $state<alertData>({ type: 'none', msg: '' })
    // Every emission of the store re-keys the prompt: an answer given inside the answer guard is discarded
    // and the same prompt is written back, and the fresh instance must accept the next press.
    let emission = $state(0)

    $effect(() => alertStore.subscribe((value) => {
        untrack(() => {
            shown = value
            emission += 1
        })
    }))

    function onanswer(message: string) {
        alertStore.set({ type: 'none', msg: message })
    }
</script>

{#if shown.type === 'patternSelect' || shown.type === 'patternInput'}
    {#key emission}
        <PatternPrompt
            kind={shown.type === 'patternSelect' ? 'select' : 'input'}
            heading={shown.msg}
            choices={shown.choices}
            defaultValue={shown.defaultValue}
            datalist={shown.datalist}
            {onanswer}
            {trigger}
            {background}
            {lowPower}
            {labels}
        />
    {/key}
{/if}
