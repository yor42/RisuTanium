<script lang="ts" module>
    import type { ExportAssetSource } from '../../../ts/drive/assetPieces'
    import type { AssetSizeJob } from '../../../ts/studio/assets/assetSizes'
    import type { AssetPickerPort } from '../../../ts/studio/assets/assetPresentation'
    import type { FinderPort } from './StudioAssetFinder.svelte'

    let sessionJob: Promise<AssetSizeJob> | undefined
    let sessionSourceImport: Promise<ExportAssetSource | null> | undefined
    let sessionFinder: Promise<FinderPort> | undefined
    let finderForTests: FinderPort | undefined
    let storeApiImport: Promise<typeof import('../../../ts/globalApi.svelte')> | undefined

    /** An enabled module's asset rows, for the duplicate scope switch and the last-picture line. In module order, stubs left out. */
    export interface EnabledModuleAssets {
        id: string
        name: string
        assets: readonly (readonly string[])[]
    }

    /** What the picker is given when Add is pressed: the folder to land in, and the call that lands the imported names there. */
    export interface ImportLanding {
        // The open folder: the folder whose header or row held focus when Add was pressed, null for "No folder".
        folder: string | null
        // Call after the imported rows landed, with the names they carry. Places them in one step and returns the lines to show.
        land(names: readonly string[]): { landed: boolean, notes: string[], refusal: string | null }
    }

    /** A picker that also takes the landing. A picker that ignores it leaves its imports in "No folder". */
    export interface FolderAwarePicker extends AssetPickerPort {
        open(landing?: ImportLanding): void
    }

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
                const [source, sizes] = await Promise.all([sessionSource(), import('../../../ts/studio/assets/assetSizes')])
                return sizes.createAssetSizeJob({ source })
            })()
            // A failed build is not kept: the next list asks again.
            made.catch(() => { if (sessionJob === made) sessionJob = undefined })
            sessionJob = made
        }
        return sessionJob
    }

    // The store the page's assets are read from, as the piece source of the size job and of Check bytes; null where the page has no store.
    function sessionSource(): Promise<ExportAssetSource | null> {
        if (sessionSourceImport === undefined) {
            const made = (async (): Promise<ExportAssetSource | null> => {
                const [preflight, pieces] = await Promise.all([import('../../../ts/drive/exportPreflight'), import('../../../ts/drive/assetPieces')])
                const store = await preflight.appStoreOrNull()
                return store === null ? null : await pieces.exportAssetPieceSource(store)
            })()
            made.catch(() => { if (sessionSourceImport === made) sessionSourceImport = undefined })
            sessionSourceImport = made
        }
        return sessionSourceImport
    }

    // The byte layer of the duplicate panel. Its size job is the list's own, so a file is sized once however it is asked for,
    // and its hash cache lives as long as the page, so a file is hashed once for the session.
    export function sessionFinderPort(): Promise<FinderPort> {
        if (finderForTests !== undefined) return Promise.resolve(finderForTests)
        if (sessionFinder === undefined) {
            const made = (async (): Promise<FinderPort> => {
                const [source, job, hashing] = await Promise.all([sessionSource(), sessionAssetSizeJob(), import('../../../ts/studio/assets/assetHashJob')])
                const cache = hashing.createHashCache()
                return {
                    sizes: job,
                    hashCache: cache,
                    async checkBytes(rows, signal, hooks) {
                        // Without a store no file can be read: nothing is hashed and nothing is marked unreadable.
                        if (source === null) return { status: 'done', hashes: new Map(), unreadable: [] }
                        const run = hashing.createCheckBytes({
                            source,
                            sizes: job,
                            cache,
                            onPhase: hooks.onPhase,
                            onProgress: (progress) => {
                                const figures = hashing.progressFigures(progress.doneBytes, progress.totalBytes)
                                hooks.onProgress(figures.x, figures.y)
                            },
                        })
                        return run.runCheckBytes(rows, signal)
                    },
                }
            })()
            made.catch(() => { if (sessionFinder === made) sessionFinder = undefined })
            sessionFinder = made
        }
        return sessionFinder
    }

    // Tests: stands a fake in for the session job, or drops it (undefined) so no test sees another's cache. A list in a
    // suite then never loads the production job and the app graph behind it.
    export function setSessionAssetSizeJobForTests(job: AssetSizeJob | undefined): void {
        sessionJob = job === undefined ? undefined : Promise.resolve(job)
    }

    // Tests: the byte layer of the duplicate panel for a list that is mounted by a parent (undefined drops it).
    export function setSessionFinderPortForTests(port: FinderPort | undefined): void {
        finderForTests = port
    }
</script>

<script lang="ts">
    import { onDestroy, untrack } from 'svelte'
    import { afterFlush } from '../../../ts/afterFlush'
    import { language } from '../../../lang'
    import { writeLiveCharacter } from '../../../ts/liveCharacterWrite'
    import { assetListUse, createWholeReadBudget, isRowAssetUrlCurrent, rowAssetUrl, storeRowAssetUrl, type AssetUse, type RowAssetUrl } from '../../../ts/storage/assetUrlGate'
    import { textMatches } from '../../../ts/chatShell/toggleSearch'
    import { ASSET_FOLDER_KEY } from '../../../ts/studio/assets/assetOwnerKeys'
    import { assetPresentationOf, assetRowExt, type AssetPresentation, type UsedInPort } from '../../../ts/studio/assets/assetPresentation'
    import { assetPoolKey, folderNameKey, folderOf, readFolderDoc } from '../../../ts/studio/assets/folderCodec'
    import { createRowMount } from '../../../ts/studio/assets/rowMount.svelte'
    import type { DuplicateGroup } from '../../../ts/studio/assets/duplicateGroups'
    import type { AssetArrayName } from '../../../ts/studio/assets/mergePreview'
    import type { SurvivorDeps } from '../../../ts/studio/edit/assetSetters'
    import { createStudioToasts, refusalText, refusalTextOf } from '../../../ts/studio/edit/studioToasts'
    import { characterOwnerKey, moduleOwnerKey } from '../../../ts/studio/history/ownerPhase'
    import type { RisuModule } from '../../../ts/process/modules'
    import { isModuleStub } from '../../../ts/storage/moduleStub'
    import type { StudioResult } from '../../../ts/studio/history/ownerHistory.svelte'
    import { beginOwnerVisit, ensureStudioHistory, getStudioHistoryService, historyBannerText, studioHistoryLoadFailed } from '../../../ts/studio/history/studioHistoryService.svelte'
    import { DBState } from '../../../ts/stores.svelte'
    import type { ToastHost } from '../../../ts/toast/toastHost.svelte'
    import StudioAssetBulkBar from './StudioAssetBulkBar.svelte'
    import StudioAssetFinder, { type FinderArray, type FinderRow } from './StudioAssetFinder.svelte'
    import StudioAssetFolderHeader from './StudioAssetFolderHeader.svelte'
    import StudioAssetRow, { type MoveChoice } from './StudioAssetRow.svelte'

    // The additional assets of one character, read by id: rows with their thumbnail or type tile, the name field that
    // renames, and a menu with delete, preview and the exclude toggle. Every row change goes through the history
    // service, so each is one step with a durable undo. Thumbnails always show; the preview setting only gates the
    // exclude item. Sizes and URLs are asked for only after the list is shown, and never for a row that does not need them.
    // With `moduleId` the list is the `assets` of one module slot instead: it has no emotion images, no exclude or preview
    // settings and no last-picture line, which belong to a character.
    interface Props {
        // The character's id; unused by a module's list.
        chaId?: string
        // A module's list: the module's stored id and the place of its slot in the module list. The slot is read by place
        // so a module whose id is shared shows its own rows.
        moduleId?: string
        moduleIndex?: number
        // True while another module holds this module's id: the rows, folders and finder show and every change is off.
        readOnly?: boolean
        // The toast host of the delete toasts; the app's own host when absent (tests pass one on a fake clock).
        host?: ToastHost
        // The size job of the rows; the page session's own when absent (tests pass a fake).
        sizeJob?: () => Promise<AssetSizeJob>
        // The used-in count and the renamed-field note; both are left out while it is absent.
        usedIn?: UsedInPort
        // Opens the picker; the list has no Add control while it is absent.
        picker?: FolderAwarePicker
        // The enabled modules' assets; without it the duplicate panel has no module scope and no last-picture line.
        enabledModules?: () => readonly EnabledModuleAssets[]
        // How many places reach a file under a name, for the survivor rule of Remove extras; absent counts none.
        references?: (name: string, path: string) => number
        // The byte layer of Check bytes; the page session's own when absent (tests pass a double).
        finderPort?: () => Promise<FinderPort>
        // Merge belongs to the merge stage: while it is absent a "same file, different names" group has no Merge button.
        onmerge?: (group: DuplicateGroup<FinderRow>) => void
    }

    let { chaId = '', moduleId, moduleIndex, readOnly = false, host, sizeJob, usedIn, picker, enabledModules, references, finderPort, onmerge }: Props = $props()

    interface ListRow {
        key: string
        index: number
        name: string
        path: string
        ext: string
        // The listed folder the row's name is in, or null for "No folder".
        folder: string | null
        presentation: AssetPresentation
    }

    // One group of the list: a listed folder, "No folder", or (while no folder is listed) the whole list. The structure
    // does not depend on the filter: every group of it is in the page, and the filter only hides.
    interface HeldGroup {
        id: string
        // The folder's name, null for "No folder".
        folder: string | null
        headed: boolean
        expanded: boolean
        // Every row the group holds, matched or not.
        held: ListRow[]
        total: number
    }

    // A group with the rows that match the filter.
    interface Group extends HeldGroup {
        rows: ListRow[]
    }

    // Whether this list is a module's, and the array its rows are in. Fixed for the life of the list: the detail builds a
    // character's list and a module's list in different branches.
    const forModule = untrack(() => moduleId !== undefined && moduleIndex !== undefined)
    const arrayId: AssetArrayName = forModule ? 'assets' : 'additionalAssets'
    const owner = $derived(forModule ? moduleOwnerKey(moduleId ?? '') : characterOwnerKey(chaId))
    const toasts = createStudioToasts({ service: getStudioHistoryService, host: untrack(() => host) })

    const service = $derived(getStudioHistoryService())
    // A module whose id is shared starts no history lifecycle: its form changes nothing, and the service would claim and
    // load a record for an id that names more than one module.
    $effect(() => {
        const key = owner
        if (service) {
            if (!readOnly) untrack(() => beginOwnerVisit(key))
        } else {
            ensureStudioHistory()
        }
    })

    const live = $derived.by(() => {
        if (forModule) return undefined
        const found = DBState.db.characters?.find((candidate) => candidate?.chaId === chaId)
        return found && found.type !== 'group' ? found : undefined
    })
    // The module's slot: a loaded module holding the id at the place the detail named. A slot is replaced by every
    // write, so this re-reads on each change of the module's rows or folders.
    const moduleSlot = $derived.by((): RisuModule | undefined => {
        if (!forModule || moduleIndex === undefined) return undefined
        const slot: RisuModule | undefined = DBState.db.modules?.[moduleIndex]
        return slot !== undefined && slot.id === moduleId && !isModuleStub(slot) ? slot : undefined
    })
    const present = $derived(forModule ? moduleSlot !== undefined : live !== undefined)
    // Read at every render, so a character that became private or a group shows nothing.
    const view = $derived(service ? service.view(owner) : null)
    const hidden = $derived(!present || live?.license === 'private' || view?.restricted === true)
    // A read-only module is not waiting for anything: it is never loading.
    const busy = $derived(!readOnly && view?.editable !== true)
    const editable = $derived(view?.editable === true && !readOnly)
    const banner = $derived(view ? historyBannerText(view.banner) : null)
    const loadFailed = $derived(!service && studioHistoryLoadFailed())

    // The folder list of the owner, as the list shows it: the listed folders in stored order, and each name's folder. A
    // list this build cannot read shows no folders and is never written.
    const folderRead = $derived(readFolderDoc(forModule ? moduleSlot?.[ASSET_FOLDER_KEY] : live?.extentions?.[ASSET_FOLDER_KEY]))
    const folderNames = $derived(folderRead.doc.additional.order)
    const foldersNewer = $derived(folderRead.state === 'unreadable')

    // A row is named by its file: a rename keeps the row's DOM node and its focus. Two rows over one file are told apart by their order.
    const rows = $derived.by((): ListRow[] => {
        const seen = new Map<string, number>()
        const doc = folderRead.doc
        return ((forModule ? moduleSlot?.assets : live?.additionalAssets) ?? []).map((tuple, index) => {
            const path = tuple[1] ?? ''
            const occurrence = seen.get(path) ?? 0
            seen.set(path, occurrence + 1)
            const ext = assetRowExt(tuple)
            const name = tuple[0] ?? ''
            return { key: `${occurrence}:${path}`, index, name, path, ext, folder: folderOf(doc, name), presentation: assetPresentationOf(ext) }
        })
    })
    const emotionCount = $derived(live?.emotionImages?.length ?? 0)
    const excludedPaths = $derived(live?.prebuiltAssetExclude ?? [])
    // The exclude and preview settings belong to a character: a module's rows have neither.
    const previewSetting = $derived(!forModule && DBState.db.useAdditionalAssetsPreview === true)

    let container = $state<HTMLElement | undefined>()
    let refusal = $state<string | null>(null)
    let menuKey = $state<string | null>(null)
    let previewed = $state<Record<string, true>>({})
    let renamedFrom = $state<Record<string, string>>({})
    let joinNotes = $state<Record<string, string>>({})
    let sizes = $state<Record<string, number | null>>({})
    let urls = $state<(RowAssetUrl | undefined)[]>([])

    // The filter text, the bulk selection, the folders that are folded and the open editors. The structure resets them: a
    // new owner builds the list again, and a filter change clears the selection where it is typed.
    let filter = $state('')
    let selecting = $state(false)
    // The keys the person ticked. What counts as selected is `selectedRows`: these keys that are still shown.
    let picked = $state<Record<string, true>>({})
    let folded = $state<Record<string, true>>({})
    let renamingFolder = $state<string | null>(null)
    let newFolderOpen = $state(false)
    let finderOpen = $state(false)
    // The line that follows a bulk delete: how many of the removed names are still used in text, and the first of them.
    let stillUsed = $state<{ text: string, name: string } | null>(null)

    const query = $derived(filter.trim())
    function passesFilter(row: ListRow): boolean {
        return query === '' || textMatches(row.name, query) || (row.folder !== null && textMatches(row.folder, query))
    }

    // The one pass of the matcher: the rows the filter keeps. Everything the filter decides is read from these keys.
    const matched = $derived(rows.filter(passesFilter))
    const matchedKeys = $derived(new Set(matched.map((row) => row.key)))

    // The groups with every row they hold, whatever the filter says: the structure the page keeps. It never reads the query.
    const allGroups = $derived.by((): HeldGroup[] => {
        if (folderNames.length === 0) {
            return rows.length === 0 ? [] : [{ id: 'all', folder: null, headed: false, expanded: true, held: rows, total: rows.length }]
        }
        const made: HeldGroup[] = folderNames.map((name) => {
            const id = `f:${folderNameKey(name)}`
            const held = rows.filter((row) => row.folder === name)
            return { id, folder: name, headed: true, expanded: folded[id] !== true, held, total: held.length }
        })
        const loose = rows.filter((row) => row.folder === null)
        made.push({ id: 'none', folder: null, headed: true, expanded: folded.none !== true, held: loose, total: loose.length })
        // "No folder" is in the page while it holds a row; an empty listed folder always is, so it can be filled or deleted.
        return made.filter((group) => group.folder !== null || group.total > 0)
    })
    // The groups the filter leaves visible, with the rows it keeps. While nothing is typed an empty folder stays visible.
    const groups = $derived(allGroups.map((group): Group => ({ ...group, rows: group.held.filter((row) => matchedKeys.has(row.key)) })).filter((group) => query === '' || group.rows.length > 0))
    const visibleIds = $derived(new Set(groups.map((group) => group.id)))
    // The rows that are on screen, in the order they show.
    const shownRows = $derived(groups.flatMap((group) => (group.expanded ? group.rows : [])))
    // The one rule of what is displayed: a row is displayed exactly when its key is here. The row's flag, its player, the
    // focus rule and the removal walk all read this set, never the filter or the fold on their own.
    const displayedKeys = $derived(new Set(shownRows.map((row) => row.key)))
    // The selection is computed, never written by an effect: the ticked keys that are still on screen.
    const selectedRows = $derived(shownRows.filter((row) => picked[row.key] === true))

    // The first mount is chunked: the rows the list starts with mount a few at a time, then every row stays mounted and
    // the filter and the folds only hide. Rows that arrive later mount in one flush, so a write never defers anything.
    const rowMount = createRowMount({
        initialKeys: untrack(() => shownRows.map((row) => row.key)),
        shownKeys: () => shownRows.map((row) => row.key),
    })
    onDestroy(() => rowMount.dispose())

    const moveChoices = $derived.by((): MoveChoice[] => [{ value: null, label: language.studioAssetNoFolder }, ...folderNames.map((name) => ({ value: name, label: name }))])

    // The kind of URL a row asks for, or null for none: a thumbnail always, a player only after Preview, a tile never.
    // The kind comes from the gate's own decision for the row's element.
    function wantedUse(row: ListRow, preview: boolean): AssetUse | null {
        const use = assetListUse(row.presentation.element)
        return row.presentation.shown === 'thumb' || preview ? use : null
    }

    // The trigger of a displayed row; a row that is not displayed has none to give, whatever its node still holds.
    function moreButtonOf(key: string): HTMLElement | null {
        if (!displayedKeys.has(key)) return null
        const row =Array.from(container?.querySelectorAll<HTMLElement>('[data-part="studio-asset-row"]') ?? []).find((candidate) => candidate.dataset.rowKey === key)
        return row?.querySelector<HTMLElement>('[data-part="studio-asset-row-more"]') ?? null
    }

    // ---------------------------------------------------------------- focus after a removal

    // The row keys as the last flush showed them, and the row that holds focus. Focus is tracked by events because the
    // flush drops a removed row's DOM before any effect runs, and the page's focus is gone with it.
    let knownKeys: string[] = []
    let focusedKey: string | null = null
    // The folder whose header or row held focus last, for an import to land in: null is "No folder". Focus on Add itself
    // keeps it, so pressing Add does not lose it; focus anywhere else in the list clears it.
    let focusedFolder: string | null = null

    function onFocusIn(event: FocusEvent): void {
        const target = event.target
        focusedKey = target instanceof HTMLElement ? (target.closest<HTMLElement>('[data-part="studio-asset-row"]')?.dataset.rowKey ?? null) : null
        if (!(target instanceof HTMLElement)) return
        const section = target.closest<HTMLElement>('[data-part="studio-asset-folder"]')
        if (section) focusedFolder = section.dataset.folder ?? null
        else if (target.closest('[data-part="studio-asset-add"]') === null) focusedFolder = null
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
    // focused row that is gone, or no longer displayed, hands focus to the next displayed row's trigger, else the previous
    // row's, else Add, else the list itself. A hidden row stays in the page, so the page's own focus is not the sign: focus
    // inside the list on a row that is not displayed counts as lost, and focus anywhere else stays, so the page never
    // receives it and an undo or redo elsewhere moves nothing. A change that takes one row out as another comes in keeps
    // the length and is not seen here; the hidden element keeps focus until the browser drops it, as a removed one did.
    function moveFocusAfterRemoval(keys: string[]): void {
        const key = focusedKey
        if (key === null || !container) return
        // A change that removes no row (a move to another folder, a rename, a fold that shows rows again) loses no focus.
        if (keys.length >= knownKeys.length) return
        const active = document.activeElement
        const lost = active === null || active === document.body || !active.isConnected || (!displayedKeys.has(key) && container.contains(active))
        if (!lost) return
        // One pass over the list: the triggers of the displayed rows that are mounted. While the first mount runs, a
        // displayed row may have no node yet, and the walk goes on to the next one that has.
        const triggers = new Map<string, HTMLElement>()
        for (const row of Array.from(container.querySelectorAll<HTMLElement>('[data-part="studio-asset-row"]'))) {
            const rowKey = row.dataset.rowKey
            const more = row.querySelector<HTMLElement>('[data-part="studio-asset-row-more"]')
            if (rowKey !== undefined && more !== null && displayedKeys.has(rowKey)) triggers.set(rowKey, more)
        }
        const firstTrigger = (candidates: readonly string[]): HTMLElement | null => {
            for (const candidate of candidates) {
                const found = triggers.get(candidate)
                if (found) return found
            }
            return null
        }
        const survivors = new Set(keys)
        const at = knownKeys.indexOf(key)
        let target: HTMLElement | null
        if (survivors.has(key)) {
            // Rows over one file are keyed by their order, so the key of a removed row can name the row after it, which
            // inherited the node whose menu item held the focus. Position decides: the row now at the old place is the next one.
            const place = Math.min(Math.max(at, 0), keys.length - 1)
            target = firstTrigger([...keys.slice(place), ...keys.slice(0, place).reverse()])
        } else {
            const next = knownKeys.slice(at + 1).filter((candidate) => survivors.has(candidate))
            const previous = knownKeys.slice(0, Math.max(at, 0)).reverse().filter((candidate) => survivors.has(candidate))
            target = firstTrigger(next) ?? firstTrigger(previous) ?? container.querySelector<HTMLElement>('[data-part="studio-asset-add"]')
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
        // A name that already has rows in a folder takes this row into it; read before the write changes the rows.
        const pooled = rows.find((other) => other.index !== row.index && assetPoolKey(other.name) === assetPoolKey(value))
        const joins = pooled?.folder != null && pooled.folder !== row.folder ? pooled.folder : null
        const result = service.assetRename(owner, arrayId, row.index, value)
        if (result.ok === false) {
            refusal = refusalTextOf(result)
            return row.name
        }
        refusal = null
        // An unchanged result landed nothing and posts nothing: the row already has the name it shows.
        if (result.unchanged === true) return row.name
        renamedFrom[row.key] = row.name
        if (joins !== null) joinNotes[row.key] = language.studioAssetRenameJoins(joins, value)
        else delete joinNotes[row.key]
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
            const joined = after === undefined ? undefined : joinNotes[after]
            if (joined !== undefined) joinNotes[here] = joined
            else delete joinNotes[here]
        })
    }

    function remove(row: ListRow): void {
        menuKey = null
        if (!service) return
        // The keys of the removed row and the rows over its file behind it, read before the write changes the rows.
        const sharing = rows.filter((other) => other.path === row.path && other.index >= row.index).map((other) => other.key)
        const lastPicture = lastPictureLine([row])
        // While the first mount runs, the rows next to the removed one mount in the delete's own flush, so the focus move
        // after it finds a trigger to take. After the first mount this changes nothing.
        const place = shownRows.findIndex((other) => other.key === row.key)
        if (place >= 0) rowMount.release([shownRows[place + 1]?.key, shownRows[place - 1]?.key].filter((key): key is string => key !== undefined))
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
        pickedAfterRemoval()
        if (result.stepId === undefined) return
        toasts.postAssetAction(owner, result.stepId, language.studioAssetDeletedOne(row.name), lastPicture ?? undefined)
    }

    // The ticked keys that still name a row; written by the handlers that change the rows or the ticks.
    function pickedAfterRemoval(): void {
        const live = new Set(rows.map((row) => row.key))
        for (const key of Object.keys(picked)) {
            if (!live.has(key)) delete picked[key]
        }
    }

    // "Text using {name} now shows module {m}'s picture": only for a name whose last character row goes, and only when an
    // enabled module holds that name. Read before the write, from the rows that are about to go.
    function lastPictureLine(removed: readonly ListRow[]): string | null {
        // The line is about the last character row of a name; a module's rows never raise it.
        if (forModule || !enabledModules) return null
        const goneKeys = new Set(removed.map((row) => row.index))
        const lines: string[] = []
        const seen = new Set<string>()
        for (const row of removed) {
            const key = assetPoolKey(row.name)
            if (seen.has(key)) continue
            seen.add(key)
            if (rows.some((other) => !goneKeys.has(other.index) && assetPoolKey(other.name) === key)) continue
            const holder = enabledModules().find((module) => module.assets.some((asset) => assetPoolKey(asset[0] ?? '') === key))
            if (holder) lines.push(language.studioAssetModuleNowShows(row.name, holder.name))
        }
        return lines.length === 0 ? null : lines.join(' ')
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

    // ---------------------------------------------------------------- filter and selection

    // The selection is cleared here, where the filter is typed, and nowhere else: a clear written by an effect would also run
    // when a rebuild of the owner model re-ran it.
    function onFilterInput(value: string): void {
        filter = value
        picked = {}
        stillUsed = null
    }

    function toggleSelecting(): void {
        selecting = !selecting
        picked = {}
        stillUsed = null
    }

    function pick(row: ListRow, on: boolean): void {
        pickedAfterRemoval()
        if (on) picked[row.key] = true
        else delete picked[row.key]
    }

    // Selects the rows that are shown, and only those: rows the filter or a folded folder hides are never ticked.
    function selectAll(on: boolean): void {
        const next: Record<string, true> = {}
        if (on) {
            for (const row of shownRows) next[row.key] = true
        }
        picked = next
    }

    // ---------------------------------------------------------------- folders

    // The words of a refused action: a folder rule's own, else the refusal's.
    function refusalOf(result: Extract<StudioResult, { ok: false }>): string {
        switch (result.folderRefusal) {
            case 'newerVersion': return language.studioAssetFoldersNewer
            case 'nameTaken': return language.studioAssetFolderExists
            case 'noFolderName': return language.studioAssetFolderNameReserved
            case 'emptyName': return language.studioAssetFolderNameEmpty
            case 'unknownFolder': return refusalText('precondition')
            case undefined: return refusalTextOf(result)
        }
    }

    function toggleFold(group: HeldGroup): void {
        if (folded[group.id] === true) delete folded[group.id]
        else folded[group.id] = true
    }

    let newFolderName = $state('')

    function openNewFolder(): void {
        newFolderOpen = !newFolderOpen
        newFolderName = ''
    }

    function createFolder(): void {
        if (!service) return
        const result = service.assetFolder(owner, { kind: 'create', name: newFolderName })
        if (result.ok === false) {
            refusal = refusalOf(result)
            return
        }
        refusal = null
        newFolderOpen = false
        newFolderName = ''
    }

    function onNewFolderKeydown(event: KeyboardEvent): void {
        if (event.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter') {
            event.preventDefault()
            createFolder()
        } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            newFolderOpen = false
        }
    }

    function focusNode(node: HTMLElement): void {
        node.focus()
    }

    // True while focus is on the given control of that folder's own section, read before the write that removes or
    // replaces the control. Focus anywhere else is none of the folder write's business and stays.
    function focusIsOnFolderControl(control: 'studio-asset-folder-delete' | 'studio-asset-folder-name', folder: string): boolean {
        const active = document.activeElement
        if (!(active instanceof HTMLElement) || !container?.contains(active) || active.dataset.part !== control) return false
        return active.closest<HTMLElement>('[data-part="studio-asset-folder"]')?.dataset.folder === folder
    }

    // The header of a folder section that is in the page and not hidden, or null.
    function folderHeaderOf(folder: string | null): HTMLElement | null {
        for (const section of Array.from(container?.querySelectorAll<HTMLElement>('[data-part="studio-asset-folder"]') ?? [])) {
            const named = folder === null ? section.dataset.none === 'true' : section.dataset.folder !== undefined && folderNameKey(section.dataset.folder) === folderNameKey(folder)
            if (named && !section.hidden) return section.querySelector<HTMLElement>('[data-part="studio-asset-folder-header"]')
        }
        return null
    }

    // True when the rename field may close: the name landed, or it already was the folder's own.
    function renameFolder(from: string, to: string): boolean {
        if (!service) return false
        const heldFocus = focusIsOnFolderControl('studio-asset-folder-name', from)
        const result = service.assetFolder(owner, { kind: 'rename', from, to })
        if (result.ok === false) {
            refusal = refusalOf(result)
            return false
        }
        refusal = null
        renamingFolder = null
        // The field is gone and the section is re-created under its new name: the header is looked up once the flush has drawn it.
        if (heldFocus) void afterFlush().then(() => (folderHeaderOf(to) ?? container)?.focus())
        return true
    }

    function deleteFolder(name: string): void {
        if (!service) return
        const heldFocus = focusIsOnFolderControl('studio-asset-folder-delete', name)
        const result = service.assetFolder(owner, { kind: 'delete', name })
        if (result.ok === false) {
            refusal = refusalOf(result)
            return
        }
        refusal = null
        if (result.unchanged === true || result.stepId === undefined) return
        // The Delete button left with its section; the rows are now in "No folder", whose header may only now exist.
        if (heldFocus) void afterFlush().then(() => (folderHeaderOf(null) ?? container)?.focus())
        toasts.postAssetAction(owner, result.stepId, language.studioAssetFolderDeletedToast(name))
    }

    // Moves every row of the given names: rows with one name (ignoring case) share a folder, so they all go.
    function moveNames(names: readonly string[], folder: string | null): void {
        if (!service) return
        const pooled = new Set(names.map(assetPoolKey))
        const moved = rows.filter((row) => pooled.has(assetPoolKey(row.name))).length
        const result = service.assetFolder(owner, { kind: 'move', names, folder })
        if (result.ok === false) {
            refusal = refusalOf(result)
            return
        }
        refusal = null
        if (result.unchanged === true || result.stepId === undefined) return
        toasts.postAssetAction(owner, result.stepId, language.studioStepAssetMove(moved, folder ?? language.studioAssetNoFolder))
    }

    function moveRow(row: ListRow, folder: string | null): void {
        menuKey = null
        moveNames([row.name], folder)
        // The row may have moved to another group: its trigger is found again once the flush has drawn it.
        void afterFlush().then(() => (moreButtonOf(row.key) ?? container)?.focus())
    }

    function moveNote(row: ListRow): string | null {
        const sharing = rows.filter((other) => assetPoolKey(other.name) === assetPoolKey(row.name)).length
        return sharing > 1 ? language.studioAssetMovesSameName(sharing, row.name) : null
    }

    // ---------------------------------------------------------------- bulk actions

    // The label of the preview action: it includes the picked rows when every one is left out, else it leaves them out.
    const previewAction = $derived(previewSetting ? (selectedRows.length > 0 && selectedRows.every((row) => excludedPaths.includes(row.path)) ? 'include' : 'leave') : null)

    function bulkDelete(): void {
        const targets = selectedRows
        if (!service || targets.length === 0) return
        const names = [...new Set(targets.map((row) => row.name))]
        // Read before the write, from the rows that are about to go: a delete never rewrites text, so these stay used.
        const used = usedIn ? names.filter((name) => usedIn.usedText(name) !== null) : []
        const lastPicture = lastPictureLine(targets)
        const result = service.assetDelete(owner, arrayId, targets.map((row) => row.index))
        if (result.ok === false) {
            refusal = refusalTextOf(result)
            return
        }
        refusal = null
        if (result.unchanged === true) return
        for (const row of targets) delete picked[row.key]
        pickedAfterRemoval()
        stillUsed = used.length > 0 ? { text: language.studioAssetStillUsed(used.length), name: used[0] } : null
        if (result.stepId === undefined) return
        const sub = [stillUsed?.text, lastPicture].filter((line): line is string => line !== undefined && line !== null).join(' ')
        toasts.postAssetAction(owner, result.stepId, language.studioAssetDeletedMany(targets.length), sub === '' ? undefined : sub)
    }

    function bulkMove(folder: string | null): void {
        const targets = selectedRows
        if (targets.length === 0) return
        moveNames([...new Set(targets.map((row) => row.name))], folder)
    }

    // As the single item does: the paths join or leave `prebuiltAssetExclude`, with no history step.
    function bulkPreview(): void {
        const paths = [...new Set(selectedRows.map((row) => row.path))]
        const include = previewAction === 'include'
        if (paths.length === 0) return
        writeLiveCharacter(chaId, (target) => {
            target.prebuiltAssetExclude ??= []
            target.prebuiltAssetExclude = include
                ? target.prebuiltAssetExclude.filter((entry) => !paths.includes(entry))
                : [...target.prebuiltAssetExclude, ...paths.filter((path) => !target.prebuiltAssetExclude?.includes(path))]
        })
    }

    // ---------------------------------------------------------------- imports

    // Places imported rows, which have landed already, in the folder that was open when Add was pressed. A name that has
    // other rows keeps the folder those rows have; a folder entry of a name that has no other row is stale and is not read.
    function landImported(names: readonly string[], openFolder: string | null): { landed: boolean, notes: string[], refusal: string | null } {
        if (!service) return { landed: false, notes: [], refusal: null }
        const imported = new Map<string, number>()
        for (const name of names) imported.set(assetPoolKey(name), (imported.get(assetPoolKey(name)) ?? 0) + 1)
        const notes: string[] = []
        const placed: string[] = []
        const seen = new Set<string>()
        for (const name of names) {
            const key = assetPoolKey(name)
            if (seen.has(key)) continue
            seen.add(key)
            const others = rows.filter((row) => assetPoolKey(row.name) === key).length - (imported.get(key) ?? 0)
            const existing = others > 0 ? folderOf(folderRead.doc, name) : null
            if (existing !== null) notes.push(language.studioAssetImportJoins(existing, name))
            else placed.push(name)
        }
        if (placed.length === 0) return { landed: false, notes, refusal: null }
        const result = service.assetFolder(owner, { kind: 'move', names: placed, folder: openFolder })
        if (result.ok === false) return { landed: false, notes, refusal: refusalOf(result) }
        return { landed: result.unchanged !== true, notes, refusal: null }
    }

    function openPicker(): void {
        const folder = focusedFolder
        picker?.open({ folder, land: (names) => landImported(names, folder) })
    }

    // ---------------------------------------------------------------- the duplicate panel

    const finderArrays = $derived.by((): FinderArray[] => {
        const own: FinderArray[] = [{ id: arrayId, title: null, reportOnly: false, rows: rows.map((row) => ({ name: row.name, path: row.path, index: row.index, folder: row.folder })) }]
        const emotions = live?.emotionImages ?? []
        if (emotions.length > 0) {
            own.push({ id: 'emotionImages', title: language.emotionImage, reportOnly: true, rows: emotions.map((tuple, index) => ({ name: tuple[0] ?? '', path: tuple[1] ?? '', index, folder: null })) })
        }
        return own
    })

    // The enabled modules' arrays for the scope switch, in module order. A module's own list is already the first array,
    // so the module itself is left out here.
    function moduleArrays(): FinderArray[] {
        return (enabledModules?.() ?? []).filter((module) => module.id !== moduleId).map((module) => ({
            id: `module:${module.id}`,
            title: module.name,
            reportOnly: true,
            rows: module.assets.map((asset, index) => ({ name: asset[0] ?? '', path: asset[1] ?? '', index, folder: null })),
        }))
    }

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
        const kept = survivor.reason === 'folder' && survivor.row.folder !== null ? language.studioAssetSurvivorFolder(survivor.row.folder)
            : survivor.reason === 'references' ? language.studioAssetSurvivorMostUsed
            : language.studioAssetSurvivorFirst
        toasts.postAssetAction(owner, result.stepId, language.studioAssetRemovedExtras(extras.length, name), pool ? `${kept} ${language.studioAssetPoolWarning}` : kept)
    }
</script>

{#if present && !hidden}
    <section bind:this={container} tabindex="-1" data-part="studio-asset-list" data-rows-pending={rowMount.done ? undefined : 'true'} aria-busy={busy ? 'true' : undefined} class="flex flex-col gap-3 outline-none" onfocusin={onFocusIn} onfocusout={onFocusOut}>
        {#if busy && !loadFailed}
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
                <button type="button" data-part="studio-asset-add" class="min-h-11 shrink-0 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={openPicker}>{language.add}</button>
            {/if}
        </div>
        {#if emotionCount > 0}
            <p data-part="studio-asset-emotions" class="text-sm text-textcolor2">{language.studioAssetEmotionsElsewhere(emotionCount)}</p>
        {/if}
        {#if foldersNewer}
            <p data-part="studio-asset-folders-newer" class="text-sm text-textcolor2">{language.studioAssetFoldersNewer}</p>
        {/if}
        {#if rows.length === 0}
            <p data-part="studio-asset-empty" class="text-textcolor2">{language.sidebarUi.noAssets}</p>
        {:else}
            <div class="flex flex-wrap items-center gap-2">
                <input
                    type="text"
                    data-part="studio-asset-filter"
                    class="min-h-11 min-w-0 flex-1 rounded-md border border-darkborderc bg-darkbg px-2 text-textcolor"
                    aria-label={language.studioAssetFilter}
                    placeholder={language.studioAssetFilter}
                    autocomplete="off"
                    value={filter}
                    oninput={(event) => onFilterInput(event.currentTarget.value)}
                />
                <button type="button" data-part="studio-asset-new-folder" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50" aria-expanded={newFolderOpen} disabled={!editable} onclick={openNewFolder}>{language.studioAssetNewFolder}</button>
                <button type="button" data-part="studio-asset-select-toggle" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" aria-pressed={selecting} onclick={toggleSelecting}>{language.studioAssetSelect}</button>
                <button type="button" data-part="studio-asset-find-duplicates" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" aria-expanded={finderOpen} onclick={() => { finderOpen = !finderOpen }}>{language.studioAssetFindDuplicates}</button>
            </div>
            {#if newFolderOpen}
                <input
                    use:focusNode
                    type="text"
                    data-part="studio-asset-new-folder-name"
                    class="min-h-11 w-full min-w-0 rounded-md border border-darkborderc bg-darkbg px-2 text-textcolor"
                    aria-label={language.studioAssetNewFolder}
                    autocomplete="off"
                    bind:value={newFolderName}
                    onkeydown={onNewFolderKeydown}
                />
            {/if}
            {#if selecting}
                <StudioAssetBulkBar
                    count={selectedRows.length}
                    shown={shownRows.length}
                    {editable}
                    {moveChoices}
                    {previewAction}
                    onselectall={selectAll}
                    onmove={bulkMove}
                    ondelete={bulkDelete}
                    onpreview={bulkPreview}
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
                    moduleArrays={enabledModules ? moduleArrays : undefined}
                    port={finderPort ?? sessionFinderPort}
                    {sizes}
                    {editable}
                    {references}
                    onremoveextras={removeExtras}
                    onmerge={onmerge ? (_array, group) => onmerge(group) : undefined}
                    onclose={() => { finderOpen = false }}
                />
            {/if}
            {#if groups.length === 0}
                <p data-part="studio-asset-filter-empty" class="text-textcolor2">{language.studioAssetFilterEmpty(query)}</p>
            {/if}
            {#each allGroups as group (group.id)}
                <section data-part="studio-asset-folder" data-folder={group.folder ?? undefined} data-none={group.folder === null && group.headed ? 'true' : undefined} hidden={!visibleIds.has(group.id)} class="flex flex-col gap-2">
                    {#if group.headed}
                        <StudioAssetFolderHeader
                            label={group.folder ?? language.studioAssetNoFolder}
                            count={group.total}
                            expanded={group.expanded}
                            actionable={group.folder !== null && (editable || readOnly)}
                            disabled={!editable}
                            editing={group.folder !== null && renamingFolder === group.folder}
                            ontoggle={() => toggleFold(group)}
                            onstartrename={() => { renamingFolder = group.folder }}
                            ondelete={() => group.folder !== null && deleteFolder(group.folder)}
                            oncommitrename={(value) => group.folder !== null && renameFolder(group.folder, value)}
                            oncancelrename={() => { renamingFolder = null }}
                        />
                    {/if}
                    <ul data-part="studio-asset-rows" hidden={!group.expanded} class="flex flex-col gap-2">
                        {#each group.held.filter((row) => rowMount.mounted(row.key)) as row (row.key)}
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
                                displayed={displayedKeys.has(row.key)}
                                excludeShown={previewSetting}
                                excluded={excludedPaths.includes(row.path)}
                                {editable}
                                menuOpen={menuKey === row.key}
                                renamedFrom={renamedFrom[row.key] ?? null}
                                joinNote={joinNotes[row.key] ?? null}
                                {usedIn}
                                moveChoices={editable ? moveChoices : []}
                                moveNote={() => moveNote(row)}
                                {selecting}
                                selected={picked[row.key] === true}
                                oncommit={(value) => rename(row, value)}
                                ondelete={() => remove(row)}
                                onpreview={() => preview(row)}
                                ontoggleexclude={() => toggleExclude(row)}
                                onmenutoggle={() => toggleMenu(row)}
                                onmenuclose={() => closeMenu(row)}
                                onmove={(folder) => moveRow(row, folder)}
                                onselect={(on) => pick(row, on)}
                            />
                        {/each}
                    </ul>
                </section>
            {/each}
        {/if}
        {#if refusal}
            <p role="alert" data-part="studio-asset-refusal" class="text-sm text-draculared">{refusal}</p>
        {/if}
    </section>
{/if}
