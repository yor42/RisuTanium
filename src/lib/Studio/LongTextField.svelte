<script lang="ts">
    import { onDestroy, onMount } from 'svelte'
    import type { StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { registerStudioField } from '../../ts/studio/fieldFlush'
    import { createFieldWriteController, lf, type LongTextKind, type LongTextMode, type LongTextWritePort } from '../../ts/studio/longText/fieldWrite'

    // One Studio long-text field: a native textarea over a write port. The port and its controller own every
    // write; nothing here writes the owner except through the controller's `input` path.
    interface Props {
        port: LongTextWritePort
        // The data-part the existing tests and focus routing know the textarea by.
        part: string
        index?: number
        label?: string
        labelId?: string
        ariaLabel?: string
        kind: LongTextKind
        mode: LongTextMode
        editable: boolean
        busy: boolean
        fieldClass: string
        onresult: (result: StudioResult | null) => void
    }

    let { port, part, index, label, labelId, ariaLabel, kind, mode, editable, busy, fieldClass, onresult }: Props = $props()

    const instanceId = $props.id()
    const headerId = $derived(labelId ?? `${instanceId}-label`)
    const areaId = `${instanceId}-area`

    let area = $state<HTMLTextAreaElement | undefined>()

    const controller = createFieldWriteController(
        {
            read: () => port.read(),
            write: (value) => port.write(value),
            closeStep: () => port.closeStep(),
        },
        {
            value: () => area?.value ?? '',
            reset: (value) => {
                if (area) area.value = lf(value)
            },
        },
        (result) => onresult(result),
    )

    onMount(() => registerStudioField(controller.flush))
    onDestroy(() => controller.dispose())

    function onFocus(event: FocusEvent & { currentTarget: HTMLTextAreaElement }): void {
        // The value the field had when it was focused: the browser's own undo owns the field until it is back here.
        event.currentTarget.dataset.studioFocusValue = event.currentTarget.value
    }

    function onInput(event: Event): void {
        controller.input(event instanceof InputEvent && event.isComposing)
    }

    /**
     * The one insert path for later stages: replaces `start..end` with `text` as an input event, so the text
     * reaches the owner through the controller like typing does. Ignored while read-only or composing.
     */
    export function insertText(start: number, end: number, text: string, caret: number): void {
        if (!area || !editable || controller.composing) return
        port.closeStep()
        area.focus()
        area.setRangeText(text, start, end, 'end')
        area.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }))
        area.setSelectionRange(caret, caret)
        port.closeStep()
        area.dataset.studioFocusValue = area.value
    }
</script>

<div class="flex min-w-0 flex-1 flex-col gap-1" data-kind={kind} data-mode={mode}>
    {#if label}
        <div class="flex items-center justify-between gap-2">
            <label id={headerId} for={areaId} class="font-bold">{label}</label>
        </div>
    {/if}
    <textarea
        bind:this={area}
        id={areaId}
        data-part={part}
        data-index={index}
        class={fieldClass}
        dir="auto"
        readonly={!editable}
        aria-busy={busy ? 'true' : undefined}
        aria-label={ariaLabel}
        aria-labelledby={label ? headerId : undefined}
        value={lf(port.read() ?? '')}
        onfocus={onFocus}
        oninput={onInput}
        oncompositionstart={() => controller.compositionStart()}
        oncompositionend={() => controller.compositionEnd()}
        onblur={() => controller.blur()}
    ></textarea>
</div>
