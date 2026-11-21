// @vitest-environment jsdom
/**
 * The windowed Studio asset list over the real history service on the memory doubles: only the rows near the band (and
 * the pinned ones) are in the page, whatever the filter and the folds say, and the list's own actions read data, not
 * the rows that happen to be mounted. Default jsdom geometry: zero rects and a band of the viewport height, so a
 * segment's narrow window is about a dozen rows and its wide window about twice that.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0, srcCalls: [] as string[] }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string, use: string) => {
        h.srcCalls.push(path)
        return `blob:${use}:${path}`
    },
}))

const db = $state({ db: fixtureDb([]) })
const selection = $state({ selId: 0 })
const quickSettings = $state({ open: true })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const stores = {
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
        CharConfigSubMenu: writable(0),
        SettingsMenuIndex: writable(-1),
        botMakerMode: writable(false),
        sideBarStore: writable(false),
        frozenSaveKeysStore: writable([]),
        clearCharEmotionCache: () => {},
    }
    return {
        ...stores,
        get DBState() { return db },
        get selIdState() { return selection },
        get QuickSettings() { return quickSettings },
    }
})
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('src/ts/process/moduleRefList', () => ({ moduleListOf: () => [] }))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = { sidebarUi: { noAssets: 'noAssets' } }
    for (const key of [
        'studioAssetEmotionsElsewhere', 'studioAssetRowMenu', 'studioAssetDeletedOne', 'studioAssetDeletedMany', 'studioAssetSelectedCount', 'studioAssetStillUsed',
        'studioAssetModuleNowShows', 'studioAssetFilterEmpty', 'studioStepAssetDeleteOne', 'studioStepAssetDeleteMany', 'studioStepAssetRename', 'studioAssetFileGone',
        'studioAssetFileUnchecked', 'studioStepAssetMove',
    ]) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { AssetSizeJob, StoredSize } from 'src/ts/studio/assets/assetSizes'
import { resetStudioToastsForTests, retireAssetToasts } from 'src/ts/studio/edit/studioToasts'
import { makeCharacter, makeChat, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createToastHost, resetToastHostForTests, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../../ts/studio/history/tests/studioStoreDoubles'
import { assetRow } from '../../../ts/studio/assets/assetFixtures.test-helpers'
import { ASSET_FOLDER_KEY } from '../../../ts/studio/assets/assetOwnerKeys'
import { setWindowGeometryForTests } from '../../../ts/windowing/windowHost.svelte'
import StudioAssetList, { setSessionAssetSizeJobForTests } from './StudioAssetList.svelte'
import { installChromiumFocusRemoval } from './chromiumFocusRemoval.test-helpers'

function fixtureDb(rows: string[][], folders?: unknown) {
    const base = studioDbOf(makeInput({ character: makeCharacter({ chaId: 'A' }) }))
    const chat = { ...makeChat({ id: 'c1', name: 'First chat' }), note: 'n0', fmIndex: 2 }
    const character = {
        ...base.characters[0], desc: 'd0', alternateGreetings: ['g0'], chats: [chat], additionalAssets: rows, emotionImages: [] as string[][],
        ...(folders === undefined ? {} : { extentions: { [ASSET_FOLDER_KEY]: folders } }),
    }
    return { ...base, characters: [character], useAdditionalAssetsPreview: false }
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

// No size is ever read: the production size job is not loaded.
const noSizes: AssetSizeJob = { peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true }

class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
        this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve(): void {}
    disconnect(): void {}
}

let service: OwnerHistoryService
let toastHost: ToastHost
let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function install(rows: string[][], folders?: unknown): void {
    db.db = fixtureDb(rows, folders)
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
        onLanded: retireAssetToasts,
    })
    setStudioHistoryServiceForTests(service)
}

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

async function showList(props: Record<string, unknown> = {}): Promise<void> {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioAssetList, { target: host, props: { chaId: 'A', host: toastHost, ...props } }), host })
    flushSync()
    await settle()
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const rawParts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const rawRows = () => rawParts('studio-asset-row')

async function filterBy(text: string): Promise<void> {
    const field = part('studio-asset-filter') as HTMLInputElement
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
}

const laterTask = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
    h.marks = 0
    h.srcCalls.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selection.selId = 0
    studioScreen.chaId = 'A'
    setSessionAssetSizeJobForTests(noSizes)
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    toastHost = createToastHost({ clock: { now: () => 0, after: () => () => {} } })
    setStudioVisitAckForTests({ display: 'saved', canRetry: () => false, retry: () => false, noteEdit: () => {}, dispose: () => {} } as never)
})

afterEach(async () => {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    setWindowGeometryForTests(undefined)
    setSessionAssetSizeJobForTests(undefined)
    resetStudioToastsForTests()
    resetToastHostForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

const plainName = (n: number): string => `p${String(n).padStart(4, '0')}`
const plainRows = (count: number): string[][] => Array.from({ length: count }, (_, n) => assetRow(plainName(n), `assets/${plainName(n)}.png`))

const FOLDERS = ['Alpha', 'Beta', 'Gamma']

// 30 rows named `<folder prefix><f>-pic<n>` over three folders, ten each.
function thirtyRows(): { rows: string[][]; folders: unknown } {
    const rows: string[][] = []
    const of: [string, string][] = []
    FOLDERS.forEach((folder, f) => {
        for (let n = 0; n < 10; n++) {
            const name = `${folder.slice(0, 2).toLowerCase()}${f}-pic${n}`
            rows.push(assetRow(name, `assets/${name}.png`))
            of.push([name, folder])
        }
    })
    return { rows, folders: { v: 1, additional: { order: FOLDERS, of } } }
}

describe('a long list mounts its window', () => {
    // R1
    test('1000 rows in one folder: at most a window of rows at once, at most twice that after the widen delay', async () => {
        install(plainRows(1000))
        await service.whenReady(A)
        await showList()
        expect(rawRows().length).toBeGreaterThan(0)
        expect(rawRows().length).toBeLessThanOrEqual(20)
        await laterTask(250)
        await settle()
        expect(rawRows().length).toBeLessThanOrEqual(40)
    })
})

describe('a row the filter or a fold takes off the screen', () => {
    // R2
    test('leaves no row node in the page: a filter keeps only the matching row, and a folded folder holds none', async () => {
        const { rows, folders } = thirtyRows()
        install(rows, folders)
        await service.whenReady(A)
        await showList()
        expect(rawRows()).toHaveLength(30)
        await filterBy('be1-pic3')
        expect(rawRows()).toHaveLength(1)
        await filterBy('')
        expect(rawRows()).toHaveLength(30)
        const second = rawParts('studio-asset-folder')[1]
        ;(second.querySelector('[data-part="studio-asset-folder-header"]') as HTMLElement).click()
        await settle()
        expect(second.querySelectorAll('[data-part="studio-asset-row"]')).toHaveLength(0)
        expect(rawRows()).toHaveLength(20)
    })

    // R2 variant: the row that holds focus is the one the filter takes off the screen
    test('a row that holds focus and leaves the filter is removed from the page, and focus goes to a displayed row', async () => {
        const { rows, folders } = thirtyRows()
        install(rows, folders)
        await service.whenReady(A)
        await showList()
        await filterBy('al0')
        const gone = rawRows().find((row) => rowNameOf(row) === 'al0-pic3') as HTMLElement
        const field = gone.querySelector('[data-part="studio-asset-name"]') as HTMLInputElement
        field.focus()
        await laterTask(30)
        // Read in the flush of the keystroke itself: the window host still names the removed row as the focused one then.
        const filterField = part('studio-asset-filter') as HTMLInputElement
        filterField.value = 'al0-pic4'
        filterField.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        expect(rawRows()).toHaveLength(1)
        expect(gone.isConnected).toBe(false)
        expect(rawRows().map(rowNameOf)).toEqual(['al0-pic4'])
        await settle()
        expect(document.activeElement).toBe(rawRows()[0].querySelector('[data-part="studio-asset-row-more"]'))
    })

    // R3
    test('one narrowing keystroke over 1000 rows adds and removes no more than two windows of rows and flips none', async () => {
        const rows: string[][] = []
        for (let n = 0; n < 1000; n++) {
            const name = `${n % 2 === 0 ? 'keep' : 'drop'}${String(n).padStart(4, '0')}`
            rows.push(assetRow(name, `assets/${name}.png`))
        }
        install(rows)
        await service.whenReady(A)
        await showList()
        await laterTask(250)
        await settle()
        let churn = 0
        const watcher = new MutationObserver((records) => {
            const rowsIn = (nodes: NodeList): number => Array.from(nodes).reduce((sum, node) => {
                if (!(node instanceof HTMLElement)) return sum
                return sum + (node.dataset.part === 'studio-asset-row' ? 1 : 0) + node.querySelectorAll('[data-part="studio-asset-row"]').length
            }, 0)
            for (const record of records) {
                if (record.type === 'attributes' && record.attributeName === 'hidden') churn += 1
                else churn += rowsIn(record.addedNodes) + rowsIn(record.removedNodes)
            }
        })
        watcher.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] })
        await filterBy('keep')
        watcher.disconnect()
        expect(rawRows().length).toBeGreaterThan(0)
        expect(churn).toBeLessThanOrEqual(2 * 20)
    })
})

// ---------------------------------------------------------------- a scrolled band

// Without CSS the rows have no row gap, so a row's slot is its fallback height.
const SLOT = 86
const HEADER = 40

interface BandModel {
    scroll: number
    // The number of displayed rows of each segment in page order, folded and hidden ones as 0.
    sizes: number[]
    jumps: number[]
}

// The scroller is the window. A segment's client top is the scroll model's, and a row's top follows its position.
function installBand(sizes: number[]): BandModel {
    const model: BandModel = { scroll: 0, sizes, jumps: [] }
    const segments = (): HTMLElement[] => rawParts('studio-asset-rows')
    const topOfSegment = (at: number): number => {
        let top = -model.scroll + HEADER * (at + 1)
        for (let k = 0; k < at; k++) top += model.sizes[k] * SLOT
        return top
    }
    setWindowGeometryForTests({
        rectOf(element) {
            const own = segments().indexOf(element as HTMLElement)
            if (own >= 0) return { top: topOfSegment(own), height: 0 }
            const owner = element.closest('[data-part="studio-asset-rows"]') as HTMLElement | null
            const at = owner === null ? -1 : segments().indexOf(owner)
            const place = Number(element.getAttribute('aria-posinset') ?? '1') - 1
            if (at < 0) return { top: 0, height: 0 }
            return { top: topOfSegment(at) + place * SLOT, height: SLOT }
        },
        viewport: () => 768,
        scrollBy(_scroller, dy) {
            model.scroll += dy
            model.jumps.push(dy)
        },
        schedule(callback) {
            callback()
            return () => {}
        },
    })
    return model
}

async function scrollTo(model: BandModel, y: number): Promise<void> {
    model.scroll = y
    window.dispatchEvent(new Event('scroll'))
    await settle()
}

const keyOf = (name: string): string => `0:assets/${name}.png`
const rowNode = (name: string): HTMLElement | null => rawRows().find((row) => row.dataset.rowKey === keyOf(name)) ?? null
const moreOf = (name: string): HTMLElement | null => rowNode(name)?.querySelector<HTMLElement>('[data-part="studio-asset-row-more"]') ?? null
const rowNameOf = (row: HTMLElement): string => (row.querySelector('[data-part="studio-asset-name"]') as HTMLInputElement).value
const mountedNames = (): string[] => rawRows().map(rowNameOf)
const num = (n: number, width = 4): string => String(n).padStart(width, '0')

// Folders of the given sizes: rows `f<k>r<nnnn>` in the folder `F<k>`.
function foldered(counts: number[], prefixes: string[] = counts.map(() => 'f')): { rows: string[][]; folders: unknown; names: string[][] } {
    const rows: string[][] = []
    const of: [string, string][] = []
    const names: string[][] = counts.map(() => [])
    counts.forEach((count, k) => {
        for (let n = 0; n < count; n++) {
            const name = `${prefixes[k]}${k}r${num(n)}`
            rows.push(assetRow(name, `assets/${name}.png`))
            of.push([name, `F${k}`])
            names[k].push(name)
        }
    })
    return { rows, folders: { v: 1, additional: { order: counts.map((_, k) => `F${k}`), of } }, names }
}

describe('a scrolled band', () => {
    // G1
    test('the band rows are mounted, the top of the list is not, and spacers and rows add up to the whole height', async () => {
        install(plainRows(1000))
        await service.whenReady(A)
        const model = installBand([1000])
        await showList()
        await scrollTo(model, HEADER + 500 * SLOT)
        const names = mountedNames()
        expect(names).toContain(plainName(500))
        expect(names).not.toContain(plainName(0))
        expect(names).not.toContain(plainName(999))
        const spacers = rawParts('studio-asset-rows')[0].querySelectorAll<HTMLElement>('[data-window-spacer]')
        const spacerSum = Array.from(spacers).reduce((sum, spacer) => sum + parseFloat(spacer.style.height), 0)
        expect(spacerSum + names.length * SLOT).toBe(1000 * SLOT)
    })

    // G2
    test('the row that holds focus stays in the page while the band is far away, and releases it when focus leaves', async () => {
        install(plainRows(300))
        await service.whenReady(A)
        const model = installBand([300])
        await showList()
        moreOf(plainName(5))?.focus()
        await laterTask(30)
        await scrollTo(model, HEADER + 200 * SLOT)
        expect(moreOf(plainName(5))).not.toBeNull()
        expect(document.activeElement).toBe(moreOf(plainName(5)))
        expect(mountedNames()).toContain(plainName(200))
        ;(document.activeElement as HTMLElement).blur()
        await laterTask(30)
        await scrollTo(model, HEADER + 201 * SLOT)
        expect(rowNode(plainName(5))).toBeNull()
    })

    // The list's section is destroyed and created again when the list goes hidden and present; the host follows the new one.
    test('after the list is hidden and shown again, the focused row still stays in the page while the band is far away', async () => {
        install(plainRows(300))
        await service.whenReady(A)
        const model = installBand([300])
        await showList()
        const section = part('studio-asset-list')
        db.db.characters[0].license = 'private'
        await settle()
        expect(part('studio-asset-list')).toBeNull()
        db.db.characters[0].license = undefined
        await settle()
        expect(part('studio-asset-list')).not.toBeNull()
        expect(part('studio-asset-list')).not.toBe(section)
        moreOf(plainName(5))?.focus()
        await laterTask(30)
        await scrollTo(model, HEADER + 200 * SLOT)
        expect(mountedNames()).toContain(plainName(200))
        expect(moreOf(plainName(5))).not.toBeNull()
        expect(document.activeElement).toBe(moreOf(plainName(5)))
    })

    test('the row whose menu is open stays in the page while the band is far away', async () => {
        install(plainRows(300))
        await service.whenReady(A)
        const model = installBand([300])
        await showList()
        moreOf(plainName(3))?.click()
        await settle()
        expect(rowNode(plainName(3))?.querySelector('[role="menu"]')).toBeInstanceOf(HTMLElement)
        await scrollTo(model, HEADER + 200 * SLOT)
        expect(rowNode(plainName(3))?.querySelector('[role="menu"]')).toBeInstanceOf(HTMLElement)
    })

    // G3
    test('a previewing audio row scrolled out of the window keeps its player', async () => {
        const rows = plainRows(300)
        rows[2] = assetRow('tune', 'assets/tune.mp3', 'mp3')
        install(rows)
        await service.whenReady(A)
        const model = installBand([300])
        await showList()
        const tune = (): HTMLElement | null => rawRows().find((row) => rowNameOf(row) === 'tune') ?? null
        tune()?.querySelector<HTMLElement>('[data-part="studio-asset-row-more"]')?.click()
        await settle()
        tune()?.querySelector<HTMLElement>('[data-part="studio-asset-menu-preview"]')?.click()
        await laterTask(30)
        await settle()
        expect(tune()?.querySelector('[data-part="studio-asset-media"]')).toBeInstanceOf(HTMLElement)
        // Preview hands focus back to the row's trigger; with focus off the row, only the preview keeps it in the page.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        await laterTask(30)
        await scrollTo(model, HEADER + 200 * SLOT)
        expect(mountedNames()).toContain(plainName(200))
        expect(tune()?.querySelector('[data-part="studio-asset-media"]')).toBeInstanceOf(HTMLElement)
    })

    // G11
    test('a row announces its place among its folder\'s displayed rows, and the spacers are hidden from assistive technology', async () => {
        const { rows, folders } = thirtyRows()
        install(rows, folders)
        await service.whenReady(A)
        await showList()
        for (const segment of rawParts('studio-asset-rows')) {
            const items = Array.from(segment.querySelectorAll<HTMLElement>('[data-window-key]'))
            expect(items).toHaveLength(10)
            items.forEach((item, at) => {
                expect(item.getAttribute('aria-setsize')).toBe('10')
                expect(item.getAttribute('aria-posinset')).toBe(String(at + 1))
            })
        }
        await filterBy('al0')
        const first = rawParts('studio-asset-rows')[0]
        expect(first.querySelectorAll('[data-window-key]')).toHaveLength(10)
    })

    test('a scrolled row\'s place is its position among the folder\'s rows, not its place in the page', async () => {
        install(plainRows(1000))
        await service.whenReady(A)
        const model = installBand([1000])
        await showList()
        await scrollTo(model, HEADER + 500 * SLOT)
        const segment = rawParts('studio-asset-rows')[0]
        const spacers = Array.from(segment.querySelectorAll<HTMLElement>('[data-window-spacer]'))
        expect(spacers.length).toBeGreaterThan(0)
        expect(spacers.every((spacer) => spacer.getAttribute('aria-hidden') === 'true')).toBe(true)
        const items = Array.from(segment.querySelectorAll<HTMLElement>('[data-window-key]'))
        expect(items.every((item) => item.getAttribute('aria-setsize') === '1000')).toBe(true)
        const at = items.findIndex((item) => item.querySelector('[data-part="studio-asset-row"]') && rowNameOf(item.querySelector('[data-part="studio-asset-row"]') as HTMLElement) === plainName(500))
        expect(items[at].getAttribute('aria-posinset')).toBe('501')
    })
})

// ---------------------------------------------------------------- focus by data

describe('focus after a removal when the target is not in the page', () => {
    let removeShim: () => void
    beforeEach(() => { removeShim = installChromiumFocusRemoval() })
    afterEach(() => { removeShim() })

    // G4 (a removal that does not go through the list, as an undo, a redo or the History panel makes one)
    test('the focused row is removed while the band is far away: the next row, which is not in the page, takes focus, never the page', async () => {
        install(plainRows(300))
        await service.whenReady(A)
        const model = installBand([300])
        await showList()
        moreOf(plainName(5))?.focus()
        await laterTask(30)
        await scrollTo(model, HEADER + 200 * SLOT)
        expect(document.activeElement).toBe(moreOf(plainName(5)))
        expect(rowNode(plainName(6))).toBeNull()
        expect(service.assetDelete(A, 'additionalAssets', [5]).ok).toBe(true)
        flushSync()
        // Never the page, even in the frames before the target is in.
        expect(document.activeElement).not.toBe(document.body)
        await laterTask(30)
        await settle()
        expect(rowNode(plainName(5))).toBeNull()
        expect(document.activeElement).toBe(moreOf(plainName(6)))
        expect(model.jumps.length).toBeGreaterThan(0)
    })

    // G15
    test('the list takes focus without scrolling, and a focus the person moves before the row arrives is left alone', async () => {
        install(plainRows(300))
        await service.whenReady(A)
        const model = installBand([300])
        await showList()
        const outside = document.createElement('button')
        document.body.append(outside)
        moreOf(plainName(5))?.focus()
        await laterTask(30)
        await scrollTo(model, HEADER + 200 * SLOT)
        const list = part('studio-asset-list') as HTMLElement
        const focusSpy = vi.spyOn(list, 'focus')
        expect(service.assetDelete(A, 'additionalAssets', [5]).ok).toBe(true)
        flushSync()
        expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
        outside.focus()
        await laterTask(30)
        await settle()
        expect(document.activeElement).toBe(outside)
        outside.remove()
    })
})

describe('a move to a folder far from the window', () => {
    async function moveFirstRowTo(folder: string, model: BandModel): Promise<void> {
        moreOf(`f0r${num(0)}`)?.click()
        await settle()
        rowNode(`f0r${num(0)}`)?.querySelector<HTMLElement>('[data-part="studio-asset-menu-move"]')?.click()
        await settle()
        // Focus is off the row when the move is chosen, so only the window decides whether the moved row is in the page.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        await laterTask(30)
        void model
        const choice = Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-asset-move-choice"]')).find((entry) => entry.dataset.folder === folder)
        choice?.click()
        await laterTask(30)
        await settle()
    }

    // G7
    test('focuses the moved row\'s menu button, though its folder is far from the band', async () => {
        const { rows, folders } = foldered([300, 300, 300])
        install(rows, folders)
        await service.whenReady(A)
        const model = installBand([300, 300, 300])
        await showList()
        // After the move the first folder holds one row less and the last one more.
        model.sizes = [299, 300, 301]
        await moveFirstRowTo('F2', model)
        expect(document.activeElement).toBe(moreOf(`f0r${num(0)}`))
        expect(document.activeElement).not.toBeNull()
        expect(model.jumps.length).toBeGreaterThan(0)
    })

    test('into a folded folder leaves focus on the list', async () => {
        const { rows, folders } = foldered([20, 20, 20])
        install(rows, folders)
        await service.whenReady(A)
        installBand([20, 20, 20])
        await showList()
        ;(rawParts('studio-asset-folder-header')[2]).click()
        await settle()
        await moveFirstRowTo('F2', { scroll: 0, sizes: [], jumps: [] })
        expect(document.activeElement).toBe(part('studio-asset-list'))
    })
})

// ---------------------------------------------------------------- data, not the page

describe('the actions read the displayed rows, not the mounted ones', () => {
    // G8
    test('select all takes every displayed row, a bulk delete removes them, and the rows of a folded folder stay', async () => {
        const { rows, folders } = foldered([250, 250])
        install(rows, folders)
        await service.whenReady(A)
        await showList()
        ;(rawParts('studio-asset-folder-header')[1]).click()
        await settle()
        part('studio-asset-select-toggle')?.click()
        await settle()
        part('studio-asset-select-all')?.click()
        await settle()
        expect(rawRows().length).toBeLessThan(50)
        expect(part('studio-asset-selected-count')?.textContent).toBe('studioAssetSelectedCount(250)')
        part('studio-asset-bulk-delete')?.click()
        await settle()
        expect(db.db.characters[0].additionalAssets).toHaveLength(250)
        expect(db.db.characters[0].additionalAssets.every((row) => row[0].startsWith('f1'))).toBe(true)
    })
})

describe('a segment follows its own band when another folder changes', () => {
    // G12
    test('folding the folder above the band re-reads the next folder\'s top and keeps its band rows in the page', async () => {
        const { rows, folders, names } = foldered([500, 2000])
        install(rows, folders)
        await service.whenReady(A)
        const model = installBand([500, 2000])
        await showList()
        // The band is 20000 px into the second folder.
        await scrollTo(model, 500 * SLOT + 2 * HEADER + 20000)
        const before = mountedNames()
        expect(before).toContain(names[1][232])
        // The page shrinks under the band and the scroll position stays (no anchoring): the band is now deeper in the folder.
        model.sizes = [0, 2000]
        ;(rawParts('studio-asset-folder-header')[0]).click()
        await laterTask(30)
        await settle()
        const local = model.scroll - 2 * HEADER
        const target = names[1][Math.floor(local / SLOT)]
        expect(mountedNames()).toContain(target)
        expect(mountedNames()).not.toContain(names[1][232])
    })

    test('a filter that empties the folder above the band does the same', async () => {
        const { rows, folders, names } = foldered([500, 2000], ['x', 'y'])
        install(rows, folders)
        await service.whenReady(A)
        const model = installBand([500, 2000])
        await showList()
        await scrollTo(model, 500 * SLOT + 2 * HEADER + 20000)
        expect(mountedNames()).toContain(names[1][232])
        model.sizes = [0, 2000]
        await filterBy('y1r')
        await laterTask(30)
        await settle()
        const local = model.scroll - 2 * HEADER
        expect(mountedNames()).toContain(names[1][Math.floor(local / SLOT)])
        expect(mountedNames()).not.toContain(names[1][232])
    })
})

// ---------------------------------------------------------------- thumbnails

describe('thumbnails behave as they did before the list was windowed', () => {
    // G16
    test('every thumbnail URL is asked for once at open, and a row mounted later shows the URL of its own file', async () => {
        const { rows, folders, names } = foldered([100, 100])
        install(rows, folders)
        await service.whenReady(A)
        const model = installBand([100, 100])
        await showList()
        await laterTask(30)
        await settle()
        expect(h.srcCalls).toHaveLength(200)
        expect(new Set(h.srcCalls).size).toBe(200)
        const last = names[1][99]
        expect(rowNode(last)).toBeNull()
        await scrollTo(model, 2 * HEADER + 200 * SLOT)
        await settle()
        const picture = rowNode(last)?.querySelector<HTMLImageElement>('[data-part="studio-thumb"]')
        expect(picture?.getAttribute('src')).toBe(`blob:whole:assets/${last}.png`)
        expect(h.srcCalls).toHaveLength(200)
    })
})
