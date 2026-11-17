<script lang="ts">
    import { onDestroy, onMount, untrack, type Snippet } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import '../../styles/studio-tokens.css'
    import { language } from '../../lang'
    import { alertError } from '../../ts/alert'
    import { dispatchBack } from '../../ts/backHandlers'
    import { provideOwnerSource } from '../../ts/studio/ownerSource.svelte'
    import { studioLayoutOf } from '../../ts/studio/studioLayout'
    import { createStudioToasts, refusalTextOf, runDismissingConsumed, withListReason } from '../../ts/studio/edit/studioToasts'
    import type { OwnerHistoryService, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import type { OwnerKey } from '../../ts/studio/history/ownerPhase'
    import { getStudioHistoryService, noteStudioInput } from '../../ts/studio/history/studioHistoryService.svelte'
    import { placeFocusAfterHistory } from '../../ts/studio/historyFocus'
    import { readOwnerFields, type OwnerFields } from '../../ts/studio/ownerFields'
    import { trackStudioFocus } from '../../ts/studio/layerFocus'
    import { closeStudioDrawer, closeStudioHistory, closeStudioRestoreSheet, closeStudioSearch, installStudioBack } from '../../ts/studio/studioBack.svelte'
    import { selectedHistoryOwner, setStudioHistoryOpen, setStudioLayout, setStudioNotice, showStudioList, studioScreen } from '../../ts/studio/studioScreen.svelte'
    import type { ToastHost } from '../../ts/toast/toastHost.svelte'
    import StudioHeader from './StudioHeader.svelte'
    import StudioDetail from './StudioDetail.svelte'
    import StudioHistoryPanel from './StudioHistoryPanel.svelte'
    import StudioNotice from './StudioNotice.svelte'
    import StudioRestoreSheet from './StudioRestoreSheet.svelte'
    import StudioSearch from './StudioSearch.svelte'
    import StudioTree from './StudioTree.svelte'

    // The tree and the detail default to Studio's own; a caller may supply others. The screen owns the layouts,
    // the header, the notice line, the History panel with its restore sheet and the Back layers.
    interface Props {
        tree?: Snippet
        detail?: Snippet
        // The toast host of the Undo toasts the History actions end; the app's own host when absent.
        toastHost?: ToastHost
    }

    let { tree, detail, toastHost }: Props = $props()

    let root: HTMLElement | undefined = $state()

    // Set once the screen is gone: a replay that settles after that has no screen to speak on.
    let destroyed = false
    onDestroy(() => { destroyed = true })

    const toasts = createStudioToasts({ service: getStudioHistoryService, host: untrack(() => toastHost) })

    installStudioBack()

    // The panes below read this one model, so a phone pane swap does not build another.
    provideOwnerSource(() => studioScreen.chaId)

    // On open, focus moves into Studio so Esc and Ctrl+K reach the root handler without a click first.
    // Focus that is already inside Studio is left alone.
    onMount(() => {
        void afterFlush().then(() => {
            if (root && !root.contains(document.activeElement)) root.focus()
        })
    })

    // A layer's close returns focus to the last element focused outside it (MC-1504).
    $effect(() => {
        if (root) return trackStudioFocus(root)
    })

    // The layout follows the width of the screen itself, not the window, so a docked pane lays out right.
    $effect(() => {
        const element = root
        if (!element) return
        const measure = (width: number) => untrack(() => setStudioLayout(studioLayoutOf(width)))
        measure(element.clientWidth || window.innerWidth)
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1]
            if (entry) measure(entry.contentRect.width)
        })
        observer.observe(element)
        return () => observer.disconnect()
    })

    const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number'])

    // The text-entry element a key was typed in: its own value is what the browser's undo works on.
    function textEntryOf(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | 'editable' | null {
        if (target instanceof HTMLTextAreaElement) return target
        if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type) ? target : null
        if (target instanceof HTMLElement && target.isContentEditable) return 'editable'
        return null
    }

    function historyDirectionOf(event: KeyboardEvent): 'undo' | 'redo' | null {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
        const key = event.key.toLowerCase()
        if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
        if (key === 'y' && !event.shiftKey) return 'redo'
        return null
    }

    // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo and redo the selected owner's history. In a Studio text field the
    // browser's own undo keeps the key until the field is back at the value it had when focused; a field that
    // never recorded one (the search field) keeps it always. Nothing to replay leaves the key to the browser.
    function onHistoryKey(event: KeyboardEvent, direction: 'undo' | 'redo'): void {
        const entry = textEntryOf(event.target)
        if (entry === 'editable') return
        if (entry !== null && (entry.dataset.studioFocusValue === undefined || entry.value !== entry.dataset.studioFocusValue)) return
        const service = getStudioHistoryService()
        const owner = selectedHistoryOwner()
        if (!service || owner === null) return
        const view = service.view(owner)
        if (!view.editable || (direction === 'undo' ? view.done : view.undone).length === 0) return
        event.preventDefault()
        void replayAndNotify(service, owner, direction, entry)
    }

    // The replay runs in the service's queue and may ask whether asset files are still there, so its outcome arrives
    // later. The fields are read inside the replay's own synchronous segment, so `before` is what the apply changed.
    async function replayAndNotify(service: OwnerHistoryService, owner: OwnerKey, direction: 'undo' | 'redo', entry: HTMLInputElement | HTMLTextAreaElement | null): Promise<void> {
        const read: { before: OwnerFields | null } = { before: null }
        const visitId = studioScreen.visitId
        let result: StudioResult
        try {
            result = await service.replay(owner, { kind: direction }, (apply) => {
                read.before = readOwnerFields(owner)
                return runDismissingConsumed(service, toasts, owner, apply)
            })
        } catch (error) {
            // A rejected replay may already have landed its write; the error is shown, whatever became of the screen.
            alertError(error instanceof Error ? error : String(error))
            return
        }
        // A replay that outlasts this screen or its visit has nothing to say: a notice would land on a screen that is
        // gone, or on the next visit, and focus would move in a page that is no longer this one's.
        if (destroyed || studioScreen.visitId !== visitId) return
        // A replay that outlasts a switch to another owner has nothing to say on the new screen.
        if (selectedHistoryOwner() !== owner) return
        // Exactly one message: the refusal, a gone file, or the note of a step that moved or dropped without a write. A gone
        // file comes first, because it is the reason a step was dropped. A queued replay that finds nothing left to replay
        // says nothing: the key was already taken.
        if (result.ok === false) {
            if (result.reason !== 'empty') setStudioNotice(refusalTextOf(result))
        } else if (result.goneRows !== undefined && result.goneRows.length > 0) setStudioNotice(language.studioAssetFileGone(result.goneName ?? result.goneRows[0]))
        else if (result.already === 'undo') setStudioNotice(withListReason(language.studioHistoryAlreadyUndone, result.listReason))
        else if (result.already === 'redo') setStudioNotice(withListReason(language.studioHistoryAlreadyRedone, result.listReason))
        else if (result.dropped) setStudioNotice(language.studioHistoryStepDropped)
        // The field now holds the replayed value; the next Ctrl+Z in it continues through the owner's history.
        if (entry !== null) void afterFlush().then(() => { entry.dataset.studioFocusValue = entry.value })
        void placeFocusAfterHistory(read.before, readOwnerFields(owner), () => root ?? null, () => root)
    }

    // Esc closes one layer and never leaves Studio: the restore sheet, then search, the drawer and the History
    // panel, in that fixed order (Back instead closes the newest-opened layer first). A composition's Esc belongs
    // to the IME.
    function onkeydown(event: KeyboardEvent): void {
        if (event.isComposing || event.keyCode === 229) return
        // Ctrl+K (Cmd+K) opens the search, or returns to its field. It is bound here, on the Studio root, so it
        // never reaches a key typed outside Studio.
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
            event.preventDefault()
            studioScreen.searchOpen = true
            void afterFlush().then(() => root?.querySelector<HTMLElement>('[data-part="studio-search-input"]')?.focus())
            return
        }
        const direction = historyDirectionOf(event)
        if (direction !== null) {
            onHistoryKey(event, direction)
            return
        }
        if (event.key !== 'Escape') return
        if (studioScreen.restoreSheetOpen) {
            closeStudioRestoreSheet()
            event.preventDefault()
        } else if (studioScreen.searchOpen) {
            closeStudioSearch()
            event.preventDefault()
            // The field that held focus is gone; the button that opened the search takes it.
            void afterFlush().then(() => root?.querySelector<HTMLElement>('[data-part="studio-search-toggle"]')?.focus())
        } else if (studioScreen.drawerOpen) {
            closeStudioDrawer()
            event.preventDefault()
        } else if (studioScreen.historyOpen) {
            closeStudioHistory()
            event.preventDefault()
        }
    }

    // The mouse's back button is Back.
    function onmouseup(event: MouseEvent): void {
        if (event.button !== 3) return
        event.preventDefault()
        dispatchBack()
    }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={root} data-part="studio" data-layout={studioScreen.layout} tabindex="-1" class="flex h-full min-h-0 w-full flex-col bg-bgcolor text-textcolor outline-none" {onkeydown} {onmouseup} oninputcapture={noteStudioInput} oncompositionstartcapture={noteStudioInput}>
    <StudioHeader
        layout={studioScreen.layout}
        drawerOpen={studioScreen.drawerOpen}
        searchOpen={studioScreen.searchOpen}
        onback={() => { dispatchBack() }}
        ontitle={showStudioList}
        ondrawer={() => { if (studioScreen.drawerOpen) closeStudioDrawer(); else studioScreen.drawerOpen = true }}
        onsearch={() => { studioScreen.searchOpen = !studioScreen.searchOpen }}
        historyOpen={studioScreen.historyOpen}
        historyAvailable={selectedHistoryOwner() !== null}
        onhistory={() => { if (studioScreen.historyOpen) closeStudioHistory(); else setStudioHistoryOpen(true) }}
    />
    <StudioNotice message={studioScreen.notice} ondismiss={() => setStudioNotice(null)} />
    {#if studioScreen.searchOpen}
        <section data-part="studio-search" aria-label={language.studioSearch} class="shrink-0 border-b border-darkborderc"><StudioSearch /></section>
    {/if}
    <div data-part="studio-body" class="relative flex min-h-0 flex-1">
        {#if studioScreen.layout === 'wide'}
            <nav data-part="studio-tree" aria-label={language.studioTreeLabel} class="w-[var(--studio-tree-width)] shrink-0 overflow-y-auto border-e border-darkborderc">
                {#if tree}{@render tree()}{:else}<StudioTree />{/if}
            </nav>
            <main data-part="studio-detail" class="min-w-0 flex-1 overflow-y-auto">
                {#if detail}{@render detail()}{:else}<StudioDetail />{/if}
            </main>
        {:else if studioScreen.layout === 'drawer'}
            {#if studioScreen.drawerOpen}
                <aside data-part="studio-tree-drawer" aria-label={language.studioTreeLabel} class="absolute inset-y-0 start-0 z-10 w-[var(--studio-tree-width)] max-w-full overflow-y-auto border-e border-darkborderc bg-darkbg">
                    {#if tree}{@render tree()}{:else}<StudioTree />{/if}
                </aside>
            {/if}
            <!-- A drawer pick lands focus here (MC-1507): named by the owner title when the detail shows one, else by the screen title. -->
            <main data-part="studio-detail" tabindex="-1" aria-labelledby="studio-detail-title" aria-label={language.studioTitle} class="min-w-0 flex-1 overflow-y-auto outline-none">
                {#if detail}{@render detail()}{:else}<StudioDetail />{/if}
            </main>
        {:else if studioScreen.detailShown}
            <main data-part="studio-detail" class="min-w-0 flex-1 overflow-y-auto">
                {#if detail}{@render detail()}{:else}<StudioDetail />{/if}
            </main>
        {:else}
            <nav data-part="studio-tree" aria-label={language.studioTreeLabel} class="min-w-0 flex-1 overflow-y-auto">
                {#if tree}{@render tree()}{:else}<StudioTree />{/if}
            </nav>
        {/if}
        <!-- Both exist only while open: the sheet's toast suspension and Back layer live exactly as long as it does. -->
        {#if studioScreen.historyOpen}
            <StudioHistoryPanel host={toastHost} />
        {/if}
        {#if studioScreen.restoreSheetOpen}
            <StudioRestoreSheet host={toastHost} />
        {/if}
    </div>
</div>
