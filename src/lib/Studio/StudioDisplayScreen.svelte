<script lang="ts">
    import type { Snippet } from 'svelte'
    import { language } from '../../lang'
    import { modeDefaultOf, NEW_GEN_PATHS, type NewGenPath, type ScreenMode } from '../../ts/studio/edit/screenModeFill'
    import type { OwnerHistoryService, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import type { OwnerKey } from '../../ts/studio/history/ownerPhase'
    import type { LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import type { character } from '../../ts/storage/database.svelte'
    import LongTextField from './LongTextField.svelte'
    import StudioEmotionList from './assets/StudioEmotionList.svelte'

    // The 화면 panel of the Display form: the view-screen mode and what each mode shows, as classic's panel gates them. A
    // mode or inlay switch is one history step that also fills the mode's default wording (see screenModeFill.ts). The
    // fill's tag and reset are in memory only: the parent keeps the paths the last switch filled and the pair they were
    // filled for.
    export interface ScreenFill {
        paths: readonly NewGenPath[]
        viewScreen: ScreenMode
        inlay: boolean
    }

    interface Props {
        chaId: string
        owner: OwnerKey
        service: OwnerHistoryService | null
        live: character
        editable: boolean
        fill: ScreenFill | null
        onfill: (next: ScreenFill | null) => void
        noted: (result: StudioResult | null) => boolean
        onresult: (result: StudioResult | null) => void
    }

    let { chaId, owner, service, live, editable, fill, onfill, noted, onresult }: Props = $props()

    const idBase = $props.id()
    const mode = $derived<ScreenMode>(live.viewScreen === 'emotion' || live.viewScreen === 'imggen' ? live.viewScreen : 'none')
    const inlay = $derived(live.inlayViewScreen === true)

    function keyOf(path: NewGenPath): 'prompt' | 'negative' | 'instructions' | 'emotionInstructions' {
        return path === 'newGenData.prompt' ? 'prompt' : path === 'newGenData.negative' ? 'negative' : path === 'newGenData.instructions' ? 'instructions' : 'emotionInstructions'
    }
    function textOf(path: NewGenPath): string {
        const value = live.newGenData?.[keyOf(path)]
        return typeof value === 'string' ? value : ''
    }

    // The fill is shown only while the live pair is the one it was made for: a history undo that moved the pair away hides it.
    const fillShown = $derived(fill !== null && fill.paths.length > 0 && fill.viewScreen === mode && fill.inlay === inlay)
    function filled(path: NewGenPath): boolean {
        return fill !== null && fillShown && fill.paths.includes(path)
    }
    function isDefault(path: NewGenPath): boolean {
        return filled(path) && fill !== null && textOf(path) === modeDefaultOf(path, fill.viewScreen, fill.inlay)
    }
    const hiddenFill = $derived(fillShown && fill !== null && fill.paths.includes('newGenData.emotionInstructions') && !inlay && mode === 'emotion')

    // One switch, one step; the keys the step changed are what the tag and reset follow.
    function applyChange(change: { viewScreen: ScreenMode } | { inlay: boolean }): boolean {
        if (!service || !editable) return false
        const before = NEW_GEN_PATHS.map((path) => textOf(path))
        const result = service.screenMode(owner, change)
        if (!noted(result)) return false
        if (result.ok && result.unchanged !== true) {
            const changed = NEW_GEN_PATHS.filter((path, index) => textOf(path) !== before[index])
            const nextMode: ScreenMode = 'viewScreen' in change ? change.viewScreen : mode
            const nextInlay = 'inlay' in change ? change.inlay : inlay
            onfill(changed.length > 0 ? { paths: changed, viewScreen: nextMode, inlay: nextInlay } : null)
        }
        service.closeOpenStep(owner)
        return true
    }

    function onModeChange(event: Event & { currentTarget: HTMLSelectElement }): void {
        const select = event.currentTarget
        const value = select.value
        const next: ScreenMode = value === 'emotion' || value === 'imggen' ? value : 'none'
        if (!applyChange({ viewScreen: next })) select.value = mode
    }

    function onInlayChange(event: Event & { currentTarget: HTMLInputElement }): void {
        const box = event.currentTarget
        if (!applyChange({ inlay: box.checked })) box.checked = inlay
    }

    function portOf(path: NewGenPath): LongTextWritePort {
        return {
            read: () => textOf(path),
            write: (value) => (service && editable ? service.editText(owner, path, value, 'typing') : null),
            closeStep: () => service?.closeOpenStep(owner),
        }
    }
    const ports: Partial<Record<NewGenPath, LongTextWritePort>> = {}
    function port(path: NewGenPath): LongTextWritePort {
        return (ports[path] ??= portOf(path))
    }

    function reset(path: NewGenPath): void {
        if (!service || !editable || fill === null) return
        if (noted(service.editText(owner, path, modeDefaultOf(path, fill.viewScreen, fill.inlay), 'single'))) service.closeOpenStep(owner)
    }

    const fieldClass = 'min-h-20 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor'
    const inputClass = 'min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor'
    const rowClass = 'flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-md border border-darkborderc p-2'
</script>

{#snippet textField(path: NewGenPath, label: string, body: Snippet)}
    <div data-part="studio-display-field" data-path={path} data-default={isDefault(path) ? '' : undefined} class="flex flex-col gap-1">
        <div class="flex flex-wrap items-center gap-2">
            <span class="font-bold">{label}</span>
            {#if isDefault(path)}
                <span data-part="studio-default-tag" class="rounded border border-darkborderc px-1 text-xs text-textcolor2">{language.studioDefaultTag}</span>
            {/if}
            {#if filled(path)}
                <button type="button" data-part="studio-default-reset" data-path={path} disabled={!editable} class="min-h-11 rounded-md border border-darkborderc px-3 text-sm hover:bg-selected cursor-pointer" onclick={() => reset(path)}>{language.studioDefaultReset}</button>
            {/if}
        </div>
        {@render body()}
    </div>
{/snippet}

<!-- One snippet per text field: each part name is a literal, which the theme-pack part reader requires. -->
{#snippet promptBody()}
    <LongTextField port={port('newGenData.prompt')} part="studio-display-gen-prompt" ariaLabel={language.imgGenPrompt} kind="advanced" mode="plain" ownerLabel={live.name} {editable} busy={!editable} {fieldClass} {onresult} />
{/snippet}
{#snippet negativeBody()}
    <LongTextField port={port('newGenData.negative')} part="studio-display-gen-negative" ariaLabel={language.imgGenNegatives} kind="advanced" mode="plain" ownerLabel={live.name} {editable} busy={!editable} {fieldClass} {onresult} />
{/snippet}
{#snippet instructionsBody()}
    <LongTextField port={port('newGenData.instructions')} part="studio-display-gen-instructions" ariaLabel={language.imgGenInstructions} kind="advanced" mode="plain" ownerLabel={live.name} {editable} busy={!editable} {fieldClass} {onresult} />
{/snippet}
{#snippet emotionInstructionsBody()}
    <LongTextField port={port('newGenData.emotionInstructions')} part="studio-display-emotion-instructions" ariaLabel={language.emotionInstructions} kind="advanced" mode="plain" ownerLabel={live.name} {editable} busy={!editable} {fieldClass} {onresult} />
{/snippet}
{#snippet inlaySwitch()}
    <label class={rowClass}>
        <span class="min-w-0 flex-1 font-bold">{language.inlayViewScreen}</span>
        <input
            type="checkbox"
            role="switch"
            data-part="studio-display-inlay"
            aria-label={language.inlayViewScreen}
            disabled={!editable}
            aria-busy={editable ? undefined : 'true'}
            checked={inlay}
            onchange={onInlayChange}
        />
    </label>
{/snippet}

<div data-part="studio-display-screen" class="flex flex-col gap-3">
    <div class="flex flex-col gap-1">
        <label id="{idBase}-mode-label" for="{idBase}-mode" class="font-bold">{language.viewScreen}</label>
        <select
            id="{idBase}-mode"
            aria-labelledby="{idBase}-mode-label"
            aria-describedby="{idBase}-mode-label"
            data-part="studio-display-view-screen"
            class={inputClass}
            disabled={!editable}
            aria-busy={editable ? undefined : 'true'}
            value={mode}
            onchange={onModeChange}
        >
            <option value="none" selected={mode === 'none'}>{language.none}</option>
            <option value="emotion" selected={mode === 'emotion'}>{language.emotionImage}</option>
            <option value="imggen" selected={mode === 'imggen'}>{language.imageGeneration}</option>
        </select>
        {#if fillShown}
            <p data-part="studio-screen-filled" class="text-sm text-textcolor2">{language.studioScreenFilled}</p>
        {/if}
        {#if hiddenFill}
            <p role="status" data-part="studio-screen-fill-hidden" class="text-sm text-textcolor2">{language.studioScreenFillHidden}</p>
        {/if}
    </div>
    {#if mode === 'emotion'}
        <div class="flex flex-col gap-1">
            <h3 class="font-bold">{language.emotionImage}</h3>
            <p class="text-sm text-textcolor2">{language.emotionWarn}</p>
        </div>
        <StudioEmotionList {chaId} />
        {#if inlay}
            {@render textField('newGenData.emotionInstructions', language.emotionInstructions, emotionInstructionsBody)}
        {/if}
        {@render inlaySwitch()}
    {:else if mode === 'imggen'}
        <div class="flex flex-col gap-1">
            <h3 class="font-bold">{language.imageGeneration}</h3>
            <p class="text-sm text-textcolor2">{language.emotionWarn}</p>
        </div>
        {@render textField('newGenData.prompt', language.imgGenPrompt, promptBody)}
        {@render textField('newGenData.negative', language.imgGenNegatives, negativeBody)}
        {@render textField('newGenData.instructions', language.imgGenInstructions, instructionsBody)}
        {@render inlaySwitch()}
    {/if}
</div>
