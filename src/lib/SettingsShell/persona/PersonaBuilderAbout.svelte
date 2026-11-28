<script lang="ts">
    import { language } from '../../../lang'
    import type { PersonaBuilderAnswers } from '../../../ts/settingsShell/personaBuilder'

    interface Props {
        uid: string
        answers: PersonaBuilderAnswers
    }

    let { uid, answers = $bindable() }: Props = $props()

    const fields: Array<{ key: keyof PersonaBuilderAnswers, label: string, help: string, example: string }> = [
        { key: 'appearance', label: language.settingsShellPersonaBuilderAppearance, help: language.settingsShellPersonaBuilderAppearanceHelp, example: language.settingsShellPersonaBuilderAppearanceExample },
        { key: 'personality', label: language.settingsShellPersonaBuilderPersonality, help: language.settingsShellPersonaBuilderPersonalityHelp, example: language.settingsShellPersonaBuilderPersonalityExample },
        { key: 'background', label: language.settingsShellPersonaBuilderBackground, help: language.settingsShellPersonaBuilderBackgroundHelp, example: language.settingsShellPersonaBuilderBackgroundExample },
        { key: 'other', label: language.settingsShellPersonaBuilderOther, help: language.settingsShellPersonaBuilderOtherHelp, example: language.settingsShellPersonaBuilderOtherExample },
    ]
</script>

<div class="flex flex-col gap-3" data-persona-builder-step="about">
    {#each fields as field (field.key)}
        <div class="flex flex-col gap-1">
            <label class="text-sm text-(--settings-text-2)" for="{uid}-{field.key}">{field.label}</label>
            <textarea id="{uid}-{field.key}" rows="3" autocomplete="off" aria-describedby="{uid}-{field.key}-help" placeholder={field.example} class="w-full min-h-20 px-3 py-2 rounded-md border border-(--settings-border-subtle) bg-transparent text-(--settings-text) focus:border-(--settings-border-strong) focus:outline-hidden risu-focus-ring" bind:value={answers[field.key]}></textarea>
            <span id="{uid}-{field.key}-help" class="text-xs text-(--settings-text-2)">{field.help}</span>
        </div>
    {/each}
</div>
