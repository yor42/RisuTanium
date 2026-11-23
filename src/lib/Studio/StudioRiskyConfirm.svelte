<script lang="ts">
    import { onMount, tick } from 'svelte'
    import { language } from '../../lang'
    import { answerRiskyQuestion, cancelRiskyQuestion, riskyQuestion } from '../../ts/studio/edit/riskyConfirm.svelte'
    import { isRiskyFlagPath } from '../../ts/studio/edit/riskyFlags'
    import { riskyAskOf, riskyExplainOf } from '../../ts/studio/edit/riskyText'
    import { registerStudioRiskyBack } from '../../ts/studio/studioBack.svelte'

    // The question sheet of a risky turn-on, for a character flag and for a module's Low Level Access. The screen mounts
    // it only while a question is pending, so its Back layer is the newest one for exactly that long. The scrim covers
    // the Studio body and a tap on it means cancel; Esc and Back cancel too, and default focus is Cancel. Nothing here
    // writes: the answer goes to the question, whose asker acts.
    registerStudioRiskyBack()

    const question = $derived(riskyQuestion())
    const path = $derived(question !== null && isRiskyFlagPath(question.path) ? question.path : null)
    // A module's Low Level Access keeps its own wording and names the module; every other flag is a character flag.
    const title = $derived(path === null ? '' : path === 'moduleLowLevelAccess' ? language.studioModAdvLowLevelAskTitle : riskyAskOf(path))
    const body = $derived(path === null ? '' : path === 'moduleLowLevelAccess' ? language.studioModAdvLowLevelAskBody(question?.name ?? '') : riskyExplainOf(path))
    const confirmLabel = $derived(path === 'moduleLowLevelAccess' ? language.studioModAdvLowLevelAskConfirm : language.studioRiskyTurnOn)

    let cancelButton = $state<HTMLButtonElement | undefined>()
    let okButton = $state<HTMLButtonElement | undefined>()

    // Each flag of a multi-flag action is asked in turn, and each question starts on Cancel.
    $effect(() => {
        void question?.path
        void tick().then(() => cancelButton?.focus())
    })
    onMount(() => {
        cancelButton?.focus()
    })

    // Tab and Shift+Tab cycle between the two buttons.
    function onkeydown(event: KeyboardEvent): void {
        if (event.key !== 'Tab') return
        event.preventDefault()
        const onCancel = document.activeElement === cancelButton
        const onOk = document.activeElement === okButton
        // With two buttons either direction moves to the other one; from outside them, forward is the first and backward the last.
        const toOk = onCancel || (!onOk && event.shiftKey)
        ;(toOk ? okButton : cancelButton)?.focus()
    }

    function onscrim(event: MouseEvent): void {
        if (event.target === event.currentTarget) cancelRiskyQuestion()
    }

    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
</script>

{#if path !== null}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="absolute inset-0 z-40 flex items-end justify-center bg-black/50 p-3 sm:items-center" onclick={onscrim}>
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
            role="alertdialog"
            aria-modal="true"
            tabindex="-1"
            aria-labelledby="studio-risky-confirm-title-{path}"
            aria-describedby="studio-risky-confirm-body-{path}"
            data-part="studio-risky-confirm"
            data-part-critical
            class="flex max-h-full w-full max-w-md flex-col gap-3 overflow-y-auto rounded-md border-2 border-draculared bg-darkbg p-4 text-textcolor"
            {onkeydown}
        >
            <h2 data-part="studio-risky-confirm-title" id="studio-risky-confirm-title-{path}" class="text-lg font-bold">{title}</h2>
            <div data-part="studio-risky-confirm-body" id="studio-risky-confirm-body-{path}" class="flex flex-col gap-2 text-sm">
                <p>{body}</p>
                {#if path === 'lowLevelAccess'}
                    <p class="font-bold">{language.studioRiskyLowConsequence}</p>
                {/if}
            </div>
            <div class="flex justify-end gap-2">
                <button bind:this={cancelButton} type="button" class={buttonClass} data-part="studio-risky-confirm-cancel" onclick={cancelRiskyQuestion}>{language.cancel}</button>
                <button bind:this={okButton} type="button" class={buttonClass} data-part="studio-risky-confirm-ok" onclick={() => answerRiskyQuestion(true)}>{confirmLabel}</button>
            </div>
        </div>
    </div>
{/if}
