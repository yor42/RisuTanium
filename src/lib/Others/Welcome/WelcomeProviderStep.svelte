<script lang="ts">
    import { language } from 'src/lang'
    import { createEnterKeyController } from 'src/ts/chatShell/enterKey'
    import { providerTakesKey, standardKeyPrefix, type FirstRunProvider } from 'src/ts/firstRun/firstRunChoices'
    import type { WelcomeFlow } from './welcomeFlow.svelte'

    let { flow }: { flow: WelcomeFlow } = $props()

    interface ProviderOption {
        value: FirstRunProvider
        label: string
        description: string
        recommended: boolean
    }

    const options = $derived<ProviderOption[]>([
        { value: 'claude', label: 'Claude', description: language.setup.claudeDesc, recommended: true },
        { value: 'openai', label: 'OpenAI', description: language.setup.openAIDesc, recommended: true },
        { value: 'gemini', label: 'Gemini', description: language.onboarding.geminiDesc, recommended: true },
        { value: 'openrouter', label: 'OpenRouter', description: language.setup.openRouterProvider, recommended: false },
        { value: 'horde', label: 'Horde', description: language.setup.hordeProvider, recommended: false },
        { value: 'later', label: language.onboarding.setUpLater, description: '', recommended: false },
    ])

    const providerLabel = $derived(options.find((option) => option.value === flow.provider)?.label ?? '')
    const guide = $derived.by(() => {
        switch (flow.provider) {
            case 'claude':
                return language.onboarding.keyGuideClaude
            case 'openai':
                return language.onboarding.keyGuideOpenAI
            case 'gemini':
                return language.onboarding.keyGuideGemini
            case 'openrouter':
                return language.onboarding.keyGuideOpenRouter
            default:
                return ''
        }
    })
    const asksSetUpNow = $derived(flow.provider === 'horde' || flow.provider === 'later')

    const enter = createEnterKeyController()

    function advanceOnEnter(e: KeyboardEvent): void {
        // An Enter that commits an IME composition, or arrives in the tail after it, must not advance the step.
        if (enter.shouldSend(e, 'send')) {
            e.preventDefault()
            flow.next()
        }
    }
</script>

<h2 class="text-2xl font-bold outline-hidden" tabindex="-1" data-step-heading>{language.onboarding.providerTitle}</h2>

<fieldset class="mt-4 border-none p-0 m-0 min-w-0" disabled={flow.finishing}>
    <legend class="sr-only">{language.onboarding.providerTitle}</legend>
    <div class="flex flex-col gap-2">
        {#each options as option (option.value)}
            <label class="flex items-start gap-3 min-h-11 px-3 py-2 rounded-md border border-darkborderc cursor-pointer has-checked:border-selected has-checked:bg-bgcolor">
                <input
                    type="radio"
                    class="mt-1"
                    name="welcome-provider"
                    value={option.value}
                    checked={flow.provider === option.value}
                    onchange={() => flow.chooseProvider(option.value)}
                />
                <span class="flex flex-col">
                    <span class="font-bold">
                        {option.label}
                        {#if option.recommended}
                            <span class="ml-1 text-xs p-1 rounded-sm bg-selected text-textcolor">{language.recommended}</span>
                        {/if}
                    </span>
                    {#if option.description !== ''}
                        <span class="text-sm text-textcolor2">{option.description}</span>
                    {/if}
                </span>
            </label>
        {/each}
    </div>
</fieldset>

{#if flow.provider !== null && providerTakesKey(flow.provider)}
    <div class="mt-4">
        <div class="flex flex-col gap-1">
            <label for="welcome-api-key" class="text-sm text-textcolor2">{language.apiKey}</label>
            <span class="flex gap-2">
                <input
                    id="welcome-api-key"
                    type={flow.showKey ? 'text' : 'password'}
                    class="grow min-w-0 min-h-11 px-3 rounded-md border border-darkborderc bg-transparent text-textcolor"
                    bind:value={flow.apiKey}
                    disabled={flow.finishing}
                    autocomplete="off"
                    spellcheck="false"
                    autocapitalize="off"
                    onkeydown={advanceOnEnter}
                    oncompositionstart={() => enter.compositionStart()}
                    oncompositionend={() => enter.compositionEnd()}
                    onblur={() => enter.compositionEnd()}
                />
                <button
                    type="button"
                    class="min-h-11 min-w-11 px-3 rounded-md border border-darkborderc hover:bg-bgcolor disabled:opacity-50"
                    disabled={flow.finishing}
                    onclick={() => { flow.showKey = !flow.showKey }}
                >{flow.showKey ? language.onboarding.hideKey : language.onboarding.showKey}</button>
            </span>
        </div>
        <!-- Advisory only: a key with another shape, from a proxy or a newer format, still continues. -->
        {#if flow.advisory !== null && flow.advisory.ready && !flow.advisory.standardPrefix}
            <p class="mt-2 text-sm text-textcolor2" role="note" data-key-advisory>{language.onboarding.keyAdvisory(providerLabel, standardKeyPrefix(flow.provider))}</p>
        {/if}
        <p class="mt-3 text-sm"><strong>{language.onboarding.keyCautionTitle}</strong> <span class="text-textcolor2">{language.onboarding.keyCautionBody}</span></p>
        <details class="mt-3">
            <summary class="min-h-11 flex items-center cursor-pointer">{language.onboarding.whereKey}</summary>
            <p class="text-sm text-textcolor2">{guide}</p>
        </details>
    </div>
{/if}

{#if asksSetUpNow}
    <!-- Nothing is preselected: Continue stays disabled until the question is answered. -->
    <fieldset class="mt-4 border-none p-0 m-0 min-w-0" disabled={flow.finishing}>
        <legend class="mb-2">{language.onboarding.setUpNowQuestion}</legend>
        <div class="flex flex-col gap-2">
            <label class="flex items-center gap-3 min-h-11 px-3 rounded-md border border-darkborderc cursor-pointer has-checked:border-selected has-checked:bg-bgcolor">
                <input type="radio" name="welcome-set-up-now" value="yes" checked={flow.setUpNow === true} onchange={() => { flow.setUpNow = true }} />
                <span>{language.onboarding.yes}</span>
            </label>
            <label class="flex items-center gap-3 min-h-11 px-3 rounded-md border border-darkborderc cursor-pointer has-checked:border-selected has-checked:bg-bgcolor">
                <input type="radio" name="welcome-set-up-now" value="no" checked={flow.setUpNow === false} onchange={() => { flow.setUpNow = false }} />
                <span>{language.onboarding.no}</span>
            </label>
        </div>
    </fieldset>
{/if}
