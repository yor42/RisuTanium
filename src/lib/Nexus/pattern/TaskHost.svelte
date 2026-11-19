<script lang="ts">
    import { tick, untrack } from 'svelte'
    import PatternTask from './PatternTask.svelte'
    import { returnFocus } from './patternFocus'
    import { answerTask, requestTaskCancel, taskHostView, taskOpener } from '../../../ts/alertTask.svelte'
    import { motionPrefs } from '../../../ts/chatShell/motionPrefs.svelte'

    interface Props {
        /**
         * True while a legacy alert that covers the page is up. The card unmounts its dialog then, so the alert keeps its
         * keys and focus; the task keeps running in its slot and the card returns, state intact, when the alert is gone.
         */
        yielded?: boolean
    }

    let { yielded = false }: Props = $props()

    const view = $derived(taskHostView())

    // The dialog is given no trigger: its own focus return runs on every teardown, a yield included, and may run before the
    // inert scope has released. Focus returns here instead, once, when the slot clears while the card is not yielded.
    let opener: HTMLElement | null = null
    let wasShown = false
    $effect(() => {
        const current = view
        const stepAside = yielded
        if (current) {
            opener = untrack(() => taskOpener())
            wasShown = true
            return
        }
        if (!wasShown) return
        wasShown = false
        const target = opener
        opener = null
        if (stepAside) return
        void tick().then(() => returnFocus(target))
    })
</script>

{#if view && !yielded}
    {#key view.id}
        <PatternTask {view} lowPower={motionPrefs.lowPower} oncancel={requestTaskCancel} onanswer={answerTask} />
    {/key}
{/if}
