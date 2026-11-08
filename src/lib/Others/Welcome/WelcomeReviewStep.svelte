<script lang="ts">
    import { language } from 'src/lang'
    import { MEMORY_SIZES, type FirstRunProvider, type FirstRunStep } from 'src/ts/firstRun/firstRunChoices'
    import { LANGUAGE_NAMES, type WelcomeFlow } from './welcomeFlow.svelte'

    let { flow }: { flow: WelcomeFlow } = $props()

    interface ReviewRow {
        step: FirstRunStep
        label: string
        value: string
        detail?: string
    }

    const providerNames: Record<FirstRunProvider, string> = {
        claude: 'Claude',
        openai: 'OpenAI',
        gemini: 'Gemini',
        openrouter: 'OpenRouter',
        horde: 'Horde',
        later: '',
    }

    const useLabels = $derived({
        stories: language.onboarding.useStories,
        both: language.onboarding.useBoth,
        tools: language.onboarding.useTools,
    })
    const memoryLabels = $derived({
        cheap: language.setup.chooseCheapOrMemoryOption2,
        balanced: language.setup.chooseCheapOrMemoryOption3,
        memory: language.setup.chooseCheapOrMemoryOption1,
        unlimited: language.setup.chooseCheapOrMemoryOption4,
    })
    const chatLanguageLabels = $derived({
        english: language.setup.chooseChatTypeOption1,
        englishProcessing: language.setup.chooseChatTypeOption2,
        ownLanguage: language.setup.chooseChatTypeOption3,
        unchanged: language.onboarding.notSet,
    })

    // The typed key is never written out here: the row only says a key is set, and always shows the same mask.
    const KEY_MASK = '••••••••'

    const rows = $derived.by(() => {
        const list: ReviewRow[] = []
        for (const step of flow.steps) {
            switch (step) {
                case 'welcome':
                    list.push({ step, label: language.language, value: LANGUAGE_NAMES[flow.appLanguage] })
                    break
                case 'use':
                    list.push({
                        step,
                        label: language.onboarding.stepUse,
                        value: flow.use === null ? language.onboarding.notSet : useLabels[flow.use],
                        detail: flow.hidesUnused ? language.onboarding.hideUnusedReview : undefined,
                    })
                    break
                case 'persona': {
                    const name = flow.name.trim()
                    list.push({ step, label: language.persona, value: name === '' ? language.onboarding.notSet : name, detail: flow.description.trim() })
                    break
                }
                case 'nickname':
                    list.push({ step, label: language.nickname, value: flow.greetingName === '' ? language.onboarding.notSet : flow.greetingName })
                    break
                case 'provider': {
                    const provider = flow.provider
                    list.push({ step, label: language.provider, value: provider === null || provider === 'later' ? language.onboarding.setUpLater : providerNames[provider] })
                    if (flow.advisory !== null) {
                        list.push({ step, label: language.apiKey, value: KEY_MASK })
                    }
                    break
                }
                case 'chatLanguage':
                    list.push({ step, label: language.onboarding.stepChatLanguage, value: chatLanguageLabels[flow.chatLanguage ?? 'unchanged'] })
                    break
                case 'memory':
                    list.push({
                        step,
                        label: language.onboarding.stepMemory,
                        value: memoryLabels[flow.memory],
                        detail: language.onboarding.tokenSizes(MEMORY_SIZES[flow.memory].maxContext, MEMORY_SIZES[flow.memory].maxResponse),
                    })
                    break
                case 'review':
                    break
            }
        }
        return list
    })

    const heading = $derived.by(() => {
        const name = flow.greetingName
        if (flow.finishing) {
            return name === '' ? language.onboarding.allSet : language.onboarding.allSetNamed(name)
        }
        return name === '' ? language.onboarding.ready : language.onboarding.readyNamed(name)
    })
</script>

<h2 class="text-2xl font-bold outline-hidden" tabindex="-1" data-step-heading>{heading}</h2>

<dl class="mt-4 flex flex-col gap-3">
    {#each rows as row, i (i)}
        <div class="flex items-start gap-3 min-h-11">
            <div class="grow min-w-0">
                <dt class="text-sm text-textcolor2">{row.label}</dt>
                <dd class="m-0 break-words">{row.value}</dd>
                {#if row.detail}
                    <dd class="m-0 text-sm text-textcolor2 break-words">{row.detail}</dd>
                {/if}
            </div>
            <button
                type="button"
                class="min-h-11 min-w-11 px-3 rounded-md text-textcolor2 hover:text-textcolor disabled:opacity-50"
                disabled={flow.finishing}
                aria-label={`${language.onboarding.change}: ${row.label}`}
                onclick={() => flow.goToStep(row.step)}
            >{language.onboarding.change}</button>
        </div>
    {/each}
</dl>
