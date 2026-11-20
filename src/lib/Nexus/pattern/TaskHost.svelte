<script lang="ts">
    import { tick, untrack } from 'svelte'
    import PatternTask from './PatternTask.svelte'
    import { returnFocus } from './patternFocus'
    import {
        answerTask,
        backgroundOffered,
        backgroundTask,
        confirmTask,
        declineTask,
        requestTaskCancel,
        setTaskToastPresenter,
        taskHostView,
        taskOpener,
        taskReopened,
    } from '../../../ts/alertTask.svelte'
    import { motionPrefs } from '../../../ts/chatShell/motionPrefs.svelte'
    import { toastHost, type ToastHost } from '../../../ts/toast/toastHost.svelte'
    import { createTaskToastPresenter } from './taskToastPresenter'

    interface Props {
        /**
         * True while a legacy alert that covers the page is up. The card unmounts its dialog then, so the alert keeps its
         * keys and focus; the task keeps running in its slot and the card returns, state intact, when the alert is gone.
         */
        yielded?: boolean
        /** The host that shows backgrounded tasks; the app-wide host unless a test injects one. */
        toasts?: ToastHost
    }

    let { yielded = false, toasts = toastHost }: Props = $props()

    const view = $derived(taskHostView())

    // The host registers where a task goes when it is sent to the background; its teardown ends those tasks as closed.
    // The injected host is fixed for the component's lifetime.
    // svelte-ignore state_referenced_locally
    setTaskToastPresenter(createTaskToastPresenter(toasts))
    $effect(() => () => setTaskToastPresenter(null))

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
        <PatternTask
            {view}
            lowPower={motionPrefs.lowPower}
            oncancel={requestTaskCancel}
            onanswer={answerTask}
            onconfirm={confirmTask}
            ondecline={declineTask}
            onbackground={backgroundTask}
            backgroundOffered={backgroundOffered()}
            armOnMount={taskReopened()}
        />
    {/key}
{/if}
