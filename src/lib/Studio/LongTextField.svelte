<script lang="ts">
    import { EyeIcon, Maximize2Icon, SearchIcon } from '@lucide/svelte'
    import { onDestroy, onMount, untrack } from 'svelte'
    import { language } from '../../lang'
    import { motionPrefs } from '../../ts/chatShell/motionPrefs.svelte'
    import { nearViewport } from '../../ts/gui/nearViewport.svelte'
    import type { StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { registerStudioField } from '../../ts/studio/fieldFlush'
    import { CAP_MAX_PX, CAP_MIN_PX, readCap, writeCap } from '../../ts/studio/longText/fieldHeightStore'
    import { checkCbs } from '../../ts/studio/longText/cbsCheck'
    import { createFieldWriteController, lf, type LongTextKind, type LongTextMode, type LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import { colourWindow, createUpdateBudget, editBetween, measureUpdate, segmentsOf, shiftSpans, tokenSpans, WINDOW_LIMIT, type Mark, type Note, type Span } from '../../ts/studio/longText/highlightSpans'
    import { MACRO_ROWS } from '../../ts/studio/longText/macroGroups'
    import type { MacroIndex } from '../../ts/studio/longText/macroIndex'
    import { loadMacroIndex } from '../../ts/studio/longText/macroIndexService'
    import { filterPicks, macroTrigger, pickItems, type MacroTrigger, type PickItem, type PickSource } from '../../ts/studio/longText/macroPick'
    import { LT_TEXT_LAYOUT } from '../../ts/studio/longText/overlayMetrics'
    import { createPauseScheduler } from '../../ts/studio/longText/pauseScheduler'
    import { fixApplies, problemRows, shiftRows, withExtraRows, type CheckedText, type ExtraProblem, type ProblemCopy, type ProblemRow } from '../../ts/studio/longText/problemsModel'
    import { loadPreviewEngine } from '../../ts/studio/longText/previewEngineService'
    import { tokenChipView, type FilledCount, type TokenChipCopy, type TokenChipView } from '../../ts/studio/longText/tokenChip'
    import { requestTokens } from '../../ts/studio/longText/tokenService'
    import { studioScreen } from '../../ts/studio/studioScreen.svelte'
    import LongTextFocus from './LongTextFocus.svelte'
    import LongTextOverlay from './LongTextOverlay.svelte'
    import LongTextPreview, { NO_VALUES, type PreviewSourceInput, type PreviewValues } from './LongTextPreview.svelte'
    import LongTextProblems from './LongTextProblems.svelte'
    import LongTextTokens from './LongTextTokens.svelte'
    import MacroPicker from './MacroPicker.svelte'
    import MacroSheet from './MacroSheet.svelte'

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
        // Hint text the empty textarea shows; display only.
        placeholder?: string
        kind: LongTextKind
        mode: LongTextMode
        editable: boolean
        busy: boolean
        fieldClass: string
        // `focus` is the field inside the full-screen layer: no label element (the layer's title names it), no height
        // cap or handle, and no button that opens a layer.
        variant?: 'inline' | 'focus'
        // The owner's name, shown as the layer's breadcrumb.
        ownerLabel?: string
        // Called with the field's LF text at both exits of `syncValue`. A handler only reads: it never writes a port or
        // calls the field's insert or controller.
        onvalue?: (value: string) => void
        // Called when an IME composition starts or ends, read-side like `onvalue`.
        oncomposing?: (composing: boolean) => void
        // Display-only notes for the text it is given (LF). Read when the overlay runs; the field shifts them with the
        // text between runs, so a handler never decides what is written.
        extraMarks?: (text: string) => Note[]
        // Display-only problems for the text it is given (LF), listed beside the checker's. Read when the check runs;
        // never while composing or in plain mode, and they carry no fix.
        extraProblems?: (text: string) => ExtraProblem[]
        // A second picker source next to the macro one. It opens the picker where its own trigger matches and inserts
        // through the field's insert path.
        extraPicks?: PickSource
        // Called with `true` when this field opens its full-screen layer and with `false` once when that layer closes or
        // the field is destroyed while it is open. A handler only reads and holds state; it never writes through the field.
        onfocuslayer?: (open: boolean) => void
        // What the CBS preview reads from the open owner. Without it (or in plain mode) there is no Preview button and
        // the token chip counts the text as written.
        previewSource?: () => PreviewSourceInput
        // The values the preview fills in, owned by the field that opened the layer; the field keeps its own when absent.
        previewValues?: PreviewValues
        onpreviewvalues?: (next: PreviewValues) => void
        onresult: (result: StudioResult | null) => void
    }

    let { port, part, index, label, labelId, ariaLabel, placeholder, kind, mode, editable, busy, fieldClass, variant = 'inline', ownerLabel, onvalue, oncomposing, previewSource, previewValues, onpreviewvalues, onresult, extraMarks, extraProblems, extraPicks, onfocuslayer }: Props = $props()

    const inFocus = $derived(variant === 'focus')

    const instanceId = $props.id()
    const headerId = $derived(labelId ?? `${instanceId}-label`)
    const areaId = `${instanceId}-area`
    const noteId = `${instanceId}-hl-off`
    const chipId = `${instanceId}-tokens`
    const tokenPanelId = `${instanceId}-tokens-info`
    const problemCountId = `${instanceId}-problems`

    let area = $state<HTMLTextAreaElement | undefined>()
    // An invisible `M` whose box follows the effective font size: a text-zoom change moves it with no resize of the textarea.
    let metricProbe = $state<HTMLElement | undefined>()

    // The field's text as the textarea shows it. Every reader of the text takes it from here, never from the port:
    // a stored CRLF text and its LF display have different offsets.
    const surfaceValue = (): string => area?.value ?? ''

    const controller = createFieldWriteController(
        {
            read: () => port.read(),
            write: (value) => port.write(value),
            closeStep: () => port.closeStep(),
        },
        {
            value: surfaceValue,
            reset: (value) => {
                if (area) area.value = lf(value)
            },
        },
        (result) => onresult(result),
    )

    // Derived state follows the text through `syncValue` alone. `seen` is the text the overlay, the spans and
    // the marks were last made for; it is null until the first run.
    const OVERLAY_PAUSE_MS = 250
    let seen = $state<string | null>(null)
    let spans = $state.raw<Span[]>([])
    let marks = $state.raw<Mark[]>([])
    let notes = $state.raw<Note[]>([])
    let typing = $state(false)
    let focused = $state(false)
    let scrollTop = $state(0)
    let capPx = $state<number | null>(null)
    let capNow = $state(0)
    let fine = $state(false)
    let budgetTripped = $state(false)
    // Set when the overlay reports that its lines no longer match the textarea's; sticky until the field remounts.
    let misaligned = $state(false)
    let disposed = false
    const budget = createUpdateBudget()

    // The token chip: counted 500 ms after the last change, only while the field is focused or near the viewport.
    // `counted` is the text the last request was made for, so a field that is already counted asks again only
    // when its text changes. In low power a count is asked for on blur or on a tap of the chip only.
    const TOKEN_PAUSE_MS = 500
    let chipView = $state.raw<TokenChipView | null>(null)
    let nearby = $state(false)
    let counted: string | null = null

    const tokenCopy: TokenChipCopy = {
        tokens: (n, model) => language.ltTokens(n, model),
        tokensEst: (n) => language.ltTokensEst(n),
        tokensVaries: (n, model) => language.ltTokensVaries(n, model),
        estOnline: (model) => language.ltTokEstOnline(model),
        estUnavailable: (model) => language.ltTokEstUnavailable(model),
        estError: (model) => language.ltTokEstError(model),
        get noteRaw() { return language.ltTokNoteRaw },
        get noteFilled() { return language.ltTokNote },
    }

    // The preview's values. The field that opened the layer owns them and passes them down; otherwise the field holds its
    // own. The chip and the preview read the same ones, and a change counts again once.
    let ownValues = $state.raw<PreviewValues>(NO_VALUES)
    const values = $derived(previewValues ?? ownValues)
    const previewable = $derived(previewSource !== undefined && mode !== 'plain')
    let previewOpen = $state(false)
    let composingNow = $state(false)

    function setValues(next: PreviewValues): void {
        if (onpreviewvalues) onpreviewvalues(next)
        else ownValues = next
    }

    // The problems: the checker runs 250 ms after the last change on the text the field shows, never while composing.
    // `checked` is the text the rows were made for. A result for text that has changed since is dropped: that change
    // touched every scheduler, so a newer check follows.
    const CHECK_PAUSE_MS = 250
    let rows = $state.raw<ProblemRow[]>([])
    let checked: CheckedText | null = null
    let checkRun = 0

    const problemCopy: ProblemCopy = {
        'unclosed-macro': () => language.cbsUnclosedMacro,
        'stray-macro-close': () => language.cbsStrayMacroClose,
        'unclosed-block': (problem) => language.cbsUnclosed(problem.name ?? ''),
        'stray-block-close': (problem) => language.cbsStrayBlockClose(problem.name ?? ''),
        'unknown-macro': () => language.cbsUnknown,
        'not-a-block': (problem) => language.cbsNotABlock(problem.name ?? ''),
        'misplaced-else': () => language.cbsMisplacedElse,
        'slot-outside': () => language.cbsSlotOutside,
        'deprecated': () => language.cbsDeprecated,
        'not-static': () => language.cbsNotStatic,
    }

    // The macro picker opens when a `{{` is typed and filters as the name grows. `trigger` is the open one (where its
    // `{{` sits and the name typed since); `activeAt` is the arrow choice, -1 until an arrow key is pressed. The sheet
    // lists every macro and inserts at the selection saved when it opened. `source` says which trigger opened it: the
    // macro one, or the extra source's.
    type PickerSource = 'macro' | 'extra'
    let trigger = $state.raw<(MacroTrigger & { source: PickerSource }) | null>(null)
    let activeAt = $state(-1)
    let macroIndex = $state.raw<MacroIndex | null>(null)
    let pickerEl = $state<HTMLElement | undefined>()
    let sheetOpen = $state(false)
    let sheetSelection: { start: number; end: number } | null = null
    const pickerListId = `${instanceId}-picker`
    const pickerOptionId = (at: number): string => `${instanceId}-pick-${at}`

    // The sheet always lists macros; the picker lists the items of the source that opened it.
    const macroPicks = $derived(macroIndex !== null && (trigger?.source === 'macro' || sheetOpen) ? pickItems(MACRO_ROWS, macroIndex, (id) => language.ltMacroRows[id]) : [])
    const pickerItems = $derived(trigger === null ? [] : trigger.source === 'extra' ? (extraPicks?.items() ?? []) : macroPicks)
    const matches = $derived(trigger === null ? [] : filterPicks(pickerItems, trigger.query))
    const pickerShown = $derived(editable && trigger !== null && matches.length > 0)

    const overlaySchedule = createPauseScheduler(OVERLAY_PAUSE_MS, runOverlay)
    const tokenSchedule = createPauseScheduler(TOKEN_PAUSE_MS, runTokens)
    const checkSchedule = createPauseScheduler(CHECK_PAUSE_MS, runCheck)
    const schedulers = [overlaySchedule, tokenSchedule, checkSchedule]

    const length = $derived(seen === null ? 0 : seen.length)
    const lowPowerOff = $derived(motionPrefs.lowPower && (!focused || length > WINDOW_LIMIT))
    const overlayState: 'on' | 'off' | 'typing' = $derived(budgetTripped || misaligned || lowPowerOff ? 'off' : typing ? 'typing' : 'on')
    const showOverlay = $derived(mode !== 'plain')
    const noteShown = $derived(showOverlay && (budgetTripped || misaligned || (motionPrefs.lowPower && length > WINDOW_LIMIT)))
    const describedBy = $derived([chipView ? chipId : null, rows.length > 0 ? problemCountId : null, noteShown ? noteId : null].filter((id) => id !== null).join(' '))
    // Before the first run the overlay shows the field's own text without spans.
    const segments = $derived(overlayState !== 'on' ? [] : seen === null ? segmentsOf(lf(port.read() ?? ''), [], []) : segmentsOf(seen, spans, marks, notes))

    function touchSchedulers(): void {
        for (const schedule of schedulers) schedule.touch()
    }

    /**
     * The one read-side funnel: brings everything derived from the text up to the textarea's current value.
     * It reads the surface only, writes no port and calls no controller method. Items an edit touches are
     * dropped, so no mark points at replaced text.
     */
    function syncValue(): void {
        if (disposed || !area) return
        const next = surfaceValue()
        if (seen === null) {
            seen = next
            onvalue?.(next)
            touchSchedulers()
            fit()
            return
        }
        if (next === seen) return
        const edit = editBetween(seen, next)
        seen = next
        onvalue?.(next)
        if (next.length > WINDOW_LIMIT) {
            typing = true
            spans = []
        } else {
            typing = false
            spans = shiftSpans(spans, edit)
        }
        marks = shiftSpans(marks, edit)
        notes = shiftSpans(notes, edit)
        if (rows.length > 0) rows = shiftRows(rows, edit, next)
        refreshPicker()
        touchSchedulers()
        fit()
    }

    function runOverlay(): void {
        if (disposed || seen === null || mode === 'plain') return
        typing = false
        if (budgetTripped || lowPowerOff) return
        const text = seen
        const view = { scrollTop: area?.scrollTop ?? 0, scrollHeight: area?.scrollHeight ?? 0, clientHeight: area?.clientHeight ?? 0 }
        const colouring = colourWindow(text.length, view)
        const took = measureUpdate(() => { spans = tokenSpans(text, colouring.from, colouring.to) })
        if (budget.record(took)) budgetTripped = true
        notes = extraMarks?.(text) ?? []
    }

    function runCheck(): void {
        const checkMode = mode
        if (disposed || seen === null || checkMode === 'plain' || controller.composing) return
        const text = seen
        const typingAt = focused && area ? area.selectionStart : undefined
        const run = ++checkRun
        void loadMacroIndex().then((index) => {
            if (disposed || run !== checkRun || seen !== text) return
            const result = checkCbs(text, index, { mode: checkMode, slotAllowed: false, typingAt })
            checked = { text, result }
            const extra = extraProblems?.(text) ?? []
            rows = withExtraRows(problemRows(result.problems, problemCopy), extra, text)
            marks = [...result.problems, ...extra].filter((problem) => problem.end > problem.start).map((problem) => ({ start: problem.start, end: problem.end, severity: problem.severity }))
        }, () => {})
    }

    function jumpTo(row: ProblemRow): void {
        if (!area) return
        area.focus()
        area.setSelectionRange(row.start, row.end)
    }

    // A fix is applied only to the text it was computed on. Otherwise the field is checked again at once and nothing is
    // inserted, so the author never gets a replacement computed for text they did not see.
    function applyFix(row: ProblemRow): void {
        const fix = row.fix
        if (!editable || fix === null) return
        if (controller.composing || checked === null || !fixApplies(checked, surfaceValue(), row)) {
            runCheck()
            return
        }
        insertText(fix.start, fix.end, fix.text, fix.start + fix.text.length)
    }

    // Counts the field's current text. A result for text that has since been superseded resolves null and is
    // ignored; one that arrives after the field is gone is dropped.
    function requestCount(): void {
        if (disposed || seen === null || controller.composing) return
        const text = seen
        counted = text
        if (!previewable) {
            void requestTokens(instanceId, text).then((result) => {
                if (disposed || result === null) return
                chipView = tokenChipView(result, tokenCopy)
            })
            return
        }
        void filledText(text).then(({ text: basis, count }) => requestTokens(instanceId, basis).then((result) => {
            if (disposed || result === null) return
            chipView = tokenChipView(result, tokenCopy, count)
        }))
    }

    // With a preview source the chip counts what the preview makes of the text; a failed engine load, a failed run and an
    // owner that is gone all count the text as written. A field with no source or in plain mode never waits for the engine.
    async function filledText(text: string): Promise<{ text: string, count: FilledCount }> {
        const raw = { text, count: { filled: false, varies: false } }
        if (!previewSource) return raw
        try {
            const engine = await loadPreviewEngine()
            const input = previewSource()
            if (!input.owner) return raw
            const source = engine.sandboxSourceOf(input.owner, input.chat)
            const run = engine.runPreview(text, kind, source, {
                char: values.char || source.name,
                chat: values.chat,
                toggles: values.toggles,
                samples: { user: language.sbSampleUser, char: language.sbSampleChar },
            })
            return run.ok ? { text: run.text, count: { filled: true, varies: run.varies } } : raw
        } catch {
            return raw
        }
    }

    function runTokens(): void {
        if (motionPrefs.lowPower || !(focused || nearby)) return
        requestCount()
    }

    function loadPickIndex(): void {
        if (macroIndex !== null) return
        void loadMacroIndex().then((index) => {
            if (!disposed) macroIndex = index
        }, () => {})
    }

    function closePicker(): void {
        trigger = null
        activeAt = -1
    }

    // The trigger the caret is inside, read from the text the field shows: the macro `{{` first, then the extra source's.
    function triggerAtCaret(): (MacroTrigger & { source: PickerSource }) | null {
        if (!area) return null
        const before = surfaceValue().slice(0, area.selectionStart)
        const macro = macroTrigger(before)
        if (macro !== null) return { ...macro, source: 'macro' }
        const extra = extraPicks?.trigger(before) ?? null
        return extra === null ? null : { ...extra, source: 'extra' }
    }

    // An open picker follows the text: it closes when the caret is no longer inside the same `{{`, and filters by
    // the name typed since.
    function refreshPicker(): void {
        if (trigger === null) return
        const now = triggerAtCaret()
        if (now === null || now.start !== trigger.start || now.source !== trigger.source) {
            closePicker()
            return
        }
        if (now.query !== trigger.query) {
            trigger = now
            activeAt = -1
        }
    }

    // Typing (also a composition step) opens the picker. A paste, a drop, a deletion, an insert of the field's own and
    // a caret move never do.
    function openPicker(event: Event): void {
        if (!editable || !(event instanceof InputEvent)) return
        if (event.inputType !== 'insertText' && event.inputType !== 'insertCompositionText') return
        const found = triggerAtCaret()
        if (found === null) return
        if (trigger === null || trigger.start !== found.start || trigger.query !== found.query) activeAt = -1
        trigger = found
        if (found.source === 'macro') loadPickIndex()
    }

    function inPicker(target: EventTarget | null): boolean {
        return target instanceof Node && pickerEl !== undefined && pickerEl.contains(target)
    }

    // A pick replaces the `{{` and the name typed with the item. A composition in progress is ended first by blurring the
    // field (the IME commits and the blur flush writes), so the insert is never refused. The trigger is read again
    // from the text because the blur may have changed it; once the field is blurred, no picker state is read.
    function pickItem(item: PickItem): void {
        const field = area
        if (!field) return
        const insertion = item.insertion
        const source = trigger?.source ?? 'macro'
        if (controller.composing) field.blur()
        const caret = field.selectionStart
        const before = surfaceValue().slice(0, caret)
        const found = source === 'extra' ? (extraPicks?.trigger(before) ?? null) : macroTrigger(before)
        if (found === null) {
            closePicker()
            return
        }
        insertText(found.start, caret, insertion.text, found.start + insertion.caret)
        closePicker()
    }

    function openSheet(): void {
        if (!editable || !area) return
        sheetSelection = { start: area.selectionStart, end: area.selectionEnd }
        closePicker()
        sheetOpen = true
        loadPickIndex()
    }

    function closeSheet(refocus: boolean): void {
        sheetOpen = false
        sheetSelection = null
        if (refocus) area?.focus()
    }

    function chooseFromSheet(item: PickItem): void {
        const saved = sheetSelection
        closeSheet(false)
        if (!saved) return
        const length = surfaceValue().length
        const start = Math.min(saved.start, length)
        const end = Math.min(Math.max(saved.end, start), length)
        insertText(start, end, item.insertion.text, start + item.insertion.caret)
    }

    // The full-screen layer lives exactly as long as this flag: it is a sibling after the field's wrapper, so the field's
    // own keys and chip state never see the nested field's events.
    let focusOpen = $state(false)
    // Whether the layer opens with its find bar showing (the Find button) or not (Maximize, Ctrl+E).
    let focusFind = $state(false)

    // A composition in progress is ended first by blurring the field (the IME commits and the blur flush writes), so the
    // nested field opens on the text the author typed.
    function openFocus(withFind = false): void {
        if (controller.composing) area?.blur()
        closePicker()
        focusFind = withFind
        focusOpen = true
        onfocuslayer?.(true)
    }

    function closeFocus(): void {
        focusOpen = false
        focusFind = false
        onfocuslayer?.(false)
    }

    // A layer that is torn down with its field never runs `closeFocus`; the owner of the hold still hears it close.
    onDestroy(() => {
        if (focusOpen) onfocuslayer?.(false)
    })

    // Keys are ignored while an IME is composing. Esc is stopped only when it closes an open picker, so with nothing
    // open it reaches the Studio screen unchanged.
    function onKeydown(event: KeyboardEvent): void {
        if (event.isComposing || event.keyCode === 229) return
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'Space') {
            event.preventDefault()
            openSheet()
            return
        }
        if (!inFocus && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'e') {
            event.preventDefault()
            openFocus()
            return
        }
        const open = trigger
        if (open === null) return
        const count = pickerShown ? matches.length : 0
        switch (event.key) {
            case 'Escape':
                if (pickerShown) {
                    event.preventDefault()
                    event.stopPropagation()
                }
                closePicker()
                return
            case 'ArrowDown':
            case 'ArrowUp':
                if (count === 0) return
                event.preventDefault()
                activeAt = event.key === 'ArrowDown' ? (activeAt + 1) % count : activeAt <= 0 ? count - 1 : activeAt - 1
                return
            case 'Enter':
            case 'Tab': {
                // Enter also takes the first match of a typed name; Tab takes an arrow choice only.
                const chosen = activeAt >= 0 ? matches[activeAt] : event.key === 'Enter' && open.query !== '' ? matches[0] : undefined
                if (chosen === undefined) {
                    closePicker()
                    return
                }
                event.preventDefault()
                pickItem(chosen)
                return
            }
            case 'ArrowLeft':
            case 'ArrowRight':
            case 'Home':
            case 'End':
                closePicker()
                return
        }
    }

    function px(value: string): number {
        const parsed = parseFloat(value)
        return Number.isFinite(parsed) ? parsed : 0
    }

    function lineHeightPx(): number {
        return area ? px(getComputedStyle(area).lineHeight) || 20 : 20
    }

    function currentCap(): number {
        return capPx ?? readCap(kind) ?? Math.round(window.innerHeight * (studioScreen.layout === 'stack' ? 0.6 : 0.7))
    }

    // Grows with the text between three lines and the cap; beyond the cap the textarea scrolls.
    function fit(): void {
        if (!area || inFocus) return
        area.style.height = 'auto'
        const computed = getComputedStyle(area)
        const borders = area.offsetHeight - area.clientHeight
        const floor = 3 * lineHeightPx() + px(computed.paddingTop) + px(computed.paddingBottom) + borders
        const cap = currentCap()
        capNow = cap
        area.style.height = `${Math.round(Math.max(floor, Math.min(area.scrollHeight + borders, cap)))}px`
    }

    // The one reaction to a change of the text metrics (font scale or font size) that does not resize the textarea.
    // The overlay notices the resulting height change through its own area observer.
    function onMetricsChange(): void {
        fit()
    }

    function setCap(next: number, persist: boolean): void {
        capPx = Math.round(Math.max(CAP_MIN_PX, Math.min(CAP_MAX_PX, next)))
        if (persist) writeCap(kind, capPx)
        fit()
    }

    let dragFrom: { y: number; cap: number } | null = null

    function onHandleKey(event: KeyboardEvent): void {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        setCap(currentCap() + (event.key === 'ArrowDown' ? 1 : -1) * lineHeightPx(), true)
    }

    function onHandleDown(event: PointerEvent & { currentTarget: HTMLElement }): void {
        dragFrom = { y: event.clientY, cap: currentCap() }
        event.currentTarget.setPointerCapture?.(event.pointerId)
    }

    function onHandleMove(event: PointerEvent): void {
        if (dragFrom) setCap(dragFrom.cap + event.clientY - dragFrom.y, false)
    }

    function onHandleUp(): void {
        if (!dragFrom) return
        dragFrom = null
        if (capPx !== null) writeCap(kind, capPx)
    }

    // The composing edge of the controller drives every scheduler: a composition that ends by blur has no
    // compositionend, so the scheduler follows `controller.composing` rather than the DOM event names.
    function settle(composingBefore: boolean): void {
        const composingAfter = controller.composing
        if (!composingBefore && composingAfter) for (const schedule of schedulers) schedule.compositionStart()
        else if (composingBefore && !composingAfter) for (const schedule of schedulers) schedule.compositionEnd()
        if (composingBefore !== composingAfter) {
            composingNow = composingAfter
            oncomposing?.(composingAfter)
        }
        syncValue()
    }

    function around(handle: () => void): void {
        const composingBefore = controller.composing
        handle()
        settle(composingBefore)
    }

    onMount(() => registerStudioField(controller.flush))
    onDestroy(() => {
        disposed = true
        for (const schedule of schedulers) schedule.cancel()
        controller.dispose()
    })

    onMount(() => {
        fine = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches
        let width = area?.clientWidth ?? 0
        const observer = typeof ResizeObserver === 'undefined' || !area ? null : new ResizeObserver(() => {
            const next = area?.clientWidth ?? 0
            if (next === width) return
            width = next
            fit()
        })
        if (area) observer?.observe(area)
        // The probe's first callback reports the size it already has; the unchanged-size return skips it.
        let probeWidth = metricProbe?.offsetWidth ?? 0
        let probeHeight = metricProbe?.offsetHeight ?? 0
        const probeObserver = typeof ResizeObserver === 'undefined' || !metricProbe ? null : new ResizeObserver(() => {
            const nextWidth = metricProbe?.offsetWidth ?? 0
            const nextHeight = metricProbe?.offsetHeight ?? 0
            if (nextWidth === probeWidth && nextHeight === probeHeight) return
            probeWidth = nextWidth
            probeHeight = nextHeight
            onMetricsChange()
        })
        if (metricProbe) probeObserver?.observe(metricProbe)
        const onViewport = (): void => fit()
        window.addEventListener('resize', onViewport)
        return () => {
            observer?.disconnect()
            probeObserver?.disconnect()
            window.removeEventListener('resize', onViewport)
        }
    })

    // A change of the owner's value with no DOM event (undo, redo, revert, a peer write) re-renders the textarea at
    // Svelte's flush; this effect runs after that and reads the new DOM value.
    $effect(() => {
        port.read()
        void area
        untrack(syncValue)
    })

    // Colour returns when low power ends or the field is focused again.
    $effect(() => {
        if (!lowPowerOff) untrack(() => overlaySchedule.touch())
    })

    // A field that becomes countable (focused or near the viewport, or out of low power) with an uncounted text is
    // counted after the pause.
    $effect(() => {
        if (motionPrefs.lowPower || !(focused || nearby)) return
        untrack(() => { if (seen !== null && counted !== seen) tokenSchedule.touch() })
    })

    // A change of the preview's values counts the chip again once.
    $effect(() => {
        void values
        untrack(() => { if (previewable && seen !== null) tokenSchedule.touch() })
    })

    function onFocus(event: FocusEvent & { currentTarget: HTMLTextAreaElement }): void {
        focused = true
        // The value the field had when it was focused: the browser's own undo owns the field until it is back here.
        event.currentTarget.dataset.studioFocusValue = event.currentTarget.value
    }

    function onInput(event: Event): void {
        around(() => controller.input(event instanceof InputEvent && event.isComposing))
        openPicker(event)
    }

    function onScroll(): void {
        scrollTop = area?.scrollTop ?? 0
        if (seen !== null && seen.length > WINDOW_LIMIT) overlaySchedule.touch()
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

    /** The text the textarea shows (LF endings). Read-only. */
    export function value(): string {
        return surfaceValue()
    }

    /** The textarea's selection in the LF text; 0/0 before it exists. Read-only. */
    export function selection(): { start: number, end: number } {
        return { start: area?.selectionStart ?? 0, end: area?.selectionEnd ?? 0 }
    }

    /** Whether an IME composition is in progress. Read-only. */
    export function composing(): boolean {
        return controller.composing
    }

    /** Selects `start..end` in the field and focuses it, then hands focus to `refocus` (the control the caller works in). */
    export function reveal(start: number, end: number, refocus?: HTMLElement | null): void {
        if (!area) return
        area.focus()
        area.setSelectionRange(start, end)
        refocus?.focus()
    }

    /** Runs `fn` and restores the textarea's scroll position, so an insert does not move the view. */
    export function keepScroll(fn: () => void): void {
        const top = area?.scrollTop ?? 0
        fn()
        if (area) area.scrollTop = top
    }
</script>

<div class="flex min-w-0 flex-1 flex-col gap-1" class:min-h-0={inFocus} data-kind={kind} data-mode={mode}>
    <div class="flex flex-wrap items-start justify-between gap-2" data-part="studio-lt-header" use:nearViewport={{ onChange: (visible) => { nearby = visible } }}>
        {#if label && !inFocus}
            <label id={headerId} for={areaId} class="font-bold">{label}</label>
        {/if}
        {#if rows.length > 0}
            <span id={problemCountId} data-part="studio-lt-problem-count" class="text-xs text-textcolor2">{language.ltProblemCount(rows.length)}</span>
        {/if}
        <LongTextTokens view={chipView} {chipId} panelId={tokenPanelId} onrefresh={requestCount} />
        <button
            type="button"
            data-part="studio-lt-braces"
            class="rounded bg-darkbg px-2 text-textcolor2 hover:text-textcolor disabled:opacity-50"
            aria-label={language.ltInsertMacro}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            disabled={!editable}
            onclick={openSheet}
        >{'{ }'}</button>
        {#if !inFocus}
            <button
                type="button"
                data-part="studio-lt-find"
                class="rounded bg-darkbg px-2 text-textcolor2 hover:text-textcolor"
                aria-label={language.ltFind}
                aria-haspopup="dialog"
                onclick={() => openFocus(true)}
            ><SearchIcon size={16} /></button>
            {#if previewable}
                <button
                    type="button"
                    data-part="studio-lt-preview"
                    class="rounded bg-darkbg px-2 text-textcolor2 hover:text-textcolor"
                    aria-label={language.ltPreview}
                    aria-haspopup="dialog"
                    aria-expanded={previewOpen}
                    onclick={() => { closePicker(); previewOpen = true }}
                ><EyeIcon size={16} /></button>
            {/if}
            <button
                type="button"
                data-part="studio-lt-focus"
                class="rounded bg-darkbg px-2 text-textcolor2 hover:text-textcolor"
                aria-label={language.ltFocus}
                aria-haspopup="dialog"
                aria-expanded={focusOpen}
                onclick={() => openFocus()}
            ><Maximize2Icon size={16} /></button>
        {/if}
    </div>
    <div class="relative flex flex-col" class:min-h-0={inFocus} class:flex-1={inFocus}>
        <textarea
            bind:this={area}
            id={areaId}
            data-part={part}
            data-index={index}
            class="{fieldClass} {LT_TEXT_LAYOUT}"
            class:caret-textcolor={showOverlay && overlayState === 'on'}
            style:color={showOverlay && overlayState === 'on' ? 'transparent' : undefined}
            dir="auto"
            readonly={!editable}
            aria-busy={busy ? 'true' : undefined}
            aria-label={ariaLabel}
            {placeholder}
            aria-labelledby={label || inFocus ? headerId : undefined}
            aria-describedby={describedBy || undefined}
            aria-controls={pickerShown ? pickerListId : undefined}
            aria-activedescendant={pickerShown && activeAt >= 0 ? pickerOptionId(activeAt) : undefined}
            value={lf(port.read() ?? '')}
            onfocus={onFocus}
            oninput={onInput}
            onkeydown={onKeydown}
            onclick={closePicker}
            onscroll={onScroll}
            oncompositionstart={() => around(() => controller.compositionStart())}
            oncompositionend={() => around(() => controller.compositionEnd())}
            onblur={(event) => {
                focused = false
                if (trigger !== null && !inPicker(event.relatedTarget)) closePicker()
                around(() => controller.blur())
                if (motionPrefs.lowPower) requestCount()
            }}
        ></textarea>
        <span bind:this={metricProbe} aria-hidden="true" data-part="studio-lt-metric-probe" class="invisible absolute inline-block">M</span>
        {#if showOverlay}
            <LongTextOverlay {area} {segments} phase={overlayState} {scrollTop} onmisalign={() => { misaligned = true }} />
        {/if}
        <!-- Both trigger prefixes (`{{` and `@@`) are two characters, so the offset is the same for either source. -->
        {#if trigger !== null && pickerShown}
            <MacroPicker
                bind:root={pickerEl}
                {area}
                items={matches}
                active={activeAt}
                offset={trigger.start + 2 + trigger.query.length}
                label={trigger.source === 'extra' ? extraPicks?.label?.() : undefined}
                matches={trigger.source === 'extra' ? extraPicks?.matches : undefined}
                stack={studioScreen.layout === 'stack'}
                listId={pickerListId}
                optionId={pickerOptionId}
                isOpen={() => trigger !== null}
                onpick={pickItem}
                onclose={closePicker}
            />
        {/if}
    </div>
    {#if fine && !inFocus}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={language.ltHeightHandle}
            aria-valuemin={CAP_MIN_PX}
            aria-valuemax={CAP_MAX_PX}
            aria-valuenow={capNow}
            tabindex="0"
            data-part="studio-lt-height-handle"
            class="h-1.5 w-full cursor-row-resize touch-none rounded-full bg-darkborderc hover:bg-selected focus-visible:bg-selected"
            onkeydown={onHandleKey}
            onpointerdown={onHandleDown}
            onpointermove={onHandleMove}
            onpointerup={onHandleUp}
            onpointercancel={onHandleUp}
        ></div>
    {/if}
    {#if noteShown}
        <p id={noteId} data-part="studio-lt-hl-off" class="text-xs text-textcolor2">{language.ltHlOff}</p>
    {/if}
    <LongTextProblems {rows} {editable} onjump={jumpTo} onfix={applyFix} />
    {#if sheetOpen}
        <MacroSheet items={macroPicks} isOpen={() => sheetOpen} onchoose={chooseFromSheet} onclose={closeSheet} />
    {/if}
    {#if previewOpen && previewSource}
        <LongTextPreview
            variant="sheet"
            {kind}
            text={seen ?? ''}
            composing={composingNow}
            active={true}
            lowPower={motionPrefs.lowPower}
            {previewSource}
            {values}
            onvalues={setValues}
            onclose={(refocus) => { previewOpen = false; if (refocus) area?.focus() }}
        />
    {/if}
</div>
{#if focusOpen}
    <LongTextFocus
        {port}
        {kind}
        {mode}
        {editable}
        {busy}
        {onresult}
        title={label ?? ariaLabel ?? ''}
        {ownerLabel}
        {extraMarks}
        {extraProblems}
        {extraPicks}
        findOnOpen={focusFind}
        {previewSource}
        {values}
        onvalues={setValues}
        returnTo={() => area ?? null}
        onclose={closeFocus}
    />
{/if}
