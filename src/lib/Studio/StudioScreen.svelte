<script lang="ts">
    import { onMount, tick, untrack, type Snippet } from 'svelte'
    import '../../styles/studio-tokens.css'
    import { language } from '../../lang'
    import { dispatchBack } from '../../ts/backHandlers'
    import { studioLayoutOf } from '../../ts/studio/studioLayout'
    import { closeStudioSearch, installStudioBack } from '../../ts/studio/studioBack.svelte'
    import { setStudioLayout, setStudioNotice, showStudioList, studioScreen } from '../../ts/studio/studioScreen.svelte'
    import StudioHeader from './StudioHeader.svelte'
    import StudioDetail from './StudioDetail.svelte'
    import StudioNotice from './StudioNotice.svelte'
    import StudioSearch from './StudioSearch.svelte'
    import StudioTree from './StudioTree.svelte'

    // The tree and the detail default to Studio's own; a caller may supply others. The screen owns the layouts,
    // the header, the notice line and the Back layers.
    interface Props {
        tree?: Snippet
        detail?: Snippet
    }

    let { tree, detail }: Props = $props()

    let root: HTMLElement | undefined = $state()

    installStudioBack()

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

    // Esc closes the innermost layer and never leaves Studio. A composition's Esc belongs to the IME.
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
        if (event.key !== 'Escape') return
        if (studioScreen.searchOpen) {
            closeStudioSearch()
            event.preventDefault()
            // The field that held focus is gone; the button that opened the search takes it.
            void tick().then(() => root?.querySelector<HTMLElement>('[data-part="studio-search-toggle"]')?.focus())
        } else if (studioScreen.drawerOpen) {
            studioScreen.drawerOpen = false
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
<div bind:this={root} data-part="studio" data-layout={studioScreen.layout} tabindex="-1" class="flex h-full min-h-0 w-full flex-col bg-bgcolor text-textcolor outline-none" {onkeydown} {onmouseup}>
    <StudioHeader
        layout={studioScreen.layout}
        drawerOpen={studioScreen.drawerOpen}
        searchOpen={studioScreen.searchOpen}
        onback={() => { dispatchBack() }}
        ontitle={showStudioList}
        ondrawer={() => { studioScreen.drawerOpen = !studioScreen.drawerOpen }}
        onsearch={() => { studioScreen.searchOpen = !studioScreen.searchOpen }}
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
    </div>
</div>
