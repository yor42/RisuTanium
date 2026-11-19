// @vitest-environment jsdom
/**
 * The preview sheet on the toggle builder of a resident module under the real Studio screen, with the real publish of
 * the open module's id and the real history service on the memory doubles. Guards by construction (class G): the sheet
 * is new, so the evidence is the mutant each row kills.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ inUse: [] as string[] }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => 0,
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
    readImage: () => Promise.resolve(undefined),
    saveAsset: vi.fn(),
    aiWatermarkingLawApplies: () => false,
}))
vi.mock('src/ts/studio/assets/assetFileState', () => ({
    openAssetFileReader: async () => ({ concurrency: 1, stateOf: async () => 'present' }),
}))

// Filled by `beforeEach`: the fixture's own constants are not defined yet at this point.
const db = $state({ db: {} as ReturnType<typeof fixtureDb> })
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
        selectedCharID: writable(0),
    }
    return {
        ...stores,
        get DBState() { return db },
        get selIdState() { return selection },
        get QuickSettings() { return quickSettings },
    }
})
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
// The modules in use are the ids the test names; the chat panel reads them through `getModules`.
vi.mock('src/ts/process/modules', () => ({
    refreshModules: vi.fn(),
    getModules: () => db.db.modules.filter((row: { id: string }) => h.inUse.includes(row.id)),
    getModuleToggles: () => '',
    getModuleAssets: () => [],
}))
vi.mock('src/ts/process/moduleGuiBump', () => ({ bumpModuleGui: vi.fn() }))
vi.mock('src/ts/process/moduleRefList', () => ({
    moduleRefIdsOf: () => db.db.modules.map((row: { id: string }) => row.id),
    moduleListOf: (ids: string[]) => db.db.modules.filter((row: { id: string }) => ids.includes(row.id)),
}))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const named: Record<string, unknown> = { sidebarUi: { notAllowed: 'notAllowed', noAssets: 'noAssets' } }
    for (const key of [
        'studioTgDeleted', 'studioTgMoved', 'studioTgOptionN', 'studioTgSummarySelect', 'studioTgSummaryGroup', 'studioTgUnreadableCount', 'studioTgLineN',
        'studioTgCarryAskKey', 'studioTgCarryAskOptions', 'studioTgCarryAskKind', 'studioTgCarryAskDrop', 'studioTgCarryAskUnclear',
        'studioTgCarryAskOptionsLate', 'studioTgCarryAskOptionsLateRenamed', 'studioTgCarryOverwrite', 'studioTgCarryShared', 'studioTgCarryOldStays',
        'studioTgPreviewKeyTip', 'studioTgPreviewGroupCount', 'studioTgPreviewHidden', 'studioTgPreviewSelected',
    ]) named[key] = call(key)
    return { language: new Proxy(named, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { dispatchBack, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { installDbWriteHook, uninstallDbWriteHook } from 'src/ts/storage/dbWriteHook'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetOpenModuleIdForTests } from 'src/ts/studio/assets/openModuleForm.svelte'
import { createSaveAck, type ModuleCommitVerdict, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { makeCharacter, makeInput, residentModule, studioDbOf, stubModule } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioModuleAckForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { syncFavourites } from '../../ts/chatShell/toggleFavouritesStore.svelte'
import { resetToggleCarrySessionForTests } from '../../ts/studio/toggleCarryPending'
import { openStudioModuleId } from 'src/ts/studio/assets/openModuleForm.svelte'
import { setSessionAssetSizeJobForTests } from './assets/StudioAssetList.svelte'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import StudioScreen from './StudioScreen.svelte'

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

function fixtureDb(secret = false) {
    const input = makeInput({
        character: makeCharacter({
            chaId: 'A',
            name: 'Secret Name',
            customModuleToggle: 'ch=Char=check',
            ...(secret ? { license: 'private' } : {}),
        } as Parameters<typeof makeCharacter>[0]),
        modules: [
            { ...residentModule('M1', { customModuleToggle: 'm1=One=check' }), name: 'Named One' },
            { ...residentModule('M2', { customModuleToggle: 'm2=Two=check' }), name: 'Named Two' },
        ],
        enabledModules: ['M1', 'M2'],
    })
    return { ...studioDbOf(input), modules: [...input.modules] }
}

const moduleToggles = (id: string) => ({ owner: { type: 'module', id }, kind: 'toggles', from: 'chat' }) as const
const characterToggles = { owner: { type: 'character', id: 'A' }, kind: 'toggles', from: 'chat' } as const

function makeAck(clock: FakeClock): SaveAck {
    const deps: SaveAckDeps = {
        getMarkCount: () => 0,
        getCommittedMarkCount: () => 0,
        afterNextCommit: () => {},
        requestSaveNow: () => {},
        getPeerSaveCount: () => 0,
        onStopped: () => () => {},
        isStopped: () => false,
        subscribeFailure: () => () => {},
        currentFailure: () => null,
        frozenKeys: () => new Set<string>(),
        isCharacterUnsavable: () => false,
        onPassStart: () => () => {},
        visible: () => true,
        onVisibilityChange: () => () => {},
        clock,
    }
    return createSaveAck(deps)
}

function makeModuleAck(clock: FakeClock): SaveAck {
    const deps: SaveAckDeps = {
        getMarkCount: () => 1,
        getCommittedMarkCount: () => 0,
        afterNextCommit: () => {},
        requestSaveNow: () => {},
        getPeerSaveCount: () => 0,
        onStopped: () => () => {},
        isStopped: () => false,
        subscribeFailure: () => () => {},
        currentFailure: () => null,
        frozenKeys: () => new Set<string>(),
        isCharacterUnsavable: () => false,
        onPassStart: () => () => {},
        visible: () => true,
        onVisibilityChange: () => () => {},
        clock,
    }
    return createSaveAck(deps, { kind: 'module', verdict: (): ModuleCommitVerdict => 'saved' })
}

let rigCount = 0

function makeRig(): OwnerHistoryService {
    const clock = createFakeClock()
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: `p${++rigCount}`,
        registerLeaveFlush: () => () => {},
        openModuleId: openStudioModuleId,
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    setStudioModuleAckForTests(() => makeModuleAck(clock))
    return service
}

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountInto(component: Parameters<typeof mount>[0], props: Record<string, unknown> = {}): HTMLElement {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    const app = mount(component, { target: host, props })
    mounted.push({ app, host })
    flushSync()
    return host
}

async function unmountAll(): Promise<void> {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
}

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
}

class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
        this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    disconnect(): void {}
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const previewRows = () => parts('studio-tg-preview-row')

async function mountOn(target: Parameters<typeof openStudio>[0]): Promise<OwnerHistoryService> {
    const service = makeRig()
    openStudio(target, null)
    mountInto(StudioScreen)
    await settle()
    return service
}

async function openSheet(): Promise<void> {
    part('studio-toggle-preview-eye')?.click()
    flushSync()
    await vi.waitFor(() => expect(part('studio-toggle-preview')).not.toBeNull())
    await settle()
}

async function showAll(): Promise<void> {
    part('studio-tg-preview-scope-all')?.click()
    flushSync()
    await settle()
}

// The builder loads the sheet on the first opening; its first load transforms the chat panel's whole import chain.
beforeAll(async () => {
    await import('./StudioTogglePreview.svelte')
}, 120_000)

beforeEach(() => {
    h.inUse = ['M1', 'M2']
    tracker.character.length = 0
    tracker.modules = false
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    resetOpenModuleIdForTests()
    db.db = fixtureDb()
    installDbWriteHook(db, { selectedChaId: () => 'A' })
    selection.selId = 0
    setStudioEnabled(true)
    setSessionAssetSizeJobForTests({ peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true } satisfies AssetSizeJob)
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(async () => {
    await unmountAll()
    uninstallDbWriteHook()
    localStorage.clear()
    resetToggleCarrySessionForTests()
    syncFavourites()
    setSessionAssetSizeJobForTests(undefined)
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetOpenModuleIdForTests()
    resetBackHandlersForTests()
    resetToastHostForTests()
    setStudioEnabled(false)
    vi.unstubAllGlobals()
})

describe('PU-9 the module in the chat', () => {
    test('a module in use shows its rows outlined and no note; the combined scope lists the panel sources', async () => {
        await mountOn(moduleToggles('M1'))
        await openSheet()
        await showAll()
        expect(part('studio-tg-preview-not-in-chat')).toBeNull()
        const current = previewRows().filter((row) => row.hasAttribute('data-current'))
        expect(current.map((row) => row.dataset.key)).toEqual(['m1'])
        expect(previewRows().map((row) => row.dataset.key)).toEqual(['m1', 'm2', 'ch'])
    })

    test('a module that the chat does not use shows the note and no outlined row, while its own scope still shows its rows', async () => {
        h.inUse = ['M2']
        await mountOn(moduleToggles('M1'))
        await openSheet()
        expect(previewRows().map((row) => row.dataset.key)).toEqual(['m1'])
        await showAll()
        expect(part('studio-tg-preview-not-in-chat')?.textContent).toBe('studioTgPreviewNotInChat')
        expect(previewRows().filter((row) => row.hasAttribute('data-current'))).toEqual([])
        expect(previewRows().map((row) => row.dataset.key)).toEqual(['m2', 'ch'])
    })

    test('a character never shows the note', async () => {
        h.inUse = []
        await mountOn(characterToggles)
        await openSheet()
        await showAll()
        expect(part('studio-tg-preview-not-in-chat')).toBeNull()
        expect(previewRows().filter((row) => row.hasAttribute('data-current')).map((row) => row.dataset.key)).toEqual(['ch'])
    })
})

describe('PU-10 a private bound character', () => {
    test('its rows and its name never reach the joined scope of a module builder', async () => {
        db.db = fixtureDb(true)
        await mountOn(moduleToggles('M1'))
        await openSheet()
        await showAll()
        expect(previewRows().map((row) => row.dataset.key)).toEqual(['m1', 'm2'])
        expect(document.querySelector('[data-uid^="character:A#"]')).toBeNull()
        expect(part('studio-toggle-preview')?.textContent).not.toContain('Secret Name')
        expect(part('studio-toggle-preview')?.textContent).not.toContain('Char')
    })
})

describe('PU-11 the host that renders the sheet', () => {
    test('a second row with the module id unmounts the builder, the flag falls and the next Back reaches the layer below', async () => {
        await mountOn(moduleToggles('M1'))
        await openSheet()
        expect(studioScreen.togglePreviewOpen).toBe(true)
        db.db.modules.push(residentModule('M1', { customModuleToggle: 'dup=Dup=check' }))
        await settle()
        expect(part('studio-toggle-builder')).toBeNull()
        expect(studioScreen.togglePreviewOpen).toBe(false)
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(studioScreen.open).toBe(false)
    })

    test('a module that stops being loaded does the same', async () => {
        await mountOn(moduleToggles('M1'))
        await openSheet()
        db.db.modules[0] = stubModule('M1')
        await settle()
        expect(part('studio-toggle-builder')).toBeNull()
        expect(studioScreen.togglePreviewOpen).toBe(false)
    })
})
