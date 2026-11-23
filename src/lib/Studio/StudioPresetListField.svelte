<script lang="ts">
    import { ChevronDownIcon, ChevronUpIcon } from '@lucide/svelte'
    import { onDestroy } from 'svelte'
    import { language } from '../../lang'
    import { addEntry, editEntry, moveEntry, removeEntry, withSearchTool, SEARCH_TOOL } from '../../ts/studio/edit/presetLists'
    import { PRESET_FIELDS, presetValueAllowed, type PresetPath } from '../../ts/studio/edit/presetFields'
    import { readPresetField } from '../../ts/studio/edit/presetTarget'
    import { refusalTextOf } from '../../ts/studio/edit/studioToasts'
    import { isTextList } from '../../ts/studio/history/fieldAccess'
    import type { OwnerHistoryService, StudioRefusal, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import type { OwnerKey } from '../../ts/studio/history/ownerPhase'
    import { createCompositionGate } from '../../ts/studio/toggleBuilderModel'
    import ModelList from '../UI/ModelList.svelte'

    // One text list of a preset, as whole-list steps of the preset owner: the fallback model lists (a picker per row), the
    // custom stop strings (a text row each, with an on and off switch), the model tools (one "Search" switch that keeps
    // every other entry) and the format order (move only). The list is read through the adapter on every render and each
    // operation hands the service the whole new list, so one operation is one undoable step.
    interface Props {
        presetId: string
        owner: OwnerKey
        path: PresetPath
        variant: 'models' | 'stops' | 'tools' | 'order'
        service: OwnerHistoryService | null
        editable: boolean
        // The preset is the active one: a "not set" note describes a switch, which the active preset has none of.
        active: boolean
    }

    let { presetId, owner, path, variant, service, editable, active }: Props = $props()

    const NAMES: Readonly<Record<string, string>> = language.formating
    const BUTTON_CLASS = 'min-h-11 min-w-11 rounded-md border border-darkborderc bg-darkbg px-3 text-textcolor hover:bg-selected disabled:opacity-50 cursor-pointer'
    const LINE_CLASS = 'min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor'

    const read = $derived(readPresetField(presetId, path))
    // The list, or null while the preset holds none (not set).
    const list = $derived(read.had === true && isTextList(read.value) ? read.value : null)
    const shown = $derived(list ?? [])
    const locked = $derived(!service || !editable)
    const notSetNote = $derived(!active && PRESET_FIELDS[path].absent === 'keeps' && !read.had)
    const idBase = $props.id()

    let refusal = $state<StudioRefusal | null>(null)
    function noted(result: StudioResult): boolean {
        refusal = result.ok === false ? result.reason : null
        return result.ok
    }

    // One whole-list write. `coalesceKey` joins typing in one entry; null makes a step of its own.
    function write(next: string[], coalesceKey: string | null): boolean {
        if (!service || !editable || !presetValueAllowed(path, next, shown)) return false
        const done = noted(service.editField(owner, path, next, { coalesceKey }))
        if (done && coalesceKey === null) service.closeOpenStep(owner)
        return done
    }

    function onModelPick(index: number, model: string): void {
        write(editEntry(shown, index, model), null)
    }

    // Stop strings: off is "not set" (the stored value becomes null), on is an empty list.
    function onStopsToggle(event: Event & { currentTarget: HTMLInputElement }): void {
        const input = event.currentTarget
        if (!service || !editable) {
            input.checked = list !== null
            return
        }
        const result = input.checked ? service.editField(owner, path, [], { coalesceKey: null }) : service.clearField(owner, path)
        if (noted(result)) service.closeOpenStep(owner)
        else input.checked = list !== null
    }

    const inputs = new Map<number, HTMLInputElement>()
    function commitStop(index: number, value: string): void {
        if (!write(editEntry(shown, index, value), `${path}:${index}`)) {
            const element = inputs.get(index)
            if (element) element.value = shown[index] ?? ''
        }
    }
    const gates = new Map<number, ReturnType<typeof createCompositionGate>>()
    function gateOf(index: number): ReturnType<typeof createCompositionGate> {
        let gate = gates.get(index)
        if (!gate) {
            gate = createCompositionGate((value) => commitStop(index, value))
            gates.set(index, gate)
        }
        return gate
    }
    function onStopInput(index: number, event: Event & { currentTarget: HTMLInputElement }): void {
        inputs.set(index, event.currentTarget)
        gateOf(index).input(event.currentTarget.value, event instanceof InputEvent && event.isComposing)
    }
    function onStopBlur(index: number): void {
        gateOf(index).flush()
        service?.closeOpenStep(owner)
    }
    onDestroy(() => {
        for (const gate of gates.values()) gate.flush()
        service?.closeOpenStep(owner)
    })

    function onSearchToggle(event: Event & { currentTarget: HTMLInputElement }): void {
        const input = event.currentTarget
        if (!write(withSearchTool(shown, input.checked), null)) input.checked = shown.includes(SEARCH_TOOL)
    }
</script>

{#snippet rowButtons(index: number, removable: boolean)}
    <div class="flex gap-1">
        <button type="button" data-part="studio-preset-list-up" class={BUTTON_CLASS} disabled={locked || index === 0} aria-label={language.chatShellMoveUp} onclick={() => write(moveEntry(shown, index, -1), null)}>
            <ChevronUpIcon size={16} aria-hidden="true" />
        </button>
        <button type="button" data-part="studio-preset-list-down" class={BUTTON_CLASS} disabled={locked || index === shown.length - 1} aria-label={language.chatShellMoveDown} onclick={() => write(moveEntry(shown, index, 1), null)}>
            <ChevronDownIcon size={16} aria-hidden="true" />
        </button>
        {#if removable}
            <button type="button" data-part="studio-preset-list-remove" class={BUTTON_CLASS} disabled={locked} aria-label={language.remove} onclick={() => write(removeEntry(shown, index), null)}>{language.remove}</button>
        {/if}
    </div>
{/snippet}

<div data-path={path} aria-busy={locked ? 'true' : undefined} class="flex flex-col gap-2">
    {#if variant === 'models'}
        {#each shown as model, index (index)}
            <div data-part="studio-preset-list-row" class="flex flex-col gap-1 rounded-md border border-darkborderc p-2">
                <span class="text-sm">{language.model} {index + 1}</span>
                <ModelList bind:value={() => model, () => {}} onChange={(picked) => onModelPick(index, picked)} blankable />
                {@render rowButtons(index, true)}
            </div>
        {/each}
        <button type="button" data-part="studio-preset-list-add" class="{BUTTON_CLASS} self-start" disabled={locked} aria-label={language.add} onclick={() => write(addEntry(shown), null)}>{language.add}</button>
    {:else if variant === 'stops'}
        <label class="flex min-h-11 items-center gap-2">
            <input type="checkbox" data-part="studio-preset-stops-toggle" disabled={locked} checked={list !== null} onchange={onStopsToggle} />
            <span>{language.customStopWords}</span>
        </label>
        {#if list !== null}
            {#each list as stop, index (index)}
                <div data-part="studio-preset-list-row" class="flex flex-col gap-1 rounded-md border border-darkborderc p-2">
                    <label for="{idBase}-stop-{index}" class="text-sm">{language.customStopWords}</label>
                    <input
                        id="{idBase}-stop-{index}"
                        type="text"
                        data-part="studio-preset-stop-entry"
                        class={LINE_CLASS}
                        readonly={locked}
                        value={stop}
                        oninput={(event) => onStopInput(index, event)}
                        oncompositionstart={() => gateOf(index).start()}
                        oncompositionend={(event) => { inputs.set(index, event.currentTarget); gateOf(index).end(event.currentTarget.value) }}
                        onblur={() => onStopBlur(index)}
                    />
                    {@render rowButtons(index, true)}
                </div>
            {/each}
            <button type="button" data-part="studio-preset-list-add" class="{BUTTON_CLASS} self-start" disabled={locked} aria-label={language.add} onclick={() => write(addEntry(shown), null)}>{language.add}</button>
        {/if}
    {:else if variant === 'tools'}
        <label class="flex min-h-11 items-center gap-2">
            <input type="checkbox" data-part="studio-preset-tools-search" disabled={locked} checked={shown.includes(SEARCH_TOOL)} onchange={onSearchToggle} />
            <span>{language.search}</span>
        </label>
    {:else}
        {#each shown as item, index (index)}
            <div data-part="studio-preset-list-row" class="flex items-center justify-between gap-2 rounded-md border border-darkborderc p-2">
                <span>{NAMES[item] ?? item}</span>
                {@render rowButtons(index, false)}
            </div>
        {/each}
    {/if}
    {#if notSetNote}
        <p data-part="studio-preset-not-set" class="text-sm text-textcolor2">{language.studioPresetNotSet}</p>
    {/if}
    {#if refusal}
        <p role="alert" data-part="studio-form-refusal" class="text-sm text-draculared">{refusalTextOf({ reason: refusal }, owner)}</p>
    {/if}
</div>
