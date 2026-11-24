// @vitest-environment jsdom
/**
 * The Studio module list page (`list:modules`) mounted through the real Studio screen over a reactive database, with the
 * real owner source, the real history service on the memory doubles and the real shared list helpers. MOCKED: the alerts
 * (they answer what each test says), the module store's acquire (it counts its calls), the import, export and conversion
 * functions, and the MCP import. A stub is minted by `moduleStubOf` from a store2 index entry, as the boot path mints it.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    alertInput: vi.fn(),
    alertConfirm: vi.fn(),
    alertSelect: vi.fn(),
    alertError: vi.fn(),
    importModule: vi.fn(),
    importMCPModule: vi.fn(),
    exportModule: vi.fn(),
    exportModuleLegacy: vi.fn(),
    refreshModules: vi.fn(),
    acquire: vi.fn(),
    release: vi.fn(),
    convert: vi.fn(),
    checkCharOrder: vi.fn(),
}))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0, getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`, checkCharOrder: h.checkCharOrder }))
vi.mock('src/ts/studio/assets/assetFileState', () => ({
    openAssetFileReader: async () => ({ concurrency: 1, stateOf: async () => 'present' }),
}))
vi.mock('src/ts/alert', () => ({ alertInput: h.alertInput, alertConfirm: h.alertConfirm, alertSelect: h.alertSelect, alertError: h.alertError }))
vi.mock('src/ts/process/mcp/mcp', () => ({ importMCPModule: h.importMCPModule }))
vi.mock('src/ts/storage/store2/moduleAcquire', () => ({ acquireModule: h.acquire }))
vi.mock('src/ts/interchangeability', () => ({ convertModuleToCharacter: h.convert }))
const loader = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('src/ts/process/moduleLoader', () => ({ loadModuleStubsOf: loader.load, loadModule: vi.fn() }))

// Filled by `beforeEach`: the fixture's own constants are not defined yet at this point.
const db = $state({ db: {} as ReturnType<typeof worldDb> })
const selection = $state({ selId: 0 })
const quickSettings = $state({ open: true })

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
vi.mock('src/ts/process/modules', () => ({
    importModule: h.importModule,
    exportModule: h.exportModule,
    exportModuleLegacy: h.exportModuleLegacy,
    refreshModules: h.refreshModules,
}))
vi.mock('src/ts/process/moduleGuiBump', () => ({ bumpModuleGui: vi.fn() }))
vi.mock('src/ts/process/moduleRefList', () => ({
    moduleRefIdsOf: () => db.db.modules.map((row: { id: string }) => row.id),
    moduleListOf: (ids: string[]) => db.db.modules.filter((row: { id: string }) => ids.includes(row.id)),
}))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    // The nested groups the page reads answer with their own key, as the flat keys do.
    const own: Record<string, unknown> = {
        settingsPage: { back: 'Back', noDescriptionProvided: 'noDescriptionProvided' },
        alerts: { risumLegacy: 'risumLegacy' },
        errors: { mcpModuleConversionUnsupported: 'mcpModuleConversionUnsupported' },
    }
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { ALERT_INPUT_CANCEL, ALERT_SELECT_CANCEL } from 'src/ts/alertCancel'
import type { RisuModule } from 'src/ts/process/modules'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { installDbWriteHook, uninstallDbWriteHook } from 'src/ts/storage/dbWriteHook'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioModuleLoadsForTests } from 'src/ts/studio/assets/moduleStubLoad.svelte'
import { resetOpenModuleIdForTests } from 'src/ts/studio/assets/openModuleForm.svelte'
import { makeCharacter, makeInput, residentModule, studioDbOf, stubModule } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, selectStudioNode, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { resetStudioHistoryAccessorForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { moduleOwnerKey } from '../../ts/studio/history/ownerPhase'
import { allRowsGeometry, setWindowGeometryForTests } from '../../ts/windowing/windowHost.svelte'
import { setSessionAssetSizeJobForTests } from './assets/StudioAssetList.svelte'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import { makeModuleRig, mountInto, part, parts, ResizeObserverStub, settle, unmountAll, type ModuleRig } from './moduleFormRig.test-helpers'
import StudioScreen from './StudioScreen.svelte'

interface World {
    enabled?: string[]
    integration?: string
}

function worldDb(modules: RisuModule[], world: World = {}) {
    const input = makeInput({
        character: makeCharacter({ chaId: 'A' }),
        modules,
        enabledModules: world.enabled ?? [],
        moduleIntergration: world.integration ?? '',
    })
    return { ...studioDbOf(input), modules: [...modules] }
}

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
let rig: ModuleRig

// The page is a plain selection of its own key, so the selection function every caller goes through is used here.
function showListPage(revealKey: string | null = null): void {
    selectStudioNode('list:modules', null, null)
    studioScreen.revealListRow = revealKey
    flushSync()
}

/** Mounts Studio and shows the module list page over `modules`. */
async function showList(modules: RisuModule[], world: World = {}): Promise<void> {
    db.db = worldDb(modules, world)
    rig = makeModuleRig()
    openStudio({ from: 'chat' }, null)
    mountInto(StudioScreen)
    await settle()
    showListPage()
    await vi.dynamicImportSettled()
    await settle()
    await settle()
    // The page is mounted for its key: a selection the detail does not know clears with the not-found notice instead.
    expect(part('studio-module-list')).not.toBeNull()
    expect(studioScreen.selectedOwnerKey).toBe('list:modules')
}

const rowParts = () => parts('studio-module-list-row')
const openButton = (row: Element) => row.querySelector<HTMLElement>('[data-part="studio-module-list-open"]')!
const switchOf = (row: Element) => row.querySelector<HTMLElement>('[data-part="studio-module-list-global"]')!
const menuButtonOf = (row: Element) => row.querySelector<HTMLElement>('[data-part="studio-module-list-menu-button"]')!
const names = () => rowParts().map((row) => openButton(row).textContent ?? '')
const status = () => part('studio-module-list-status')?.textContent ?? ''

function click(element: Element | null): void {
    ;(element as HTMLElement | null)?.click()
    flushSync()
}

/** Opens the row menu of `row` and returns the menu item with `itemPart`. */
function menuItem(row: Element, itemPart: string): HTMLButtonElement {
    click(menuButtonOf(row))
    return document.querySelector<HTMLButtonElement>(`[data-part="studio-module-list-menu"] [data-part="${itemPart}"]`)!
}

function typeInto(element: HTMLInputElement, value: string): void {
    element.value = value
    element.dispatchEvent(new InputEvent('input', { bubbles: true }))
    flushSync()
}

// Svelte's 	ick() resolves on a timer under xperimental.async, which the window host's reveal waits for.
async function realTick(): Promise<void> {
    await new Promise((done) => setTimeout(done, 30))
    await settle()
}

function deferred<T>(): { promise: Promise<T>, resolve: (value: T) => void } {
    let resolve: (value: T) => void = () => {}
    const promise = new Promise<T>((done) => { resolve = done })
    return { promise, resolve }
}

const mod = (id: string, over: Partial<RisuModule> = {}): RisuModule => residentModule(id, over)

beforeEach(() => {
    for (const fn of Object.values(h)) fn.mockReset()
    loader.load.mockReset()
    h.release.mockImplementation(() => {})
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    resetStudioModuleLoadsForTests()
    resetOpenModuleIdForTests()
    db.db = worldDb([])
    selection.selId = 0
    setStudioEnabled(true)
    setSessionAssetSizeJobForTests({ peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true } satisfies AssetSizeJob)
    setWindowGeometryForTests(allRowsGeometry())
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    installDbWriteHook(db, { selectedChaId: () => 'A' })
})

afterEach(async () => {
    await unmountAll()
    uninstallDbWriteHook()
    setSessionAssetSizeJobForTests(undefined)
    setWindowGeometryForTests(undefined)
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetOpenModuleIdForTests()
    resetBackHandlersForTests()
    resetToastHostForTests()
    setStudioEnabled(false)
    vi.unstubAllGlobals()
})

describe('T9-LIST-ROWS: the page lists every module and keeps its selection', () => {
    const mixed = (): RisuModule[] => [
        mod('A', { name: 'Alpha', description: 'first' }),
        stubModule('S1'),
        mod('MC', { name: 'Dice', description: 'MCP from internal:dice', mcp: { url: 'internal:dice' } }),
        mod('SH', { name: 'Sh One' }),
        mod('SH', { name: 'Sh Two' }),
        mod('E', { name: '', description: '' }),
        { ...mod('N'), name: 5, description: 7 } as unknown as RisuModule,
    ]

    test('rows follow db.modules order with stub, MCP, shared-id, empty and non-string names; nothing is cleared', async () => {
        await showList(mixed())
        expect(part('studio-module-list')).not.toBeNull()
        expect(part('studio-detail-title')?.textContent).toBe('studioModuleList')
        expect(rowParts()).toHaveLength(7)
        const rows = rowParts()
        expect(openButton(rows[0]).textContent).toContain('Alpha')
        expect(openButton(rows[0]).textContent).toContain('first')
        expect(openButton(rows[1]).textContent).toContain('Module S1')
        expect(openButton(rows[1]).textContent).toContain('studioNotLoaded')
        expect(openButton(rows[2]).textContent).toContain('Dice')
        expect(openButton(rows[2]).querySelector('svg[aria-hidden="true"]')).not.toBeNull()
        expect(openButton(rows[0]).querySelector('svg')).toBeNull()
        expect(openButton(rows[3]).textContent).toContain('Sh One')
        expect(openButton(rows[4]).textContent).toContain('Sh Two')
        // An empty or non-string name and description fall back to the page's own words.
        expect(openButton(rows[5]).textContent).toContain('modules')
        expect(openButton(rows[5]).textContent).toContain('noDescriptionProvided')
        expect(openButton(rows[6]).textContent).toContain('modules')
        expect(openButton(rows[6]).textContent).toContain('noDescriptionProvided')
        // The two rows of one id have distinct window keys.
        const keys = parts('studio-module-list-rows')[0].querySelectorAll('[data-window-key]')
        expect(new Set(Array.from(keys).map((key) => key.getAttribute('data-window-key'))).size).toBe(7)
        expect(studioScreen.selectedOwnerKey).toBe('list:modules')
        expect(studioScreen.notice).toBeNull()
    })

    test('the search ignores case, includes stubs, never throws on a non-string name and shows the no-result line', async () => {
        await showList(mixed())
        const search = part('studio-module-list-search') as HTMLInputElement
        typeInto(search, 'ALP')
        expect(names()).toHaveLength(1)
        expect(names()[0]).toContain('Alpha')
        typeInto(search, 'module s1')
        expect(names()).toHaveLength(1)
        expect(names()[0]).toContain('studioNotLoaded')
        typeInto(search, 'zzz')
        expect(rowParts()).toHaveLength(0)
        expect(part('studio-module-list-no-match')?.textContent).toBe('studioSearchNoResults')
        typeInto(search, '')
        await settle()
        expect(rowParts()).toHaveLength(7)
        expect(part('studio-module-list-no-match')).toBeNull()
        expect(studioScreen.selectedOwnerKey).toBe('list:modules')
        expect(studioScreen.notice).toBeNull()
    })

    test('a row keeps its DOM node across a search (keys name the module, not its position)', async () => {
        await showList(mixed())
        const diceKey = (): string => JSON.stringify(['m', 'MC', 0])
        const node = () => parts('studio-module-list-rows')[0].querySelector(`[data-window-key='${diceKey()}']`)
        const before = node()
        expect(before).not.toBeNull()
        typeInto(part('studio-module-list-search') as HTMLInputElement, 'e')
        expect(names().length).toBeLessThan(7)
        expect(node()).toBe(before)
    })

    test('with no module the empty line shows and the toolbar stays', async () => {
        await showList([])
        expect(part('studio-module-list-empty')?.textContent).toBe('noModules')
        expect(part('studio-module-list-create')).not.toBeNull()
        expect(part('studio-module-list-import')).not.toBeNull()
        expect(part('studio-module-list-import-mcp')).not.toBeNull()
    })

    test('Open selects the row\'s own owner at the 고급 kind, a later row of a shared id by its row-suffixed owner id', async () => {
        await showList(mixed())
        click(openButton(rowParts()[0]))
        expect(studioScreen.selectedOwnerKey).toBe('module:A')
        expect(studioScreen.selectedKind).toBe('advanced')
        showListPage()
        await settle()
        click(openButton(rowParts()[4]))
        expect(studioScreen.selectedOwnerKey).toBe('module:SH#4')
    })
})

describe('T9-WINDOW: a large library mounts a window of rows', () => {
    const VIEW_PX = 600
    let frames: (() => void)[] = []

    function runFrames(): void {
        const pending = frames
        frames = []
        for (const frame of pending) frame()
        flushSync()
    }

    async function settleFrames(): Promise<void> {
        await settle()
        runFrames()
        await realTick()
        runFrames()
        await settle()
    }

    // Regression reproducer: the page did not exist, so no row was mounted.
    test('with 400 modules only a window of rows is mounted, and a reveal of row 350 mounts and focuses it', async () => {
        setWindowGeometryForTests({
            rectOf: (element) => element.getAttribute('data-part') === 'studio-module-list-rows' ? { top: 0, height: 0 } : { top: 0, height: VIEW_PX },
            viewport: () => VIEW_PX,
            scrollBy: () => {},
            schedule: (callback) => {
                frames.push(callback)
                return () => { frames = frames.filter((frame) => frame !== callback) }
            },
        })
        const modules = Array.from({ length: 400 }, (_, index) => mod(`id-${index}`, { name: `m${index}` }))
        db.db = worldDb(modules)
        rig = makeModuleRig()
        openStudio({ from: 'chat' }, null)
        mountInto(StudioScreen)
        await settleFrames()
        showListPage()
        await vi.dynamicImportSettled()
        await settleFrames()
        expect(rowParts().length).toBeGreaterThan(0)
        expect(rowParts().length).toBeLessThan(60)
        expect(names().some((text) => text.includes('m350'))).toBe(false)
        studioScreen.revealListRow = JSON.stringify(['m', 'id-350', 0])
        await settleFrames()
        await settleFrames()
        const revealed = rowParts().find((row) => (openButton(row).textContent ?? '').includes('m350'))
        expect(revealed).toBeDefined()
        expect(document.activeElement).toBe(openButton(revealed!))
        expect(studioScreen.revealListRow).toBeNull()
    })
})

describe('T9-GLOBAL: the switch enables a module in all chats', () => {
    const rowIds = () => Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-row"]')).map((element) => element.dataset.rowId)

    test('the id is pushed and then spliced at its first occurrence, aria-checked follows, the owner changes group and the selection stays', async () => {
        await showList([mod('M1', { name: 'One' }), mod('M2', { name: 'Two' })], { enabled: ['X', 'M1', 'Y', 'M1'] })
        studioScreen.expanded['g:modules'] = true
        studioScreen.expanded['g:otherModules'] = true
        flushSync()
        const [one, two] = rowParts()
        expect(switchOf(one).getAttribute('role')).toBe('switch')
        expect(switchOf(one).getAttribute('aria-checked')).toBe('true')
        expect(switchOf(two).getAttribute('aria-checked')).toBe('false')
        expect(openButton(one).textContent).toContain('studioBadgeAllChats')
        expect(rowIds().indexOf('o:module:M2')).toBeGreaterThan(rowIds().indexOf('g:otherModules'))
        click(switchOf(one))
        expect(db.db.enabledModules).toEqual(['X', 'Y', 'M1'])
        click(switchOf(rowParts()[0]))
        expect(db.db.enabledModules).toEqual(['X', 'Y'])
        expect(switchOf(rowParts()[0]).getAttribute('aria-checked')).toBe('false')
        click(switchOf(rowParts()[1]))
        expect(db.db.enabledModules).toEqual(['X', 'Y', 'M2'])
        expect(rowIds().indexOf('o:module:M2')).toBeLessThan(rowIds().indexOf('g:otherModules'))
        expect(studioScreen.selectedOwnerKey).toBe('list:modules')
        expect(studioScreen.notice).toBeNull()
    })

    test('rows that share an id switch together', async () => {
        await showList([mod('SH', { name: 'First' }), mod('SH', { name: 'Second' })])
        click(switchOf(rowParts()[1]))
        expect(db.db.enabledModules).toEqual(['SH'])
        expect(switchOf(rowParts()[0]).getAttribute('aria-checked')).toBe('true')
        expect(switchOf(rowParts()[1]).getAttribute('aria-checked')).toBe('true')
    })

    test('the on-through-integration note shows for an id or a namespace listed in Module Integration, and not otherwise', async () => {
        await showList(
            [mod('IDM', { name: 'ById' }), mod('NSM', { name: 'ByNs', namespace: 'space' }), mod('OFF', { name: 'Off' }), mod('ON', { name: 'On' })],
            { integration: 'IDM, space', enabled: ['ON'] },
        )
        const [byId, byNs, off, on] = rowParts()
        for (const row of [byId, byNs]) {
            const note = document.getElementById(switchOf(row).getAttribute('aria-describedby') ?? '')
            expect(note?.textContent).toBe('moduleOnByIntegration')
            expect(note?.getAttribute('data-part')).toBe('studio-module-list-integrated')
            expect(switchOf(row).className).toContain('risu-state-amber')
            expect(switchOf(row).getAttribute('aria-checked')).toBe('false')
        }
        expect(switchOf(off).hasAttribute('aria-describedby')).toBe(false)
        expect(switchOf(off).className).not.toContain('risu-state-amber')
        expect(switchOf(on).hasAttribute('aria-describedby')).toBe(false)
        expect(switchOf(on).getAttribute('aria-checked')).toBe('true')
    })
})

describe('T9-CREATE: a module is created only after a name is given', () => {
    // Regression reproducer: the page and its create button did not exist.
    test('a name answered with spaces creates the trimmed module, selects it at 고급 with its group open and mounts the form', async () => {
        await showList([mod('M1', { name: 'One' })])
        h.alertInput.mockResolvedValue('  N  ')
        click(part('studio-module-list-create'))
        await settle()
        await settle()
        expect(h.alertInput).toHaveBeenCalledWith('studioModuleListCreatePrompt', undefined, '', { cancel: ALERT_INPUT_CANCEL })
        expect(db.db.modules).toHaveLength(2)
        const created = db.db.modules[1] as unknown as Record<string, unknown>
        expect(Object.keys(created).sort()).toEqual(['description', 'id', 'name'])
        expect(created.name).toBe('N')
        expect(created.description).toBe('')
        expect(typeof created.id).toBe('string')
        expect(studioScreen.selectedOwnerKey).toBe(`module:${created.id as string}`)
        expect(studioScreen.selectedKind).toBe('advanced')
        expect(studioScreen.expanded['g:otherModules']).toBe(true)
        expect(studioScreen.expanded[`o:module:${created.id as string}`]).toBe(true)
        expect(studioScreen.notice).toBeNull()
        await rig.service.whenReady(moduleOwnerKey(created.id as string))
        await settle()
        expect(part('studio-module-advanced-form')).not.toBeNull()
        expect(db.db.enabledModules).not.toContain(created.id)
    })

    test('cancel creates nothing and changes no selection', async () => {
        await showList([mod('M1', { name: 'One' })])
        h.alertInput.mockResolvedValue(ALERT_INPUT_CANCEL)
        click(part('studio-module-list-create'))
        await settle()
        expect(db.db.modules).toHaveLength(1)
        expect(studioScreen.selectedOwnerKey).toBe('list:modules')
        expect(status()).toBe('')
    })

    test('a blank name creates nothing, says so in the status line and changes no selection', async () => {
        await showList([mod('M1', { name: 'One' })])
        h.alertInput.mockResolvedValue('   ')
        click(part('studio-module-list-create'))
        await settle()
        expect(db.db.modules).toHaveLength(1)
        expect(studioScreen.selectedOwnerKey).toBe('list:modules')
        expect(status()).toBe('studioModuleListNameNeeded')
    })
})

describe('T9-DELETE: delete removes exactly the clicked row after a confirm', () => {
    test('the confirm names the module, and Yes removes the row with the status line saying so', async () => {
        await showList([mod('M1', { name: 'One' }), mod('M2', { name: 'Two' })], { enabled: ['M1', 'M2'] })
        h.alertConfirm.mockResolvedValue(true)
        click(menuItem(rowParts()[1], 'studio-module-list-delete'))
        await settle()
        expect(h.alertConfirm).toHaveBeenCalledWith('removeConfirmTwo')
        expect(db.db.modules.map((row) => row.id)).toEqual(['M1'])
        expect(db.db.enabledModules).toEqual(['M1'])
        expect(status()).toBe('studioModuleListDeleted(Two)')
        expect(h.refreshModules).toHaveBeenCalledTimes(1)
        expect(rowParts()).toHaveLength(1)
        expect(document.querySelector('[data-part="studio-module-list-menu"]')).toBeNull()
    })

    test('a row inserted before it, or a reorder, while the confirm is open never changes which row goes', async () => {
        await showList([mod('M1', { name: 'One' }), mod('M2', { name: 'Two' })])
        const confirm = deferred<boolean>()
        h.alertConfirm.mockReturnValue(confirm.promise)
        const target = db.db.modules[1]
        click(menuItem(rowParts()[1], 'studio-module-list-delete'))
        db.db.modules.unshift(mod('NEW', { name: 'New' }))
        db.db.modules.reverse()
        confirm.resolve(true)
        await settle()
        expect(db.db.modules.map((row) => row.id)).toEqual(['M1', 'NEW'])
        expect(db.db.modules).not.toContain(target)
    })

    test('with a second row holding the id the id stays enabled, and it leaves with the last one', async () => {
        await showList([mod('SH', { name: 'First' }), mod('SH', { name: 'Second' })], { enabled: ['SH'] })
        h.alertConfirm.mockResolvedValue(true)
        click(menuItem(rowParts()[1], 'studio-module-list-delete'))
        await settle()
        expect(db.db.modules.map((row) => row.name)).toEqual(['First'])
        expect(db.db.enabledModules).toEqual(['SH'])
        click(menuItem(rowParts()[0], 'studio-module-list-delete'))
        await settle()
        expect(db.db.modules).toHaveLength(0)
        expect(db.db.enabledModules).toEqual([])
    })

    test('No changes nothing', async () => {
        await showList([mod('M1', { name: 'One' })], { enabled: ['M1'] })
        h.alertConfirm.mockResolvedValue(false)
        click(menuItem(rowParts()[0], 'studio-module-list-delete'))
        await settle()
        expect(db.db.modules).toHaveLength(1)
        expect(db.db.enabledModules).toEqual(['M1'])
        expect(status()).toBe('')
        expect(h.refreshModules).not.toHaveBeenCalled()
    })

    test('a stub row is removed with the module store never asked for it', async () => {
        await showList([stubModule('S1'), mod('M1', { name: 'One' })])
        h.alertConfirm.mockResolvedValue(true)
        click(menuItem(rowParts()[0], 'studio-module-list-delete'))
        await settle()
        expect(db.db.modules.map((row) => row.id)).toEqual(['M1'])
        expect(h.acquire).not.toHaveBeenCalled()
        expect(status()).toBe('studioModuleListDeleted(Module S1)')
    })
})

describe('T9-EXPORT: the row menu exports through the shared helper', () => {
    test('Cancel does nothing; CharX and Legacy call their export with the module', async () => {
        await showList([mod('M1', { name: 'One' })])
        h.alertSelect.mockResolvedValue(ALERT_SELECT_CANCEL)
        click(menuItem(rowParts()[0], 'studio-module-list-export'))
        await settle()
        expect(h.exportModule).not.toHaveBeenCalled()
        expect(h.exportModuleLegacy).not.toHaveBeenCalled()
        expect(h.alertSelect).toHaveBeenCalledWith(['CharX (recommended)', 'risumLegacy'], undefined, { cancel: ALERT_SELECT_CANCEL })
        h.alertSelect.mockResolvedValue('0')
        click(menuItem(rowParts()[0], 'studio-module-list-export'))
        await settle()
        expect(h.exportModule).toHaveBeenCalledTimes(1)
        expect(h.exportModule.mock.calls[0][0]).toBe(db.db.modules[0])
        h.alertSelect.mockResolvedValue('1')
        click(menuItem(rowParts()[0], 'studio-module-list-export'))
        await settle()
        expect(h.exportModuleLegacy).toHaveBeenCalledTimes(1)
        expect(h.exportModuleLegacy.mock.calls[0][0]).toBe(db.db.modules[0])
    })

    test('a stub is acquired once and released once, also when the export throws', async () => {
        await showList([stubModule('S1')])
        const body = mod('S1', { name: 'Loaded' })
        h.acquire.mockResolvedValue({ module: body, release: h.release })
        h.alertSelect.mockResolvedValue('0')
        click(menuItem(rowParts()[0], 'studio-module-list-export'))
        await settle()
        expect(h.acquire).toHaveBeenCalledTimes(1)
        expect(h.acquire).toHaveBeenCalledWith('S1')
        expect(h.exportModule.mock.calls[0][0]).toBe(body)
        expect(h.release).toHaveBeenCalledTimes(1)
        h.exportModule.mockRejectedValue(new Error('disk full'))
        click(menuItem(rowParts()[0], 'studio-module-list-export'))
        await settle()
        expect(h.acquire).toHaveBeenCalledTimes(2)
        expect(h.release).toHaveBeenCalledTimes(2)
        expect(h.alertError).toHaveBeenCalledWith('disk full')
    })

    test('an MCP row\'s export and conversion are disabled with the note, and a click starts nothing', async () => {
        await showList([mod('MC', { name: 'Dice', mcp: { url: 'internal:dice' } })])
        const exportItem = menuItem(rowParts()[0], 'studio-module-list-export')
        expect(exportItem.disabled).toBe(true)
        expect(document.querySelector<HTMLButtonElement>('[data-part="studio-module-list-convert"]')!.disabled).toBe(true)
        expect(document.querySelector('[data-part="studio-module-list-delete"]')).not.toBeNull()
        expect(part('studio-module-list-mcp-note')?.textContent).toBe('studioModuleListMcpOnly')
        click(exportItem)
        await settle()
        expect(h.alertSelect).not.toHaveBeenCalled()
        expect(h.exportModule).not.toHaveBeenCalled()
    })

    test('a stub whose index entry says MCP is refused by the helper before anything is acquired', async () => {
        await showList([stubModule('S1')])
        ;(db.db.modules[0] as unknown as { mcp: boolean }).mcp = true
        flushSync()
        expect(menuItem(rowParts()[0], 'studio-module-list-export').disabled).toBe(true)
    })

    test('the menu closes with Escape and gives focus back to its button, and a Back press closes it first', async () => {
        await showList([mod('M1', { name: 'One' })])
        const button = menuButtonOf(rowParts()[0])
        click(button)
        expect(button.getAttribute('aria-expanded')).toBe('true')
        const menu = part('studio-module-list-menu')!
        menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        flushSync()
        await settle()
        expect(part('studio-module-list-menu')).toBeNull()
        expect(document.activeElement).toBe(button)
        click(button)
        const { dispatchBack } = await import('src/ts/backHandlers')
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(part('studio-module-list-menu')).toBeNull()
    })
})

describe('T9-CONVERT: the row menu makes a character through the shared helper', () => {
    const made = (m: RisuModule) => ({ chaId: `made-${m.id}`, name: m.name })

    test('the converted character is pushed, the order is checked once and the status line says so', async () => {
        await showList([mod('M1', { name: 'One' })])
        h.convert.mockImplementation(made)
        const before = db.db.characters.length
        click(menuItem(rowParts()[0], 'studio-module-list-convert'))
        await settle()
        expect(h.convert).toHaveBeenCalledTimes(1)
        expect(h.convert.mock.calls[0][0]).toBe(db.db.modules[0])
        expect(db.db.characters).toHaveLength(before + 1)
        expect(db.db.characters[before]).toEqual(made(db.db.modules[0]))
        expect(h.checkCharOrder).toHaveBeenCalledTimes(1)
        expect(status()).toBe('successfullyConverted')
        expect(studioScreen.selectedOwnerKey).toBe('list:modules')
    })

    test('a stub is acquired and released around the conversion', async () => {
        await showList([stubModule('S1')])
        const body = mod('S1', { name: 'Loaded' })
        h.acquire.mockResolvedValue({ module: body, release: h.release })
        h.convert.mockImplementation(made)
        click(menuItem(rowParts()[0], 'studio-module-list-convert'))
        await settle()
        expect(h.acquire).toHaveBeenCalledTimes(1)
        expect(h.convert.mock.calls[0][0]).toBe(body)
        expect(h.release).toHaveBeenCalledTimes(1)
    })

    test('a conversion that throws shows its message, pushes nothing and says nothing of success', async () => {
        await showList([mod('M1', { name: 'One' })])
        h.convert.mockImplementation(() => { throw new Error('cannot') })
        const before = db.db.characters.length
        click(menuItem(rowParts()[0], 'studio-module-list-convert'))
        await settle()
        expect(h.alertError).toHaveBeenCalledWith('cannot')
        expect(db.db.characters).toHaveLength(before)
        expect(status()).toBe('')
    })
})

describe('T9-IMPORT: the toolbar starts the existing imports', () => {
    test('Import and Import MCP each call their function once with no argument', async () => {
        await showList([])
        click(part('studio-module-list-import'))
        click(part('studio-module-list-import-mcp'))
        await settle()
        expect(h.importModule).toHaveBeenCalledTimes(1)
        expect(h.importModule).toHaveBeenCalledWith()
        expect(h.importMCPModule).toHaveBeenCalledTimes(1)
        expect(h.importMCPModule).toHaveBeenCalledWith()
    })
})

describe('T9-NAME-TEXT: server-controlled names and descriptions are text', () => {
    // Regression reproducer: the row did not exist. A markup renderer would put an img and a b element in the page.
    test('a name and a description that hold markup show as text', async () => {
        const name = '<img src=x onerror=alert(1)>'
        const description = '<b>x</b>'
        await showList([mod('MC', { name, description, mcp: { url: 'internal:dice' } })])
        const page = part('studio-module-list')!
        expect(page.querySelector('img')).toBeNull()
        expect(page.querySelector('b')).toBeNull()
        const open = openButton(rowParts()[0])
        expect(open.textContent).toContain(name)
        expect(open.textContent).toContain(description)
    })
})

describe('T9-STUB-LINK: a stub module links to its row in the list', () => {
    test('the link opens the list, scrolls its row into view and focuses its Open button', async () => {
        loader.load.mockResolvedValue({ kind: 'refused' })
        db.db = worldDb([mod('M1', { name: 'One' }), stubModule('S1')])
        rig = makeModuleRig()
        openStudio({ owner: { type: 'module', id: 'S1' }, kind: 'advanced', from: 'chat' }, null)
        mountInto(StudioScreen)
        await settle()
        await settle()
        expect(part('studio-detail-classic')).toBeNull()
        click(part('studio-module-show-in-list'))
        await vi.dynamicImportSettled()
        await realTick()
        await realTick()
        expect(studioScreen.selectedOwnerKey).toBe('list:modules')
        const row = rowParts()[1]
        expect(document.activeElement).toBe(openButton(row))
        expect(studioScreen.revealListRow).toBeNull()
    })

    test('a search that hides the row is cleared by the reveal', async () => {
        await showList([mod('M1', { name: 'One' }), mod('M2', { name: 'Two' })])
        typeInto(part('studio-module-list-search') as HTMLInputElement, 'One')
        expect(rowParts()).toHaveLength(1)
        showListPage(JSON.stringify(['m', 'M2', 0]))
        await realTick()
        await realTick()
        expect(rowParts()).toHaveLength(2)
        expect((part('studio-module-list-search') as HTMLInputElement).value).toBe('')
    })
})

describe('T9-FLUSH-EXPORT: held typing of a module is written before the list exports it', () => {
    // Regression reproducer: the route to the list did not exist.
    test('a namespace draft typed in the 고급 form is in the exported snapshot after Show in list', async () => {
        db.db = worldDb([mod('M1', { name: 'One' })])
        rig = makeModuleRig()
        openStudio({ owner: { type: 'module', id: 'M1' }, kind: 'advanced', from: 'chat' }, null)
        mountInto(StudioScreen)
        await settle()
        await rig.service.whenReady(moduleOwnerKey('M1'))
        await settle()
        typeInto(part('studio-module-namespace') as HTMLInputElement, 'draft')
        expect('namespace' in db.db.modules[0]).toBe(false)
        click(part('studio-module-show-in-list'))
        await vi.dynamicImportSettled()
        await settle()
        await settle()
        h.alertSelect.mockResolvedValue('1')
        click(menuItem(rowParts()[0], 'studio-module-list-export'))
        await settle()
        expect(h.exportModuleLegacy).toHaveBeenCalledTimes(1)
        expect((h.exportModuleLegacy.mock.calls[0][0] as RisuModule).namespace).toBe('draft')
    })
})

describe('T9-DELETE-LOADING: deleting a stub while its Studio load is pending', () => {
    // Diagnostic: the loader is a double here, so this documents the page's side only. The real loader's refusal to
    // reinstall a deleted slot is the inherited behaviour named in the spec.
    test('the page removes the row and the settling load adds nothing back and raises no notice', async () => {
        const held = deferred<{ kind: 'refused' }>()
        loader.load.mockReturnValue(held.promise)
        db.db = worldDb([stubModule('S1'), mod('M1', { name: 'One' })])
        rig = makeModuleRig()
        openStudio({ owner: { type: 'module', id: 'S1' }, kind: 'advanced', from: 'chat' }, null)
        mountInto(StudioScreen)
        await settle()
        click(part('studio-module-show-in-list'))
        await vi.dynamicImportSettled()
        await settle()
        h.alertConfirm.mockResolvedValue(true)
        click(menuItem(rowParts()[0], 'studio-module-list-delete'))
        await settle()
        held.resolve({ kind: 'refused' })
        await settle()
        await settle()
        expect(db.db.modules.map((row) => row.id)).toEqual(['M1'])
        expect(studioScreen.notice).toBeNull()
        expect(status()).toBe('studioModuleListDeleted(Module S1)')
        expect(h.acquire).not.toHaveBeenCalled()
    })
})
