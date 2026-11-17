// @vitest-environment jsdom
/**
 * What the Studio detail mounts for a module: a module that is not loaded is loaded when it is selected, showing
 * "Loading module"; a loaded module's display kind gets the asset list, and no save chip; the list keeps its filter,
 * selection and folded folders across rebuilds of the owner model; and the detail publishes the id of a selected module
 * that is loaded, private to no one and not shared, on any kind. The history service is a stand-in here (the form has
 * its own suite over the real one), and so is the loader, whose answers each case controls.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RisuModule } from '../../ts/process/modules'
import type { ModuleStubLoad } from '../../ts/storage/store2/saveActive'
import { toAssetList } from '../../ts/storage/assetList'
import type { StudioKind } from '../../ts/studio/ownerModel'
import { makeCharacter, makeChat, makeInput, residentModule, stubModule, studioDbOf } from '../../ts/studio/studioFixtures.test-helpers'

const db = $state({ db: {} as Omit<ReturnType<typeof studioDbOf>, 'modules'> & { modules: RisuModule[] } })
const selection = $state({ selId: 0 })
const ReloadGUIPointer = writable(0)
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const CharConfigSubMenu = writable(0)
const SettingsMenuIndex = writable(-1)
const botMakerMode = writable(false)
const sideBarStore = writable(false)
const QuickSettings = $state({ open: true })
const loader = vi.hoisted(() => ({ load: vi.fn() }))

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('../../ts/stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get ReloadGUIPointer() { return ReloadGUIPointer },
    get MobileGUI() { return MobileGUI },
    get settingsOpen() { return settingsOpen },
    get CharConfigSubMenu() { return CharConfigSubMenu },
    get SettingsMenuIndex() { return SettingsMenuIndex },
    get botMakerMode() { return botMakerMode },
    get sideBarStore() { return sideBarStore },
    get QuickSettings() { return QuickSettings },
}))
vi.mock('../../ts/globalApi.svelte', () => ({ getFileSrc: async (path: string, use: string) => `blob:${use}:${path}` }))
vi.mock('../../ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
// The loader module is not spread in: evaluating the real one loads the app graph, and the detail reads no other export of it.
vi.mock('../../ts/process/moduleLoader', () => ({ loadModuleStubsOf: loader.load, loadModule: vi.fn() }))
// The real publish, counted: a rebuild of the owner model must not publish again.
vi.mock('../../ts/studio/assets/openModuleForm.svelte', async (importActual) => {
    const actual = await importActual<typeof import('../../ts/studio/assets/openModuleForm.svelte')>()
    return { ...actual, publishOpenModuleId: vi.fn(actual.publishOpenModuleId) }
})
vi.mock('../../ts/process/modules', () => ({ refreshModules: vi.fn() }))
vi.mock('../../ts/process/moduleGuiBump', () => ({ bumpModuleGui: vi.fn() }))
// The engine's own selection over the module list: the rows whose id is asked for.
vi.mock('../../ts/process/moduleRefList', () => ({
    moduleRefIdsOf: () => db.db.modules.map((row: { id: string }) => row.id),
    moduleListOf: (ids: string[]) => db.db.modules.filter((row: { id: string }) => ids.includes(row.id)),
}))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = { sidebarUi: { notAllowed: 'notAllowed', noAssets: 'noAssets' } }
    for (const key of ['studioAssetEmotionsElsewhere', 'studioAssetRowMenu', 'studioAssetSelectedCount', 'studioAssetFilterEmpty']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import type { SaveAck } from '../../ts/studio/edit/saveAck.svelte'
import type { OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { openStudio, resetStudioScreenForTests, setStudioSelection } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { ASSET_FOLDER_KEY } from '../../ts/studio/assets/assetOwnerKeys'
import { resetStudioModuleLoadsForTests } from '../../ts/studio/assets/moduleStubLoad.svelte'
import { openStudioModuleId, publishOpenModuleId, resetOpenModuleIdForTests } from '../../ts/studio/assets/openModuleForm.svelte'
import { setRowSliceSchedulerForTests } from '../../ts/studio/assets/rowMount.svelte'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import { setSessionAssetSizeJobForTests } from './assets/StudioAssetList.svelte'
import StudioDetail from './StudioDetail.svelte'

// No size is ever read: the production size job is not loaded.
const noSizes: AssetSizeJob = { peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true }
const stubAck = { display: 'saved', canRetry: () => false, retry: () => false, noteEdit: () => {}, dispose: () => {} } as unknown as SaveAck

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
// What the person sees: a hidden row or folder stays in the page, so an element that is itself hidden, or inside a hidden one, is left out.
const all = <T extends HTMLElement>(name: string) => Array.from(document.querySelectorAll<T>(`[data-part="${name}"]`)).filter((element) => element.closest('[hidden]') === null)

const folders = { v: 1, additional: { order: ['F1', 'F2'], of: [['a1', 'F1'], ['a2', 'F1'], ['b1', 'F2'], ['b2', 'F2']] } }
const rows: [string, string, string][] = [['a1', 'assets/a1.png', 'png'], ['a2', 'assets/a2.png', 'png'], ['b1', 'assets/b1.png', 'png'], ['b2', 'assets/b2.png', 'png'], ['c1', 'assets/c1.png', 'png']]
const M1 = 'module:M1'
const S1 = 'module:S1'

function setWorld(modules: RisuModule[], character: Record<string, unknown> = {}): void {
    db.db = {
        ...studioDbOf(makeInput({
            character: { ...makeCharacter({ chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }), ...character },
            modules,
            enabledModules: modules.map((row) => row.id),
        })),
        modules: [...modules],
    }
}

function loadedM1(extra: Parameters<typeof residentModule>[1] = {}) {
    return residentModule('M1', { assets: toAssetList(rows), [ASSET_FOLDER_KEY]: folders, ...extra })
}

// Opens the detail on the character, then selects what the case asks for.
async function show(selectedKey: string | null, kind: StudioKind | null = null): Promise<void> {
    openStudio({ owner: { type: 'character', id: 'cha-1' }, from: 'chat' }, null)
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioDetail, { target: host })
    flushSync()
    if (selectedKey !== null) {
        setStudioSelection(selectedKey, kind, null)
        flushSync()
    }
    await vi.dynamicImportSettled()
    await settle()
}

async function settle(): Promise<void> {
    for (let turn = 0; turn < 10; turn++) await Promise.resolve()
    flushSync()
}

// A rebuild of the model that changes nothing the detail shows: what the GUI reload pointer does after any module write.
function rebuild(): void {
    ReloadGUIPointer.update((value) => value + 1)
    flushSync()
}

function click(element: HTMLElement): void {
    element.click()
    flushSync()
}

function typeFilter(text: string): void {
    const field = part('studio-asset-filter') as HTMLInputElement
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

// A load the case answers when it chooses.
function heldLoad(): { settle: (value: ModuleStubLoad) => void } {
    let settleLoad: (value: ModuleStubLoad) => void = () => {}
    loader.load.mockReturnValueOnce(new Promise<ModuleStubLoad>((resolve) => { settleLoad = resolve }))
    return { settle: settleLoad }
}

beforeEach(() => {
    localStorage.clear()
    resetStudioScreenForTests()
    resetStudioModuleLoadsForTests()
    resetOpenModuleIdForTests()
    vi.mocked(publishOpenModuleId).mockClear()
    loader.load.mockReset()
    settingsOpen.set(false)
    MobileGUI.set(false)
    selection.selId = 0
    setStudioEnabled(true)
    setSessionAssetSizeJobForTests(noSizes)
    setStudioHistoryServiceForTests({
        useOwner: () => {},
        setAck: () => {},
        closeOpenStep: () => {},
        view: (owner: string) => ({
            ownerKey: owner, phase: 'ready', banner: null, restricted: false, editable: true, persisted: true,
            done: [], undone: [], deleted: [], restore: null,
        }),
    } as unknown as OwnerHistoryService)
    setStudioVisitAckForTests(stubAck)
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    setSessionAssetSizeJobForTests(undefined)
    resetStudioHistoryAccessorForTests()
    resetStudioScreenForTests()
    resetStudioModuleLoadsForTests()
    resetOpenModuleIdForTests()
    setStudioEnabled(false)
    localStorage.clear()
})

describe('the display kind of a loaded module', () => {
    test('renders the module\'s asset list with its rows, and no save chip', async () => {
        setWorld([loadedM1()])
        await show(M1, 'display')
        expect(part('studio-module-asset-form')).not.toBeNull()
        expect(all('studio-asset-row')).toHaveLength(5)
        expect(part('studio-chip')).toBeNull()
        expect(part('studio-detail-readonly')).toBeNull()
        expect(part('studio-character-form')).toBeNull()
    })

    // The same detail shows the chip for a character's list, so the absence above is the module form's own.
    test('the chip is the character list\'s: it shows there and not here', async () => {
        setWorld([loadedM1()], { additionalAssets: rows })
        await show('character:cha-1', 'display')
        expect(part('studio-asset-list')).not.toBeNull()
        expect(part('studio-chip')).not.toBeNull()
        setStudioSelection(M1, 'display', null)
        flushSync()
        expect(part('studio-module-asset-form')).not.toBeNull()
        expect(part('studio-chip')).toBeNull()
    })

    test('a module with no assets shows the list\'s empty state in place of the empty-kind note', async () => {
        setWorld([residentModule('M1')])
        await show(M1, 'display')
        expect(part('studio-asset-empty')?.textContent).toBe('noAssets')
        expect(document.body.textContent).not.toContain('studioEmptyKind')
    })

    test('a kind other than display shows no list', async () => {
        setWorld([loadedM1()])
        await show(M1, null)
        expect(part('studio-module-asset-form')).toBeNull()
        expect(part('studio-asset-list')).toBeNull()
    })

    test('the later of two modules with one id gets its own form over its own rows', async () => {
        setWorld([loadedM1(), residentModule('M1', { assets: toAssetList([['z1', 'assets/z1.png', 'png']]) })])
        await show('module:M1#1', 'display')
        expect(all('studio-asset-name').map((field) => (field as HTMLInputElement).value)).toEqual(['z1'])
        expect(part('studio-asset-module-readonly')).not.toBeNull()
    })
})

describe('the module asset list across rebuilds of the owner model and across owner and kind changes', () => {
    test('keeps the filter, the selection and the folded folders, on the same list', async () => {
        setWorld([loadedM1()])
        await show(M1, 'display')
        const list = part('studio-asset-list')
        click(part('studio-asset-select-toggle') as HTMLElement)
        typeFilter('1')
        // "1" matches the folder F1 too, so its two rows show beside b1 and c1: a1 and c1 are ticked, b1 is not.
        click(all('studio-asset-select')[0])
        click(all('studio-asset-select')[3])
        expect(part('studio-asset-selected-count')?.textContent).toBe('studioAssetSelectedCount(2)')
        click(all('studio-asset-folder-header')[1])
        expect(all('studio-asset-folder-header')[1].getAttribute('aria-expanded')).toBe('false')
        expect(part('studio-asset-selected-count')?.textContent).toBe('studioAssetSelectedCount(2)')
        rebuild()
        rebuild()
        expect(part('studio-asset-list')).toBe(list)
        expect((part('studio-asset-filter') as HTMLInputElement).value).toBe('1')
        expect(part('studio-asset-selected-count')?.textContent).toBe('studioAssetSelectedCount(2)')
        expect(all('studio-asset-folder-header')[1].getAttribute('aria-expanded')).toBe('false')
    })

    test('builds the list again with nothing carried over when the kind changes and comes back', async () => {
        setWorld([loadedM1()])
        await show(M1, 'display')
        click(part('studio-asset-select-toggle') as HTMLElement)
        typeFilter('1')
        click(all('studio-asset-select')[0])
        setStudioSelection(M1, null, null)
        flushSync()
        expect(part('studio-asset-list')).toBeNull()
        setStudioSelection(M1, 'display', null)
        flushSync()
        expect((part('studio-asset-filter') as HTMLInputElement).value).toBe('')
        expect(part('studio-asset-bulkbar')).toBeNull()
        expect(all('studio-asset-row')).toHaveLength(5)
    })

    test('builds the list again when the module changes', async () => {
        setWorld([loadedM1(), residentModule('M2', { assets: toAssetList([['q1', 'assets/q1.png', 'png']]) })])
        await show(M1, 'display')
        typeFilter('1')
        const list = part('studio-asset-list')
        setStudioSelection('module:M2', 'display', null)
        flushSync()
        expect(part('studio-asset-list')).not.toBe(list)
        expect((part('studio-asset-filter') as HTMLInputElement).value).toBe('')
    })
})

describe('the chunked first mount across an owner change', () => {
    // The chain of the old list ends with the list: the scheduler is asked to cancel, and a slice that still runs
    // after that writes nothing, so no row of the old owner appears in the new owner's list.
    test('a list that is replaced during its first mount cancels its chain, and a stale slice adds no row', async () => {
        const runs: (() => void)[] = []
        let cancelled = 0
        setRowSliceSchedulerForTests({ schedule: (run) => { runs.push(run); return () => { cancelled += 1 } } })
        try {
            const hundred = Array.from({ length: 100 }, (_, n): string[] => [`c${n}`, `assets/c${n}.png`, 'png'])
            setWorld([loadedM1(), residentModule('M2', { assets: toAssetList([['q1', 'assets/q1.png', 'png'], ['q2', 'assets/q2.png', 'png']]) })], { additionalAssets: hundred })
            await show('character:cha-1', 'display')
            expect(all('studio-asset-row').length).toBeGreaterThan(0)
            expect(runs).toHaveLength(1)
            setStudioSelection('module:M2', 'display', null)
            flushSync()
            await settle()
            expect(cancelled).toBe(1)
            expect(all('studio-asset-name').map((field) => (field as HTMLInputElement).value)).toEqual(['q1', 'q2'])
            runs[0]()
            await settle()
            expect(all('studio-asset-name').map((field) => (field as HTMLInputElement).value)).toEqual(['q1', 'q2'])
            expect(document.querySelectorAll('[data-part="studio-asset-row"]')).toHaveLength(2)
        } finally {
            setRowSliceSchedulerForTests(undefined)
        }
    })
})

describe('a module that is not loaded', () => {
    const stubWorld = () => setWorld([stubModule('S1'), loadedM1()])
    const loadingLine = () => part('studio-asset-module-loading')

    // The slot becomes the loaded module, as the loader installs it.
    function install(): void {
        db.db.modules[0] = residentModule('S1', { assets: toAssetList([['s1', 'assets/s1.png', 'png']]) })
    }

    test('selecting it shows "Loading module" and asks the loader once; the loaded module then gets its kinds and its form', async () => {
        stubWorld()
        const held = heldLoad()
        await show(S1)
        expect(loadingLine()?.textContent).toBe('studioAssetModuleLoading')
        expect(part('studio-detail-notloaded')).toBeNull()
        expect(part('studio-detail-classic')).toBeNull()
        expect(loader.load).toHaveBeenCalledTimes(1)
        expect(loader.load).toHaveBeenCalledWith('S1')
        install()
        held.settle({ kind: 'loaded' })
        await settle()
        expect(loadingLine()).toBeNull()
        expect(part('studio-detail-notloaded')).toBeNull()
        setStudioSelection(S1, 'display', null)
        flushSync()
        expect(part('studio-module-asset-form')).not.toBeNull()
        expect(all('studio-asset-name').map((field) => (field as HTMLInputElement).value)).toEqual(['s1'])
    })

    // The chunk covers the rows present when the list starts: a module's list starts once the slot holds the loaded
    // module, so a hundred rows mount in a first flush of at most a few dozen and the rest in later slices.
    test('a module that loads with a hundred assets mounts its first rows at once and the rest in later slices', async () => {
        stubWorld()
        const held = heldLoad()
        await show(S1)
        const rawRows = () => document.querySelectorAll('[data-part="studio-asset-row"]').length
        db.db.modules[0] = residentModule('S1', { assets: toAssetList(Array.from({ length: 100 }, (_, n): [string, string, string] => [`s${n}`, `assets/s${n}.png`, 'png'])) })
        held.settle({ kind: 'loaded' })
        await settle()
        setStudioSelection(S1, 'display', null)
        flushSync()
        expect(rawRows()).toBeGreaterThanOrEqual(1)
        expect(rawRows()).toBeLessThanOrEqual(32)
        await vi.waitFor(() => expect(rawRows()).toBe(100), { timeout: 10_000 })
        expect(part('studio-asset-list')?.hasAttribute('data-rows-pending')).toBe(false)
    })

    test('a refused load goes back to the stub note and the link to the Modules screen, after one request', async () => {
        stubWorld()
        loader.load.mockResolvedValue({ kind: 'refused' })
        await show(S1)
        expect(loadingLine()).toBeNull()
        expect(part('studio-detail-notloaded')).not.toBeNull()
        expect(part('studio-detail-classic')?.textContent?.trim()).toBe('studioOpenModules')
        expect(loader.load).toHaveBeenCalledTimes(1)
        expect(part('studio-module-asset-form')).toBeNull()
    })

    test('a load that asks the person keeps "Loading module" until it is answered', async () => {
        stubWorld()
        let answer: () => void = () => {}
        const settled = new Promise<void>((resolve) => { answer = resolve })
        loader.load.mockResolvedValue({ kind: 'deferred', settled })
        await show(S1)
        expect(loadingLine()).not.toBeNull()
        answer()
        await settle()
        expect(loadingLine()).toBeNull()
        expect(part('studio-detail-notloaded')).not.toBeNull()
    })

    test('a load that fails shows the stub note and throws nothing out of the screen', async () => {
        stubWorld()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        loader.load.mockRejectedValue(new Error('the body could not be read'))
        await show(S1)
        expect(loadingLine()).toBeNull()
        expect(part('studio-detail-notloaded')).not.toBeNull()
        expect(part('studio-detail-classic')).not.toBeNull()
        vi.restoreAllMocks()
    })

    test('moving to another owner before the load settles shows nothing of it there and moves no focus', async () => {
        stubWorld()
        const held = heldLoad()
        await show(S1)
        const probe = document.createElement('button')
        document.body.appendChild(probe)
        probe.focus()
        setStudioSelection(M1, null, null)
        flushSync()
        expect(loadingLine()).toBeNull()
        held.settle({ kind: 'refused' })
        await settle()
        expect(loadingLine()).toBeNull()
        expect(part('studio-detail-notloaded')).toBeNull()
        expect(document.activeElement).toBe(probe)
        probe.remove()
    })

    test('a rebuild of the owner model after a refusal asks nothing more and shows no loading line', async () => {
        stubWorld()
        loader.load.mockResolvedValue({ kind: 'refused' })
        await show(S1)
        expect(loader.load).toHaveBeenCalledTimes(1)
        rebuild()
        expect(loadingLine()).toBeNull()
        await vi.dynamicImportSettled()
        await settle()
        expect(loader.load).toHaveBeenCalledTimes(1)
        expect(loadingLine()).toBeNull()
        expect(part('studio-detail-notloaded')).not.toBeNull()
    })

    test('selecting it again while its load is pending asks the loader once and keeps the line until the load ends', async () => {
        stubWorld()
        const held = heldLoad()
        await show(S1)
        setStudioSelection('character:cha-1', null, null)
        flushSync()
        expect(loadingLine()).toBeNull()
        setStudioSelection(S1, null, null)
        flushSync()
        await vi.dynamicImportSettled()
        await settle()
        expect(loadingLine()).not.toBeNull()
        expect(loader.load).toHaveBeenCalledTimes(1)
        held.settle({ kind: 'refused' })
        await settle()
        expect(loadingLine()).toBeNull()
        expect(part('studio-detail-notloaded')).not.toBeNull()
    })

    test('selecting it again after a refusal asks again, once', async () => {
        stubWorld()
        loader.load.mockResolvedValue({ kind: 'refused' })
        await show(S1)
        setStudioSelection('character:cha-1', null, null)
        flushSync()
        setStudioSelection(S1, null, null)
        flushSync()
        await vi.dynamicImportSettled()
        await settle()
        expect(loader.load).toHaveBeenCalledTimes(2)
    })

    test('a module that is not loaded and shares its id with another is refused by the loader and shows the stub note', async () => {
        setWorld([stubModule('S1'), stubModule('S1')])
        loader.load.mockResolvedValue({ kind: 'refused' })
        await show('module:S1#1')
        expect(loader.load).toHaveBeenCalledWith('S1')
        expect(part('studio-detail-notloaded')).not.toBeNull()
    })
})

describe('the id the detail publishes for the selected module', () => {
    const publishes = () => vi.mocked(publishOpenModuleId).mock.calls.length
    const publishedIds = () => vi.mocked(publishOpenModuleId).mock.calls.map((call) => call[0])

    test('a loaded module publishes its raw id on every kind, with none chosen yet, and kind changes do not publish again', async () => {
        setWorld([loadedM1()])
        await show(M1)
        expect(openStudioModuleId()).toBe('M1')
        const before = publishes()
        for (const kind of ['display', 'lore', 'scripts', 'toggles', 'regex', 'html', 'advanced'] as const) {
            setStudioSelection(M1, kind, null)
            flushSync()
            expect(openStudioModuleId()).toBe('M1')
        }
        setStudioSelection(M1, null, null)
        flushSync()
        expect(openStudioModuleId()).toBe('M1')
        expect(publishes()).toBe(before)
    })

    test('deselecting the module, and selecting a character after it, publish null', async () => {
        setWorld([loadedM1()])
        await show(M1, 'display')
        expect(openStudioModuleId()).toBe('M1')
        setStudioSelection('character:cha-1', null, null)
        flushSync()
        expect(openStudioModuleId()).toBeNull()
    })

    test('unmounting the detail publishes null', async () => {
        setWorld([loadedM1()])
        await show(M1, 'display')
        expect(openStudioModuleId()).toBe('M1')
        await unmount(app!)
        app = undefined
        expect(openStudioModuleId()).toBeNull()
    })

    test('switching from one module to another publishes the second', async () => {
        setWorld([loadedM1(), residentModule('M2', { assets: toAssetList([['q1', 'assets/q1.png', 'png']]) })])
        await show(M1, 'lore')
        expect(openStudioModuleId()).toBe('M1')
        setStudioSelection('module:M2', 'scripts', null)
        flushSync()
        expect(openStudioModuleId()).toBe('M2')
        expect(publishedIds().slice(-1)).toEqual(['M2'])
    })

    test('the end of an older detail does not clear what a newer one published', async () => {
        setWorld([loadedM1()])
        await show(M1, 'display')
        const secondHost = document.createElement('div')
        document.body.appendChild(secondHost)
        const second = mount(StudioDetail, { target: secondHost })
        flushSync()
        expect(openStudioModuleId()).toBe('M1')
        await unmount(app!)
        app = undefined
        expect(openStudioModuleId()).toBe('M1')
        await unmount(second)
        secondHost.remove()
        expect(openStudioModuleId()).toBeNull()
    })

    test('a shared id publishes null on every kind, and publishes without a remount once the other module is gone', async () => {
        setWorld([loadedM1(), residentModule('M1', { assets: toAssetList([['z1', 'assets/z1.png', 'png']]) })])
        await show(M1)
        expect(openStudioModuleId()).toBeNull()
        for (const kind of ['lore', 'scripts', 'display'] as const) {
            setStudioSelection(M1, kind, null)
            flushSync()
            expect(openStudioModuleId()).toBeNull()
        }
        const list = part('studio-asset-list')
        expect(list).not.toBeNull()
        db.db.modules.splice(1, 1)
        flushSync()
        await settle()
        expect(openStudioModuleId()).toBe('M1')
        expect(part('studio-asset-list')).toBe(list)
        expect(part('studio-asset-module-readonly')).toBeNull()
    })

    test('another module taking the id withdraws it again', async () => {
        setWorld([loadedM1()])
        await show(M1, 'scripts')
        expect(openStudioModuleId()).toBe('M1')
        db.db.modules.push(residentModule('M1'))
        flushSync()
        await settle()
        expect(openStudioModuleId()).toBeNull()
    })

    test('a module that is not loaded publishes nothing until it loads, then publishes its id', async () => {
        setWorld([stubModule('S1'), loadedM1()])
        const held = heldLoad()
        await show(S1)
        expect(openStudioModuleId()).toBeNull()
        expect(publishedIds()).not.toContain('S1')
        db.db.modules[0] = residentModule('S1', { assets: toAssetList([['s1', 'assets/s1.png', 'png']]) })
        held.settle({ kind: 'loaded' })
        await settle()
        expect(openStudioModuleId()).toBe('S1')
    })

    test('a refused load keeps null published', async () => {
        setWorld([stubModule('S1'), loadedM1()])
        loader.load.mockResolvedValue({ kind: 'refused' })
        await show(S1)
        setStudioSelection(S1, 'display', null)
        flushSync()
        await settle()
        expect(openStudioModuleId()).toBeNull()
        expect(publishedIds()).not.toContain('S1')
    })

    test('a rebuild of the owner model, or a module write, neither publishes again nor clears', async () => {
        setWorld([loadedM1()])
        await show(M1, 'display')
        const before = publishes()
        rebuild()
        rebuild()
        db.db.modules[0] = loadedM1({ name: 'renamed' })
        flushSync()
        await settle()
        rebuild()
        expect(openStudioModuleId()).toBe('M1')
        expect(publishes()).toBe(before)
    })
})
