<script lang="ts">
    import { language } from 'src/lang'
    import { MEMORY_SIZES, type MemoryChoice } from 'src/ts/firstRun/firstRunChoices'
    import type { WelcomeFlow } from './welcomeFlow.svelte'

    let { flow }: { flow: WelcomeFlow } = $props()

    const options = $derived<{ value: MemoryChoice, label: string, description: string }[]>([
        { value: 'cheap', label: language.setup.chooseCheapOrMemoryOption2, description: language.setup.chooseCheapOrMemoryOption2Desc },
        { value: 'balanced', label: language.setup.chooseCheapOrMemoryOption3, description: language.setup.chooseCheapOrMemoryOption3Desc },
        { value: 'memory', label: language.setup.chooseCheapOrMemoryOption1, description: language.setup.chooseCheapOrMemoryOption1Desc },
        { value: 'unlimited', label: language.setup.chooseCheapOrMemoryOption4, description: language.setup.chooseCheapOrMemoryOption4Desc },
    ])
</script>

<h2 class="text-2xl font-bold outline-hidden" tabindex="-1" data-step-heading>{language.onboarding.stepMemory}</h2>

<!-- Balanced is preselected, as the recommended choice. -->
<fieldset class="mt-4 border-none p-0 m-0 min-w-0" disabled={flow.finishing}>
    <legend class="sr-only">{language.onboarding.stepMemory}</legend>
    <div class="flex flex-col gap-2">
        {#each options as option (option.value)}
            <label class="flex items-start gap-3 min-h-11 px-3 py-2 rounded-md border border-darkborderc cursor-pointer has-checked:border-selected has-checked:bg-bgcolor">
                <input
                    type="radio"
                    class="mt-1"
                    name="welcome-memory"
                    value={option.value}
                    checked={flow.memory === option.value}
                    onchange={() => { flow.memory = option.value }}
                />
                <span class="flex flex-col">
                    <span class="font-bold">
                        {option.label}
                        {#if option.value === 'balanced'}
                            <span class="ml-1 text-xs p-1 rounded-sm bg-selected text-textcolor">{language.recommended}</span>
                        {/if}
                    </span>
                    <span class="text-sm text-textcolor2">{option.description}</span>
                    <span class="text-xs text-textcolor2">{language.onboarding.tokenSizes(MEMORY_SIZES[option.value].maxContext, MEMORY_SIZES[option.value].maxResponse)}</span>
                </span>
            </label>
        {/each}
    </div>
</fieldset>
