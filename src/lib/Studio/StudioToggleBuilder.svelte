<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import { characterTogglePort } from '../../ts/studio/edit/toggleTextPort'
    import { createStudioToasts, refusalTextOf } from '../../ts/studio/edit/studioToasts'
    import { ensureStudioHistory, getStudioHistoryService, studioHistoryLoadFailed } from '../../ts/studio/history/studioHistoryService.svelte'
    import { registerStudioBackLayer } from '../../ts/studio/studioBack.svelte'
    import { studioScreen } from '../../ts/studio/studioScreen.svelte'
    import { appToggleKeys, createToggleBuilder, restoreLines, TOGGLE_KEY_EDITS_LIVE, type EditOutcome } from '../../ts/studio/toggleBuilder.svelte'
    import { caretOffsetOf, rowAtLine, rowViewOf, type MoveDirection, type NewKind } from '../../ts/studio/toggleBuilderModel'
    import { lineById, type LineId } from '../../ts/studio/toggleDef'
    import { ownerStem } from '../../ts/studio/toggleKeys'
    import { DBState } from '../../ts/stores.svelte'
    import type { ToastHost } from '../../ts/toast/toastHost.svelte'
    import StudioToggleEditor from './StudioToggleEditor.svelte'
    import StudioToggleList from './StudioToggleList.svelte'
    import StudioToggleText from './StudioToggleText.svelte'

    // The list builder of one character's toggle definition. Every edit goes through the history service as a whole
    // string write; the page's own copy of the definition is parsed from the live text and re-read whenever that text
    // changes outside it (an undo, a restore, another editor).
    interface Props {
        chaId: string
        // The toast host of the delete toast; the app's own host when absent (tests pass one on a fake clock).
        host?: ToastHost
    }

    let { chaId, host }: Props = $props()

    // A side-by-side layout needs a list and a 560 px editor column.
    const WIDE_AT = 1000

    const port = characterTogglePort(untrack(() => chaId))
    const toasts = createStudioToasts({ service: getStudioHistoryService, host: untrack(() => host) })
    const character = untrack(() => DBState.db.characters?.find((candidate) => candidate?.chaId === chaId))
    const builder = createToggleBuilder(port, {
        keyEditsLive: TOGGLE_KEY_EDITS_LIVE,
        stem: ownerStem(character && character.type !== 'group' ? character.name ?? '' : '', untrack(() => chaId)),
        appKeys: appToggleKeys(untrack(() => chaId)),
    })

    const service = $derived(getStudioHistoryService())
    $effect(() => {
        if (service) {
            untrack(() => port.begin())
        } else {
            ensureStudioHistory()
        }
    })
    // An outside change of the text is taken in without a write.
    $effect(() => {
        const live = port.read()
        untrack(() => builder.resync(live))
    })

    const view = $derived(port.view())
    const editable = $derived(view.editable)
    const loadFailed = $derived(!service && studioHistoryLoadFailed())

    let width = $state(0)
    let root = $state<HTMLElement | undefined>()
    // The layout follows the builder's own width, not the window's: the drawer and the tree take part of the page.
    $effect(() => {
        const element = root
        if (!element) return
        width = element.clientWidth
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(() => { width = element.clientWidth })
        observer.observe(element)
        return () => observer.disconnect()
    })
    // The text view shows the same definition as one field; nothing is stored about which view was last open.
    let mode = $state<'list' | 'text'>('list')
    let announcement = $state('')
    const wide = $derived(width >= WIDE_AT)
    const editorOpen = $derived(builder.editor !== null || builder.pending !== null)
    const editorKey = $derived(builder.pending !== null ? 'pending' : String(builder.editor?.id ?? ''))
    const errorShown = $derived(builder.error !== null && !editorOpen && mode === 'list')

    let textView = $state<ReturnType<typeof StudioToggleText> | undefined>()
    let caretAt = $state(0)

    // The row open in the list becomes the caret's line; the line under the caret becomes the open row when the author
    // moved the caret, so a view switch alone never changes the selection.
    function showText(): void {
        if (mode === 'text') return
        const id = builder.editor?.id
        caretAt = id === undefined ? 0 : caretOffsetOf(builder.def, id)
        mode = 'text'
    }

    function showList(): void {
        if (mode === 'list') return
        const line = textView?.caretLine() ?? null
        if (line !== null) {
            const id = rowAtLine(builder.def, line)
            if (id === null) builder.close()
            else builder.open(id)
        }
        mode = 'list'
    }

    // The editor as a page of its own sits over the list like the detail over the tree: Back closes it first.
    registerStudioBackLayer({
        isOpen: () => mode === 'list' && !wide && editorOpen &&!studioScreen.searchOpen && !studioScreen.drawerOpen && !studioScreen.historyOpen,
        close: () => closeEditor(),
    })

    async function focusRow(id: LineId | null): Promise<void> {
        await afterFlush()
        const target = id === null ? root?.querySelector<HTMLElement>('[data-part="studio-toggle-add"]') : root?.querySelector<HTMLElement>(`[data-row-id="${id}"]`)
        target?.focus()
    }

    function closeEditor(): void {
        const id = builder.editor?.id ?? null
        builder.close()
        void focusRow(id)
    }

    function nameOf(id: LineId): string {
        const line = lineById(builder.def, id)?.line
        const label = line ? rowViewOf(line).label : ''
        return label !== '' ? label : language.studioTgUnnamed
    }

    function report(outcome: EditOutcome): void {
        if (outcome.ok === false && outcome.kind === 'cantMove') announcement = language.studioTgCantMove
    }

    function failureText(outcome: EditOutcome): string {
        if (outcome.ok !== false) return ''
        return outcome.kind === 'refused' ? refusalTextOf({ reason: outcome.reason })
            : outcome.kind === 'unavailable' ? refusalTextOf({ reason: 'loading' })
            : language.studioTgNotWritten
    }

    const actions = {
        add(kind: NewKind, group: LineId | null): void {
            report(builder.startAdd(kind, group))
        },
        async remove(id: LineId): Promise<void> {
            const rows = builder.rows()
            const at = rows.findIndex((row) => row.id === id)
            const label = nameOf(id)
            const outcome = builder.deleteRow(id)
            if (outcome.ok === false || outcome.removed === undefined) return
            const removed = outcome.removed
            toasts.postUndoAction(language.studioTgDeleted(label), () => {
                const restored = restoreLines(port, removed)
                return restored.ok ? { ok: true, text: language.studioTgRestored } : { ok: false, text: failureText(restored) }
            })
            // Focus goes to the row that took the place, else the one before it, else the add button.
            await afterFlush()
            const after = builder.rows()
            const next = after[at] ?? after[at - 1]
            void focusRow(next ? next.id : null)
        },
        duplicate(id: LineId): void {
            report(builder.duplicate(id))
        },
        move(id: LineId, direction: MoveDirection): void {
            const outcome = builder.move(id, direction)
            if (outcome.ok && outcome.movedTo !== undefined) announcement = language.studioTgMoved(nameOf(id), outcome.movedTo)
            report(outcome)
        },
        moveToGroup(id: LineId, group: LineId): void {
            const outcome = builder.moveToGroup(id, group)
            if (outcome.ok && outcome.movedTo !== undefined) announcement = language.studioTgMoved(nameOf(id), outcome.movedTo)
            report(outcome)
        },
        moveOut(id: LineId): void {
            const outcome = builder.moveOut(id)
            if (outcome.ok && outcome.movedTo !== undefined) announcement = language.studioTgMoved(nameOf(id), outcome.movedTo)
            report(outcome)
        },
        changeKind(id: LineId, kind: Exclude<NewKind, 'group'>): void {
            const outcome = builder.changeKind(id, kind)
            if (outcome.ok && outcome.optionsDropped) announcement = language.studioTgOptionsDropped
        },
        closeStep(): void {
            port.closeOpenStep()
        },
    }

    function retry(): void {
        ensureStudioHistory()
    }

    onDestroy(() => port.closeOpenStep())
</script>

{#if !view.restricted}
    <section bind:this={root} data-part="studio-toggle-builder" data-layout={wide ? 'wide' : 'narrow'} class="flex flex-col gap-3" aria-busy={editable ? undefined : 'true'}>
        {#if !editable && !loadFailed}
            <p data-part="studio-form-loading" class="text-sm text-textcolor2">{language.studioFormLoading}</p>
        {/if}
        {#if loadFailed}
            <p role="status" data-part="studio-form-banner" data-banner="failed" class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{language.studioBannerFailed}</p>
            <button type="button" data-part="studio-history-retry" class="min-h-11 self-start rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={retry}>{language.studioChipRetry}</button>
        {/if}
        {#if view.banner}
            <p role="status" data-part="studio-form-banner" class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{view.banner}</p>
        {/if}
        <div role="group" aria-label={language.studioTgViewLabel} class="flex self-start overflow-hidden rounded-md border border-darkborderc">
            <button type="button" data-part="studio-toggle-view-list" aria-pressed={mode === 'list'} class={`min-h-11 px-3 cursor-pointer hover:bg-selected ${mode === 'list' ? 'bg-selected' : ''}`} onclick={showList}>{language.studioTgViewList}</button>
            <button type="button" data-part="studio-toggle-view-text" aria-pressed={mode === 'text'} class={`min-h-11 px-3 cursor-pointer hover:bg-selected ${mode === 'text' ? 'bg-selected' : ''}`} onclick={showText}>{language.studioTgViewText}</button>
        </div>
        {#if mode === 'text'}
            <StudioToggleText bind:this={textView} {builder} {port} {editable} {caretAt} />
        {:else if !wide && editorOpen}
            <button type="button" data-part="studio-toggle-back" class="min-h-11 self-start rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={closeEditor}>{language.studioTgBack}</button>
            {#key editorKey}
                <StudioToggleEditor {builder} {editable} id={builder.pending !== null ? null : (builder.editor?.id ?? null)} {actions} />
            {/key}
        {:else}
            <div class={wide ? 'grid grid-cols-[minmax(0,1fr)_minmax(560px,1.2fr)] items-start gap-3' : 'flex flex-col gap-3'}>
                <StudioToggleList {builder} {editable} {actions} />
                {#if wide && editorOpen}
                    {#key editorKey}
                        <StudioToggleEditor {builder} {editable} id={builder.pending !== null ? null : (builder.editor?.id ?? null)} {actions} />
                    {/key}
                {/if}
            </div>
        {/if}
        {#if errorShown && builder.error}
            <p role="alert" data-part="studio-toggle-error" class="text-sm text-draculared">{builder.error.kind === 'refused' ? refusalTextOf({ reason: builder.error.reason }) : builder.error.kind === 'unavailable' ? refusalTextOf({ reason: 'loading' }) : builder.error.kind === 'held' ? language.studioTgTextHeld : builder.error.kind === 'field' ? language.studioTgNotWritten : language.studioTgCantMove}</p>
        {/if}
        <p role="status" data-part="studio-toggle-announce" class="sr-only">{announcement}</p>
    </section>
{/if}
