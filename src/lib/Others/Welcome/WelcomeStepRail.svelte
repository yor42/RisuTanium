<script lang="ts">
    import { isMobile } from 'src/ts/platform'
    import NexusStatusMark from '../../Nexus/brand/NexusStatusMark.svelte'
    import type { WelcomeFlow } from './welcomeFlow.svelte'

    let { flow }: { flow: WelcomeFlow } = $props()

    // The rail stays mounted while the person picks a language, so its text follows the flow's language table.
    const text = $derived(flow.strings)
    const names = $derived({
        welcome: text.onboarding.stepWelcome,
        use: text.onboarding.stepUse,
        persona: text.persona,
        nickname: text.nickname,
        provider: text.provider,
        chatLanguage: text.onboarding.stepChatLanguage,
        memory: text.onboarding.stepMemory,
        review: text.onboarding.stepReview,
    })
    const stepText = $derived(text.onboarding.stepOf(flow.index + 1, flow.total, names[flow.current]))
    const big = $derived(flow.current === 'welcome')
</script>

<div class="flex items-center gap-3 mb-4" class:flex-col={big} class:mt-4={big}>
    <NexusStatusMark status={flow.markStatus} size={big ? 104 : 28} lowPower={isMobile} label={stepText} />
    <!-- The mark's status text carries the same words for assistive technology. -->
    <p class="text-sm text-textcolor2" data-step-rail aria-hidden="true">{stepText}</p>
</div>
