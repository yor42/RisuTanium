<script lang="ts">
    import { onDestroy, onMount } from 'svelte'
    import { language } from '../../../lang'
    import { afterFlush } from '../../../ts/afterFlush'
    import { backCloseHandler, registerBackHandler } from '../../../ts/backHandlers'
    import { createEnterKeyController } from '../../../ts/chatShell/enterKey'
    import { selectUserImg } from '../../../ts/persona'
    import { editPersona } from '../../../ts/personaList'
    import { composePersonaText, EMPTY_ANSWERS, recomposeDecision, type PersonaBuilderAnswers } from '../../../ts/settingsShell/personaBuilder'
    import { DBState } from '../../../ts/stores.svelte'
    import PatternWarning from '../../Nexus/pattern/PatternWarning.svelte'
    import type { PatternAnswer, PatternWarningDef } from '../../Nexus/pattern/patternWarning'
    import PersonaBuilderAbout from './PersonaBuilderAbout.svelte'
    import PersonaBuilderFinish from './PersonaBuilderFinish.svelte'
    import PersonaBuilderWho from './PersonaBuilderWho.svelte'

    interface Props {
        /** The persona the builder writes live; the page creates it when the builder opens. */
        id: string
        /** "Create" was pressed: the page opens the persona in the editor. */
        onfinish: () => void
        /** Back on step 1 or "Cancel": the page decides whether the persona is removed or kept. */
        oncancel: () => void
    }

    let { id, onfinish, oncancel }: Props = $props()

    const uid = $props.id()
    const STEPS = 3
    // Only the Enter after the IME composition has ended advances; the composing keydown is left to the IME.
    const enter = createEnterKeyController()

    let step = $state(1)
    let answers = $state<PersonaBuilderAnswers>({ ...EMPTY_ANSWERS })
    /** The last composed text the person was offered; a step 3 text that still equals it was never hand-edited. */
    let composedBase = $state<string | null>(null)
    let pendingText = $state<string | null>(null)
    let rootEl = $state<HTMLElement>()
    let headingEl = $state<HTMLElement>()

    const persona = $derived(DBState.db.personas.find((entry) => entry.id === id))
    const titles = $derived([language.settingsShellPersonaBuilderStep1, language.settingsShellPersonaBuilderStep2, language.settingsShellPersonaBuilderStep3])

    onMount(() => { void focusHeading() })
    // A page switch or Settings closing unmounts the builder without any exit action.
    onDestroy(flush)

    $effect(() => {
        if (pendingText === null) return
        return registerBackHandler(backCloseHandler({
            isOpen: () => pendingText !== null,
            snapshot: () => String(pendingText !== null),
            close: () => { pendingText = null },
        }))
    })

    async function focusHeading(): Promise<void> {
        await afterFlush()
        headingEl?.focus()
    }

    function edit(field: 'name' | 'personaPrompt', value: string): void {
        editPersona(DBState.db, id, field, value)
    }

    function goTo(target: number): void {
        step = target
        void focusHeading()
    }

    function composeNow(): string {
        return composePersonaText(answers, {
            appearance: language.settingsShellPersonaBuilderAppearance,
            personality: language.settingsShellPersonaBuilderPersonality,
            background: language.settingsShellPersonaBuilderBackground,
        })
    }

    function next(): void {
        if (step === 2) {
            const composed = composeNow()
            const decision = recomposeDecision(composed, composedBase, persona?.personaPrompt ?? '')
            if (decision === 'ask') {
                pendingText = composed
                return
            }
            if (decision === 'write') edit('personaPrompt', composed)
            composedBase = composed
        }
        if (step < STEPS) goTo(step + 1)
    }

    /** Whether step 2 holds text that is not yet in the persona. */
    export function hasInput(): boolean {
        return Object.values(answers).some((value) => value.trim() !== '')
    }

    /** Keeps typed step 2 answers when the builder is left before step 3 was reached: they go into the description only while it is still empty. */
    export function flush(): void {
        if (composedBase !== null) return
        const composed = composeNow()
        if (composed !== '' && (persona?.personaPrompt ?? '') === '') edit('personaPrompt', composed)
    }

    /** One step back; on step 1 the builder is left. Also called by the Settings Back. */
    export function back(): void {
        if (pendingText !== null) {
            pendingText = null
            return
        }
        if (step > 1) goTo(step - 1)
        else oncancel()
    }

    function answerReplace(answer: PatternAnswer): void {
        const composed = pendingText
        pendingText = null
        if (composed === null) return
        if (answer === 'confirm') edit('personaPrompt', composed)
        composedBase = composed
        goTo(3)
    }

    function replaceDef(): PatternWarningDef {
        return {
            severity: 'confirm',
            headline: language.settingsShellPersonaBuilderReplaceTitle,
            consequences: [],
            actions: { cancel: language.settingsShellPersonaBuilderKeepText, primary: language.settingsShellPersonaBuilderReplace },
        }
    }

    function onNameKeydown(event: KeyboardEvent): void {
        if (enter.shouldSend(event, 'send')) {
            event.preventDefault()
            next()
        }
    }

    // The field stays above the soft keyboard once the viewport has resized.
    function keepVisible(event: FocusEvent): void {
        const target = event.target
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return
        setTimeout(() => { target.scrollIntoView?.({ block: 'center' }) }, 300)
    }
</script>

<div class="flex flex-col gap-3 min-w-0" bind:this={rootEl} data-persona-builder onfocusin={keepVisible}>
    <p class="text-sm text-(--settings-text-2)" data-persona-builder-progress>{language.settingsShellPersonaBuilderProgress(step, STEPS, titles[step - 1])}</p>
    <h2 class="text-xl font-bold outline-hidden" tabindex="-1" bind:this={headingEl} data-step-heading>{titles[step - 1]}</h2>

    {#if persona}
        {#if step === 1}
            <PersonaBuilderWho {uid} name={persona.name} icon={persona.icon} onname={(value) => edit('name', value)} onpicture={() => { void selectUserImg(id) }} onkeydown={onNameKeydown} />
        {:else if step === 2}
            <PersonaBuilderAbout {uid} bind:answers />
        {:else}
            <PersonaBuilderFinish {uid} text={persona.personaPrompt ?? ''} ontext={(value) => edit('personaPrompt', value)} />
        {/if}
    {/if}

    <div class="sticky bottom-0 flex flex-wrap items-center gap-2 py-2 bg-(--settings-canvas) border-t border-(--settings-border-subtle)" data-persona-builder-footer>
        <button type="button" class="min-h-11 px-4 rounded-md bg-(--settings-raised) text-(--settings-text) hover:bg-(--settings-hover)" onclick={back}>{language.settingsShellPersonaBuilderPrev}</button>
        <button type="button" class="min-h-11 px-4 rounded-md text-(--settings-text-2) hover:text-(--settings-text)" onclick={oncancel}>{language.cancel}</button>
        {#if step < STEPS}
            <button type="button" class="min-h-11 px-4 ml-auto rounded-md bg-(--settings-raised) text-(--settings-text) hover:bg-(--settings-hover)" onclick={next}>{language.settingsShellPersonaBuilderNext}</button>
        {:else}
            <button type="button" class="min-h-11 px-4 ml-auto rounded-md bg-(--settings-selected) text-(--settings-on-selected)" onclick={onfinish}>{language.settingsShellPersonaBuilderCreate}</button>
        {/if}
    </div>
</div>

{#if pendingText !== null}
    <PatternWarning def={replaceDef()} background={rootEl ? [rootEl] : []} onanswer={answerReplace} />
{/if}
