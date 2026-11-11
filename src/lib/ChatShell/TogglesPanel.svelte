<script module lang="ts">
    import { getModules } from '../../ts/process/modules'
    import { isModuleStub } from '../../ts/storage/moduleStub'
    import { DBState } from '../../ts/stores.svelte'
    import { language } from '../../lang'
    import type { Chat } from '../../ts/storage/database.svelte'
    import { chatToggleValue } from '../../ts/parser/chatToggleScope'
    import { buildPanelModel, toggleVarKey, uniqueCounts, type Counts, type SourceInput } from '../../ts/chatShell/togglePanel'

    /** What the panel needs of an owner: who it is and the toggle text the character itself contributes. */
    export type ToggleOwner = { chaId: string, name: string, customModuleToggle?: string }

    /**
     * The toggle text of each source in use, in display order: the active prompt, every module in use that has toggles
     * (the order and the stub rule of the modules that build the prompt), and the owner. The key set of these texts is
     * the one the chat-only scope copies.
     */
    export function toggleSourcesOf(owner: ToggleOwner): SourceInput[] {
        const inputs: SourceInput[] = [{
            id: 'prompt',
            kind: 'prompt',
            name: language.chatShellTogglesSourcePrompt,
            detail: DBState.db.botPresets?.[DBState.db.botPresetsId]?.name ?? '',
            text: DBState.db.customPromptTemplateToggle,
        }]
        for (const module of getModules()) {
            if (!module || isModuleStub(module) || !module.customModuleToggle) {
                continue
            }
            inputs.push({ id: `module:${module.id}`, kind: 'module', name: module.name, text: module.customModuleToggle })
        }
        inputs.push({ id: `character:${owner.chaId}`, kind: 'character', name: language.chatShellTogglesSourceCharacter, detail: owner.name, text: owner.customModuleToggle })
        return inputs
    }

    /** Distinct toggles and how many are on, for the summary rows of the This-chat sheet and the + menu. */
    export function toggleSummary(owner: ToggleOwner, chat: Chat): Counts {
        const model = buildPanelModel(toggleSourcesOf(owner))
        return uniqueCounts(model, (key) => chatToggleValue(chat, toggleVarKey(key)))
    }
</script>

<script lang="ts">
    import { onDestroy, tick, untrack } from 'svelte'
    import { ChevronDownIcon, FileTextIcon, FunnelIcon, PuzzleIcon, SearchIcon, StarIcon, UserIcon, XIcon } from '@lucide/svelte'
    import { ReloadGUIPointer } from '../../ts/stores.svelte'
    import { backCloseHandler, registerBackHandler } from '../../ts/backHandlers'
    import { useSharedToggleValue, writeChatToggle } from '../../ts/parser/chatToggleScope'
    import {
        defaultOpenSections,
        duplicateBadges,
        isOn,
        rememberSourceOpen,
        resetValue,
        shownText,
        sourceOpenChoice,
        takeSavedFlash,
        valueRowsOf,
        type PanelItem,
        type PanelSource,
        type PanelValueRow,
    } from '../../ts/chatShell/togglePanel'
    import { filterPanel, type RowMatch } from '../../ts/chatShell/toggleSearch'
    import { favouriteRows, isShowing, sameRef, type FavouriteRef, type FavouriteRow } from '../../ts/chatShell/toggleFavourites'
    import { currentFavourites, syncFavourites, updateFavourites } from '../../ts/chatShell/toggleFavouritesStore.svelte'
    import ShellSheet from './ShellSheet.svelte'
    import ToggleRow from './ToggleRow.svelte'

    /**
     * The toggles panel (TOGGLES_SPEC §2-§7): every toggle of the prompt, the modules in use and the character, grouped
     * by source, with search and the on-only filter, the control of each kind, Reset and the shared-value revert. While
     * a search or the filter is active, sections and groups with a hit show open and the user's own fold state is left
     * alone. Starred toggles (device-local, by source and key) also show first in a Favourites section, which is not
     * shown while a search or the filter is active so that each hit appears once. It stacks above the This-chat sheet
     * (inertOutside) and works on the owner and chat captured when it opens; ChatShell closes it when the shown chat
     * changes. Values are read and written only through the scope accessors, which write the chat's own value while
     * its scope is on, the shared value otherwise, and mark the owner. The editor and list sheets of a row are
     * siblings of the panel's sheet and never inside it, because the sheet keeps a transform.
     */
    interface Props {
        open: boolean
        opener: HTMLElement | null
        target: { owner: ToggleOwner, chat: Chat } | null
        onclose: () => void
        // The star of a text row to open at: its Favourites copy takes the initial focus and the outline. Anything else leaves the title as the initial focus.
        openAt?: FavouriteRef | null
    }

    let { open, opener, target, onclose, openAt = null }: Props = $props()

    const FLASH_SHOWN_MS = 1500
    const SEARCH_DEBOUNCE_MS = 120

    let session = $derived(open ? target : null)
    // Bumped after a write, so rows that read the chat show it even when the chat object is not reactive.
    let edits = $state(0)
    let choiceTick = $state(0)
    let layer = $state<HTMLElement>()
    let menuUid = $state<string | null>(null)
    let editing = $state<{ uid: string, row: PanelValueRow } | null>(null)
    let draft = $state('')
    let longEditor = $state<{ row: PanelValueRow, opener: HTMLElement } | null>(null)
    let longDraft = $state('')
    let picker = $state<{ row: PanelValueRow, opener: HTMLElement } | null>(null)
    let announce = $state('')
    let flash = $state('')
    let groupOpen = $state<Record<string, boolean>>({})
    // Frozen when the panel opens: switching the last toggle of a section off must not fold it under the user.
    let defaultOpen = $state.raw<Set<string>>(new Set())
    let flashTimer: ReturnType<typeof setTimeout> | undefined
    // What the field holds, and what the list is filtered by: the list follows the field 120 ms after the last keystroke.
    let query = $state('')
    let applied = $state('')
    let onlyOn = $state(false)
    let finePointer = $state(false)
    let searchField = $state<HTMLInputElement>()
    let searchTimer: ReturnType<typeof setTimeout> | undefined

    let model = $derived.by(() => {
        // A module loaded into its stub's slot keeps its id, so the content change comes through the pointer.
        void $ReloadGUIPointer
        return session ? buildPanelModel(toggleSourcesOf(session.owner)) : { sources: [] }
    })
    let sources = $derived(model.sources.filter((source) => valueRowsOf(source).length > 0))
    let totals = $derived(uniqueCounts({ sources }, valueOf))
    let scopeOn = $derived.by(() => {
        void edits
        return session?.chat.useLocallySetGlobalVariables === true
    })

    function valueOf(key: string): string {
        void edits
        return session ? chatToggleValue(session.chat, toggleVarKey(key)) : 'null'
    }

    // The chat holds its own value for the key and it differs from the shared one (the "This chat" tag and the revert entry).
    function chatOnlyOf(key: string): boolean {
        void edits
        const chat = session?.chat
        if (!chat || chat.useLocallySetGlobalVariables !== true) return false
        const own = chat.GLGlobalVariables?.[toggleVarKey(key)]
        if (own === undefined || own === '' || own === 'null') return false
        return own !== (DBState.db.globalChatVariables[toggleVarKey(key)] ?? 'null')
    }

    let searching = $derived(applied.trim() !== '')
    let filtering = $derived(searching || onlyOn)
    // The text in the field or a filter still waiting for its debounce: one Escape / Back layer.
    let searchLayer = $derived(query !== '' || applied !== '')
    // A row counts for the on-only filter when it is on, or (chat-only scope) the chat holds its own differing value.
    let filtered = $derived.by(() => filtering
        ? filterPanel(sources, { query: applied, onlyOn, passesOn: (row) => isOn(row.kind, valueOf(row.key)) || chatOnlyOf(row.key) })
        : null)
    let visible = $derived(filtered
        ? filtered.sources
        : sources.map((source) => ({ source, items: source.items, matches: new Map<string, RowMatch>() })))

    let favourites = $derived(currentFavourites())
    // Only a star whose source is in use and still has the key shows; the others stay in the store, in place.
    let favRows = $derived(filtering ? [] : favouriteRows(sources, favourites.items))
    // The uid of the Favourites copy this opening is aimed at; null when it is not aimed at one. The aim is
    // taken when the opening is read, so the sheet's first render and its one-shot initial focus see it in
    // either scheduler; it recomputes only when the panel opens or closes.
    let openedAt = $derived.by(() => {
        const opening = open
        return untrack(() => {
            const at = opening ? openAt : null
            const aimed = at ? favRows.find((entry) => sameRef(entry.ref, at) && (entry.row.kind === 'text' || entry.row.kind === 'textarea')) : undefined
            return aimed?.row.uid ?? null
        })
    })

    const isStarred = (ref: FavouriteRef): boolean => favourites.items.some((known) => sameRef(known, ref))

    function sectionOpen(id: string): boolean {
        void choiceTick
        return sourceOpenChoice(id) ?? defaultOpen.has(id)
    }

    // While searching or filtering, a section or group with a hit shows open; the stored choice is not touched.
    const sectionShown = (id: string): boolean => filtering || sectionOpen(id)
    const groupShown = (uid: string): boolean => filtering || groupOpen[uid] === true

    function groupRowsOf(uid: string): PanelValueRow[] {
        for (const source of sources) {
            for (const item of source.items) {
                if (item.type === 'group' && item.uid === uid) {
                    return item.children.filter((child): child is PanelValueRow => child.type === 'row')
                }
            }
        }
        return []
    }

    function cancelPendingSearch(): void {
        clearTimeout(searchTimer)
        searchTimer = undefined
    }

    function onSearchInput(text: string): void {
        query = text
        cancelPendingSearch()
        searchTimer = setTimeout(() => { applied = query }, SEARCH_DEBOUNCE_MS)
    }

    // The clear button, Escape and Back act at once: no waiting for the debounce, and a pending filter is dropped.
    function clearSearch(focusField: boolean): void {
        cancelPendingSearch()
        query = ''
        applied = ''
        if (focusField) searchField?.focus()
    }

    function toggleSection(id: string): void {
        if (filtering) return
        rememberSourceOpen(id, !sectionOpen(id))
        choiceTick++
    }

    function countsOf(rows: PanelValueRow[]): { n: number, on: number } {
        return { n: rows.length, on: rows.filter((row) => isOn(row.kind, valueOf(row.key))).length }
    }

    // One opening is one session: the default open set is taken now, and no editor or menu carries over.
    $effect.pre(() => {
        const opening = open
        untrack(() => {
            // Closing takes every inner layer with it, so no editor or list sheet is left standing over a closed panel.
            editing = null
            menuUid = null
            longEditor = null
            picker = null
            announce = ''
            flash = ''
            // Search and the filter start empty on every opening and survive only the layers above the panel.
            cancelPendingSearch()
            query = ''
            applied = ''
            onlyOn = false
            if (opening) {
                syncFavourites()
                finePointer = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true
                defaultOpen = defaultOpenSections({ sources }, valueOf)
                groupOpen = {}
            }
        })
    })

    onDestroy(() => {
        clearTimeout(flashTimer)
        cancelPendingSearch()
    })

    function noteSaved(): void {
        if (!takeSavedFlash()) return
        flash = session?.chat.useLocallySetGlobalVariables === true ? language.chatShellTogglesSavedChat : language.chatShellTogglesSavedAll
        clearTimeout(flashTimer)
        flashTimer = setTimeout(() => { flash = '' }, FLASH_SHOWN_MS)
    }

    function write(row: PanelValueRow, value: string): void {
        if (!session) return
        writeChatToggle(session.owner, session.chat, toggleVarKey(row.key), value)
        edits++
        noteSaved()
    }

    // Focus goes back to the control of the row that had the layer, once the layer is gone.
    async function refocus(uid: string, selector = '[data-row-control]'): Promise<void> {
        await tick()
        layer?.querySelector<HTMLElement>(`[data-part="toggle-row"][data-uid="${uid}"] ${selector}`)?.focus()
    }

    function setValue(row: PanelValueRow, value: string): void {
        write(row, value)
        if (row.kind === 'check') {
            announce = value === '1' ? language.chatShellTogglesOnA11y(row.label) : language.chatShellTogglesOffA11y(row.label)
        } else if (row.kind === 'select') {
            announce = language.chatShellTogglesPicked(row.label, row.options[Number(value)] ?? '')
        }
    }

    function startEdit(row: PanelValueRow, from: HTMLElement): void {
        menuUid = null
        if (row.kind === 'textarea') {
            longDraft = shownText(valueOf(row.key))
            longEditor = { row, opener: from }
            return
        }
        draft = shownText(valueOf(row.key))
        editing = { uid: row.uid, row }
    }

    function commitEdit(): void {
        const current = editing
        if (!current) return
        editing = null
        if (draft !== shownText(valueOf(current.row.key))) {
            write(current.row, draft)
            announce = language.chatShellTogglesTextSaved(current.row.label)
        }
        void refocus(current.uid)
    }

    function cancelEdit(): void {
        const current = editing
        editing = null
        if (current) void refocus(current.uid)
    }

    function saveLongEditor(): void {
        const current = longEditor
        if (!current) return
        longEditor = null
        if (longDraft !== shownText(valueOf(current.row.key))) {
            write(current.row, longDraft)
            announce = language.chatShellTogglesTextSaved(current.row.label)
        }
    }

    function choose(index: number): void {
        const current = picker
        if (!current) return
        picker = null
        setValue(current.row, String(index))
    }

    function setMenu(row: PanelValueRow, openMenu: boolean): void {
        menuUid = openMenu ? row.uid : null
    }

    function reset(row: PanelValueRow): void {
        menuUid = null
        write(row, resetValue(row.kind))
        announce = language.chatShellTogglesResetDone(row.label)
        void refocus(row.uid, '[data-part="toggle-menu-button"]')
    }

    function revert(row: PanelValueRow): void {
        if (!session) return
        menuUid = null
        useSharedToggleValue(session.owner, session.chat, toggleVarKey(row.key))
        edits++
        announce = language.chatShellTogglesRevertDone(row.label)
        void refocus(row.uid, '[data-part="toggle-menu-button"]')
    }

    // Stars touch only the device-local store: no profile, preset or chat data changes, so nothing is marked for saving.
    // `focusUid` is the row that keeps focus afterwards: the source row when the Favourites copy has just gone.
    function toggleStar(ref: FavouriteRef, row: PanelValueRow, focusUid: string): void {
        menuUid = null
        const had = isStarred(ref)
        updateFavourites({ type: had ? 'remove' : 'add', ref })
        announce = had ? language.chatShellTogglesUnstarred(row.label) : language.chatShellTogglesStarred(row.label)
        void refocus(focusUid, '[data-part="toggle-menu-button"]')
    }

    function moveStar(entry: FavouriteRow, by: -1 | 1): void {
        menuUid = null
        updateFavourites({ type: 'move', ref: entry.ref, by, visible: (candidate) => isShowing(sources, candidate) })
        const shown = favouriteRows(sources, currentFavourites().items)
        const position = shown.findIndex((candidate) => sameRef(candidate.ref, entry.ref)) + 1
        announce = language.chatShellTogglesMovedTo(entry.row.label, position, shown.length)
        void refocus(entry.row.uid, '[data-part="toggle-menu-button"]')
    }

    // Escape goes to the innermost layer of the panel first: the inline field, then an open row menu.
    function innerEscape(): boolean {
        if (editing) {
            cancelEdit()
            return true
        }
        if (menuUid !== null) {
            const uid = menuUid
            menuUid = null
            void refocus(uid, '[data-part="toggle-menu-button"]')
            return true
        }
        if (searchLayer) {
            clearSearch(false)
            return true
        }
        return false
    }

    // Back answers the same layers: the focused field is blurred first (which saves it), then the menu closes, then the
    // search text clears. One press takes one layer: the search text goes only when no editor or menu was open.
    $effect(() => {
        if (!open || (editing === null && menuUid === null && !searchLayer)) return
        let innerBefore = false
        const handler = backCloseHandler({
            isOpen: () => editing !== null || menuUid !== null || searchLayer,
            snapshot: () => `${editing?.uid ?? ''}|${menuUid ?? ''}|${query}|${applied}`,
            close: () => {
                commitEdit()
                menuUid = null
                if (!innerBefore) clearSearch(false)
            },
        })
        return registerBackHandler(() => {
            innerBefore = editing !== null || menuUid !== null
            return handler()
        })
    })

    // Shift+F10 or the Menu key on a row opens its menu; Right Arrow on a switch or button control reaches the row's ⋯
    // button and Left Arrow comes back. A segmented control keeps its own arrows (it handles them first).
    function onListKeydown(event: KeyboardEvent): void {
        const target = event.target
        if (event.defaultPrevented || event.isComposing || !(target instanceof HTMLElement) || target.matches('[data-part="toggle-text-input"]')) return
        const rowElement = target.closest<HTMLElement>('[data-part="toggle-row"]')
        if (!rowElement) return
        if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
            const uid = rowElement.dataset.uid
            if (!uid) return
            event.preventDefault()
            menuUid = uid
            void tick().then(() => rowElement.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus())
        } else if (event.key === 'ArrowRight' && target.matches('[data-row-control]:not([role="radio"])')) {
            const button = rowElement.querySelector<HTMLElement>('[data-part="toggle-menu-button"]')
            if (!button) return
            event.preventDefault()
            button.focus()
        } else if (event.key === 'ArrowLeft' && target.matches('[data-part="toggle-menu-button"]')) {
            const control = rowElement.querySelector<HTMLElement>('[data-row-control]')
            if (!control) return
            event.preventDefault()
            control.focus()
        }
    }

    const sourceIcon = { prompt: FileTextIcon, module: PuzzleIcon, character: UserIcon }
</script>

{#snippet valueRow(source: PanelSource, item: PanelValueRow, entry: FavouriteRow | null, index: number)}
    {@const ref = entry?.ref ?? { s: source.id, k: item.key }}
    <ToggleRow
        row={item}
        value={valueOf(item.key)}
        badges={duplicateBadges(model, source.id, item)}
        chatOnly={chatOnlyOf(item.key)}
        menuOpen={menuUid === item.uid}
        editing={editing?.uid === item.uid}
        {draft}
        openedAt={openedAt === item.uid}
        starred={isStarred(ref)}
        inFavourites={entry !== null}
        canMoveUp={index > 0}
        canMoveDown={index < favRows.length - 1}
        onset={(value) => setValue(item, value)}
        onpick={(from) => { menuUid = null; picker = { row: item, opener: from } }}
        onedit={(from) => startEdit(item, from)}
        ondraft={(text) => { draft = text }}
        oncommit={commitEdit}
        onmenu={(openMenu) => setMenu(item, openMenu)}
        onreset={() => reset(item)}
        onrevert={() => revert(item)}
        onstar={() => toggleStar(ref, item, entry ? entry.sourceUid : item.uid)}
        onmove={(by) => { if (entry) moveStar(entry, by) }}
    />
{/snippet}

{#snippet items(source: PanelSource, list: PanelItem[], matches: ReadonlyMap<string, RowMatch> | null)}
    {#each list as item (item.uid)}
        {#if item.type === 'row'}
            {@const hit = matches?.get(item.uid)}
            {@render valueRow(source, item, null, -1)}
            {#if hit}
                <p data-part="toggles-crumb" role="note" aria-label={language.chatShellTogglesBreadcrumb}>
                    <span data-part="toggles-crumb-path">{hit.path.join(' › ')}</span>
                    {#if hit.option !== null}<span data-part="toggles-crumb-option">{language.chatShellTogglesOption(hit.option)}</span>{/if}
                </p>
            {/if}
        {:else if item.type === 'caption'}
            <p data-part="toggles-caption">{item.label}</p>
        {:else if item.type === 'divider'}
            <div data-part="toggles-divider" role="separator">{#if item.label}<span>{item.label}</span>{/if}</div>
        {:else}
            <div data-part="toggles-group">
                <button type="button" data-part="toggles-group-head" aria-expanded={groupShown(item.uid)} aria-disabled={filtering ? 'true' : undefined} onclick={() => { if (!filtering) groupOpen[item.uid] = groupOpen[item.uid] !== true }}>
                    <span data-part="toggles-chevron" data-open={groupShown(item.uid) ? '' : undefined} aria-hidden="true"><ChevronDownIcon size={16} /></span>
                    <span data-part="toggles-section-title">{item.label}</span>
                    <span data-part="toggles-count">{language.chatShellTogglesSummary(countsOf(groupRowsOf(item.uid)).n, countsOf(groupRowsOf(item.uid)).on)}</span>
                </button>
                {#if groupShown(item.uid)}
                    {@render items(source, item.children, matches)}
                {/if}
            </div>
        {/if}
    {/each}
{/snippet}

<ShellSheet {open} kind="sheet" mode="side" label={language.chatShellTogglesTitle} {opener} inertOutside innerescape={innerEscape} bind:layer {onclose}>
    {#if session}
        <div data-part="toggles-panel-body">
            <div data-part="toggles-titlebar">
                <h2 tabindex="-1" data-sheet-initial={openedAt === null ? '' : undefined} data-part="toggles-title">{language.chatShellTogglesTitle}</h2>
                <span data-part="toggles-scope">{scopeOn ? language.chatShellThisChat : language.chatShellScopeAll}</span>
                <button type="button" data-part="toggles-close" aria-label={language.chatShellTogglesClose} onclick={onclose}>×</button>
            </div>
            <p role="status" data-part="toggles-flash">{flash}</p>
            <p role="status" aria-live="polite" data-part="toggles-announce">{announce}</p>
            {#if favourites.unreadable}
                <p role="note" data-part="toggles-fav-unreadable">{language.chatShellFavouritesUnreadable}</p>
            {/if}
            {#if sources.length === 0}
                <p data-part="toggles-none">{language.chatShellTogglesNone}</p>
                <p data-part="toggles-none-help">{language.chatShellTogglesNoneHelp}</p>
            {:else}
                <p data-part="toggles-total">{language.chatShellTogglesSummary(totals.n, totals.on)}</p>
                <div data-part="toggles-search-bar">
                    <div data-part="toggles-search">
                        <span data-part="toggles-search-icon" aria-hidden="true"><SearchIcon size={18} /></span>
                        <input
                            bind:this={searchField}
                            type="search"
                            data-part="toggles-search-input"
                            autocomplete="off"
                            spellcheck="false"
                            aria-label={language.chatShellTogglesSearchLabel}
                            placeholder={language.chatShellTogglesSearch}
                            value={query}
                            oninput={(event) => onSearchInput(event.currentTarget.value)}
                        />
                        <button type="button" data-part="toggles-search-clear" aria-label={language.chatShellTogglesClearSearch} hidden={query === ''} onclick={() => clearSearch(true)}><XIcon size={16} /></button>
                    </div>
                    <button type="button" data-part="toggles-filter-chip" aria-pressed={onlyOn} title={language.chatShellTogglesChangedState} onclick={() => { onlyOn = !onlyOn }}>
                        <FunnelIcon size={16} /><span>{language.chatShellTogglesChangedOnly}</span>
                    </button>
                </div>
                {#if filtered}
                    <p data-part="toggles-results">{language.chatShellTogglesResults(filtered.shown, filtered.total)}</p>
                {/if}
                {#if finePointer}
                    <p data-part="toggles-hint">{language.chatShellTogglesHint}</p>
                {/if}
                <div role="status" aria-live="polite" data-part="toggles-live">{filtered ? (filtered.shown > 0 ? language.chatShellTogglesCountLive(filtered.shown) : language.chatShellTogglesNoMatch) : ''}</div>
                {#if filtered && filtered.sources.length === 0}
                    <div data-part="toggles-nomatch">
                        <p>{language.chatShellTogglesNoMatch}</p>
                        {#if searching}<button type="button" data-part="toggles-nomatch-clear" onclick={() => clearSearch(true)}>{language.chatShellTogglesClearSearch}</button>{/if}
                        {#if onlyOn}<button type="button" data-part="toggles-nomatch-filter-off" onclick={() => { onlyOn = false }}>{language.chatShellTogglesFilterOff}</button>{/if}
                    </div>
                {/if}
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div role="region" data-part="toggles-list" aria-label={language.chatShellTogglesList} onkeydown={onListKeydown}>
                    {#if favRows.length > 0}
                        <section data-part="toggles-favourites" aria-label={language.chatShellTogglesFavRegion}>
                            <h3 data-part="toggles-fav-title"><span aria-hidden="true"><StarIcon size={16} fill="currentColor" /></span><span data-part="toggles-section-title">{language.chatShellTogglesFavorites}</span><span data-part="toggles-count">{favRows.length}</span></h3>
                            {#each favRows as entry, index (entry.row.uid)}
                                {@render valueRow(entry.source, entry.row, entry, index)}
                                <p data-part="toggles-crumb" role="note" aria-label={language.chatShellTogglesBreadcrumb}>
                                    <span data-part="toggles-crumb-path">{[entry.source.name, entry.group].filter((part) => part).join(' › ')}</span>
                                </p>
                            {/each}
                        </section>
                    {/if}
                    {#each visible as entry (entry.source.id)}
                        {@const source = entry.source}
                        {@const SourceIcon = sourceIcon[source.kind]}
                        <section data-part="toggles-section" data-source={source.id}>
                            <button type="button" data-part="toggles-section-head" aria-expanded={sectionShown(source.id)} aria-disabled={filtering ? 'true' : undefined} onclick={() => toggleSection(source.id)}>
                                <span data-part="toggles-chevron" data-open={sectionShown(source.id) ? '' : undefined} aria-hidden="true"><ChevronDownIcon size={16} /></span>
                                <span aria-hidden="true"><SourceIcon size={16} /></span>
                                <span data-part="toggles-section-title">{source.name}</span>
                                {#if source.detail}<span data-part="toggles-section-detail">{source.detail}</span>{/if}
                                <span data-part="toggles-count">{language.chatShellTogglesSummary(countsOf(valueRowsOf(source)).n, countsOf(valueRowsOf(source)).on)}</span>
                            </button>
                            {#if sectionShown(source.id)}
                                {@render items(source, entry.items, searching ? entry.matches : null)}
                            {/if}
                        </section>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
</ShellSheet>

<ShellSheet open={longEditor !== null} kind="sheet" mode="tall" label={longEditor ? language.chatShellTogglesEditTitle(longEditor.row.label) : ''} opener={longEditor?.opener ?? null} inertOutside onclose={() => { longEditor = null }}>
    {#if longEditor}
        <div data-part="toggles-editor">
            <h2 data-part="toggles-editor-title">{language.chatShellTogglesEditTitle(longEditor.row.label)}</h2>
            <textarea data-part="toggles-editor-field" data-sheet-initial rows="8" aria-label={longEditor.row.label} value={longDraft} oninput={(event) => { longDraft = event.currentTarget.value }}></textarea>
            <div data-part="toggles-editor-actions">
                <button type="button" data-part="toggles-editor-cancel" onclick={() => { longEditor = null }}>{language.cancel}</button>
                <button type="button" data-part="toggles-editor-save" onclick={saveLongEditor}>{language.chatShellTogglesSave}</button>
            </div>
        </div>
    {/if}
</ShellSheet>

<ShellSheet open={picker !== null} kind="sheet" mode="bottom" label={picker ? language.chatShellTogglesPickTitle(picker.row.label) : ''} opener={picker?.opener ?? null} inertOutside onclose={() => { picker = null }}>
    {#if picker}
        <div data-part="toggles-picker" role="radiogroup" aria-label={picker.row.label}>
            {#each picker.row.options as option, index}
                <button type="button" role="radio" data-part="toggles-picker-option" aria-checked={index === Number(valueOf(picker.row.key)) || (index === 0 && !(Number(valueOf(picker.row.key)) >= 0 && Number(valueOf(picker.row.key)) < picker.row.options.length))} onclick={() => choose(index)}>{option}</button>
            {/each}
        </div>
    {/if}
</ShellSheet>

<style>
    [data-part="toggles-panel-body"] { display: flex; flex-direction: column; gap: var(--space-5); }
    [data-part="toggles-titlebar"] { display: flex; align-items: center; gap: var(--space-7); position: sticky; top: 0; background: var(--color-surface-sheet); z-index: 1; }
    [data-part="toggles-title"] { flex: 1; min-width: 0; margin: 0; font-size: var(--font-size-xl); }
    [data-part="toggles-title"]:focus-visible { outline: var(--stroke-bold) solid var(--nexus-text); }
    [data-part="toggles-scope"] { padding: 0 var(--space-5); font-size: var(--font-size-xs); color: var(--nexus-text-secondary); border: 1px solid var(--nexus-edge); border-radius: var(--radius-pill); }
    [data-part="toggles-close"] { flex: none; min-width: var(--size-touch); min-height: var(--size-touch); color: var(--nexus-text); }
    [data-part="toggles-flash"], [data-part="toggles-announce"], [data-part="toggles-total"], [data-part="toggles-none-help"] { margin: 0; font-size: var(--font-size-xs); color: var(--nexus-text-secondary); }
    [data-part="toggles-flash"] { min-height: var(--space-12); }
    [data-part="toggles-announce"] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    [data-part="toggles-none"] { margin: 0; font-size: var(--font-size-base); }
    [data-part="toggles-list"] { display: flex; flex-direction: column; }
    [data-part="toggles-fav-title"] { display: flex; align-items: center; gap: var(--space-5); min-height: var(--size-touch); margin: 0; padding: 0 var(--space-10); font-size: inherit; color: var(--nexus-text); border-bottom: 1px solid var(--nexus-edge); }
    [data-part="toggles-fav-title"] > :first-child { display: inline-flex; color: var(--nexus-accent); }
    [data-part="toggles-fav-unreadable"] { margin: 0; font-size: var(--font-size-xs); color: var(--nexus-text-secondary); }
    [data-part="toggles-section-head"], [data-part="toggles-group-head"] { display: flex; align-items: center; gap: var(--space-5); width: 100%; min-height: var(--size-touch); padding: 0 var(--space-10); text-align: left; color: var(--nexus-text); border-bottom: 1px solid var(--nexus-edge); }
    [data-part="toggles-section-head"] { position: sticky; top: calc(var(--size-touch) * 2); background: var(--color-surface-sheet); }
    [data-part="toggles-section-head"][aria-disabled="true"], [data-part="toggles-group-head"][aria-disabled="true"] { cursor: default; }
    [data-part="toggles-search-bar"] { display: flex; align-items: center; gap: var(--space-5); position: sticky; top: var(--size-touch); background: var(--color-surface-sheet); z-index: 1; }
    [data-part="toggles-search"] { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-3); min-height: var(--size-touch); padding: 0 var(--space-3) 0 var(--space-7); color: var(--nexus-text-secondary); background: var(--nexus-surface-raised); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); }
    [data-part="toggles-search-icon"] { display: inline-flex; flex: none; }
    [data-part="toggles-search-input"] { flex: 1; min-width: 0; min-height: var(--size-touch); color: var(--nexus-text); background: transparent; border: 0; outline: 0; }
    [data-part="toggles-search"]:focus-within { outline: var(--stroke-bold) solid var(--nexus-text); }
    [data-part="toggles-search-clear"] { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: var(--size-touch); min-height: var(--size-touch); color: var(--nexus-text); }
    [data-part="toggles-search-clear"][hidden] { display: none; }
    [data-part="toggles-filter-chip"] { flex: none; display: inline-flex; align-items: center; gap: var(--space-3); min-height: var(--size-touch); padding: 0 var(--space-7); color: var(--nexus-text); border: 1px solid var(--nexus-edge); border-radius: var(--radius-pill); }
    [data-part="toggles-filter-chip"][aria-pressed="true"] { background: var(--color-accent-tint); border-color: var(--nexus-accent); }
    [data-part="toggles-results"], [data-part="toggles-hint"] { margin: 0; font-size: var(--font-size-xs); color: var(--nexus-text-secondary); }
    [data-part="toggles-live"] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    [data-part="toggles-nomatch"] { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-5); }
    [data-part="toggles-nomatch"] p { margin: 0; flex-basis: 100%; }
    [data-part="toggles-nomatch"] button { min-height: var(--size-touch); padding: 0 var(--space-10); color: var(--nexus-text); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); }
    [data-part="toggles-crumb"] { display: flex; flex-wrap: wrap; gap: var(--space-5); margin: 0; padding: 0 var(--space-10) var(--space-3); font-size: var(--font-size-2xs); color: var(--nexus-text-secondary); }
    [data-part="toggles-section-title"] { font-weight: 600; overflow-wrap: anywhere; }
    [data-part="toggles-section-detail"] { color: var(--nexus-text-secondary); font-size: var(--font-size-sm); }
    [data-part="toggles-count"] { margin-left: auto; flex: none; color: var(--nexus-text-secondary); font-size: var(--font-size-xs); }
    [data-part="toggles-chevron"] { display: inline-flex; transform: rotate(-90deg); }
    [data-part="toggles-chevron"][data-open] { transform: none; }
    [data-part="toggles-group"] { padding-left: var(--space-7); }
    [data-part="toggles-caption"] { margin: 0; padding: var(--space-3) var(--space-10); font-size: var(--font-size-sm); color: var(--nexus-text-secondary); }
    [data-part="toggles-divider"] { display: flex; align-items: center; gap: var(--space-5); padding: var(--space-3) var(--space-10); font-size: var(--font-size-sm); color: var(--nexus-text-secondary); }
    [data-part="toggles-divider"]::after { content: ''; flex: 1; border-top: 1px solid var(--nexus-edge); }
    [data-part="toggles-panel-body"] :is(button, textarea):focus-visible, [data-part="toggles-editor"] :is(button, textarea):focus-visible, [data-part="toggles-picker"] button:focus-visible { outline: var(--stroke-bold) solid var(--nexus-text); }
    [data-part="toggles-editor"] { display: flex; flex-direction: column; gap: var(--space-7); }
    [data-part="toggles-editor-title"] { margin: 0; font-size: var(--font-size-xl); }
    [data-part="toggles-editor-field"] { width: 100%; resize: vertical; padding: var(--space-7); color: var(--nexus-text); background: var(--nexus-surface-raised); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); }
    [data-part="toggles-editor-actions"] { display: flex; justify-content: flex-end; gap: var(--space-7); }
    [data-part="toggles-editor-actions"] button, [data-part="toggles-picker"] button { min-height: var(--size-touch); padding: 0 var(--space-10); color: var(--nexus-text); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); }
    [data-part="toggles-picker"] { display: flex; flex-direction: column; gap: var(--space-3); }
    [data-part="toggles-picker"] button { text-align: left; }
    [data-part="toggles-picker"] button[aria-checked="true"] { background: var(--color-accent-tint); border-color: var(--nexus-accent); }
</style>
