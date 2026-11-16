<script lang="ts" module>
    import type { AssetSizeJob } from '../../../ts/studio/assets/assetSizes'

    let sessionJob: Promise<AssetSizeJob> | undefined
    let storeApiImport: Promise<typeof import('../../../ts/globalApi.svelte')> | undefined

    // The store layer that makes asset URLs, loaded when the first URL is asked for. It is a dynamic import because a
    // static one runs the store layer's graph when this component is first imported, before the state a suite's mocks
    // return is initialised, and that graph then reads that state; the app itself has the module loaded at
    // boot, so nothing is saved there. One import serves every row, and a failed import is not kept: the next request asks again.
    function storeApi(): Promise<typeof import('../../../ts/globalApi.svelte')> {
        if (storeApiImport === undefined) {
            const made = import('../../../ts/globalApi.svelte')
            made.catch(() => { if (storeApiImport === made) storeApiImport = undefined })
            storeApiImport = made
        }
        return storeApiImport
    }

    // The size job of this page session. Its cache serves every list that is opened, so a file is sized once however
    // often a list is shown. Nothing is read until a list asks.
    export function sessionAssetSizeJob(): Promise<AssetSizeJob> {
        if (sessionJob === undefined) {
            const made = (async (): Promise<AssetSizeJob> => {
                const [preflight, pieces, sizes] = await Promise.all([
                    import('../../../ts/drive/exportPreflight'),
                    import('../../../ts/drive/assetPieces'),
                    import('../../../ts/studio/assets/assetSizes'),
                ])
                const store = await preflight.appStoreOrNull()
                return sizes.createAssetSizeJob({ source: store === null ? null : await pieces.exportAssetPieceSource(store) })
            })()
            // A failed build is not kept: the next list asks again.
            made.catch(() => { if (sessionJob === made) sessionJob = undefined })
            sessionJob = made
        }
        return sessionJob
    }

    // Tests: stands a fake in for the session job, or drops it (undefined) so no test sees another's cache. A list in a
    // suite then never loads the production job and the app graph behind it.
    export function setSessionAssetSizeJobForTests(job: AssetSizeJob | undefined): void {
        sessionJob = job === undefined ? undefined : Promise.resolve(job)
    }
</script>

<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { afterFlush } from '../../../ts/afterFlush'
    import { language } from '../../../lang'
    import { writeLiveCharacter } from '../../../ts/liveCharacterWrite'
    import { assetListUse, createWholeReadBudget, isRowAssetUrlCurrent, rowAssetUrl, storeRowAssetUrl, type AssetUse, type RowAssetUrl } from '../../../ts/storage/assetUrlGate'
    import { assetPresentationOf, assetRowExt, type AssetPickerPort, type AssetPresentation, type UsedInPort } from '../../../ts/studio/assets/assetPresentation'
    import { createStudioToasts, refusalTextOf } from '../../../ts/studio/edit/studioToasts'
    import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
    import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService, historyBannerText, studioHistoryLoadFailed } from '../../../ts/studio/history/studioHistoryService.svelte'
    import { DBState } from '../../../ts/stores.svelte'
    import type { ToastHost } from '../../../ts/toast/toastHost.svelte'
    import StudioAssetRow from './StudioAssetRow.svelte'

    // The additional assets of one character, read by id: rows with their thumbnail or type tile, the name field that
    // renames, and a menu with delete, preview and the exclude toggle. Every row change goes through the history
    // service, so each is one step with a durable undo. Thumbnails always show; the preview setting only gates the
    // exclude item. Sizes and URLs are asked for only after the list is shown, and never for a row that does not need them.
    interface Props {
        chaId: string
        // The toast host of the delete toasts; the app's own host when absent (tests pass one on a fake clock).
        host?: ToastHost
        // The size job of the rows; the page session's own when absent (tests pass a fake).
        sizeJob?: () => Promise<AssetSizeJob>
        // The used-in count and the renamed-field note; both are left out while it is absent.
        usedIn?: UsedInPort
        // Opens the picker; the list has no Add control while it is absent.
        picker?: AssetPickerPort
    }

    let { chaId, host, sizeJob, usedIn, picker }: Props = $props()

    interface ListRow {
        key: string
        index: number
        name: string
        path: string
        ext: string
        presentation: AssetPresentation
    }

    const owner = $derived(characterOwnerKey(chaId))
    const toasts = createStudioToasts({ service: getStudioHistoryService, host: untrack(() => host) })

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
    // Read at every render, so a character that became private or a group shows nothing.
    const view = $derived(service ? service.view(owner) : null)
    const hidden = $derived(live === undefined || live.license === 'private' || view?.restricted === true)
    const editable = $derived(view?.editable === true)
    const banner = $derived(view ? historyBannerText(view.banner) : null)
    const loadFailed = $derived(!service && studioHistoryLoadFailed())

    // A row is named by its file: a rename keeps the row's DOM node and its focus. Two rows over one file are told apart by their order.
    const rows = $derived.by((): ListRow[] => {
        const seen = new Map<string, number>()
        return (live?.additionalAssets ?? []).map((tuple, index) => {
            const path = tuple[1] ?? ''
            const occurrence = seen.get(path) ?? 0
            seen.set(path, occurrence + 1)
            const ext = assetRowExt(tuple)
            return { key: `${occurrence}:${path}`, index, name: tuple[0] ?? '', path, ext, presentation: assetPresentationOf(ext) }
        })
    })
    const emotionCount = $derived(live?.emotionImages?.length ?? 0)
    const excludedPaths = $derived(live?.prebuiltAssetExclude ?? [])
    const previewSetting = $derived(DBState.db.useAdditionalAssetsPreview === true)

    let container = $state<HTMLElement | undefined>()
    let refusal = $state<string | null>(null)
    let menuKey = $state<string | null>(null)
    let previewed = $state<Record<string, true>>({})
    let renamedFrom = $state<Record<string, string>>({})
    let sizes = $state<Record<string, number | null>>({})
    let urls = $state<(RowAssetUrl | undefined)[]>([])

    // The kind of URL a row asks for, or null for none: a thumbnail always, a player only after Preview, a tile never.
    // The kind comes from the gate's own decision for the row's element.
    function wantedUse(row: ListRow, preview: boolean): AssetUse | null {
        const use = assetListUse(row.presentation.element)
        return row.presentation.shown === 'thumb' || preview ? use : null
    }

    function moreButtonOf(key: string): HTMLElement | null {
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

    // A focusout that leaves the list ends the tracking only when the element is still in the page one microtask later.
    // A browser reports the removal of a focused element as a focusout from an element that is still connected, with no
    // element that takes the focus, before the flush that removes it has reached the effect below. By the next microtask
    // the flush is over: a removed element keeps the tracking for that effect, one that is still in the page really lost
    // its focus to the page or to another element, and a focus that moved within the list has already set the new row.
    function onFocusOut(event: FocusEvent): void {
        const target = event.target
        const next = event.relatedTarget
        if (!(target instanceof HTMLElement) || (next instanceof Node && container?.contains(next))) return
        const left = focusedKey
        queueMicrotask(() => {
            if (target.isConnected && focusedKey === left) focusedKey = null
        })
    }

    // Runs in the flush of the write that removed the row, which ends before any history action looks for lost focus: the
    // focused row that is gone hands focus to the next row's trigger, else the previous row's, else Add, else the list
    // itself. Focus anywhere else stays, so the page never receives it and an undo or redo elsewhere moves nothing.
    function moveFocusAfterRemoval(keys: string[]): void {
        const key = focusedKey
        if (key === null || !container) return
        const active = document.activeElement
        if (active !== null && active !== document.body && active.isConnected) return
        const survivors = new Set(keys)
        const at = knownKeys.indexOf(key)
        let target: HTMLElement | null
        if (survivors.has(key)) {
            // Rows over one file are keyed by their order, so the key of a removed row can name the row after it, which
            // inherited the node whose menu item held the focus. Position decides: the row now at the old place is the next one.
            target = moreButtonOf(keys[Math.min(Math.max(at, 0), keys.length - 1)])
        } else {
            const next = knownKeys.slice(at + 1).find((candidate) => survivors.has(candidate))
            const previous = knownKeys.slice(0, Math.max(at, 0)).reverse().find((candidate) => survivors.has(candidate))
            target = next !== undefined ? moreButtonOf(next)
                : previous !== undefined ? moreButtonOf(previous)
                : container.querySelector<HTMLElement>('[data-part="studio-asset-add"]')
        }
        ;(target ?? container).focus()
    }

    $effect(() => {
        const keys = rows.map((row) => row.key)
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

    function settleUrl(index: number, entry: RowAssetUrl): void {
        if (pending.get(index) === `${entry.use}\0${entry.path}`) pending.delete(index)
        if (unmounted) return
        // Read when the URL settles: the row may name another file or use by now, and then the URL is dropped.
        const now = rows[index]
        storeRowAssetUrl(urls, index, entry, now?.path, now ? wantedUse(now, previewed[now.key] === true) : null)
    }

    // One budget per run: the whole reads of this run's thumbnails together stay within the Android heap, asked in row order.
    function requestUrls(wanted: { row: ListRow, use: AssetUse | null }[]): void {
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
        const wanted = rows.map((row) => ({ row, use: wantedUse(row, previewed[row.key] === true) }))
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

    function rename(row: ListRow, value: string): string {
        // A row that is no longer at its place renames nothing: a browser blurs a removed row's field while the flush that
        // removes it runs, and the row's index then names whichever row moved up into it. The key check is what refuses a
        // removed row, even when another row has the same name; the name check covers the moment before the flush, when
        // the rows are already recomputed but the row's field still shows the old one.
        const current = rows[row.index]
        if (current === undefined || current.key !== row.key || current.name !== row.name) return row.name
        // An empty name names nothing: the field goes back to the row's own.
        if (!service || value.trim() === '') return row.name
        const result = service.assetRename(owner, 'additionalAssets', row.index, value)
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
    // after the other. Their Preview and renamed-note state moves with them; the removed row's own state goes. This runs
    // for the list's own delete only: an undo or redo removes rows without saying which, so over one file such a row's
    // state can pass to the row that takes its key, so a Preview or an old-name note can then show on the sibling row.
    function dropRowState(keys: string[]): void {
        keys.forEach((here, at) => {
            const after = keys[at + 1]
            if (after !== undefined && previewed[after] === true) previewed[here] = true
            else delete previewed[here]
            const note = after === undefined ? undefined : renamedFrom[after]
            if (note !== undefined) renamedFrom[here] = note
            else delete renamedFrom[here]
        })
    }

    function remove(row: ListRow): void {
        menuKey = null
        if (!service) return
        // The keys of the removed row and the rows over its file behind it, read before the write changes the rows.
        const sharing = rows.filter((other) => other.path === row.path && other.index >= row.index).map((other) => other.key)
        const result = service.assetDelete(owner, 'additionalAssets', [row.index])
        if (result.ok === false) {
            refusal = refusalTextOf(result)
            // The menu item is going away; the row's trigger keeps focus.
            moreButtonOf(row.key)?.focus()
            return
        }
        refusal = null
        if (result.unchanged === true) return
        dropRowState(sharing)
        if (result.stepId === undefined) return
        toasts.postAssetAction(owner, result.stepId, language.studioAssetDeletedOne(row.name))
    }

    function preview(row: ListRow): void {
        menuKey = null
        previewed[row.key] = true
        moreButtonOf(row.key)?.focus()
    }

    // As the classic list does: the path joins or leaves `prebuiltAssetExclude`, which is created when absent. It is no
    // history step: it removes no row and touches no retained file.
    function toggleExclude(row: ListRow): void {
        menuKey = null
        writeLiveCharacter(chaId, (target) => {
            target.prebuiltAssetExclude ??= []
            if (target.prebuiltAssetExclude.includes(row.path)) {
                target.prebuiltAssetExclude = target.prebuiltAssetExclude.filter((entry) => entry !== row.path)
            } else {
                target.prebuiltAssetExclude.push(row.path)
            }
        })
        moreButtonOf(row.key)?.focus()
    }

    function toggleMenu(row: ListRow): void {
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

    function closeMenu(row: ListRow): void {
        menuKey = null
        moreButtonOf(row.key)?.focus()
    }
</script>

{#if live && !hidden}
    <section bind:this={container} tabindex="-1" data-part="studio-asset-list" aria-busy={editable ? undefined : 'true'} class="flex flex-col gap-3 outline-none" onfocusin={onFocusIn} onfocusout={onFocusOut}>
        {#if !editable && !loadFailed}
            <p data-part="studio-asset-loading" class="text-sm text-textcolor2">{language.studioFormLoading}</p>
        {/if}
        {#if loadFailed}
            <p role="status" data-part="studio-asset-banner" data-banner="failed" class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{language.studioBannerFailed}</p>
        {/if}
        {#if banner}
            <p role="status" data-part="studio-asset-banner" data-banner={view?.banner} class="rounded-md border border-darkborderc p-2 text-sm text-textcolor2">{banner}</p>
        {/if}
        <div class="flex items-center justify-between gap-2">
            <p data-part="studio-asset-help" class="min-w-0 text-sm text-textcolor2">{language.studioAssetHelp}</p>
            {#if picker}
                <button type="button" data-part="studio-asset-add" class="min-h-11 shrink-0 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={() => picker.open()}>{language.add}</button>
            {/if}
        </div>
        {#if emotionCount > 0}
            <p data-part="studio-asset-emotions" class="text-sm text-textcolor2">{language.studioAssetEmotionsElsewhere(emotionCount)}</p>
        {/if}
        {#if rows.length === 0}
            <p data-part="studio-asset-empty" class="text-textcolor2">{language.sidebarUi.noAssets}</p>
        {:else}
            <ul data-part="studio-asset-rows" class="flex flex-col gap-2">
                {#each rows as row (row.key)}
                    {@const previewing = previewed[row.key] === true}
                    {@const use = wantedUse(row, previewing)}
                    <StudioAssetRow
                        rowKey={row.key}
                        name={row.name}
                        ext={row.ext}
                        shown={row.presentation.shown}
                        size={sizes[row.path]}
                        thumbUrl={row.presentation.shown === 'thumb' ? rowAssetUrl(urls[row.index], row.path, use) : undefined}
                        mediaUrl={previewing ? rowAssetUrl(urls[row.index], row.path, use) : undefined}
                        {previewing}
                        excludeShown={previewSetting}
                        excluded={excludedPaths.includes(row.path)}
                        {editable}
                        menuOpen={menuKey === row.key}
                        renamedFrom={renamedFrom[row.key] ?? null}
                        {usedIn}
                        oncommit={(value) => rename(row, value)}
                        ondelete={() => remove(row)}
                        onpreview={() => preview(row)}
                        ontoggleexclude={() => toggleExclude(row)}
                        onmenutoggle={() => toggleMenu(row)}
                        onmenuclose={() => closeMenu(row)}
                    />
                {/each}
            </ul>
        {/if}
        {#if refusal}
            <p role="alert" data-part="studio-asset-refusal" class="text-sm text-draculared">{refusal}</p>
        {/if}
    </section>
{/if}
