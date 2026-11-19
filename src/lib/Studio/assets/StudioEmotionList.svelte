<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { afterFlush } from '../../../ts/afterFlush'
    import { language } from '../../../lang'
    import { assetListUse, createWholeReadBudget, isRowAssetUrlCurrent, rowAssetUrl, storeRowAssetUrl, type AssetUse, type RowAssetUrl } from '../../../ts/storage/assetUrlGate'
    import type { AssetSizeJob } from '../../../ts/studio/assets/assetSizes'
    import { assetPresentationOf, type UsedInPort } from '../../../ts/studio/assets/assetPresentation'
    import type { DuplicateGroup } from '../../../ts/studio/assets/duplicateGroups'
    import { emotionFinderRows, emotionMatchesFilter, emotionMergeSource, emotionNameRefused, emotionRowsOf, focusAfterRemoval, pickedAfter, type EmotionRow } from '../../../ts/studio/assets/emotionList'
    import { assetPoolKey } from '../../../ts/studio/assets/folderCodec'
    import type { SurvivorDeps } from '../../../ts/studio/edit/assetSetters'
    import { createStudioToasts, refusalTextOf } from '../../../ts/studio/edit/studioToasts'
    import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
    import { setStudioNotRestoredNoticeFromToast, studioScreen } from '../../../ts/studio/studioScreen.svelte'
    import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService } from '../../../ts/studio/history/studioHistoryService.svelte'
    import { DBState } from '../../../ts/stores.svelte'
    import type { ToastHost } from '../../../ts/toast/toastHost.svelte'
    import { sessionAssetSizeJob, sessionFinderPort } from './StudioAssetList.svelte'
    import StudioAssetBulkBar from './StudioAssetBulkBar.svelte'
    import StudioAssetFinder, { type FinderArray, type FinderPort, type FinderRow } from './StudioAssetFinder.svelte'
    import StudioAssetMergePreview from './StudioAssetMergePreview.svelte'
    import StudioAssetRow from './StudioAssetRow.svelte'

    // The emotion images of one character, read by id: rows with their thumbnail, the name field that renames, and a
    // menu with delete. Every row change goes through the history service on `emotionImages`, so each is one step with a
    // durable undo. Every write addresses a stored row by its stored index, whatever the filter shows.
    interface Props {
        chaId: string
        // The toast host of the delete toasts; the app's own host when absent (tests pass one on a fake clock).
        host?: ToastHost
        // The size job of the rows; the page session's own when absent (tests pass a fake).
        sizeJob?: () => Promise<AssetSizeJob>
        // The used-in count and the renamed-field note; both are left out while it is absent.
        usedIn?: UsedInPort
        // The byte layer of the duplicate panel; the page session's own when absent.
        finderPort?: () => Promise<FinderPort>
        // How many places reach a file under a name, for the survivor rule of Remove extras; absent counts none.
        references?: (name: string, path: string) => number
    }

    let { chaId, host, sizeJob, usedIn, finderPort, references }: Props = $props()

    const uid = $props.id()
    const headingId = `studio-emotion-heading-${uid}`

    const arrayId = 'emotionImages'
    const owner = $derived(characterOwnerKey(chaId))
    // A merge's Undo that leaves places as they were also puts them in the Studio notice, if that visit and owner are still on screen.
    const toasts = createStudioToasts({
        service: getStudioHistoryService,
        host: untrack(() => host),
        notRestored: {
            visit: () => studioScreen.visitId,
            show: (visit, key, places) => setStudioNotRestoredNoticeFromToast(visit, key, language.studioAssetNotRestored(places.length), places),
        },
    })

    const service = $derived(getStudioHistoryService())
    $effect(() => {
        const key = owner
        if (service) {
            untrack(() => beginOwnerVisit(key))
        } else {
            ensureStudioHistory()
        }
    })

    const live = $derived.by(() => {
        const found = DBState.db.characters?.find((candidate) => candidate?.chaId === chaId)
        return found && found.type !== 'group' ? found : undefined
    })
    const present = $derived(live !== undefined)
    // Read at every render, so a character that became private or a group shows nothing.
    const view = $derived(service ? service.view(owner) : null)
    const hidden = $derived(!present || live?.license === 'private' || view?.restricted === true)
    const busy = $derived(view?.editable !== true)
    const editable = $derived(view?.editable === true)

    const rows = $derived(emotionRowsOf(live?.emotionImages))

    let container = $state<HTMLElement | undefined>()
    let refusal = $state<string | null>(null)
    let menuKey = $state<string | null>(null)
    let renamedFrom = $state<Record<string, string>>({})
    let sizes = $state<Record<string, number | null>>({})
    let urls = $state<(RowAssetUrl | undefined)[]>([])
    let filter = $state('')
    let selecting = $state(false)
    let picked = $state<Record<string, true>>({})
    // The note after a bulk delete that left names in use; only ever set while the used-in port is present.
    let stillUsed = $state<{ text: string, name: string } | null>(null)
    let finderOpen = $state(false)

    const query = $derived(filter.trim())
    // The rows on screen: the same objects as `rows`, never re-indexed, so a write always addresses the stored row.
    const shownRows = $derived(rows.filter((row) => emotionMatchesFilter(row, query)))
    const shownKeys = $derived(new Set(shownRows.map((row) => row.key)))
    // The ticked rows that are still on screen: a tick on a row that left the screen deletes nothing.
    const selectedRows = $derived(shownRows.filter((row) => picked[row.key] === true))

    // The trigger of a shown row; a row that is not shown has none to give.
    function moreButtonOf(key: string): HTMLElement | null {
        if (!shownKeys.has(key)) return null
        const row = Array.from(container?.querySelectorAll<HTMLElement>('[data-part="studio-asset-row"]') ?? []).find((candidate) => candidate.dataset.rowKey === key)
        return row?.querySelector<HTMLElement>('[data-part="studio-asset-row-more"]') ?? null
    }

    // ---------------------------------------------------------------- focus after a removal

    // The row keys as the last flush showed them, and the row that holds focus. Focus is tracked by events because the
    // flush drops a removed row's DOM before any effect runs, and the page's focus is gone with it.
    let knownKeys: string[] = []
    let focusedKey: string | null = null

    function onFocusIn(event: FocusEvent): void {
        const target = event.target
        focusedKey = target instanceof HTMLElement ? (target.closest<HTMLElement>('[data-part="studio-asset-row"]')?.dataset.rowKey ?? null) : null
    }

    // A focusout that leaves the list ends the tracking only when the element is still in the page one microtask later: a
    // browser reports the removal of a focused element as a focusout from an element that is still connected, before the
    // flush that removes it has reached the effect below.
    function onFocusOut(event: FocusEvent): void {
        const target = event.target
        const next = event.relatedTarget
        if (!(target instanceof HTMLElement) || (next instanceof Node && container?.contains(next))) return
        const left = focusedKey
        queueMicrotask(() => {
            if (target.isConnected && focusedKey === left) focusedKey = null
        })
    }

    // Runs in the flush of the write that removed the row: a focused row that is gone hands focus to the next row's
    // trigger, else the previous row's, else the list itself. Focus anywhere else stays.
    function moveFocusAfterRemoval(keys: string[]): void {
        const key = focusedKey
        if (key === null || !container) return
        if (keys.length >= knownKeys.length) return
        const active = document.activeElement
        const lost = active === null || active === document.body || !active.isConnected
        if (!lost) return
        const wanted = focusAfterRemoval(knownKeys, keys, key)
        if (wanted === null) return
        let target: HTMLElement | null = null
        if (wanted !== 'container') {
            const row = Array.from(container.querySelectorAll<HTMLElement>('[data-part="studio-asset-row"]')).find((candidate) => candidate.dataset.rowKey === wanted)
            target = row?.querySelector<HTMLElement>('[data-part="studio-asset-row-more"]') ?? null
        }
        ;(target ?? container).focus()
    }

    $effect(() => {
        const keys = shownRows.map((row) => row.key)
        untrack(() => {
            moveFocusAfterRemoval(keys)
            knownKeys = keys
        })
    })

    // ---------------------------------------------------------------- URLs

    // Row index -> the request in flight for it, so an unchanged row is not asked twice.
    const pending = new Map<number, string>()
    let unmounted = false
    onDestroy(() => { unmounted = true })

    // The store layer that makes asset URLs, loaded when the first URL is asked for: a static import would run its graph
    // before a suite's mocks are ready. A failed import is not kept: the next request asks again.
    let storeApiImport: Promise<typeof import('../../../ts/globalApi.svelte')> | undefined
    function storeApi(): Promise<typeof import('../../../ts/globalApi.svelte')> {
        if (storeApiImport === undefined) {
            const made = import('../../../ts/globalApi.svelte')
            made.catch(() => { if (storeApiImport === made) storeApiImport = undefined })
            storeApiImport = made
        }
        return storeApiImport
    }

    function wantedUse(row: EmotionRow): AssetUse | null {
        return row.shown === 'thumb' ? assetListUse(assetPresentationOf(row.ext).element) : null
    }

    function settleUrl(index: number, entry: RowAssetUrl): void {
        if (pending.get(index) === `${entry.use}\0${entry.path}`) pending.delete(index)
        if (unmounted) return
        // Read when the URL settles: the row may name another file by now, and then the URL is dropped.
        const now = rows[index]
        storeRowAssetUrl(urls, index, entry, now?.path, now ? wantedUse(now) : null)
    }

    // One budget per run: the whole reads of this run's thumbnails together stay within the Android heap, asked in row order.
    function requestUrls(wanted: { row: EmotionRow, use: AssetUse | null }[]): void {
        const budget = createWholeReadBudget()
        const known = new Map<string, RowAssetUrl>()
        for (const entry of urls) {
            if (entry) known.set(`${entry.use}\0${entry.path}`, entry)
        }
        for (const { row, use } of wanted) {
            if (use === null) {
                pending.delete(row.index)
                continue
            }
            if (isRowAssetUrlCurrent(urls[row.index], row.path, use)) continue
            const request = `${use}\0${row.path}`
            // A row that moved keeps the URL made for its file.
            const reused = known.get(request)
            if (reused) {
                storeRowAssetUrl(urls, row.index, reused, row.path, use)
                continue
            }
            if (pending.get(row.index) === request) continue
            pending.set(row.index, request)
            const { index, path } = row
            const made = storeApi().then(({ getFileSrc }) => use === 'whole' ? getFileSrc(path, 'whole', budget) : getFileSrc(path, 'media'))
            // A URL that could not be made is withheld: the row shows its name-and-icon box.
            void made.catch(() => '').then((url) => settleUrl(index, { path, use, url }))
        }
        if (urls.length > wanted.length) urls.length = wanted.length
    }

    $effect(() => {
        const wanted = rows.map((row) => ({ row, use: wantedUse(row) }))
        untrack(() => requestUrls(wanted))
    })

    // ---------------------------------------------------------------- sizes

    // The paths as one string, so a change of any other part of a row does not restart the job.
    const pathsKey = $derived(rows.map((row) => row.path).join('\n'))

    async function readSizes(paths: string[], signal: AbortSignal): Promise<void> {
        let job: AssetSizeJob
        try {
            job = await (sizeJob ?? sessionAssetSizeJob)()
        } catch {
            return
        }
        if (signal.aborted) return
        for (const [path, size] of job.snapshot(paths)) {
            if (size !== undefined) sizes[path] = size
        }
        try {
            await job.ensure(paths, signal, (path, size) => {
                if (!signal.aborted) sizes[path] = size
            })
        } catch {
            // A size that could not be read stays unknown: the row shows its extension alone.
        }
    }

    // Starts after the first render and ends with the list, the owner or the row set it was started for.
    $effect(() => {
        void chaId
        if (pathsKey === '') return
        const controller = new AbortController()
        untrack(() => void readSizes([...new Set(rows.map((row) => row.path))], controller.signal))
        return () => controller.abort()
    })

    // ---------------------------------------------------------------- actions

    function rename(row: EmotionRow, value: string): string {
        // A row that is no longer at its place renames nothing: a browser blurs a removed row's field while the flush that
        // removes it runs, and the row's index then names whichever row moved up into it. The key check is what refuses a
        // removed row, even when another row has the same name; the name check covers the moment before the flush, when
        // the rows are already recomputed but the row's field still shows the old one.
        const current = rows[row.index]
        if (current === undefined || current.key !== row.key || current.name !== row.name) return row.name
        if (!service) return row.name
        // A blank name names nothing: the field goes back to the row's own, with the reason.
        if (emotionNameRefused(value)) {
            refusal = language.studioEmotionNameBlank
            return row.name
        }
        // Any other string is stored as typed; a name another row holds is allowed.
        const result = service.assetRename(owner, arrayId, row.index, value)
        if (result.ok === false) {
            refusal = refusalTextOf(result)
            return row.name
        }
        refusal = null
        // An unchanged result landed nothing and posts nothing: the row already has the name it shows.
        if (result.unchanged === true) return row.name
        renamedFrom[row.key] = row.name
        return value
    }

    // Rows over one file are keyed by their order, so after a delete the rows behind the removed one take its key, one
    // after the other. Their renamed-note state moves with them; the removed row's own state goes.
    function dropRowState(keys: string[]): void {
        keys.forEach((here, at) => {
            const after = keys[at + 1]
            const note = after === undefined ? undefined : renamedFrom[after]
            if (note !== undefined) renamedFrom[here] = note
            else delete renamedFrom[here]
        })
    }

    function remove(row: EmotionRow): void {
        menuKey = null
        if (!service) return
        // The keys of the removed row and the rows over its file behind it, read before the write changes the rows.
        const sharing = rows.filter((other) => other.path === row.path && other.index >= row.index).map((other) => other.key)
        const result = service.assetDelete(owner, arrayId, [row.index])
        if (result.ok === false) {
            refusal = refusalTextOf(result)
            // The menu item is going away; the row's trigger keeps focus.
            moreButtonOf(row.key)?.focus()
            return
        }
        refusal = null
        if (result.unchanged === true) return
        dropRowState(sharing)
        pruneTicks()
        if (result.stepId === undefined) return
        toasts.postAssetAction(owner, result.stepId, language.studioAssetDeletedOne(row.name))
    }

    // Drops the ticks whose key no longer names a row.
    function pruneTicks(): void {
        picked = pickedAfter(picked, rows.map((row) => row.key))
    }

    function bulkDelete(): void {
        const targets = selectedRows
        if (!service || targets.length === 0) return
        const names = [...new Set(targets.map((row) => row.name))]
        // Read before the write, from the rows that are about to go: a delete never rewrites text, so these stay used.
        const used = usedIn ? names.filter((name) => usedIn.usedText(name) !== null) : []
        const result = service.assetDelete(owner, arrayId, targets.map((row) => row.index))
        if (result.ok === false) {
            refusal = refusalTextOf(result)
            return
        }
        refusal = null
        if (result.unchanged === true) return
        for (const row of targets) delete picked[row.key]
        pruneTicks()
        stillUsed = used.length > 0 ? { text: language.studioAssetStillUsed(used.length), name: used[0] } : null
        if (result.stepId === undefined) return
        toasts.postAssetAction(owner, result.stepId, language.studioEmotionDeletedMany(targets.length), stillUsed?.text)
    }

    function toggleSelecting(): void {
        selecting = !selecting
        picked = {}
        stillUsed = null
    }

    function pick(row: EmotionRow, on: boolean): void {
        pruneTicks()
        if (on) picked[row.key] = true
        else delete picked[row.key]
    }

    // Ticks the rows that are shown, and only those: rows the filter hides are never ticked.
    function selectAll(on: boolean): void {
        const next: Record<string, true> = {}
        if (on) {
            for (const row of shownRows) next[row.key] = true
        }
        picked = next
    }

    // ---------------------------------------------------------------- the duplicate panel

    // Every stored row, never the shown ones: a finder action addresses rows by their stored index.
    const finderArrays = $derived<FinderArray[]>([{ id: arrayId, title: null, reportOnly: false, rows: emotionFinderRows(rows) }])

    function removeExtras(array: FinderArray, group: DuplicateGroup<FinderRow>, deps: SurvivorDeps): void {
        if (!service || array.reportOnly || array.id !== arrayId || !group.removable || group.survivor === undefined) return
        const survivor = group.survivor
        const extras = group.rows.filter((row) => row !== survivor.row)
        const gone = new Set(extras.map((row) => row.index))
        const name = survivor.row.name
        // Other files under this name are left behind: older messages may show another picture from it.
        const pool = rows.some((row) => !gone.has(row.index) && assetPoolKey(row.name) === assetPoolKey(name) && row.path !== survivor.row.path)
        const result = service.assetRemoveExtras(owner, arrayId, name, extras.map((row) => row.index), deps)
        if (result.ok === false) {
            refusal = refusalTextOf(result)
            return
        }
        refusal = null
        if (result.unchanged === true || result.stepId === undefined) return
        const kept = survivor.reason === 'references' ? language.studioAssetSurvivorMostUsed : language.studioAssetSurvivorFirst
        toasts.postAssetAction(owner, result.stepId, language.studioAssetRemovedExtras(extras.length, name), pool ? `${kept} ${language.studioAssetPoolWarning}` : kept)
    }

    // ---------------------------------------------------------------- merge

    // The group being merged, with the survivor deps of the finder pass that listed it. The preview ends with the owner
    // it was opened for (it closes itself), and a merge that lands or a Cancel ends it here.
    let merging = $state.raw<{ group: DuplicateGroup<FinderRow>, deps: SurvivorDeps } | null>(null)
    let mergeOpener: HTMLElement | null = null

    function startMerge(array: FinderArray, group: DuplicateGroup<FinderRow>, deps: SurvivorDeps): void {
        if (!service || array.reportOnly || array.id !== arrayId || !group.mergeCandidate) return
        const active = document.activeElement
        mergeOpener = active instanceof HTMLElement ? active : null
        merging = { group, deps }
    }

    // Focus returns to the button that opened the preview when the preview's own control held it; focus elsewhere stays.
    function closeMerge(): void {
        merging = null
        const opener = mergeOpener
        mergeOpener = null
        void afterFlush().then(() => {
            const active = document.activeElement
            if (active !== null && active !== document.body && active.isConnected) return
            ;(opener !== null && opener.isConnected ? opener : container)?.focus()
        })
    }

    // The source reads the live character where it is called, from the preview's handlers, derived checks and count jobs.
    const mergeSource = $derived(emotionMergeSource({ chaId, db: () => DBState.db }))
    function toggleMenu(row: EmotionRow): void {
        if (menuKey === row.key) {
            menuKey = null
            return
        }
        menuKey = row.key
        void afterFlush().then(() => {
            if (menuKey !== row.key) return
            const first = Array.from(container?.querySelectorAll<HTMLElement>('[data-part="studio-asset-row"]') ?? []).find((candidate) => candidate.dataset.rowKey === row.key)
            first?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
        })
    }

    function closeMenu(row: EmotionRow): void {
        menuKey = null
        moreButtonOf(row.key)?.focus()
    }

    // The selection is cleared where the filter is typed, and nowhere else.
    function onFilterInput(value: string): void {
        filter = value
        picked = {}
        stillUsed = null
    }
</script>

{#if present && !hidden}
    <section bind:this={container} tabindex="-1" data-part="studio-emotion-list" aria-labelledby={headingId} aria-busy={busy ? 'true' : undefined} class="flex flex-col gap-3 outline-none" onfocusin={onFocusIn} onfocusout={onFocusOut}>
        <h3 id={headingId} class="font-semibold text-textcolor">{language.emotionImage}</h3>
        {#if !editable}
            <p data-part="studio-emotion-paused" class="text-sm text-textcolor2">{language.studioEmotionPaused}</p>
        {/if}
        <p data-part="studio-emotion-help" class="text-sm text-textcolor2">{language.studioEmotionHelp}</p>
        <p data-part="studio-emotion-rename-note" class="text-sm text-textcolor2">{language.studioEmotionRenameNote}</p>
        {#if rows.length === 0}
            <div data-part="studio-emotion-empty" class="flex flex-col gap-1">
                <p class="text-textcolor2">{language.studioEmotionEmpty}</p>
                <p class="text-sm text-textcolor2">{language.studioEmotionEmptyHint}</p>
            </div>
        {:else}
            <div class="flex flex-wrap items-center gap-2">
                <input
                    type="text"
                    data-part="studio-emotion-filter"
                    class="min-h-11 min-w-0 flex-1 rounded-md border border-darkborderc bg-darkbg px-2 text-textcolor"
                    aria-label={language.studioEmotionFilter}
                    placeholder={language.studioEmotionFilter}
                    autocomplete="off"
                    value={filter}
                    oninput={(event) => onFilterInput(event.currentTarget.value)}
                />
                <button type="button" data-part="studio-asset-select-toggle" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" aria-pressed={selecting} onclick={toggleSelecting}>{language.studioAssetSelect}</button>
                <button type="button" data-part="studio-asset-find-duplicates" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" aria-expanded={finderOpen} onclick={() => { finderOpen = !finderOpen }}>{language.studioAssetFindDuplicates}</button>
            </div>
            {#if selecting}
                <StudioAssetBulkBar
                    count={selectedRows.length}
                    shown={shownRows.length}
                    {editable}
                    moveChoices={[]}
                    previewAction={null}
                    onselectall={selectAll}
                    onmove={() => {}}
                    ondelete={bulkDelete}
                    onpreview={() => {}}
                />
            {/if}
            {#if stillUsed}
                <p data-part="studio-asset-bulk-note" role="status" class="text-sm text-textcolor2">
                    {stillUsed.text}
                    {#if usedIn}
                        {@const first = stillUsed.name}
                        <button type="button" data-part="studio-asset-bulk-show" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={() => usedIn.showUsed(first)}>{language.studioAssetShow}</button>
                    {/if}
                </p>
            {/if}
            {#if finderOpen}
                <StudioAssetFinder
                    arrays={finderArrays}
                    port={finderPort ?? sessionFinderPort}
                    {sizes}
                    {editable}
                    {references}
                    onremoveextras={removeExtras}
                    onmerge={startMerge}
                    onclose={() => { finderOpen = false }}
                />
            {/if}
            {#if merging !== null && service}
                <StudioAssetMergePreview
                    {owner}
                    ownerKind="character"
                    ownerId={chaId}
                    kind="emotion"
                    group={merging.group}
                    deps={merging.deps}
                    {service}
                    {toasts}
                    source={mergeSource}
                    {references}
                    onclose={closeMerge}
                />
            {/if}
            {#if shownRows.length === 0}
                <p data-part="studio-emotion-filter-empty" class="text-textcolor2">{language.studioEmotionFilterEmpty(query)}</p>
            {/if}
            <ul data-part="studio-emotion-rows" class="flex flex-col gap-2">
                {#each shownRows as row (row.key)}
                    <StudioAssetRow
                        rowKey={row.key}
                        name={row.name}
                        ext={row.ext}
                        shown={row.shown}
                        size={sizes[row.path]}
                        thumbUrl={row.shown === 'thumb' ? rowAssetUrl(urls[row.index], row.path, wantedUse(row)) : undefined}
                        mediaUrl={undefined}
                        previewing={false}
                        displayed={true}
                        excludeShown={false}
                        excluded={false}
                        {editable}
                        menuOpen={menuKey === row.key}
                        renamedFrom={renamedFrom[row.key] ?? null}
                        joinNote={null}
                        {usedIn}
                        moveChoices={[]}
                        {selecting}
                        selected={picked[row.key] === true}
                        onselect={(on) => pick(row, on)}
                        oncommit={(value) => rename(row, value)}
                        ondelete={() => remove(row)}
                        onpreview={() => {}}
                        ontoggleexclude={() => {}}
                        onmenutoggle={() => toggleMenu(row)}
                        onmenuclose={() => closeMenu(row)}
                    />
                {/each}
            </ul>
        {/if}
        {#if refusal}
            <p role="alert" data-part="studio-emotion-refusal" class="text-sm text-draculared">{refusal}</p>
        {/if}
    </section>
{/if}
