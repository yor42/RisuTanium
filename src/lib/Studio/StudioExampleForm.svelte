<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import { refusalText } from '../../ts/studio/edit/studioToasts'
    import type { StudioRefusal, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
    import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService, historyBannerText, studioHistoryLoadFailed } from '../../ts/studio/history/studioHistoryService.svelte'
    import { detectEol, isExampleMarkerLine } from '../../ts/studio/longText/exampleBlocks'
    import {
        addBlock,
        cardSpans,
        cardText,
        deleteCard,
        locateCaret,
        markOpening,
        moveBlock,
        rawIndexOf,
        rebaseHold,
        spliceLf,
        splitChanged,
        writeCardText,
        type CardSpan,
        type Hold,
    } from '../../ts/studio/longText/exampleCards'
    import { turnLines } from '../../ts/studio/longText/exampleTurns'
    import { lf, type LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import { createGreetingRowKeys } from '../../ts/studio/greetingRowKeys'
    import { DBState } from '../../ts/stores.svelte'
    import ExampleCard from './ExampleCard.svelte'
    import LongTextField from './LongTextField.svelte'
    import type { PreviewSourceInput } from './LongTextPreview.svelte'

    // The example dialogue of the selected character as cards, one per start-marked block, or as the whole text. Every
    // write is one `editText` of the whole stored text: a card edit changes only the bytes of the lines it touched,
    // and viewing, focusing or switching the view writes nothing. While the owner's history is loading the fields are
    // read-only; after a failure they are editable with a banner that says history is not kept.
    interface Props {
        chaId: string
    }

    let { chaId }: Props = $props()

    const owner = characterOwnerKey(untrack(() => chaId))

    const service = $derived(getStudioHistoryService())
    $effect(() => {
        if (service) {
            untrack(() => beginOwnerVisit(owner))
        } else {
            ensureStudioHistory()
        }
    })

    const live = $derived.by(() => {
        const found = DBState.db.characters?.find((candidate) => candidate?.chaId === chaId)
        return found && found.type !== 'group' ? found : undefined
    })
    const previewSource = (): PreviewSourceInput => ({ owner: live ?? null, chat: live?.chats?.[live.chatPage] ?? null, globals: DBState.db.globalChatVariables ?? {} })
    const view = $derived(service ? service.view(owner) : null)
    const hidden = $derived(live === undefined || live.license === 'private' || view?.restricted === true)
    const editable = $derived(view?.editable === true)
    const banner = $derived(view ? historyBannerText(view.banner) : null)
    const loadFailed = $derived(!service && studioHistoryLoadFailed())

    // The stored text as it is. An absent key reads as empty and every write to it is refused by the service.
    const text = $derived(typeof live?.exampleMessage === 'string' ? live.exampleMessage : '')

    // The held marker: a marker line the user is typing stays body text of its card until the caret leaves its line.
    // `holdBase` is the text the range was made for; it is moved through any outside change before a render uses it.
    let hold = $state<Hold | null>(null)
    let holdBase = $state(untrack(() => text))
    const effectiveHold = $derived(rebaseHold(hold, holdBase, text))
    $effect.pre(() => {
        if (text !== holdBase) {
            const next = effectiveHold
            untrack(() => {
                hold = next
                holdBase = text
            })
        }
    })

    const spans = $derived(cardSpans(text, effectiveHold))
    const rowKeys = createGreetingRowKeys()
    const rows = $derived(rowKeys.rows(spans.map((_, i) => cardText(text, spans, i))))
    const blockOffset = $derived(spans.length > 0 && spans[0].kind === 'opening' ? 1 : 0)

    let mode = $state<'list' | 'text'>('list')
    let refusal = $state<StudioRefusal | null>(null)
    let announcement = $state('')
    let root = $state<HTMLElement | undefined>()
    let retryButton = $state<HTMLButtonElement | undefined>()
    let retrying = false
    // The input type the last `input` event carried, recorded ahead of the field's own handler.
    let lastInputType = ''
    // The card whose full-screen layer is open, from its opening until the release after its closing flush, and the card
    // count when it opened. While it is set every write of that card widens the hold to the whole card.
    let layerId: number | null = null
    let layerCount = 0

    function retry(): void {
        root?.focus()
        retrying = true
        ensureStudioHistory()
    }

    $effect(() => {
        if (loadFailed) {
            if (retrying) {
                retrying = false
                void afterFlush().then(() => {
                    if (root && document.activeElement === root) retryButton?.focus()
                })
            }
        } else if (service) {
            retrying = false
        }
    })

    function noted(result: StudioResult): boolean {
        refusal = result.ok === false ? result.reason : null
        return result.ok
    }

    // A null result means there was no write path: the refusal line stays as it was.
    function onFieldResult(result: StudioResult | null): void {
        if (result) noted(result)
    }

    const indexOf = (id: number): number => rows.findIndex((row) => row.id === id)
    const fieldElements = (): HTMLTextAreaElement[] => (root ? Array.from(root.querySelectorAll<HTMLTextAreaElement>('[data-part="studio-example-input"]')) : [])
    const handleAt = (index: number): HTMLElement | undefined => root?.querySelectorAll<HTMLElement>('[data-part="studio-example-handle"]')[index]

    // Typed input keeps a marker line held; a paste, a drop or a replacement splits at once.
    function isTypedInput(inputType: string): boolean {
        return inputType === 'insertText' || inputType === 'insertCompositionText' || inputType.startsWith('delete')
    }

    function onInputCapture(event: Event): void {
        lastInputType = 'inputType' in event && typeof event.inputType === 'string' ? event.inputType : ''
    }

    // Where the card's own text starts in the written text: `writeCardText` puts one eol before text that follows an
    // unterminated marker line.
    function displayStart(span: CardSpan, nextLf: string): number {
        const glued = span.kind === 'block' && span.markerStart !== null && !text.slice(span.markerStart, span.start).endsWith('\n') && nextLf !== ''
        return span.start + (glued ? detectEol(text).length : 0)
    }

    // The raw range, in `whole`, of the marker line under the caret of a card; null when that line is no marker.
    function markerLineHold(base: number, whole: string, nextLf: string, caret: number): Hold | null {
        const lineStart = caret === 0 ? 0 : nextLf.lastIndexOf('\n', caret - 1) + 1
        const newline = nextLf.indexOf('\n', caret)
        const lineEnd = newline < 0 ? nextLf.length : newline
        if (!isExampleMarkerLine(nextLf.slice(lineStart, lineEnd))) return null
        const tail = whole.slice(base)
        return { start: base + rawIndexOf(tail, lineStart), end: base + rawIndexOf(tail, lineEnd) }
    }

    // After a re-derive that changes the focused card's text without its own input (a split on Enter, a paste, a
    // release), the caret goes to the card that now holds it. Focus that is elsewhere stays where it is.
    // `written` is the card the user typed into: after a split it shows other text than the field holds, so its value
    // is brought back in line with the stored card. Focus that moved while the update was pending is left alone.
    async function handoff(rawCaret: number, written?: { field: HTMLTextAreaElement | undefined; id: number }): Promise<void> {
        const origin = document.activeElement
        await afterFlush()
        if (written?.field?.isConnected) {
            const index = indexOf(written.id)
            const shown = index < 0 ? null : lf(cardText(text, spans, index))
            if (shown !== null && written.field.value !== shown) written.field.value = shown
        }
        if (!root || !root.contains(origin) || document.activeElement !== origin) return
        const target = locateCaret(text, spans, rawCaret)
        const field = fieldElements()[target.card]
        if (!field) return
        if (document.activeElement !== field) field.focus()
        field.setSelectionRange(target.offsetLf, target.offsetLf)
    }

    // Bound to the card's id, not its position: a card that was removed reads null, and a card that took other text
    // fails the controller's base check, so held text never lands in a neighbouring card.
    function cardPort(id: number): LongTextWritePort {
        return {
            read: () => {
                const index = indexOf(id)
                return index < 0 ? null : cardText(text, spans, index)
            },
            write: (arg) => {
                const index = indexOf(id)
                if (index < 0 || !service || !editable) return null
                const nextLf = lf(arg)
                const whole = writeCardText(text, spans, index, nextLf)
                const field = fieldElements()[index]
                const caret = field ? field.selectionStart : nextLf.length
                const typed = isTypedInput(lastInputType)
                lastInputType = ''
                const base = displayStart(spans[index], nextLf)
                const inLayer = layerId === id
                // In the layer the card stays whole whatever is typed: a marker line, an Enter and more text are all body text
                // until the layer has closed and its last flush has been written.
                const newHold = inLayer ? { start: base, end: spans[index].end + (whole.length - text.length) } : typed ? markerLineHold(base, whole, nextLf, caret) : null
                const changed = splitChanged(text, whole)
                const saved = { hold, holdBase, had: effectiveHold !== null }
                // The hold is set before the write, so the controller's base refresh reads the merged card.
                hold = newHold
                holdBase = whole
                const result = service.editText(owner, 'exampleMessage', whole, changed ? 'single' : 'typing')
                if (!result.ok) {
                    hold = saved.hold
                    holdBase = saved.holdBase
                } else if (!inLayer && (saved.had || (changed && newHold === null))) {
                    void handoff(base + rawIndexOf(whole.slice(base), caret), { field, id })
                }
                return result
            },
            closeStep: () => service?.closeOpenStep(owner),
        }
    }

    // The text view's edit rewrites only the LF range it touched, so CRLF lines stay CRLF.
    const textPort: LongTextWritePort = {
        read: () => (live ? text : null),
        write: (arg) => {
            if (!service || !editable) return null
            const stored = text
            const next = spliceLf(stored, lf(arg), detectEol(stored))
            return service.editText(owner, 'exampleMessage', next, splitChanged(stored, next) ? 'single' : 'typing')
        },
        closeStep: () => service?.closeOpenStep(owner),
    }

    function releaseHold(): void {
        hold = null
        holdBase = text
    }

    // Inline release: the caret left the held line. A caret that stays in this card is handed to the card that holds it.
    function checkRelease(): void {
        const held = effectiveHold
        if (held === null || !root || layerId !== null) return
        const active = document.activeElement
        if (!(active instanceof HTMLTextAreaElement) || !root.contains(active) || active.dataset.part !== 'studio-example-input') return
        const k = fieldElements().indexOf(active)
        if (k < 0) return
        const raw = text.slice(spans[k].start, spans[k].end)
        const rawCaret = spans[k].start + rawIndexOf(raw, active.selectionStart)
        // A composition shows more than is stored, so the held line is compared in the field's own shown text.
        const shownCaret = active.selectionStart
        const shownLineStart = shownCaret === 0 ? 0 : active.value.lastIndexOf('\n', shownCaret - 1) + 1
        if (held.start >= spans[k].start && held.start <= spans[k].end && shownLineStart === lf(text.slice(spans[k].start, held.start)).length) return
        releaseHold()
        void handoff(rawCaret)
    }

    // Focus leaving the textarea, to a handle or a menu as well, shows the split; it never moves focus.
    function onFocusOut(event: FocusEvent): void {
        if (layerId !== null) return
        if (event.target instanceof HTMLElement && event.target.dataset.part === 'studio-example-input' && effectiveHold !== null) releaseHold()
    }

    // The raw offset of the caret of the layer's nested field in the stored text, read before the layer is torn down;
    // null when the card or the nested field is gone.
    function layerCaret(id: number): number | null {
        const area = root?.querySelector<HTMLTextAreaElement>('[data-part="lt-focus-input"]')
        const index = indexOf(id)
        if (!area || index < 0) return null
        const raw = text.slice(spans[index].start, spans[index].end)
        return spans[index].start + rawIndexOf(raw, area.selectionStart)
    }

    // The layer closes in this order: the caret is read at once, the hold stays until the layer's teardown flush has been
    // written into the card, then it is released and the caret goes to the card that holds it, after the layer returned
    // focus to the card's own field.
    async function closeLayer(id: number, rawCaret: number | null): Promise<void> {
        await afterFlush()
        layerId = null
        releaseHold()
        const index = indexOf(id)
        if (rawCaret !== null) await handoff(rawCaret, { field: fieldElements()[index], id })
        else await afterFlush()
        if (spans.length > layerCount) announcement = language.ltExSplit
    }

    function onFocusLayer(id: number, open: boolean): void {
        if (open) {
            const index = indexOf(id)
            if (index < 0) return
            layerId = id
            layerCount = spans.length
            announcement = ''
            hold = { start: spans[index].start, end: spans[index].end }
            holdBase = text
            return
        }
        if (layerId !== id) return
        void closeLayer(id, layerCaret(id))
    }

    $effect(() => {
        document.addEventListener('selectionchange', checkRelease)
        return () => document.removeEventListener('selectionchange', checkRelease)
    })

    // The structural actions run over the cards with no hold: the hold is released first and the card is found again
    // by its id, so a held marker never shifts the index.
    function run(id: number, build: (current: string, index: number) => string): { index: number; next: string } | null {
        releaseHold()
        const index = indexOf(id)
        if (index < 0 || !service || !editable) return null
        const next = build(text, index)
        if (next === text) return null
        announcement = ''
        if (!noted(service.editText(owner, 'exampleMessage', next, 'single'))) return null
        return { index, next }
    }

    async function add(): Promise<void> {
        releaseHold()
        if (!service || !editable) return
        if (!noted(service.editText(owner, 'exampleMessage', addBlock(text), 'single'))) return
        await afterFlush()
        fieldElements().at(-1)?.focus()
    }

    async function move(id: number, delta: -1 | 1): Promise<void> {
        const done = run(id, (current, index) => moveBlock(current, index, index + delta))
        if (!done) return
        await afterFlush()
        const to = done.index + delta
        handleAt(to)?.focus()
        announcement = language.ltCardMoved(to - blockOffset + 1, spans.length - blockOffset)
    }

    async function remove(id: number): Promise<void> {
        const done = run(id, (current, index) => deleteCard(current, index))
        if (!done) return
        await afterFlush()
        // Focus goes to the card that took the place, else the one before it, else the add button.
        const fields = fieldElements()
        const next = fields[done.index] ?? fields[done.index - 1] ?? root?.querySelector<HTMLElement>('[data-part="studio-example-add"]')
        next?.focus()
    }

    async function markFirst(id: number): Promise<void> {
        const done = run(id, (current) => markOpening(current))
        if (!done) return
        await afterFlush()
        fieldElements()[0]?.focus()
    }

    function show(next: 'list' | 'text'): void {
        if (mode === next) return
        releaseHold()
        mode = next
    }

    function subtitleOf(card: string): string {
        const turns = turnLines(lf(card), live?.name ?? '')
        const unused = turns.filter((turn) => turn.notUsedStart !== null).length
        return unused > 0 ? `${language.ltExTurns(turns.length)} · ${language.ltExNotUsed(unused)}` : language.ltExTurns(turns.length)
    }

    onDestroy(() => service?.closeOpenStep(owner))

    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
    const switchClass = 'min-h-11 min-w-11 px-3 hover:bg-selected cursor-pointer'
</script>

{#if live && !hidden}
    <!-- The key, pointer and select handlers only watch where the caret is; the section takes no input itself. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <section
        bind:this={root}
        tabindex="-1"
        data-part="studio-example-form"
        data-phase={view?.phase ?? 'unused'}
        class="flex flex-col gap-3 outline-none"
        aria-busy={editable ? undefined : 'true'}
        onkeyup={checkRelease}
        onpointerup={checkRelease}
        onselect={checkRelease}
        onfocusout={onFocusOut}
    >
        {#if !editable && !loadFailed}
            <p data-part="studio-form-loading" class="text-sm text-textcolor2">{language.studioFormLoading}</p>
        {/if}
        {#if loadFailed}
            <p role="status" data-part="studio-form-banner" data-banner="failed" class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{language.studioBannerFailed}</p>
            <button bind:this={retryButton} type="button" data-part="studio-history-retry" class="min-h-11 self-start rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={retry}>{language.studioChipRetry}</button>
        {/if}
        {#if banner}
            <p role="status" data-part="studio-form-banner" data-banner={view?.banner} class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{banner}</p>
        {/if}
        <div class="flex items-center justify-between gap-2">
            <span class="font-bold">{language.exampleMessage}</span>
            <div role="group" aria-label={language.ltExView} class="flex overflow-hidden rounded-md border border-darkborderc">
                <button type="button" data-part="studio-example-view-list" class="{switchClass} {mode === 'list' ? 'bg-selected' : ''}" aria-pressed={mode === 'list'} onclick={() => show('list')}>{language.ltExViewList}</button>
                <button type="button" data-part="studio-example-view-text" class="{switchClass} {mode === 'text' ? 'bg-selected' : ''}" aria-pressed={mode === 'text'} onclick={() => show('text')}>{language.ltExViewText}</button>
            </div>
        </div>
        <div role="status" aria-live="polite" data-part="studio-example-announce" class="sr-only">{announcement}</div>
        {#if mode === 'text'}
            <LongTextField
                port={textPort}
                part="studio-example-text"
                ariaLabel={language.exampleMessage}
                kind="exampleText"
                mode="cbs"
                ownerLabel={live.name}
                {previewSource}
                {editable}
                busy={!editable}
                fieldClass="min-h-32 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
                onresult={onFieldResult}
            />
        {:else}
            {#if spans.length === 0}
                <p data-part="studio-example-empty" class="text-sm text-textcolor2">{language.ltExEmpty}</p>
            {/if}
            {#each rows as row, index (row.id)}
                <ExampleCard
                    id={row.id}
                    {index}
                    kind={spans[index]?.kind ?? 'block'}
                    number={index - blockOffset + 1}
                    subtitle={subtitleOf(row.text)}
                    canMoveUp={index - blockOffset > 0}
                    canMoveDown={index < rows.length - 1}
                    port={cardPort(row.id)}
                    {editable}
                    ownerLabel={live.name}
                    {previewSource}
                    onresult={onFieldResult}
                    onmove={(delta) => void move(row.id, delta)}
                    ondelete={() => void remove(row.id)}
                    onmarkopening={() => void markFirst(row.id)}
                    oninputcapture={onInputCapture}
                    onfocuslayer={(open) => onFocusLayer(row.id, open)}
                />
            {/each}
            <button
                type="button"
                data-part="studio-example-add"
                class="{buttonClass} self-start"
                disabled={!editable}
                aria-busy={editable ? undefined : 'true'}
                onclick={add}
            >{language.ltExAdd}</button>
        {/if}
        {#if refusal}
            <p role="alert" data-part="studio-form-refusal" class="text-sm text-draculared">{refusalText(refusal)}</p>
        {/if}
    </section>
{/if}
