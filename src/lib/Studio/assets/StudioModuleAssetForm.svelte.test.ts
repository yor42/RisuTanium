// @vitest-environment jsdom
/**
 * The asset form of a loaded module, under the real Studio screen, History panel and history service on the memory
 * doubles: the id the detail publishes while it is selected (the history of a selected module is in its own suite), the
 * read-only state of a module whose id another module shares, and what a module's list leaves out of the character's. "Settle" awaits resolved promises on one fake clock.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// What the page's error alert was asked to show.
const alerts = vi.hoisted(() => ({ errors: [] as (string | Error)[] }))

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
vi.mock('src/ts/alert', () => ({ alertError: (message: string | Error) => { alerts.errors.push(message) } }))
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
import { toAssetList, type AssetList } from 'src/ts/storage/assetList'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { RisuModule } from 'src/ts/process/modules'
import { ASSET_FOLDER_KEY } from 'src/ts/studio/assets/assetOwnerKeys'
import { readFolderDoc } from 'src/ts/studio/assets/folderCodec'
import { openStudioModuleId, resetOpenModuleIdForTests } from 'src/ts/studio/assets/openModuleForm.svelte'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { makeCharacter, makeInput, residentModule, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, setStudioSelection, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { ReloadGUIPointer } from 'src/ts/stores.svelte'
import { resetToastHostForTests, toastHost } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { moduleOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type ClaimDouble } from '../../../ts/studio/history/tests/studioStoreDoubles'
import { setSessionAssetSizeJobForTests, setSessionFinderPortForTests } from './StudioAssetList.svelte'
import type { FinderPort } from './StudioAssetFinder.svelte'
import type { AssetSizeJob, StoredSize } from '../../../ts/studio/assets/assetSizes'
import StudioScreen from '../StudioScreen.svelte'

const FOLDERS = { v: 1, additional: { order: ['Faces'], of: [['a1', 'Faces']] } }

function moduleWith(id: string, rows: string[][], extra: Partial<RisuModule> = {}): RisuModule {
    return residentModule(id, { assets: toAssetList(rows as [string, string, string][]), ...extra })
}

const rowsOf = (stem: string): string[][] => [[`${stem}1`, `assets/${stem}1.png`, 'png'], [`${stem}2`, `assets/${stem}2.png`, 'png'], [`${stem}3`, `assets/${stem}3.png`, 'png']]

function fixtureDb(license?: 'private') {
    const input = makeInput({
        character: makeCharacter({ chaId: 'A', ...(license ? { license } : {}) }),
        modules: [moduleWith('M1', rowsOf('a'), { [ASSET_FOLDER_KEY]: FOLDERS }), moduleWith('M2', rowsOf('b'))],
        enabledModules: ['M1', 'M2'],
    })
    return { ...studioDbOf(input), modules: [...input.modules], useAdditionalAssetsPreview: true }
}

const M1 = moduleOwnerKey('M1')
const M2 = moduleOwnerKey('M2')
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

interface Rig {
    clock: FakeClock
    claim: ClaimDouble
    service: OwnerHistoryService
}

let rigCount = 0

// The service as production builds it for a module: it asks the form what is open, and a landed module write tells the
// module screens the way the module port does.
function makeRig(): Rig {
    const clock = createFakeClock()
    const claim = createClaimDouble()
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim,
        clock,
        pageSession: `p${++rigCount}`,
        registerLeaveFlush: () => () => {},
        openModuleId: openStudioModuleId,
        onModuleSlotReplaced: () => ReloadGUIPointer.update((value) => value + 1),
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return { clock, claim, service }
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
    unobserve(): void {}
    disconnect(): void {}
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const names = () => parts('studio-asset-name').map((field) => (field as HTMLInputElement).value)

// The Studio screen on a module's display kind.
async function mountOnModule(id: string, panel = false): Promise<void> {
    openStudio(moduleTarget(id), null)
    mountInto(StudioScreen)
    await settle()
    if (panel) {
        part('studio-history-toggle')?.click()
        await settle()
    }
}

async function select(ownerKey: string, kind: 'display' | 'basic' | null): Promise<void> {
    setStudioSelection(ownerKey, kind, null)
    await settle()
}

async function click(element: HTMLElement | null): Promise<void> {
    element?.click()
    flushSync()
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

function slot(index: number): RisuModule {
    return db.db.modules[index] as RisuModule
}

const assetNames = (index: number): string[] => (slot(index).assets ?? []).map((row) => row[0])

beforeEach(() => {
    alerts.errors.length = 0
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
    setSessionFinderPortForTests(undefined)
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetOpenModuleIdForTests()
    resetBackHandlersForTests()
    resetToastHostForTests()
    setStudioEnabled(false)
    vi.unstubAllGlobals()
})

// ---------------------------------------------------------------- the published id

describe('the id of the module a form belongs to', () => {
    test('moves to another module when the selection does: writes land on it, the first is unchanged and its bulk selection is gone', async () => {
        const rig = makeRig()
        await mountOnModule('M1')
        await rig.service.whenReady(M1)
        await click(part('studio-asset-select-toggle'))
        await click(parts('studio-asset-select')[0])
        expect(part('studio-asset-selected-count')?.textContent).toBe('studioAssetSelectedCount(1)')
        const list = part('studio-asset-list')
        await select(M2, 'display')
        expect(part('studio-asset-list')).not.toBe(list)
        expect(openStudioModuleId()).toBe('M2')
        await rig.service.whenReady(M2)
        expect(part('studio-asset-bulkbar')).toBeNull()
        expect(rig.service.assetRename(M2, 'assets', 0, 'b1x')).toMatchObject({ ok: true })
        expect(assetNames(1)).toEqual(['b1x', 'b2', 'b3'])
        expect(assetNames(0)).toEqual(['a1', 'a2', 'a3'])
        await click(part('studio-asset-select-toggle'))
        expect(part('studio-asset-selected-count')?.textContent).toBe('studioAssetSelectedCount(0)')
    })
})

// ---------------------------------------------------------------- the module's history

describe('the history of a selected module', () => {
    test('reaches the panel and Ctrl+Z whatever the bound character is, a private one included', async () => {
        db.db = fixtureDb('private')
        const rig = makeRig()
        await mountOnModule('M1', true)
        await rig.service.whenReady(M1)
        await rename(0, 'a1x')
        expect(assetNames(0)).toEqual(['a1x', 'a2', 'a3'])
        expect(parts('studio-history-step').map((row) => row.querySelector('span')?.textContent?.trim())).toEqual(['studioStepAssetRename(a1,a1x)'])
        expect((await ctrl({ key: 'z' })).defaultPrevented).toBe(true)
        expect(assetNames(0)).toEqual(['a1', 'a2', 'a3'])
        expect(rig.service.view(M1).undone).toHaveLength(1)
        expect(alerts.errors).toEqual([])
    })

})

// ---------------------------------------------------------------- shared ids

describe('a module whose id another module shares', () => {
    function shareM1(): void {
        db.db.modules.push(moduleWith('M1', rowsOf('c')))
        flushSync()
    }

    const actionControls = (): HTMLElement[] => [
        ...parts('studio-asset-new-folder'), ...parts('studio-asset-folder-rename'), ...parts('studio-asset-folder-delete'),
    ]

    test('shows its rows and folders with the shared-id line, and every change off', async () => {
        const rig = makeRig()
        shareM1()
        await mountOnModule('M1')
        expect(part('studio-asset-module-readonly')?.textContent).toBe('studioAssetModuleSharedId')
        expect(names()).toEqual(['a1', 'a2', 'a3'])
        expect(parts('studio-asset-folder-header')).toHaveLength(2)
        expect(actionControls().length).toBeGreaterThan(0)
        for (const control of actionControls()) expect((control as HTMLButtonElement).disabled).toBe(true)
        for (const field of parts('studio-asset-name')) expect((field as HTMLInputElement).readOnly).toBe(true)
        await click(parts('studio-asset-row-more')[0])
        expect((part('studio-asset-menu-delete') as HTMLButtonElement).disabled).toBe(true)
        expect(part('studio-asset-menu-move')).toBeNull()
        expect(part('studio-asset-loading')).toBeNull()
        // The history of the id is not started and nothing is published.
        expect(openStudioModuleId()).toBeNull()
        expect(rig.claim.calls).toEqual([])
        expect(rig.service.assetRename(M1, 'assets', 0, 'x')).toEqual({ ok: false, reason: 'not-selected' })
        expect(assetNames(0)).toEqual(['a1', 'a2', 'a3'])
    })

    test('the finder and the bulk bar show too, with their changes off', async () => {
        makeRig()
        shareM1()
        await mountOnModule('M1')
        await click(part('studio-asset-select-toggle'))
        await click(parts('studio-asset-select')[0])
        expect(part('studio-asset-selected-count')?.textContent).toBe('studioAssetSelectedCount(1)')
        expect((part('studio-asset-bulk-delete') as HTMLButtonElement).disabled).toBe(true)
        expect((part('studio-asset-bulk-move') as HTMLButtonElement).disabled).toBe(true)
        await click(part('studio-asset-find-duplicates'))
        expect(part('studio-asset-dup-panel')).not.toBeNull()
    })

    test('the later of two modules with one id is read-only too and shows its own rows', async () => {
        makeRig()
        shareM1()
        await mountOnModule('M1#2')
        expect(part('studio-asset-module-readonly')).not.toBeNull()
        expect(names()).toEqual(['c1', 'c2', 'c3'])
        expect(openStudioModuleId()).toBeNull()
    })

    test('becomes editable and publishes its id, in the same list, once the other module is gone', async () => {
        const rig = makeRig()
        shareM1()
        await mountOnModule('M1')
        const list = part('studio-asset-list')
        expect(openStudioModuleId()).toBeNull()
        db.db.modules.splice(2, 1)
        flushSync()
        await settle()
        await rig.service.whenReady(M1)
        await settle()
        expect(part('studio-asset-module-readonly')).toBeNull()
        expect(part('studio-asset-list')).toBe(list)
        expect(openStudioModuleId()).toBe('M1')
        expect(parts('studio-asset-name').every((field) => !(field as HTMLInputElement).readOnly)).toBe(true)
        expect((part('studio-asset-new-folder') as HTMLButtonElement).disabled).toBe(false)
        expect(rig.service.assetRename(M1, 'assets', 0, 'a1x')).toMatchObject({ ok: true })
    })

    test('goes read-only again, without a remount, when another module takes its id', async () => {
        const rig = makeRig()
        await mountOnModule('M1')
        await rig.service.whenReady(M1)
        const list = part('studio-asset-list')
        expect(openStudioModuleId()).toBe('M1')
        shareM1()
        await settle()
        expect(part('studio-asset-list')).toBe(list)
        expect(part('studio-asset-module-readonly')).not.toBeNull()
        expect(openStudioModuleId()).toBeNull()
        expect(rig.service.assetRename(M1, 'assets', 0, 'x')).toEqual({ ok: false, reason: 'not-selected' })
    })
})

// ---------------------------------------------------------------- what a module's list is

describe('a module\'s list', () => {
    test('reads its rows and its folders from the module slot', async () => {
        makeRig()
        await mountOnModule('M1')
        expect(names()).toEqual(['a1', 'a2', 'a3'])
        expect(parts('studio-asset-folder-header').map((header) => header.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['▾ Faces 1', '▾ studioAssetNoFolder 2'])
        expect(part('studio-chip')).toBeNull()
    })

    test('has no emotion line, no exclude item and no bulk preview action, even with the preview setting on', async () => {
        makeRig()
        await mountOnModule('M1')
        expect(part('studio-asset-emotions')).toBeNull()
        await click(parts('studio-asset-row-more')[0])
        expect(part('studio-asset-menu-exclude')).toBeNull()
        await click(part('studio-asset-select-toggle'))
        expect(part('studio-asset-bulk-preview')).toBeNull()
    })

    test('renames a row on the module, keeps the list an AssetList and names the step in the panel', async () => {
        const rig = makeRig()
        await mountOnModule('M1', true)
        await rig.service.whenReady(M1)
        await rename(1, 'a2x')
        const assets: AssetList | undefined = slot(0).assets
        expect(assets?.constructor.name).toBe('AssetList')
        expect(assetNames(0)).toEqual(['a1', 'a2x', 'a3'])
        expect(names()).toEqual(['a1', 'a2x', 'a3'])
        expect(parts('studio-history-step').map((row) => row.querySelector('span')?.textContent?.trim())).toEqual(['studioStepAssetRename(a2,a2x)'])
    })

    test('deletes a row through its menu, one step, and Undo from the history puts it back', async () => {
        const rig = makeRig()
        await mountOnModule('M1', true)
        await rig.service.whenReady(M1)
        await click(parts('studio-asset-row-more')[1])
        await click(part('studio-asset-menu-delete'))
        expect(assetNames(0)).toEqual(['a1', 'a3'])
        expect(rig.service.view(M1).done).toHaveLength(1)
        await click(part('studio-history-undo'))
        expect(assetNames(0)).toEqual(['a1', 'a2', 'a3'])
    })

    test('a deleted row\'s toast carries no last-picture line, though another enabled module holds the name', async () => {
        const rig = makeRig()
        db.db.modules[1] = moduleWith('M2', [['a1', 'assets/other-a1.png', 'png']])
        await mountOnModule('M1')
        await rig.service.whenReady(M1)
        await click(parts('studio-asset-row-more')[0])
        await click(part('studio-asset-menu-delete'))
        expect(assetNames(0)).toEqual(['a2', 'a3'])
        expect(toastHost.visible.map((toast) => [toast.text, toast.sub])).toEqual([['studioAssetDeletedOne(a1)', undefined]])
    })

    test('says another tab owns the module, with the module wording, when it does', async () => {
        const rig = makeRig()
        rig.claim.forced = 'held'
        await mountOnModule('M1')
        await rig.service.whenReady(M1)
        await click(parts('studio-asset-row-more')[0])
        await click(part('studio-asset-menu-delete'))
        expect(part('studio-asset-refusal')?.textContent).toBe('studioAssetRefusalOtherTabModule')
        expect(assetNames(0)).toEqual(['a1', 'a2', 'a3'])
    })

    test('moves a row to a folder of the module and shows it there', async () => {
        const rig = makeRig()
        await mountOnModule('M1')
        await rig.service.whenReady(M1)
        await click(parts('studio-asset-row-more')[1])
        await click(part('studio-asset-menu-move'))
        await click(parts('studio-asset-move-choice').find((choice) => choice.dataset.folder === 'Faces') ?? null)
        expect(parts('studio-asset-folder-header').map((header) => header.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['▾ Faces 2', '▾ studioAssetNoFolder 1'])
        expect(readFolderDoc(slot(0)[ASSET_FOLDER_KEY]).doc.additional.of).toEqual(expect.arrayContaining([['a1', 'Faces'], ['a2', 'Faces']]))
    })

    // A write to a module replaces its whole slot, as the loader and the history service do. Rows are keyed by their file,
    // so such a write keeps the mounted row nodes (and their focus) and mounts no row it had not shown.
    test('a write that replaces the module slot keeps the mounted row nodes', async () => {
        makeRig()
        const forty = (first: string): string[][] => Array.from({ length: 40 }, (_, n) => [n === 0 ? first : `r${n}`, `assets/r${n}.png`, 'png'])
        db.db.modules[0] = moduleWith('M1', forty('r0'))
        await mountOnModule('M1')
        const rawRows = () => Array.from(document.querySelectorAll('[data-part="studio-asset-row"]'))
        const before = rawRows()
        // Only the window is in the page: the list is windowed, so forty rows are not all mounted.
        expect(before.length).toBeGreaterThan(0)
        expect(before.length).toBeLessThanOrEqual(20)
        db.db.modules[0] = moduleWith('M1', forty('renamed'))
        await settle()
        expect(rawRows()).toHaveLength(before.length)
        expect(rawRows().every((row, at) => row === before[at])).toBe(true)
        expect((rawRows()[0].querySelector('[data-part="studio-asset-name"]') as HTMLInputElement).value).toBe('renamed')
        db.db.modules[0] = moduleWith('M1', forty('renamed again'))
        await settle()
        expect(rawRows().every((row, at) => row === before[at])).toBe(true)
    })

    test('the duplicate scope switch lists the other enabled modules and leaves the module itself out', async () => {
        makeRig()
        const port: FinderPort = {
            sizes: { peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true },
            hashCache: { get: () => undefined },
            checkBytes: async () => ({ status: 'done', hashes: new Map(), unreadable: [] }),
        }
        setSessionFinderPortForTests(port)
        await mountOnModule('M1')
        await click(part('studio-asset-find-duplicates'))
        expect(parts('studio-asset-dup-array').map((array) => array.dataset.array)).toEqual(['assets'])
        await click(part('studio-asset-dup-modules'))
        expect(parts('studio-asset-dup-array').map((array) => array.dataset.array)).toEqual(['assets', 'module:M2'])
    })
})
