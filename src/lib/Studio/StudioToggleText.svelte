<script lang="ts">
    import { onDestroy, onMount } from 'svelte'
    import { language } from '../../lang'
    import { refusalTextOf } from '../../ts/studio/edit/studioToasts'
    import type { ToggleTextPort } from '../../ts/studio/edit/toggleTextPort'
    import { registerStudioField } from '../../ts/studio/fieldFlush'
    import type { EditFailure, ToggleBuilder } from '../../ts/studio/toggleBuilder.svelte'
    import {
        createCompositionGate,
        diagnosticKeyOf,
        displayTextOf,
        hasInteriorCr,
        lineIndexAtOffset,
        lineMarksOf,
        typeKeyOf,
        withKeptCr,
        type LineMark,
        type NewKind,
    } from '../../ts/studio/toggleBuilderModel'
    import { detachingItems, planCarry } from '../../ts/studio/toggleCarry'
    import { textOf } from '../../ts/studio/toggleDef'
    import { canonicalLine, replaceText, type RowDraft } from '../../ts/studio/toggleDefEdit'

    // The definition as one text field with a line-number gutter. Every input is written through the text port as a
    // whole string; the builder takes the written text back in without a second write. An edit that would rename,
    // reinterpret or drop a key present when the page was opened is not written: the field keeps what was typed and
    // says so until a later input passes or the field is left. An IME composition writes once, when it ends.
    interface Props {
        builder: ToggleBuilder
        port: ToggleTextPort
        editable: boolean
        // The offset in the displayed text where the caret starts.
        caretAt?: number
    }

    let { builder, port, editable, caretAt = 0 }: Props = $props()

    const kinds: readonly { kind: NewKind, hint: 'studioTgHintCheck' | 'studioTgHintSelect' | 'studioTgHintText' | 'studioTgHintTextarea' | 'studioTgHintGroup' | 'studioTgHintDivider' | 'studioTgHintCaption', draft: RowDraft }[] = [
        { kind: 'check', hint: 'studioTgHintCheck', draft: { kind: 'check', key: 'key', label: 'Name' } },
        { kind: 'select', hint: 'studioTgHintSelect', draft: { kind: 'select', key: 'key', label: 'Name', options: ['A', 'B'] } },
        { kind: 'text', hint: 'studioTgHintText', draft: { kind: 'text', key: 'key', label: 'Name' } },
        { kind: 'textarea', hint: 'studioTgHintTextarea', draft: { kind: 'textarea', key: 'key', label: 'Name' } },
        { kind: 'group', hint: 'studioTgHintGroup', draft: { kind: 'group', key: 'key', label: 'Name' } },
        { kind: 'divider', hint: 'studioTgHintDivider', draft: { kind: 'divider', label: 'Name' } },
        { kind: 'caption', hint: 'studioTgHintCaption', draft: { kind: 'caption', text: 'Name' } },
    ]

    // What the author typed while it is not (yet) the saved text: during a composition, and after a refused write.
    let typed = $state<string | null>(null)
    let failure = $state<EditFailure | null>(null)
    let field = $state<HTMLTextAreaElement | undefined>()
    let gutter = $state<HTMLElement | undefined>()
    let touched = false

    const shown = $derived(typed ?? displayTextOf(builder.def))
    const lineCount = $derived(shown.split('\n').length)
    const readOnlyCr = $derived(hasInteriorCr(builder.def))
    const readOnly = $derived(!editable || readOnlyCr)
    // Marks belong to the saved text; while the field holds other text their line numbers would point elsewhere.
    const marks = $derived.by(() => {
        const byLine = new Map<number, LineMark[]>()
        if (typed !== null) return byLine
        for (const mark of lineMarksOf(builder.def)) {
            byLine.set(mark.line, [...(byLine.get(mark.line) ?? []), mark])
        }
        return byLine
    })
    const examples = $derived(kinds.map((entry) => {
        const line = canonicalLine(entry.draft)
        return { kind: entry.kind, hint: entry.hint, line: typeof line === 'string' ? line : '' }
    }))

    function write(value: string): void {
        if (readOnly) return
        const before = builder.def
        const next = replaceText(before, withKeptCr(before, value))
        if (!builder.keyEditsLive && detachingItems(planCarry(before, next), builder.visitKeys).length > 0) {
            failure = { ok: false, kind: 'held' }
            return
        }
        const text = textOf(next)
        if (text !== textOf(before)) {
            const result = port.write(text, 'typing')
            if (result === null) {
                failure = { ok: false, kind: 'unavailable' }
                return
            }
            if (result.ok === false) {
                failure = { ok: false, kind: 'refused', reason: result.reason }
                return
            }
            builder.resync(text)
        }
        typed = null
        failure = null
    }

    const gate = createCompositionGate(write)

    function failureText(value: EditFailure): string {
        return value.kind === 'refused' ? refusalTextOf({ reason: value.reason }, port.owner) : refusalTextOf({ reason: 'loading' }, port.owner)
    }

    function markText(line: number, mark: LineMark): string {
        return `${language.studioTgLineN(line)}: ${language[diagnosticKeyOf(mark.code)]}`
    }

    function leave(): void {
        gate.flush()
        typed = null
        failure = null
        port.closeOpenStep()
    }

    /** The index of the line under the caret, or null while the author has not moved it or the field holds unsaved text. */
    export function caretLine(): number | null {
        return touched && typed === null && field ? lineIndexAtOffset(field.value, field.selectionStart) : null
    }

    onMount(() => {
        field?.setSelectionRange(caretAt, caretAt)
        return registerStudioField(() => gate.flush())
    })
    onDestroy(() => {
        gate.flush()
        port.closeOpenStep()
    })
</script>

<div data-part="studio-toggle-textview" class="flex flex-col gap-2">
    {#if readOnlyCr}
        <p data-part="studio-toggle-text-cr" class="text-sm text-draculared">{language.studioTgCrText}</p>
    {/if}
    <div class="flex rounded-md border border-darkborderc bg-darkbg">
        <div bind:this={gutter} data-part="studio-toggle-gutter" class="w-14 shrink-0 select-none overflow-hidden border-r border-darkborderc py-2 text-right font-mono text-sm text-textcolor2">
            {#each { length: lineCount }, index (index)}
                {@const line = index + 1}
                <div class="flex h-6 items-center justify-end gap-1 pr-2 leading-6">
                    {#each marks.get(line) ?? [] as mark, at (at)}
                        <span data-part="studio-toggle-mark" data-line={line} data-code={mark.code} data-severity={mark.severity} class={mark.severity === 'error' ? 'text-draculared' : 'text-textcolor'} title={markText(line, mark)}>
                            <span aria-hidden="true">!</span>
                            <span class="sr-only">{markText(line, mark)}</span>
                        </span>
                    {/each}
                    <span aria-hidden="true">{line}</span>
                </div>
            {/each}
        </div>
        <textarea
            bind:this={field}
            data-part="studio-toggle-textarea"
            wrap="off"
            spellcheck="false"
            aria-label={language.studioTgTextLabel}
            readonly={readOnly}
            value={shown}
            class="h-80 min-w-0 grow resize-y overflow-auto whitespace-pre bg-darkbg p-2 font-mono text-sm leading-6 text-textcolor outline-none"
            onscroll={() => { if (gutter && field) gutter.scrollTop = field.scrollTop }}
            onfocus={() => { touched = true }}
            onpointerdown={() => { touched = true }}
            onkeydown={() => { touched = true }}
            oninput={(event) => {
                const target = event.currentTarget
                typed = target.value
                gate.input(target.value, event instanceof InputEvent && event.isComposing)
            }}
            oncompositionstart={() => gate.start()}
            oncompositionend={(event) => gate.end(event.currentTarget.value)}
            onblur={leave}
        ></textarea>
    </div>
    {#if failure !== null}
        {#if failure.kind === 'held'}
            <p role="alert" data-part="studio-toggle-text-held" class="text-sm text-draculared">{language.studioTgTextHeld}</p>
        {:else}
            <p role="alert" data-part="studio-toggle-text-error" class="text-sm text-draculared">{failureText(failure)}</p>
        {/if}
    {/if}
    <details data-part="studio-toggle-format-help" class="rounded-md border border-darkborderc p-2">
        <summary class="min-h-11 cursor-pointer">{language.studioTgFormatHelp}</summary>
        <p class="text-sm text-textcolor2">{language.studioTgFormatIntro}</p>
        <ul class="flex flex-col gap-1">
            {#each examples as example (example.kind)}
                <li class="flex flex-col">
                    <span class="text-sm text-textcolor2">{language[typeKeyOf(example.kind)]} · {language[example.hint]}</span>
                    <code data-part="studio-toggle-format-example" data-kind={example.kind} class="font-mono text-sm">{example.line}</code>
                </li>
            {/each}
        </ul>
    </details>
</div>
