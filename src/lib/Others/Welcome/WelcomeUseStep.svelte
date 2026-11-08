<script lang="ts">
    import { language } from 'src/lang'
    import type { UseChoice } from 'src/ts/firstRun/firstRunChoices'
    import type { WelcomeFlow } from './welcomeFlow.svelte'

    let { flow }: { flow: WelcomeFlow } = $props()

    const options = $derived<{ value: UseChoice, label: string }[]>([
        { value: 'stories', label: language.onboarding.useStories },
        { value: 'both', label: language.onboarding.useBoth },
        { value: 'tools', label: language.onboarding.useTools },
    ])
</script>

<h2 class="text-2xl font-bold outline-hidden" tabindex="-1" data-step-heading>{language.onboarding.useTitle}</h2>

<!-- Nothing is preselected: Continue stays disabled until the person chooses. -->
<fieldset class="mt-4 border-none p-0 m-0 min-w-0" disabled={flow.finishing}>
    <legend class="sr-only">{language.onboarding.useTitle}</legend>
    <div class="flex flex-col gap-2">
        {#each options as option (option.value)}
            <label class="flex items-center gap-3 min-h-11 px-3 rounded-md border border-darkborderc cursor-pointer has-checked:border-selected has-checked:bg-bgcolor">
                <input
                    type="radio"
                    name="welcome-use"
                    value={option.value}
                    checked={flow.use === option.value}
                    onchange={() => flow.chooseUse(option.value)}
                />
                <span>{option.label}</span>
            </label>
        {/each}
    </div>
</fieldset>
