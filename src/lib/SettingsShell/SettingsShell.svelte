<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { get } from 'svelte/store'
    import { language } from '../../lang'
    import { backCloseHandler, registerBackHandler } from '../../ts/backHandlers'
    import { isImeComposing } from '../../ts/ime/compositionGuard'
    import { getModelInfo } from '../../ts/model/modellist'
    import { getSettingsIndex, searchSettings, type SearchHit } from '../../ts/setting/settingsSearch'
    import { buildSearchSources } from '../../ts/setting/settingsSearchSources'
    import type { SettingContext } from '../../ts/setting/types'
    import { DBState, SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
    import { isReturnToChat } from '../Setting/settingsRoute'
    import {
        isPhoneWidth, readLastPage, resolveOpenIndex, setShellBackHandler, settingsShellBackSnapshot, settingsShellBackStep, writeLastPage,
    } from '../../ts/settingsShell/settingsNavigation'
    import { arrivalInFlight, runSettingsArrival } from '../../ts/settingsShell/settingsArrival'
    import { restoreOpenerFocus, settingsOrigin } from '../../ts/settingsShell/settingsOrigin'
    import { firstIndexOf, pageEntry, pageForIndex, settingsLabel } from '../../ts/settingsShell/settingsPages'
    import { closeSearch, openSearch, resetSearch, setHighlight, settingsSearchState } from '../../ts/settingsShell/settingsSearchState.svelte'
    import SettingsSearchResults, { hitCountOf, resultBlocksOf, type ResultRow } from './SettingsSearchResults.svelte'
    import SettingsShellHeader from './SettingsShellHeader.svelte'
    import SettingsShellIndex from './SettingsShellIndex.svelte'
    import SettingsShellPage from './SettingsShellPage.svelte'

    let innerWidth = $state(window.innerWidth)
    const phone = $derived(isPhoneWidth(innerWidth))
    const located = $derived(pageForIndex($SettingsMenuIndex))
    const origin = settingsOrigin()
    // The scroll position of each view is kept while Settings stays open and dropped with the shell on close.
    const scrollMemory = new Map<number, number>()
    const uid = $props.id()
    const listboxId = `${uid}-search-results`

    let root = $state<HTMLElement>()
    let header = $state<ReturnType<typeof SettingsShellHeader>>()
    let indexPane = $state<ReturnType<typeof SettingsShellIndex>>()
    let pagePane = $state<ReturnType<typeof SettingsShellPage>>()

    // While Settings is open the wide layout never shows index -1: it applies the stored last page, or Models.
    // Gated on the open state so a close (which resets the index) is not undone by this effect.
    $effect(() => {
        if (!$settingsOpen) return
        const index = $SettingsMenuIndex
        const resolved = resolveOpenIndex({ index, width: innerWidth, stored: readLastPage() })
        if (resolved !== index) SettingsMenuIndex.set(resolved)
    })

    // Only an index that a page hosts is recorded, so the phone index (-1) never erases the stored page.
    $effect(() => {
        if (!$settingsOpen) return
        const shown = pageForIndex($SettingsMenuIndex)
        if (shown) writeLastPage(shown.page)
    })

    // One Back handler on the stack while Settings is open. Escape runs this same instance, so the focused
    // field is blurred and effects are flushed before the close step. Closing the search alone counts as a change.
    $effect(() => {
        if (!$settingsOpen) return
        const handler = backCloseHandler({
            isOpen: () => get(settingsOpen),
            snapshot: settingsShellBackSnapshot,
            close: settingsShellBackStep,
        })
        const unregister = registerBackHandler(handler)
        setShellBackHandler(handler)
        return () => {
            unregister()
            setShellBackHandler(null)
        }
    })

    // Focus: on open it goes to the selected entry (wide), the first entry (phone index) or the page heading
    // (phone page); a phone drill-in lands on the heading and Back to the index returns to the opened entry.
    // A search arrival places focus itself, so the drill-in heading focus yields to it. The marker is read in the
    // effect body, while the arrival is still in flight.
    let previousIndex: number | null = null
    $effect(() => {
        const index = $SettingsMenuIndex
        const isPhone = phone
        const open = $settingsOpen
        const arriving = arrivalInFlight(index)
        const before = previousIndex
        previousIndex = index
        if (!open) return
        untrack(() => {
            void afterFlush().then(() => {
                const now = get(SettingsMenuIndex)
                if (before === null) {
                    if (isPhone && now !== -1) pagePane?.focusHeading()
                    else indexPane?.focusSelected()
                } else if (isPhone && before !== -1 && now === -1) {
                    const opened = pageForIndex(before)
                    if (opened) indexPane?.focusPage(opened.page)
                    else indexPane?.focusSelected()
                } else if (isPhone && before === -1 && now !== -1) {
                    if (!arriving && !settingsSearchState.open) pagePane?.focusHeading()
                }
            })
        })
    })

    // After the close has flushed, focus goes back to what opened Settings; the helper decides where.
    onDestroy(() => {
        resetSearch()
        if (get(settingsOpen)) return
        void afterFlush().then(() => {
            if (!get(settingsOpen)) restoreOpenerFocus()
        })
    })

    const resultsShown = $derived(settingsSearchState.open && settingsSearchState.query.trim() !== '')

    // The index is built on first use and kept until the search closes; the open token keys it.
    const outcome = $derived.by(() => {
        if (!resultsShown) return null
        const db = DBState.db
        const ctx: SettingContext = { db, modelInfo: getModelInfo(db.aiModel), subModelInfo: getModelInfo(db.subModel) }
        const entries = getSettingsIndex(settingsSearchState.openToken, () => buildSearchSources(ctx))
        return searchSettings(entries, settingsSearchState.query)
    })

    let expandedGroups = $state<ReadonlySet<string>>(new Set())
    let activeIndex = $state(-1)
    const blocks = $derived(outcome ? resultBlocksOf(outcome, expandedGroups, uid) : [])
    const rows = $derived(blocks.flatMap((block) => block.rows))
    const activeOptionId = $derived(activeIndex >= 0 ? rows[activeIndex]?.optionId : undefined)

    function setQuery(value: string): void {
        if (!settingsSearchState.open) openSearch()
        settingsSearchState.query = value
        expandedGroups = new Set()
        activeIndex = -1
    }

    // The count is announced politely once typing settles; the timer dies with the query that started it.
    let liveMessage = $state('')
    $effect(() => {
        const count = outcome ? hitCountOf(outcome) : null
        if (count === null) {
            liveMessage = ''
            return
        }
        const timer = setTimeout(() => { liveMessage = language.settingsShellSearchCount(count) }, 500)
        return () => clearTimeout(timer)
    })

    // On a phone the field leaves with the search; focus returns to the button that opened it unless an arrival
    // is placing focus.
    let searchWasOpen = false
    $effect(() => {
        const open = settingsSearchState.open
        const isPhone = phone
        const wasOpen = searchWasOpen
        searchWasOpen = open
        if (!wasOpen || open || !isPhone || arrivalInFlight(get(SettingsMenuIndex))) return
        void afterFlush().then(() => root?.querySelector<HTMLElement>('[data-part="settings-search-open"]')?.focus())
    })

    function focusSearchField(): void {
        if (!settingsSearchState.open) openSearch()
        void afterFlush().then(() => header?.focusSearch())
    }

    function isTextEntry(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLElement)) return false
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
        return target.closest('[contenteditable=""], [contenteditable="true"]') !== null
    }

    // Bound on the shell root, never on the window, so a key typed outside Settings is not taken. A composition's
    // keys belong to the IME.
    function onrootkeydown(event: KeyboardEvent): void {
        if (isImeComposing(event)) return
        const accelerator = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k'
        const slash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTextEntry(event.target)
        if (!accelerator && !slash) return
        event.preventDefault()
        focusSearchField()
    }

    function activate(row: ResultRow): void {
        if (row.kind === 'hit') openHit(row.hit)
        else expandGroup(row.block)
    }

    function expandGroup(block: 'setting' | 'page'): void {
        expandedGroups = new Set([...expandedGroups, block])
    }

    function onsearchkeydown(event: KeyboardEvent): void {
        if (isImeComposing(event)) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (rows.length === 0) return
            event.preventDefault()
            const step = event.key === 'ArrowDown' ? 1 : -1
            activeIndex = activeIndex < 0 ? (step === 1 ? 0 : rows.length - 1) : (activeIndex + step + rows.length) % rows.length
        } else if (event.key === 'Enter') {
            const row = rows[activeIndex >= 0 ? activeIndex : 0]
            if (!row) return
            event.preventDefault()
            activate(row)
        }
    }

    function reducedMotion(): boolean {
        return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }

    function openHit(hit: SearchHit): void {
        void runSettingsArrival(
            { index: hit.entry.target.index, rowId: hit.entry.target.rowId },
            {
                setIndex: (index) => SettingsMenuIndex.set(index),
                closeSearch,
                tick: afterFlush,
                page: () => pagePane,
                setHighlight,
                reducedMotion,
            },
        )
    }

    const backLabel = $derived(
        phone && $SettingsMenuIndex !== -1 && !isReturnToChat() ? language.settingsShellMenu
            : origin.kind === 'chat' ? language.settingsShellBackToChat(origin.name)
            : language.settingsShellBack
    )
    const title = $derived(phone && located ? settingsLabel(pageEntry(located.page).labelKey) : language.settingsShellTitle)
    const showIndex = $derived((!phone || $SettingsMenuIndex === -1) && !(phone && resultsShown))
    const showPage = $derived((!phone || $SettingsMenuIndex !== -1) && !resultsShown)
    const indexWidth = $derived(innerWidth >= 1024 ? '280px' : '240px')
</script>

<svelte:window bind:innerWidth />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="h-full w-full flex flex-col bg-bgcolor text-textcolor rs-setting-cont" data-part="settings-shell" bind:this={root} onkeydown={onrootkeydown}>
    <SettingsShellHeader
        bind:this={header}
        {backLabel}
        {title}
        {phone}
        onback={settingsShellBackStep}
        searchOpen={settingsSearchState.open}
        query={settingsSearchState.query}
        resultsShown={resultsShown}
        {listboxId}
        {activeOptionId}
        onsearchopen={focusSearchField}
        onsearchclose={closeSearch}
        onquery={setQuery}
        {onsearchkeydown}
    />
    <div class="sr-only" role="status" aria-live="polite" data-part="settings-search-status">{liveMessage}</div>
    <div class="flex grow min-h-0">
        {#if showIndex}
            <div class="shrink-0 h-full" style:width={phone ? '100%' : indexWidth}>
                <SettingsShellIndex
                    bind:this={indexPane}
                    selected={phone || resultsShown ? null : located?.page ?? null}
                    onselect={(page) => {
                        if (settingsSearchState.open) closeSearch()
                        SettingsMenuIndex.set(firstIndexOf(page))
                    }}
                />
            </div>
        {/if}
        {#if resultsShown && outcome}
            <SettingsSearchResults
                {blocks}
                query={settingsSearchState.query}
                partial={outcome.partial}
                {listboxId}
                {activeOptionId}
                onopen={openHit}
                onexpand={expandGroup}
                onclear={() => setQuery('')}
                onbrowse={closeSearch}
            />
        {:else if showPage}
            <SettingsShellPage bind:this={pagePane} index={$SettingsMenuIndex} {phone} {scrollMemory} />
        {/if}
    </div>
</div>
