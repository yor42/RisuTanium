// @vitest-environment jsdom
/**
 * The chunked first mount of the Studio asset list over the real history service on the memory doubles: a long list
 * mounts its first rows in the first flush and the rest in later slices (a fake scheduler runs each slice when the test
 * says so), the filter and the folds act on the rows that are mounted and on the rows that are not yet, a removal in
 * the window hands focus to a row that is in the page, and a write never defers anything again.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
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
        'studioAssetFileUnchecked',
    ]) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { AssetSizeJob, StoredSize } from 'src/ts/studio/assets/assetSizes'
import { resetStudioToastsForTests, retireAssetToasts } from 'src/ts/studio/edit/studioToasts'
import { makeCharacter, makeChat, makeInput, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { createToastHost, resetToastHostForTests, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../../ts/studio/history/tests/studioStoreDoubles'
import { assetRow } from '../../../ts/studio/assets/assetFixtures.test-helpers'
import { ASSET_FOLDER_KEY } from '../../../ts/studio/assets/assetOwnerKeys'
import { FIRST_ROWS, SLICE_ROWS, setRowSliceSchedulerForTests } from '../../../ts/studio/assets/rowMount.svelte'
import StudioScreen from '../StudioScreen.svelte'
import StudioAssetList, { setSessionAssetSizeJobForTests } from './StudioAssetList.svelte'

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
const displayTarget = { owner: { type: 'character', id: 'A' }, kind: 'display', item: 'A/display:0', from: 'chat' } as const

const FOLDER_COUNT = 12
const PER_FOLDER = 10
const folderName = (f: number): string => `Z${String(f + 1).padStart(2, '0')}`
const rowName = (f: number, n: number): string => `r${f}-${n}`
const keyOfName = (name: string): string => `0:assets/${name}.png`

// 120 rows over twelve folders, ten each, in the order the list shows them. A folder's name is not part of its rows' names.
function folderedRows(): { rows: string[][]; folders: unknown } {
    const rows: string[][] = []
    const of: [string, string][] = []
    for (let f = 0; f < FOLDER_COUNT; f++) {
        for (let n = 0; n < PER_FOLDER; n++) {
            rows.push(assetRow(rowName(f, n), `assets/${rowName(f, n)}.png`))
            of.push([rowName(f, n), folderName(f)])
        }
    }
    return { rows, folders: { v: 1, additional: { order: Array.from({ length: FOLDER_COUNT }, (_, f) => folderName(f)), of } } }
}

const plainName = (n: number): string => `p${String(n).padStart(3, '0')}`
const plainRows = (count: number): string[][] => Array.from({ length: count }, (_, n) => assetRow(plainName(n), `assets/${plainName(n)}.png`))

// No size is ever read: the production size job is not loaded.
const noSizes: AssetSizeJob = { peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true }

class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
        this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    disconnect(): void {}
}

interface FakeScheduler {
    runs: (() => void)[]
    scheduled: number
    cancelled: number
}

// A slice runs only when the test says so. With `honorCancel` off a cancelled slice stays in the queue, as a scheduler that ignores cancel would.
function installScheduler(honorCancel = true): FakeScheduler {
    const fake: FakeScheduler = { runs: [], scheduled: 0, cancelled: 0 }
    setRowSliceSchedulerForTests({
        schedule(run) {
            fake.scheduled += 1
            fake.runs.push(run)
            return () => {
                fake.cancelled += 1
                if (!honorCancel) return
                const at = fake.runs.indexOf(run)
                if (at >= 0) fake.runs.splice(at, 1)
            }
        },
    })
    return fake
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

async function runNext(fake: FakeScheduler): Promise<void> {
    const run = fake.runs.shift()
    expect(run).toBeDefined()
    run?.()
    await settle()
}

async function runAll(fake: FakeScheduler): Promise<void> {
    for (let guard = 0; fake.runs.length > 0; guard++) {
        expect(guard).toBeLessThan(100)
        await runNext(fake)
    }
}

function mountInto(component: Parameters<typeof mount>[0], props: Record<string, unknown> = {}): HTMLElement {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    mounted.push({ app: mount(component, { target: host, props }), host })
    flushSync()
    return host
}

// Mounts the list and flushes once, with no wait: what the first flush holds is what the first frame would show.
function showListNow(props: Record<string, unknown> = {}): void {
    mountInto(StudioAssetList, { chaId: 'A', host: toastHost, ...props })
}

async function showList(props: Record<string, unknown> = {}): Promise<void> {
    showListNow(props)
    await settle()
}

async function showScreen(): Promise<void> {
    openStudio(displayTarget, null)
    mountInto(StudioScreen, { toastHost })
    await settle()
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const rawParts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
// What the person sees: an element that is itself hidden, or inside a hidden one, is left out.
const parts = (name: string) => rawParts(name).filter((element) => element.closest('[hidden]') === null)
const nameField = (row: HTMLElement) => row.querySelector('[data-part="studio-asset-name"]') as HTMLInputElement
const rawRows = () => rawParts('studio-asset-row')
const rowKeys = () => rawRows().map((row) => row.dataset.rowKey)
const rowOf = (name: string): HTMLElement => rawRows().find((row) => nameField(row).value === name) as HTMLElement
const moreOf = (name: string): HTMLElement => rowOf(name).querySelector('[data-part="studio-asset-row-more"]') as HTMLElement
const pending = () => part('studio-asset-list')?.getAttribute('data-rows-pending') ?? null
const headerTotals = () => rawParts('studio-asset-folder-header').map((header) => header.textContent?.replace(/\s+/g, ' ').trim().split(' ').pop())

async function filterBy(text: string): Promise<void> {
    const field = part('studio-asset-filter') as HTMLInputElement
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
}

async function click(element: HTMLElement | null): Promise<void> {
    element?.click()
    await settle()
}

// A press from the keyboard: the trigger takes focus, the menu opens, its Delete item takes focus and is activated.
async function deleteFromMenu(name: string): Promise<void> {
    moreOf(name).focus()
    moreOf(name).click()
    await settle()
    const item = rowOf(name).querySelector<HTMLElement>('[data-part="studio-asset-menu-delete"]') as HTMLElement
    item.focus()
    item.click()
    await tick()
    await settle()
}

const laterTask = () => new Promise<void>((resolve) => setTimeout(resolve, 5))

async function ctrl(init: KeyboardEventInit): Promise<void> {
    part('studio')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, ...init }))
    flushSync()
    await settle()
    await settle()
    await laterTask()
}

beforeEach(() => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    selection.selId = 0
    studioScreen.chaId = 'A'
    setStudioEnabled(true)
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
    setRowSliceSchedulerForTests(undefined)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    setSessionAssetSizeJobForTests(undefined)
    resetStudioToastsForTests()
    resetToastHostForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    setStudioEnabled(false)
})

describe('the first mount of a long list', () => {
    test('puts the first rows in the first flush and the rest in the page a little later, then clears the pending mark', async () => {
        install(plainRows(100))
        await service.whenReady(A)
        showListNow()
        expect(rawRows().length).toBeGreaterThanOrEqual(FIRST_ROWS)
        expect(rawRows().length).toBeLessThan(100)
        expect(pending()).toBe('true')
        await vi.waitFor(() => expect(rawRows()).toHaveLength(100), { timeout: 10_000 })
        expect(pending()).toBeNull()
    })

    test('mounts the first rows in display order across the folders, then each slice adds the next rows, and the headers carry the totals throughout', async () => {
        const fake = installScheduler()
        const { rows, folders } = folderedRows()
        install(rows, folders)
        await service.whenReady(A)
        await showList()
        const expectedKeys = rows.map((row) => keyOfName(row[0]))
        expect(rowKeys()).toEqual(expectedKeys.slice(0, FIRST_ROWS))
        expect(headerTotals()).toEqual(Array(FOLDER_COUNT).fill(String(PER_FOLDER)))
        expect(pending()).toBe('true')
        expect(fake.scheduled).toBe(1)
        const slices = Math.ceil((rows.length - FIRST_ROWS) / SLICE_ROWS)
        for (let run = 1; run <= slices; run++) {
            await runNext(fake)
            expect(rowKeys(), `after slice ${run}`).toEqual(expectedKeys.slice(0, Math.min(rows.length, FIRST_ROWS + run * SLICE_ROWS)))
            expect(headerTotals()).toEqual(Array(FOLDER_COUNT).fill(String(PER_FOLDER)))
        }
        expect(slices).toBe(11)
        expect(fake.runs).toHaveLength(0)
        expect(pending()).toBeNull()
        expect(rawRows()).toHaveLength(120)
    })

    test('a filter typed in the window mounts the matching rows in the next slice, the others later and hidden, and every row ends in the page', async () => {
        const fake = installScheduler()
        const { rows, folders } = folderedRows()
        install(rows, folders)
        await service.whenReady(A)
        await showList()
        await filterBy('z12')
        // Nothing is mounted by the keystroke itself: the rows of the last folder wait for their slice.
        expect(rawRows()).toHaveLength(FIRST_ROWS)
        expect(parts('studio-asset-row')).toHaveLength(0)
        await runNext(fake)
        expect(parts('studio-asset-row').map((row) => nameField(row).value)).toEqual(Array.from({ length: SLICE_ROWS }, (_, n) => rowName(11, n)))
        // The second slice finishes the matching rows, then the queue goes on from its head with the rest.
        await runNext(fake)
        expect(parts('studio-asset-row')).toHaveLength(PER_FOLDER)
        const queueHead = FIRST_ROWS + SLICE_ROWS - (PER_FOLDER - SLICE_ROWS)
        expect(rowKeys()).toEqual([...rows.slice(0, queueHead), ...rows.slice(rows.length - PER_FOLDER)].map((row) => keyOfName(row[0])))
        await runAll(fake)
        expect(rawRows()).toHaveLength(120)
        expect(parts('studio-asset-row')).toHaveLength(PER_FOLDER)
        expect(rawRows().filter((row) => !row.hidden)).toHaveLength(PER_FOLDER)
        expect(pending()).toBeNull()
    })

    test('the first rows carry the content-visibility class that lets the engine skip rows that are off screen', async () => {
        install(plainRows(1))
        await service.whenReady(A)
        await showList()
        expect(rawRows()[0].classList.contains('[content-visibility:auto]')).toBe(true)
    })
})

describe('select all and the finder in the window', () => {
    test('select all takes every displayed row, the ones not yet in the page too, and a bulk delete removes them all', async () => {
        const fake = installScheduler()
        install(plainRows(100))
        await service.whenReady(A)
        await showList()
        expect(rawRows()).toHaveLength(FIRST_ROWS)
        expect(fake.runs).toHaveLength(1)
        await click(part('studio-asset-select-toggle'))
        await click(part('studio-asset-select-all'))
        expect(part('studio-asset-selected-count')?.textContent).toBe('studioAssetSelectedCount(100)')
        await click(part('studio-asset-bulk-delete'))
        expect(db.db.characters[0].additionalAssets).toHaveLength(0)
    })

    test('the size job is asked for every path at the first mount', async () => {
        installScheduler()
        install(plainRows(100))
        await service.whenReady(A)
        const asked: string[] = []
        const job: AssetSizeJob = { peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async (paths) => { asked.push(...paths); return true } }
        await showList({ sizeJob: async () => job })
        await settle()
        expect(rawRows()).toHaveLength(FIRST_ROWS)
        expect(new Set(asked).size).toBe(100)
    })
})

describe('a row that arrives while the first mount runs', () => {
    test('is in the page in the flush of the write that added it', async () => {
        installScheduler()
        install(plainRows(100))
        await service.whenReady(A)
        await showList()
        expect(rawRows()).toHaveLength(FIRST_ROWS)
        db.db.characters[0].additionalAssets.push(assetRow('late', 'assets/late.png'))
        flushSync()
        expect(rawRows()).toHaveLength(FIRST_ROWS + 1)
        expect(rowOf('late')).toBeDefined()
    })
})

describe('the chain ends with the list', () => {
    test('cancels the scheduled slice when the list goes, and a slice that still runs afterwards writes nothing', async () => {
        const fake = installScheduler(false)
        install(plainRows(100))
        await service.whenReady(A)
        await showList()
        const stale = fake.runs[0]
        expect(stale).toBeDefined()
        const scheduledBefore = fake.scheduled
        for (const entry of mounted.splice(0)) {
            await unmount(entry.app)
            entry.host.remove()
        }
        expect(fake.cancelled).toBe(1)
        stale()
        await settle()
        expect(fake.scheduled).toBe(scheduledBefore)
        expect(rawRows()).toHaveLength(0)
    })
})

describe('focus after a removal while the first mount runs', () => {
    test('deleting the last mounted row from the list focuses the menu button of the row after it, which the delete mounts', async () => {
        installScheduler()
        install(plainRows(100))
        await service.whenReady(A)
        await showList()
        expect(rawRows()).toHaveLength(FIRST_ROWS)
        await deleteFromMenu(plainName(FIRST_ROWS - 1))
        expect(db.db.characters[0].additionalAssets).toHaveLength(99)
        expect(document.activeElement).toBe(moreOf(plainName(FIRST_ROWS)))
        expect(document.activeElement).not.toBe(document.body)
    })

    test('deleting the first of two rows over one file at the frontier focuses the row that took its place', async () => {
        installScheduler()
        const rows = plainRows(100)
        rows[FIRST_ROWS - 1] = assetRow('twin-a', 'assets/twin.png')
        rows[FIRST_ROWS] = assetRow('twin-b', 'assets/twin.png')
        install(rows)
        await service.whenReady(A)
        await showList()
        await deleteFromMenu('twin-a')
        expect(db.db.characters[0].additionalAssets).toHaveLength(99)
        expect(document.activeElement).toBe(moreOf('twin-b'))
    })

    test('a delete that does not go through the list leaves focus on the nearest mounted row\'s menu button, never the list or the page', async () => {
        installScheduler()
        install(plainRows(100))
        await service.whenReady(A)
        await showScreen()
        const last = FIRST_ROWS - 1
        expect(service.assetDelete(A, 'additionalAssets', [last]).ok).toBe(true)
        await settle()
        expect((await service.replay(A, { kind: 'undo' })).ok).toBe(true)
        await settle()
        expect(db.db.characters[0].additionalAssets).toHaveLength(100)
        const roots = [part('studio'), part('studio-asset-list')].flatMap((root) => (root ? [vi.spyOn(root, 'focus')] : []))
        moreOf(plainName(last)).focus()
        await ctrl({ key: 'y' })
        expect(db.db.characters[0].additionalAssets).toHaveLength(99)
        expect(document.activeElement).toBe(moreOf(plainName(last - 1)))
        for (const spy of roots) expect(spy).not.toHaveBeenCalled()
    })
})
