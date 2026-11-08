<script lang="ts">
    import { onDestroy, onMount, tick } from 'svelte'
    import { language } from 'src/lang'
    import { backCloseHandler, registerBackHandler } from 'src/ts/backHandlers'
    import type { FirstRunStep } from 'src/ts/firstRun/firstRunChoices'
    import WelcomeChatLanguageStep from './Welcome/WelcomeChatLanguageStep.svelte'
    import WelcomeLanguageStep from './Welcome/WelcomeLanguageStep.svelte'
    import WelcomeMemoryStep from './Welcome/WelcomeMemoryStep.svelte'
    import WelcomePersonaStep from './Welcome/WelcomePersonaStep.svelte'
    import WelcomeProviderStep from './Welcome/WelcomeProviderStep.svelte'
    import WelcomeReviewStep from './Welcome/WelcomeReviewStep.svelte'
    import WelcomeStepRail from './Welcome/WelcomeStepRail.svelte'
    import WelcomeUseStep from './Welcome/WelcomeUseStep.svelte'
    import { WelcomeFlow } from './Welcome/welcomeFlow.svelte'

    const flow = new WelcomeFlow(navigator.language)
    let card: HTMLElement | undefined = $state()

    // Android Back steps back through the handler stack. On the first step, and while finishing, it is not handled, so
    // it falls through to the app's quit guard.
    onMount(() => registerBackHandler(backCloseHandler({
        isOpen: () => flow.index > 0 && !flow.finishing,
        snapshot: () => flow.index,
        close: () => flow.goBack(),
    })))

    onDestroy(() => flow.dispose())

    // The step heading takes focus when the step changes, so a screen reader announces where the person is.
    let shownStep: FirstRunStep | undefined
    $effect(() => {
        const step = flow.current
        if (shownStep === undefined) {
            shownStep = step
            return
        }
        if (step === shownStep) {
            return
        }
        shownStep = step
        void tick().then(() => {
            card?.querySelector<HTMLElement>('[data-step-heading]')?.focus()
        })
    })
</script>

<div class="w-full h-full flex justify-center text-textcolor bg-bgcolor">
    <div bind:this={card} class="w-2xl max-w-full h-full flex flex-col overflow-x-hidden overflow-y-auto p-5 bg-darkbg">
        <WelcomeStepRail {flow} />
        {#if flow.current === 'welcome'}
            <WelcomeLanguageStep {flow} />
        {:else if flow.current === 'use'}
            <WelcomeUseStep {flow} />
        {:else if flow.current === 'persona'}
            <WelcomePersonaStep {flow} mode="persona" />
        {:else if flow.current === 'nickname'}
            <WelcomePersonaStep {flow} mode="nickname" />
        {:else if flow.current === 'provider'}
            <WelcomeProviderStep {flow} />
        {:else if flow.current === 'chatLanguage'}
            <WelcomeChatLanguageStep {flow} />
        {:else if flow.current === 'memory'}
            <WelcomeMemoryStep {flow} />
        {:else}
            <WelcomeReviewStep {flow} />
        {/if}
        {#if flow.current !== 'welcome'}
            <div class="mt-auto pt-6 flex justify-between gap-2">
                <button
                    type="button"
                    class="min-h-11 px-4 rounded-md border border-darkborderc hover:bg-bgcolor disabled:opacity-50"
                    disabled={flow.finishing}
                    onclick={() => flow.goBack()}
                >{language.onboarding.back}</button>
                <button
                    type="button"
                    class="min-h-11 px-4 rounded-md bg-selected text-textcolor font-bold disabled:opacity-50"
                    disabled={flow.finishing || !flow.canContinue}
                    onclick={() => flow.next()}
                >{flow.current === 'review' ? language.onboarding.finish : language.onboarding.continue}</button>
            </div>
        {/if}
    </div>
</div>
