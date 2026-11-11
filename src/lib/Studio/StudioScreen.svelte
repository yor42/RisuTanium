<script lang="ts">
    import { onMount, tick, untrack, type Snippet } from 'svelte'
    import '../../styles/studio-tokens.css'
    import { language } from '../../lang'
    import { dispatchBack } from '../../ts/backHandlers'
    import { provideOwnerSource } from '../../ts/studio/ownerSource.svelte'
    import { studioLayoutOf } from '../../ts/studio/studioLayout'
    import { createStudioToasts, refusalText, runDismissingConsumed } from '../../ts/studio/edit/studioToasts'
    import { getStudioHistoryService, noteStudioInput } from '../../ts/studio/history/studioHistoryService.svelte'
    import { closeStudioHistory, closeStudioRestoreSheet, closeStudioSearch, installStudioBack } from '../../ts/studio/studioBack.svelte'
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

    const toasts = createStudioToasts({ service: getStudioHistoryService, host: untrack(() => toastHost) })

    installStudioBack()

    // The panes below read this one model, so a phone pane swap does not build another.
    provideOwnerSource(() => studioScreen.chaId)

    // On open, focus moves into Studio so Esc and Ctrl+K reach the root handler without a click first.
    // Focus that is already inside Studio is left alone.
    onMount(() => {
        void tick().then(() => {
            if (root && !root.contains(document.activeElement)) root.focus()
        })
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
        const result = runDismissingConsumed(service, toasts, owner, () => (direction === 'undo' ? service.undo(owner) : service.redo(owner)))
        if (result.ok === false) setStudioNotice(refusalText(result.reason))
        // The field now holds the replayed value; the next Ctrl+Z in it continues through the owner's history.
        if (entry !== null) void tick().then(() => { entry.dataset.studioFocusValue = entry.value })
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
            void tick().then(() => root?.querySelector<HTMLElement>('[data-part="studio-search-input"]')?.focus())
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
            void tick().then(() => root?.querySelector<HTMLElement>('[data-part="studio-search-toggle"]')?.focus())
        } else if (studioScreen.drawerOpen) {
            studioScreen.drawerOpen = false
            event.preventDefault()
        } else if (studioScreen.historyOpen) {
            closeStudioHistory()
            event.preventDefault()
            void tick().then(() => root?.querySelector<HTMLElement>('[data-part="studio-history-toggle"]')?.focus())
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
        ondrawer={() => { studioScreen.drawerOpen = !studioScreen.drawerOpen }}
        onsearch={() => { studioScreen.searchOpen = !studioScreen.searchOpen }}
        historyOpen={studioScreen.historyOpen}
        historyAvailable={selectedHistoryOwner() !== null}
        onhistory={() => { setStudioHistoryOpen(!studioScreen.historyOpen) }}
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
            <main data-part="studio-detail" class="min-w-0 flex-1 overflow-y-auto">
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
