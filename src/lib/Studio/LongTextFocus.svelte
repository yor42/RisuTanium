<script lang="ts">
    import { ArrowLeftIcon, EyeIcon, Redo2Icon, RotateCcwIcon, SearchIcon, Undo2Icon } from '@lucide/svelte'
    import { getContext, untrack } from 'svelte'
    import { isTopmostShell, makeInert, registerShell, returnFocus, trapTab, watchFocus } from '../Nexus/pattern/patternFocus'
    import { language } from '../../lang'
    import { motionPrefs } from '../../ts/chatShell/motionPrefs.svelte'
    import type { StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { currentVisitAck } from '../../ts/studio/history/studioHistoryService.svelte'
    import { STUDIO_HISTORY_STEP, type StudioHistoryStep } from '../../ts/studio/historyStepContext'
    import type { LongTextKind, LongTextMode, LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
    import { mapCaret } from '../../ts/studio/longText/findReplace'
    import { editBetween, type Note } from '../../ts/studio/longText/highlightSpans'
    import { registerStudioBackLayer } from '../../ts/studio/studioBack.svelte'
    import { setStudioNotice, studioScreen } from '../../ts/studio/studioScreen.svelte'
    import type { PickSource } from '../../ts/studio/longText/macroPick'
    import type { ExtraProblem } from '../../ts/studio/longText/problemsModel'
    import LongTextField from './LongTextField.svelte'
    import LongTextFind from './LongTextFind.svelte'
    import LongTextPreview, { type PreviewSourceInput, type PreviewValues } from './LongTextPreview.svelte'
    import StudioNotice from './StudioNotice.svelte'
    import StudioStatusChip from './StudioStatusChip.svelte'

    // The full-screen layer of one long-text field: a modal dialog over the Studio screen, holding a second field on the
    // same write port. It lives exactly as long as its parent keeps it mounted, and everything it holds (the modal layer,
    // the inert background, the Back layer) is released with it.
    interface Props {
        port: LongTextWritePort
        kind: LongTextKind
        mode: LongTextMode
        editable: boolean
        busy: boolean
        onresult: (result: StudioResult | null) => void
        title: string
        ownerLabel?: string
        // The same display notes the opening field draws; the nested field never writes through them.
        extraMarks?: (text: string) => Note[]
        // The same display problems and picker source the opening field has.
        extraProblems?: (text: string) => ExtraProblem[]
        extraPicks?: PickSource
        // Whether the find bar is showing when the layer opens.
        findOnOpen?: boolean
        // The CBS preview: its source, and the values the opening field owns so the field's chip and the pane share them.
        previewSource?: () => PreviewSourceInput
        values: PreviewValues
        onvalues: (next: PreviewValues) => void
        // The control focus goes back to when the layer closes, read at that moment.
        returnTo: () => HTMLElement | null
        onclose: () => void
    }

    let { port, kind, mode, editable, busy, onresult, title, ownerLabel, extraMarks, extraProblems, extraPicks, findOnOpen = false, previewSource, values, onvalues, returnTo, onclose }: Props = $props()

    const titleId = $props.id()
    const token = {}
    const history = getContext<StudioHistoryStep | undefined>(STUDIO_HISTORY_STEP)

    let layer = $state<HTMLElement | undefined>()
    let field = $state<ReturnType<typeof LongTextField>>()
    let findBar = $state<ReturnType<typeof LongTextFind>>()

    // `opened` is the nested field's first text: what Revert goes back to, set again at every opening. `text` follows
    // the field. Both are set from `onvalue`, which only reads.
    let opened = $state<string | null>(null)
    let text = $state('')
    let findOpen = $state(untrack(() => findOnOpen))
    let replaceOpen = $state(false)

    // The preview is a side pane on a wide screen, and a second tab (next to Edit) on a narrower one. The nested field
    // stays mounted under either, so its text and its composition are never lost to a tab change.
    let previewOn = $state(false)
    let tab = $state<'edit' | 'preview'>('edit')
    let composing = $state(false)
    const previewable = $derived(previewSource !== undefined && mode !== 'plain')
    const wide = $derived(studioScreen.layout === 'wide')

    function togglePreview(): void {
        previewOn = !previewOn
        tab = previewOn ? 'preview' : 'edit'
    }

    function onvalue(value: string): void {
        if (opened === null) opened = value
        text = value
    }

    function openFind(withReplace: boolean): void {
        if (withReplace) replaceOpen = true
        if (findOpen) findBar?.focusQuery()
        else findOpen = true
    }

    function closeFind(): void {
        findOpen = false
        replaceOpen = false
        focusTextarea()?.focus()
    }

    // One ordinary forward step of the field's write kind: the edit between the text now and the text at opening, so a
    // composing or read-only refusal leaves everything as it was.
    function revert(): void {
        const f = field
        const target = opened
        if (!f || target === null || !editable) return
        const current = f.value()
        if (current === target) return
        const caret = f.selection().end
        const edit = editBetween(current, target)
        f.keepScroll(() => f.insertText(edit.start, edit.start + edit.removed, target.slice(edit.start, edit.start + edit.inserted), mapCaret(caret, edit)))
    }

    // Back is handled exactly when this layer closes: `open` is flipped synchronously by `close`, which is what the Back
    // handler's before and after snapshot sees. It is state of the layer itself, never a constant.
    let open = $state(true)

    function close(): void {
        if (!open) return
        open = false
        onclose()
    }

    registerStudioBackLayer({ isOpen: () => open, close })

    const focusTextarea = (): HTMLTextAreaElement | null => layer?.querySelector<HTMLTextAreaElement>('[data-part="studio-lt-focus-input"]') ?? null

    /** Every sibling along the path from `node` up to the Studio root (or the body): the page behind the layer. */
    function backgroundOf(node: HTMLElement): HTMLElement[] {
        const stop = node.closest<HTMLElement>('[data-part="studio"]')
        const held: HTMLElement[] = []
        let current = node
        for (let parent = current.parentElement; parent && parent !== document.body; parent = current.parentElement) {
            for (const sibling of Array.from(parent.children)) {
                if (sibling !== current && sibling instanceof HTMLElement) held.push(sibling)
            }
            if (parent === stop) break
            current = parent
        }
        return held
    }

    // While mounted the shell holds a modal layer (toast timers pause), the page behind is inert, and focus stays on a
    // live control inside the layer: a root Ctrl+Z moves focus to the changed field, and watchFocus pulls it back.
    // Teardown releases all of it, then returns focus to the control that opened the layer, once it is no longer inert.
    $effect(() => {
        const area = layer
        if (!area) return
        const opener = untrack(returnTo)
        const unregisterShell = registerShell(token)
        const restoreInert = makeInert(backgroundOf(area))
        const input = focusTextarea() ?? area
        if (!untrack(() => findOpen)) input.focus()
        const stopWatching = watchFocus(area, input, () => isTopmostShell(token))
        return () => {
            stopWatching()
            unregisterShell()
            restoreInert()
            returnFocus(opener)
        }
    })

    // Keys are ignored while an IME is composing. Esc closes the layer (an inner picker or sheet that closed something
    // stopped it already); Ctrl+K is swallowed so the screen's search never opens under the layer. Undo and redo keys
    // bubble to the Studio root unchanged.
    function onkeydown(event: KeyboardEvent): void {
        if (event.isComposing || event.keyCode === 229) return
        if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close()
            return
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
            event.preventDefault()
            event.stopPropagation()
            return
        }
        // Ctrl+F opens find and Ctrl+H adds the replace row; both are taken from the browser.
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key.toLowerCase() === 'f' || event.key.toLowerCase() === 'h')) {
            event.preventDefault()
            event.stopPropagation()
            openFind(event.key.toLowerCase() === 'h')
            return
        }
        if (layer) trapTab(event, layer)
    }

    const iconButton = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-selected disabled:opacity-50 cursor-pointer'
    const tabButton = 'rounded-t-md px-3 py-2 text-sm hover:bg-selected aria-selected:bg-darkbutton aria-selected:font-bold cursor-pointer'
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
    bind:this={layer}
    data-part="studio-lt-focus-layer"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
    class="fixed inset-0 z-40 flex flex-col bg-bgcolor text-textcolor outline-none"
    {onkeydown}
>
    <div data-part="studio-lt-focus-header" class="flex shrink-0 items-center gap-2 border-b border-darkborderc px-2">
        <button type="button" data-part="studio-lt-focus-close" class={iconButton} aria-label={language.ltFocusClose} onclick={close}>
            <ArrowLeftIcon size={20} />
        </button>
        <h2 id={titleId} data-part="studio-lt-focus-title" class="min-w-0 truncate font-bold">{title}</h2>
        {#if ownerLabel}
            <span data-part="studio-lt-focus-owner" class="hidden min-w-0 truncate text-sm text-textcolor2 min-[600px]:inline">{ownerLabel}</span>
        {/if}
        <span class="ms-auto flex shrink-0 items-center gap-1">
            <StudioStatusChip ack={currentVisitAck()} />
            <button type="button" data-part="studio-lt-focus-find" class={iconButton} aria-label={language.ltFind} aria-expanded={findOpen} onclick={() => { if (findOpen) closeFind(); else openFind(false) }}>
                <SearchIcon size={18} />
            </button>
            {#if previewable}
                <button type="button" data-part="studio-lt-focus-preview" class={iconButton} aria-label={language.ltPreview} aria-pressed={previewOn} onclick={togglePreview}>
                    <EyeIcon size={18} />
                </button>
            {/if}
            <button type="button" data-part="studio-lt-focus-revert" class={iconButton} aria-label={language.ltRevert} disabled={!editable || opened === null || text === opened} onclick={revert}>
                <RotateCcwIcon size={18} />
            </button>
            {#if history}
                <button type="button" data-part="studio-lt-focus-undo" class={iconButton} aria-label={language.studioHistoryUndo} disabled={!history.can('undo')} onclick={() => history.step('undo', focusTextarea())}>
                    <Undo2Icon size={18} />
                </button>
                <button type="button" data-part="studio-lt-focus-redo" class={iconButton} aria-label={language.studioHistoryRedo} disabled={!history.can('redo')} onclick={() => history.step('redo', focusTextarea())}>
                    <Redo2Icon size={18} />
                </button>
            {/if}
        </span>
    </div>
    <div data-part="studio-lt-focus-notice" class="shrink-0">
        <StudioNotice message={studioScreen.notice} places={studioScreen.noticePlaces?.places} ownerKind={studioScreen.noticePlaces?.ownerKind} ondismiss={() => setStudioNotice(null)} />
    </div>
    {#if findOpen}
        <LongTextFind bind:this={findBar} {field} {text} {editable} replace={replaceOpen} onclose={closeFind} />
    {/if}
    {#if previewOn && previewable && !wide}
        <div role="tablist" data-part="studio-lt-focus-tabs" class="flex shrink-0 gap-1 border-b border-darkborderc px-3 pt-2">
            <button type="button" role="tab" data-part="studio-lt-focus-tab-edit" class={tabButton} aria-selected={tab === 'edit'} onclick={() => { tab = 'edit' }}>{language.ltTabEdit}</button>
            <button type="button" role="tab" data-part="studio-lt-focus-tab-preview" class={tabButton} aria-selected={tab === 'preview'} onclick={() => { tab = 'preview' }}>{language.ltPreview}</button>
        </div>
    {/if}
    <div class="flex min-h-0 flex-1 gap-3 p-3">
        <div class="flex min-h-0 min-w-0 flex-1 flex-col" class:hidden={previewOn && !wide && tab === 'preview'}>
            <LongTextField
                bind:this={field}
                {onvalue}
                oncomposing={(now) => { composing = now }}
                {port}
                part="studio-lt-focus-input"
                labelId={titleId}
                {kind}
                {mode}
                {editable}
                {busy}
                variant="focus"
                {extraMarks}
                {extraProblems}
                {extraPicks}
                {previewSource}
                previewValues={values}
                onpreviewvalues={onvalues}
                fieldClass="min-h-0 w-full flex-1 resize-none rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
                {onresult}
            />
        </div>
        {#if previewOn && previewable && previewSource && (wide || tab === 'preview')}
            <div class="flex min-h-0 min-w-0 flex-col {wide ? 'w-2/5 shrink-0' : 'flex-1'}">
                <LongTextPreview variant="pane" {kind} text={text} {composing} active={true} lowPower={motionPrefs.lowPower} {previewSource} {values} {onvalues} />
            </div>
        {/if}
    </div>
</div>
