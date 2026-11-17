// @vitest-environment jsdom
/**
 * The history of a selected module, under the real Studio screen, History panel and history service on the memory
 * doubles. The detail publishes the selected module's id on any kind, which lets a module write land and lets the panel
 * and Ctrl+Z reach the module's steps; selecting anything else ends it. "Settle" awaits resolved promises on one fake clock.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0, getFileSrc: async (path: string, use: string) => `blob:${use}:${path}` }))
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
    }
    return {
        ...stores,
        get DBState() { return db },
        get selIdState() { return selection },
        get QuickSettings() { return quickSettings },
    }
})
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
// The module code the history accessor loads for a module owner; the rig's own port stands in for what it does.
vi.mock('src/ts/process/modules', () => ({ refreshModules: vi.fn() }))
vi.mock('src/ts/process/moduleGuiBump', () => ({ bumpModuleGui: vi.fn() }))
// The engine's own selection over the module list: the rows whose id is asked for.
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
        'studioAssetEmotionsElsewhere', 'studioAssetRowMenu', 'studioAssetSelectedCount', 'studioAssetFilterEmpty', 'studioAssetDeletedOne',
        'studioAssetDeletedMany', 'studioStepAssetDeleteOne', 'studioStepAssetRename', 'studioStepAssetDeleteMany', 'studioStepAssetMove',
        'studioAssetFileGone', 'studioAssetFileUnchecked', 'studioAssetMovesSameName', 'studioAssetModuleNowShows',
    ]) named[key] = call(key)
    return { language: new Proxy(named, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { toAssetList } from 'src/ts/storage/assetList'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { RisuModule } from 'src/ts/process/modules'
import { openStudioModuleId, resetOpenModuleIdForTests } from 'src/ts/studio/assets/openModuleForm.svelte'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { makeCharacter, makeInput, residentModule, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, selectedHistoryOwner, setStudioSelection } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { ReloadGUIPointer } from 'src/ts/stores.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { setSessionAssetSizeJobForTests } from './assets/StudioAssetList.svelte'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import StudioScreen from './StudioScreen.svelte'

function moduleWith(id: string, rows: string[][]): RisuModule {
    return residentModule(id, { assets: toAssetList(rows as [string, string, string][]) })
}

const rowsOf = (stem: string): string[][] => [[`${stem}1`, `assets/${stem}1.png`, 'png'], [`${stem}2`, `assets/${stem}2.png`, 'png'], [`${stem}3`, `assets/${stem}3.png`, 'png']]

function fixtureDb(license?: 'private') {
    const input = makeInput({
        character: makeCharacter({ chaId: 'A', ...(license ? { license } : {}) }),
        modules: [moduleWith('M1', rowsOf('a')), moduleWith('M2', rowsOf('b'))],
        enabledModules: ['M1', 'M2'],
    })
    return { ...studioDbOf(input), modules: [...input.modules] }
}

const M1 = moduleOwnerKey('M1')
const CHARACTER = 'character:A'
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const moduleTarget = (id: string) => ({ owner: { type: 'module', id }, kind: 'display', from: 'chat' }) as const

// ---------------------------------------------------------------- rigs

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

let rigCount = 0

// The service as production builds it: it asks the detail which module is selected, and a landed module write tells the
// module screens the way the module port does.
function makeRig(): OwnerHistoryService {
    const clock = createFakeClock()
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: `p${++rigCount}`,
        registerLeaveFlush: () => () => {},
        openModuleId: openStudioModuleId,
        onModuleSlotReplaced: () => ReloadGUIPointer.update((value) => value + 1),
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return service
}

// ---------------------------------------------------------------- dom helpers

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountInto(component: Parameters<typeof mount>[0]): HTMLElement {
    const host = document.createElement('div')
    host.style.position = 'relative'
    document.body.appendChild(host)
    const app = mount(component, { target: host, props: {} })
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
const stepTexts = () => parts('studio-history-step').map((row) => row.querySelector('span')?.textContent?.trim())

async function mountOnModule(id: string, panel = false): Promise<void> {
    openStudio(moduleTarget(id), null)
    mountInto(StudioScreen)
    await settle()
    if (panel) {
        part('studio-history-toggle')?.click()
        await settle()
    }
}

async function select(ownerKey: string, kind: 'display' | 'scripts' | 'lore' | null): Promise<void> {
    setStudioSelection(ownerKey, kind, null)
    await settle()
}

async function rename(row: number, value: string): Promise<void> {
    const field = parts('studio-asset-name')[row] as HTMLInputElement
    field.focus()
    field.value = value
    field.blur()
    flushSync()
    await settle()
}

async function ctrl(init: KeyboardEventInit): Promise<KeyboardEvent> {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, ...init })
    part('studio')!.dispatchEvent(event)
    flushSync()
    await settle()
    return event
}

const assetNames = (index: number): string[] => ((db.db.modules[index] as RisuModule).assets ?? []).map((row) => row[0])

beforeEach(() => {
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    resetOpenModuleIdForTests()
    db.db = fixtureDb()
    selection.selId = 0
    setStudioEnabled(true)
    setSessionAssetSizeJobForTests({ peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true } satisfies AssetSizeJob)
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(async () => {
    await unmountAll()
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

describe('a selected module on any kind', () => {
    test('is the history owner, takes writes, and shows its steps in the panel on a kind other than display', async () => {
        const service = makeRig()
        await mountOnModule('M1', true)
        await service.whenReady(M1)
        await rename(0, 'a1x')
        expect(stepTexts()).toEqual(['studioStepAssetRename(a1,a1x)'])
        for (const kind of ['scripts', 'lore'] as const) {
            await select(M1, kind)
            expect(part('studio-module-asset-form')).toBeNull()
            expect(openStudioModuleId()).toBe('M1')
            expect(selectedHistoryOwner()).toBe(M1)
            expect(stepTexts()).toEqual(['studioStepAssetRename(a1,a1x)'])
        }
        expect(service.assetRename(M1, 'assets', 1, 'a2x')).toMatchObject({ ok: true })
        expect(assetNames(0)).toEqual(['a1x', 'a2x', 'a3'])
    })

    test('is the history owner before any kind is chosen', async () => {
        const service = makeRig()
        await mountOnModule('M1')
        await select(M1, null)
        expect(openStudioModuleId()).toBe('M1')
        expect(selectedHistoryOwner()).toBe(M1)
        await service.whenReady(M1)
        expect(service.assetRename(M1, 'assets', 0, 'a1x')).toMatchObject({ ok: true })
    })
})

describe('deselecting a module', () => {
    test('returns null, and a character selected after it is the history owner with its own history', async () => {
        const service = makeRig()
        await mountOnModule('M1', true)
        await service.whenReady(M1)
        await rename(0, 'a1x')
        expect(openStudioModuleId()).toBe('M1')
        await select(CHARACTER, null)
        expect(part('studio-module-asset-form')).toBeNull()
        expect(openStudioModuleId()).toBeNull()
        expect(selectedHistoryOwner()).toBe(characterOwnerKey('A'))
        expect(stepTexts()).toEqual([])
        expect(part('studio-history-none')).toBeNull()
    })

    test('refuses a module write as not selected afterwards', async () => {
        const service = makeRig()
        await mountOnModule('M1')
        await service.whenReady(M1)
        expect(service.assetRename(M1, 'assets', 0, 'a1x')).toMatchObject({ ok: true })
        await select(CHARACTER, null)
        expect(service.assetRename(M1, 'assets', 0, 'a1y')).toEqual({ ok: false, reason: 'not-selected' })
        expect(assetNames(0)).toEqual(['a1x', 'a2', 'a3'])
    })

    test('leaves the module\'s step alone for Ctrl+Z', async () => {
        const service = makeRig()
        await mountOnModule('M1', true)
        await service.whenReady(M1)
        await rename(0, 'a1x')
        await select(CHARACTER, null)
        await ctrl({ key: 'z' })
        expect(assetNames(0)).toEqual(['a1x', 'a2', 'a3'])
        expect(service.view(M1).undone).toHaveLength(0)
    })
})
