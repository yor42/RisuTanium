<script lang="ts">
    import { language } from 'src/lang'
    import type { ChatLanguageChoice } from 'src/ts/firstRun/firstRunChoices'
    import type { WelcomeFlow } from './welcomeFlow.svelte'

    let { flow }: { flow: WelcomeFlow } = $props()

    const options = $derived<{ value: ChatLanguageChoice, label: string, description: string }[]>([
        { value: 'english', label: language.setup.chooseChatTypeOption1, description: language.setup.chooseChatTypeOption1Desc },
        { value: 'englishProcessing', label: language.setup.chooseChatTypeOption2, description: language.setup.chooseChatTypeOption2Desc },
        { value: 'ownLanguage', label: language.setup.chooseChatTypeOption3, description: language.setup.chooseChatTypeOption3Desc },
    ])
</script>

<h2 class="text-2xl font-bold outline-hidden" tabindex="-1" data-step-heading>{language.onboarding.stepChatLanguage}</h2>

<!-- Nothing is preselected: Continue stays disabled until the person chooses. -->
<fieldset class="mt-4 border-none p-0 m-0 min-w-0" disabled={flow.finishing}>
    <legend class="sr-only">{language.onboarding.stepChatLanguage}</legend>
    <div class="flex flex-col gap-2">
        {#each options as option (option.value)}
            <label class="flex items-start gap-3 min-h-11 px-3 py-2 rounded-md border border-darkborderc cursor-pointer has-checked:border-selected has-checked:bg-bgcolor">
                <input
                    type="radio"
                    class="mt-1"
                    name="welcome-chat-language"
                    value={option.value}
                    checked={flow.chatLanguage === option.value}
                    onchange={() => { flow.chatLanguage = option.value }}
                />
                <span class="flex flex-col">
                    <span class="font-bold">{option.label}</span>
                    <span class="text-sm text-textcolor2">{option.description}</span>
                </span>
            </label>
        {/each}
    </div>
</fieldset>
