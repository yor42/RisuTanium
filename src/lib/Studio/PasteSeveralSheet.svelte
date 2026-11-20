<script lang="ts">
    import { language } from '../../lang'
    import { refusalText } from '../../ts/studio/edit/studioToasts'
    import type { OwnerHistoryService, StudioRefusal, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import type { OwnerKey } from '../../ts/studio/history/ownerPhase'
    import { splitPastedMessages } from '../../ts/studio/longText/pasteSplit'
    import { registerStudioBackLayer } from '../../ts/studio/studioBack.svelte'

    // Splits pasted text into several alternate first messages. The text lives here only: it is never a field, so
    // nothing reaches the history service before Add, and Add is one greetingAppendMany step with the exact slices.
    // The sheet is mounted only while open.
    interface Props {
        owner: OwnerKey
        service: OwnerHistoryService | null
        editable: boolean
        isOpen: () => boolean
        // Shows or clears the form's refusal line for a result and says whether it landed.
        noted: (result: StudioResult) => boolean
        onadded: (count: number) => void
        onclose: () => void
    }

    let { owner, service, editable, isOpen, noted, onadded, onclose }: Props = $props()

    registerStudioBackLayer({ isOpen: () => isOpen(), close: () => onclose() })

    const PREVIEW_LIMIT = 50

    const titleId = $props.id()
    let text = $state('')
    let dash = $state(false)
    let refusal = $state<StudioRefusal | null>(null)
    let dialog = $state<HTMLDivElement | undefined>()
    let area = $state<HTMLTextAreaElement | undefined>()

    // Reading it during composition is harmless: it writes nothing.
    const messages = $derived(splitPastedMessages(text, { splitOn: dash ? 'dash-lines' : 'blank-lines' }))

    $effect(() => {
        area?.focus()
    })

    function add(): void {
        if (!service || !editable || messages.length === 0) return
        const count = messages.length
        const result = service.greetingAppendMany(owner, messages)
        const landed = noted(result)
        refusal = result.ok === false ? result.reason : null
        if (landed) onadded(count)
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.isComposing || event.keyCode === 229) return
        if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onclose()
            return
        }
        if (event.key !== 'Tab' || !dialog) return
        // The sheet is modal: Tab cycles inside it.
        const focusable = [...dialog.querySelectorAll<HTMLElement>('textarea, input, button')].filter((element) => !element.hasAttribute('disabled'))
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
        }
    }
</script>

<div class="fixed inset-0 z-50 flex items-end justify-center bg-bgcolor/60 sm:items-center" data-part="studio-paste-backdrop">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
        bind:this={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabindex="-1"
        data-part="studio-paste-sheet"
        class="flex max-h-[80vh] w-full max-w-md flex-col gap-2 rounded-t border border-darkborderc bg-bgcolor p-3 sm:rounded"
        onkeydown={onKeydown}
    >
        <div class="flex items-center justify-between gap-2">
            <h2 id={titleId} class="font-bold">{language.ltPasteTitle}</h2>
            <button type="button" data-part="studio-paste-cancel" class="min-h-11 rounded bg-darkbutton px-3 hover:bg-selected" onclick={() => onclose()}>{language.cancel}</button>
        </div>
        <textarea
            bind:this={area}
            bind:value={text}
            data-part="studio-paste-input"
            aria-label={language.ltPasteInput}
            rows="6"
            class="min-h-32 w-full rounded border border-darkborderc bg-darkbg p-2 text-textcolor"
        ></textarea>
        <label class="flex min-h-11 items-center gap-2">
            <input type="checkbox" aria-label={language.ltPmDash} data-part="studio-paste-dash" bind:checked={dash} />
            <span>{language.ltPmDash}</span>
        </label>
        <p data-part="studio-paste-rule" class="text-sm text-textcolor2">{dash ? language.ltPasteRuleDash : language.ltPasteRule}</p>
        <div role="status" aria-live="polite" data-part="studio-paste-count" class="text-sm">{language.ltPasteCount(messages.length)}</div>
        {#if messages.length > 0}
            <ol class="flex min-h-0 flex-col gap-1 overflow-y-auto" data-part="studio-paste-preview">
                {#each messages.slice(0, PREVIEW_LIMIT) as message, index (index)}
                    <li data-part="studio-paste-preview-item" class="max-h-16 overflow-hidden whitespace-pre-wrap break-words rounded bg-darkbg px-2 py-1 text-sm">{message}</li>
                {/each}
                {#if messages.length > PREVIEW_LIMIT}
                    <li class="text-sm text-textcolor2" data-part="studio-paste-more">{language.ltPasteMore(messages.length - PREVIEW_LIMIT)}</li>
                {/if}
            </ol>
        {/if}
        {#if refusal}
            <p role="alert" data-part="studio-paste-refusal" class="text-sm text-draculared">{refusalText(refusal)}</p>
        {/if}
        <button
            type="button"
            data-part="studio-paste-add"
            class="min-h-11 rounded bg-darkbutton px-3 hover:bg-selected disabled:cursor-default disabled:opacity-50"
            disabled={!editable || messages.length === 0}
            onclick={add}
        >{language.ltPasteAdd}</button>
    </div>
</div>
