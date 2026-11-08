<script lang="ts">
    import { FIRST_RUN_LANGUAGES } from 'src/ts/firstRun/firstRunChoices'
    import { LANGUAGE_NAMES, type WelcomeFlow } from './welcomeFlow.svelte'

    let { flow }: { flow: WelcomeFlow } = $props()

    // This step stays mounted while the person picks a language, so its text follows the flow's language table.
    const text = $derived(flow.strings)
</script>

<h2 class="text-2xl font-bold text-center outline-hidden" tabindex="-1" data-step-heading>{text.onboarding.welcomeTitle}</h2>
<p class="text-textcolor2 text-center mt-2">{text.onboarding.welcomeLead}</p>

<fieldset class="mt-6 border-none p-0 m-0 min-w-0" disabled={flow.welcomeLocked}>
    <legend class="text-sm text-textcolor2 mb-2">{text.language}</legend>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {#each FIRST_RUN_LANGUAGES as code (code)}
            <label class="flex items-center gap-3 min-h-11 px-3 rounded-md border border-darkborderc cursor-pointer has-checked:border-selected has-checked:bg-bgcolor">
                <input
                    type="radio"
                    name="welcome-language"
                    value={code}
                    checked={flow.appLanguage === code}
                    onchange={() => flow.pickLanguage(code)}
                />
                <span class="grow">{LANGUAGE_NAMES[code]}</span>
                {#if flow.detected.supported && flow.detected.shown === code}
                    <span class="text-xs text-textcolor2">{text.onboarding.browserLanguage}</span>
                {/if}
            </label>
        {/each}
    </div>
</fieldset>

<div class="mt-6 flex flex-col gap-2">
    <button
        type="button"
        class="min-h-11 px-4 rounded-md bg-selected text-textcolor font-bold disabled:opacity-50"
        disabled={flow.welcomeLocked}
        onclick={() => flow.startSetup()}
    >{text.onboarding.startSetup}</button>
    <button
        type="button"
        class="min-h-11 px-4 rounded-md border border-darkborderc hover:bg-bgcolor disabled:opacity-50"
        disabled={flow.welcomeLocked}
        onclick={() => flow.restore()}
    >{text.onboarding.restoreBackup}</button>
    <button
        type="button"
        class="min-h-11 px-4 rounded-md text-textcolor2 hover:text-textcolor disabled:opacity-50"
        disabled={flow.welcomeLocked}
        onclick={() => flow.skipSetup()}
    >{text.onboarding.skipSetup}</button>
</div>
