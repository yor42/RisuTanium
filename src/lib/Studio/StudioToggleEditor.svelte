<script lang="ts">
    import { onDestroy, onMount } from 'svelte'
    import { language } from '../../lang'
    import { registerStudioField } from '../../ts/studio/fieldFlush'
    import { refusalTextOf } from '../../ts/studio/edit/studioToasts'
    import type { EditFailure, EditOutcome, ToggleBuilder } from '../../ts/studio/toggleBuilder.svelte'
    import { createCompositionGate, fieldErrorKeyOf, type NewKind } from '../../ts/studio/toggleBuilderModel'
    import { lineById, type DefLine, type LineId } from '../../ts/studio/toggleDef'
    import { canonicalLine, draftOf, rewriteLoss, type RowDraft } from '../../ts/studio/toggleDefEdit'
    import StudioToggleCarryBanner from './StudioToggleCarryBanner.svelte'

    // The editor of one row, or of the new row that is not written yet. Text fields write through as the author
    // types, except while an IME composes: the composed value is then written once at the end of the composition. A
    // refused value is never written and stays in its field until the field is left.
    interface Props {
        builder: ToggleBuilder
        editable: boolean
        // The open row; null while the unwritten new row is being named.
        id: LineId | null
        actions: {
            changeKind(id: LineId, kind: Exclude<NewKind, 'group'>): void
            remove(id: LineId): void
            closeStep(): void
        }
        // Given when the editor is a page of its own: the saved-values banner then sits inside it.
        carry?: {
            error: string
            actions: { carry(): void, answer(): void, undo(): void }
        }
    }

    let { builder, editable, id, actions, carry }: Props = $props()

    const FIELD_CLASS = 'min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor'
    const leafKinds = ['check', 'select', 'text', 'textarea', 'divider', 'caption'] as const
    const kindText = {
        check: 'studioTgTypeCheck', select: 'studioTgTypeSelect', text: 'studioTgTypeText', textarea: 'studioTgTypeTextarea',
        divider: 'studioTgTypeDivider', caption: 'studioTgTypeCaption',
    } as const

    const line = $derived<DefLine | undefined>(id === null ? undefined : lineById(builder.def, id)?.line)
    const draft = $derived<RowDraft | null>(line ? draftOf(line) : null)
    const loss = $derived(line ? rewriteLoss(line) : null)
    const hasLoss = $derived(loss !== null && (loss.tail.length > 0 || loss.unknownType !== null || loss.strayOptions !== null || loss.structuralKey !== null))
    const readOnlyCr = $derived.by(() => {
        if (draft === null) return false
        const written = canonicalLine(draft)
        return typeof written !== 'string' && (written.code === 'fieldHasCr')
    })
    const locked = $derived(id !== null && builder.isLocked(id))
    const pendingKind = $derived(builder.pending?.kind ?? null)
    const off = $derived(!editable || readOnlyCr)
    const failure = $derived<EditFailure | null>(builder.error)
    const options = $derived(draft !== null && draft.kind === 'select' ? draft.options : [])
    const keyText = $derived(draft !== null && draft.kind !== 'divider' && draft.kind !== 'caption' ? draft.key : '')

    // The text a refused or held field keeps showing, by field name.
    let typed = $state<Record<string, string>>({})
    const gates = new Map<string, ReturnType<typeof createCompositionGate>>()
    let copied = $state(false)
    let root = $state<HTMLElement | undefined>()

    function gateFor(name: string, write: (value: string) => EditOutcome): ReturnType<typeof createCompositionGate> {
        let gate = gates.get(name)
        if (!gate) {
            gate = createCompositionGate((value) => {
                typed[name] = value
                if (write(value).ok) delete typed[name]
            })
            gates.set(name, gate)
        }
        return gate
    }

    function flushAll(): void {
        for (const gate of gates.values()) gate.flush()
    }

    function leave(name: string): void {
        gates.get(name)?.flush()
        delete typed[name]
        actions.closeStep()
    }

    onMount(() => {
        const stop = registerStudioField(() => flushAll())
        // Opening a row, or naming a new one, puts the caret at the end of its first text field.
        const first = root?.querySelector<HTMLInputElement>('[data-part="studio-toggle-pending-name"], [data-part="studio-toggle-label"], [data-part="studio-toggle-text"], [data-part="studio-toggle-raw"]')
        if (first && !first.disabled) {
            first.focus()
            first.setSelectionRange(first.value.length, first.value.length)
        }
        return stop
    })
    onDestroy(() => {
        flushAll()
        actions.closeStep()
    })

    // The attributes every text field shares; each field names its own `data-part` where it is rendered.
    function inputProps(name: string, value: string, write: (value: string) => EditOutcome, disabled: boolean) {
        return {
            type: 'text',
            class: FIELD_CLASS,
            disabled,
            value: typed[name] ?? value,
            oninput(event: Event) {
                const target = event.currentTarget
                if (!(target instanceof HTMLInputElement)) return
                typed[name] = target.value
                gateFor(name, write).input(target.value, event instanceof InputEvent && event.isComposing)
            },
            oncompositionstart() {
                gateFor(name, write).start()
            },
            oncompositionend(event: Event) {
                const target = event.currentTarget
                if (target instanceof HTMLInputElement) gateFor(name, write).end(target.value)
            },
            onblur() {
                leave(name)
            },
        }
    }

    function failureText(value: EditFailure): string {
        switch (value.kind) {
            case 'field': return language[fieldErrorKeyOf(value.refusal)]
            case 'held': return language.studioTgTextHeld
            case 'refused': return refusalTextOf({ reason: value.reason }, builder.owner)
            case 'unavailable': return refusalTextOf({ reason: 'loading' }, builder.owner)
            case 'cantMove': return language.studioTgCantMove
        }
    }

    function copySnippet(): void {
        void navigator.clipboard?.writeText(`{{getglobalvar::toggle_${keyText}}}`)
        copied = true
    }

    function writeOption(index: number, value: string): EditOutcome {
        return id === null ? { ok: true } : builder.setOptions(id, options.map((option, at) => (at === index ? value : option)))
    }

    function addOption(): void {
        if (id !== null) builder.setOptions(id, [...options, language.studioTgOptionN(options.length + 1)], 'single')
    }

    function removeOption(index: number): void {
        if (id !== null) builder.setOptions(id, options.filter((_, at) => at !== index), 'single')
    }

    function moveOption(index: number, by: -1 | 1): void {
        if (id === null) return
        const next = [...options]
        const other = index + by
        if (other < 0 || other >= next.length) return
        ;[next[index], next[other]] = [next[other], next[index]]
        builder.setOptions(id, next, 'single')
    }
</script>

<section bind:this={root} data-part="studio-toggle-editor" class="flex flex-col gap-3 rounded-md border border-darkborderc p-3">
    <h3 class="font-bold">{language.studioTgEditorTitle}</h3>
    {#if carry}
        <StudioToggleCarryBanner {builder} {editable} error={carry.error} actions={carry.actions} />
    {/if}
    {#if pendingKind !== null}
        <label class="flex flex-col gap-1">
            <span class="text-sm text-textcolor2">{pendingKind === 'caption' ? language.studioTgNoteText : language.studioTgName}</span>
            <input data-part="studio-toggle-pending-name" {...inputProps('pending', '', (value) => builder.typePending(value), !editable)} />
        </label>
    {:else if line === undefined || id === null}
        <p class="text-textcolor2">{language.studioTgEmpty}</p>
    {:else if draft === null}
        {@const rowId = id}
        <!-- A line the engine does not read, a stray group end, or a blank: only its raw text can be edited. -->
        <p data-part="studio-toggle-reason" class="text-sm text-textcolor2">{line.form.kind === 'groupEnd' ? language.studioTgOrphanEnd : language.studioTgReasonKeyLabel}</p>
        <label class="flex flex-col gap-1">
            <span class="text-sm text-textcolor2">{language.studioTgUnreadable}</span>
            <input data-part="studio-toggle-raw" {...inputProps('raw', line.raw, (value) => builder.setRawLine(rowId, value), !editable)} />
        </label>
    {:else}
        {@const rowId = id}
        {#if readOnlyCr}
            <p data-part="studio-toggle-crline" class="text-sm text-draculared">{language.studioTgCrLine}</p>
        {/if}
        {#if hasLoss}
            <p data-part="studio-toggle-rewrite-loss" class="text-sm text-textcolor2">{language.studioTgRewriteLoss}</p>
        {/if}
        <label class="flex flex-col gap-1">
            <span class="text-sm text-textcolor2">{language.studioTgType}</span>
            {#if draft.kind === 'group'}
                <span data-part="studio-toggle-type-static">{language.studioTgTypeGroup}</span>
            {:else}
                <select
                    data-part="studio-toggle-kind"
                    class="min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
                    disabled={off || locked}
                    value={draft.kind}
                    onchange={(event) => actions.changeKind(rowId, event.currentTarget.value as Exclude<NewKind, 'group'>)}
                >
                    {#each leafKinds as kind (kind)}
                        <option value={kind}>{language[kindText[kind]]}</option>
                    {/each}
                </select>
            {/if}
        </label>
        {#if draft.kind === 'caption'}
            <label class="flex flex-col gap-1">
                <span class="text-sm text-textcolor2">{language.studioTgNoteText}</span>
                <input data-part="studio-toggle-text" {...inputProps('text', draft.text, (value) => builder.setLabel(rowId, value), off)} />
            </label>
        {:else}
            <label class="flex flex-col gap-1">
                <span class="text-sm text-textcolor2">{language.studioTgName}</span>
                <input data-part="studio-toggle-label" {...inputProps('label', draft.label, (value) => builder.setLabel(rowId, value), off)} />
            </label>
        {/if}
        {#if draft.kind === 'select'}
            <div data-part="studio-toggle-options" class="flex flex-col gap-2">
                <span class="font-bold">{language.studioTgOptions}</span>
                {#each options as option, index (index)}
                    <div class="flex items-end gap-2">
                        <label class="flex grow flex-col gap-1">
                            <span class="text-sm text-textcolor2">{language.studioTgOptionN(index + 1)}</span>
                            <input data-part="studio-toggle-option" {...inputProps(`option${index}`, option, (value) => writeOption(index, value), off)} />
                        </label>
                        <button type="button" data-part="studio-toggle-option-up" class="min-h-11 min-w-11 rounded-md border border-darkborderc hover:bg-selected cursor-pointer" aria-label={language.studioTgOptionUp} disabled={off || locked || index === 0} onclick={() => moveOption(index, -1)}>↑</button>
                        <button type="button" data-part="studio-toggle-option-down" class="min-h-11 min-w-11 rounded-md border border-darkborderc hover:bg-selected cursor-pointer" aria-label={language.studioTgOptionDown} disabled={off || locked || index === options.length - 1} onclick={() => moveOption(index, 1)}>↓</button>
                        <button type="button" data-part="studio-toggle-option-remove" class="min-h-11 min-w-11 rounded-md border border-darkborderc hover:bg-selected cursor-pointer" aria-label={language.studioTgRemoveOption} disabled={off || locked} onclick={() => removeOption(index)}>×</button>
                    </div>
                {/each}
                <button type="button" data-part="studio-toggle-option-add" class="min-h-11 self-start rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" disabled={off} onclick={addOption}>{language.studioTgAddOption}</button>
            </div>
        {/if}
        {#if draft.kind !== 'divider' && draft.kind !== 'caption'}
            <details data-part="studio-toggle-advanced" class="rounded-md border border-darkborderc p-2">
                <summary class="min-h-11 cursor-pointer">{language.studioTgAdvanced}</summary>
                <div class="flex flex-col gap-2">
                    <label class="flex flex-col gap-1">
                        <span class="text-sm text-textcolor2">{language.studioTgKey}</span>
                        <input data-part="studio-toggle-key" {...inputProps('key', draft.key, (value) => builder.setKey(rowId, value), off || locked)} />
                    </label>
                    {#if locked}
                        <p data-part="studio-toggle-locked" class="text-sm text-textcolor2">{language.studioTgKeyLocked}</p>
                    {/if}
                    <button type="button" data-part="studio-toggle-copy" class="min-h-11 self-start rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={copySnippet}>{copied ? language.studioTgCopied : language.studioTgCopySnippet}</button>
                </div>
            </details>
        {/if}
        <button type="button" data-part="studio-toggle-delete" class="min-h-11 self-start rounded-md border border-darkborderc px-3 text-draculared hover:bg-selected cursor-pointer" disabled={!editable} onclick={() => actions.remove(rowId)}>{language.studioTgDelete}</button>
    {/if}
    {#if failure !== null && failure.kind !== 'cantMove'}
        <p role="alert" data-part="studio-toggle-error" class="text-sm text-draculared">{failureText(failure)}</p>
    {/if}
</section>
