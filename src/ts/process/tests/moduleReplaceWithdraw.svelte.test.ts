// @vitest-environment jsdom
/**
 * A module replaced by an import withdraws the Studio's published open-module id in the import commit's own synchronous
 * block, so no write of the replaced module's open form can land on the new content, and a Studio form that shows the
 * replaced module clears with the module-gone notice.
 *
 * The real `importModule`, `commitModule`, `applyModulePlacement`, history service, setters and Studio screen run over a
 * reactive database. The fixtures are built as their producers build them: the incoming module is a `.json` `risuModule`
 * file, the installed module is a resident row, and the duplicate question is answered Replace. MOCKED: the alert, the
 * file picker, the card importer, the asset and media collaborators, and the module loader.
 *
 * T9-WITHDRAW-ORDER and T9-GONE-REPLACE are regression reproducers (no withdraw on the previous code). T9-WITHDRAW-SCOPE
 * is a compatibility guard that passes before and after.
 */
import { File as NodeFile } from 'node:buffer'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    files: [] as File[],
    ids: 0,
    answers: [] as string[],
    errors: [] as string[],
    /** Runs inside `describeReplace`, which `commitModule` calls synchronously after the withdraw. It only records. */
    probe: null as null | (() => void),
    /** The reactive stores, filled once the file has declared them: modules that load earlier read a plain fallback. */
    stores: null as null | { db: { db: unknown }, selection: { selId: number }, quick: { open: boolean } },
}))

vi.mock('uuid', () => ({ v4: () => 'uuid' + (++h.ids) }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn((msg: string | Error) => { h.errors.push(msg instanceof Error ? msg.message : String(msg)) }),
    alertModuleSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => h.answers.shift() ?? '1'),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock('src/ts/globalApi.svelte', () => ({
    AppendableBuffer: class {},
    AssetSourceChangedError: class AssetSourceChangedError extends Error {},
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    forageStorage: {},
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
    getSaveMarkCount: () => 0,
    readImage: vi.fn(async () => undefined),
    saveAsset: vi.fn(async () => 'saved.png'),
    saveAssetFromPieces: vi.fn(async () => 'piece.png'),
}))

vi.mock('src/ts/studio/assets/assetFileState', () => ({
    openAssetFileReader: async () => ({ concurrency: 1, stateOf: async () => 'present' }),
}))

vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(() => null),
    selectFileByDom: vi.fn(async () => h.files),
    sleep: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (data: Uint8Array) => data),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterFile: vi.fn(async () => ({ kind: 'declined' })),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/bootWindow'), () => ({
    markBootWrite: vi.fn(),
}) as unknown as typeof import('src/ts/bootWindow'))

vi.mock('src/ts/process/moduleLoader', () => ({ loadModuleStubsOf: vi.fn(async () => ({ kind: 'loaded' })), loadModule: vi.fn() }))
vi.mock('src/ts/process/moduleGuiBump', () => ({ bumpModuleGui: vi.fn() }))
vi.mock('src/ts/process/moduleRefList', () => ({
    moduleRefIdsOf: () => db.db.modules.map((row: { id: string }) => row.id),
    moduleListOf: (ids: string[]) => db.db.modules.filter((row: { id: string }) => ids.includes(row.id)),
}))
vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))

// A partial mock: every export is the real one, and `describeReplace` runs the probe first.
vi.mock('src/ts/process/moduleDuplicates', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/process/moduleDuplicates')>()
    return {
        ...actual,
        describeReplace: (...args: Parameters<typeof actual.describeReplace>) => {
            h.probe?.()
            return actual.describeReplace(...args)
        },
    }
})

// Filled by `beforeEach`: the fixture's own constants are not defined yet at this point.
const db = $state({ db: {} as ReturnType<typeof fixtureDb> })
const selection = $state({ selId: 0 })
const quickSettings = $state({ open: true })
h.stores = { db, selection, quick: quickSettings }

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
        HideIconStore: { set: vi.fn() },
        moduleBackgroundEmbedding: { set: vi.fn() },
        clearCharEmotionCache: vi.fn(),
    }
    return {
        ...stores,
        get DBState() { return h.stores?.db ?? { db: {} } },
        get selIdState() { return h.stores?.selection ?? { selId: 0 } },
        get QuickSettings() { return h.stores?.quick ?? { open: true } },
    }
})

vi.mock('src/ts/storage/database.svelte', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/storage/database.svelte')>()
    return {
        ...actual,
        getCurrentCharacter: vi.fn(),
        getCurrentChat: vi.fn(),
        getDatabase: vi.fn(() => (h.stores?.db ?? { db: {} }).db),
        setCurrentCharacter: vi.fn(),
        setDatabase: vi.fn(),
    }
})

import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { language } from 'src/lang'
import { importModule as importModuleOnCard, type RisuModule } from 'src/ts/process/modules'
import { resetTaskHostForTests } from 'src/ts/alertTask.svelte'
import { answerImportCard } from 'src/ts/process/tests/answerImportCard'
import { resetStudioModuleLoadsForTests } from 'src/ts/studio/assets/moduleStubLoad.svelte'
import { openStudioModuleId, publishOpenModuleId, resetOpenModuleIdForTests } from 'src/ts/studio/assets/openModuleForm.svelte'
import { moduleOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests } from 'src/ts/studio/history/studioHistoryService.svelte'
import { ownerKeyOf } from 'src/ts/studio/ownerModel'
import { makeCharacter, makeInput, residentModule, studioDbOf } from 'src/ts/studio/studioFixtures.test-helpers'
import { openStudio, resetStudioScreenForTests, setStudioSelection, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { setSessionAssetSizeJobForTests } from 'src/lib/Studio/assets/StudioAssetList.svelte'
import type { AssetSizeJob, StoredSize } from 'src/ts/studio/assets/assetSizes'
import { makeModuleRig, mountInto, part, ResizeObserverStub, settle, unmountAll, type ModuleRig } from 'src/lib/Studio/moduleFormRig.test-helpers'
import StudioScreen from 'src/lib/Studio/StudioScreen.svelte'

function fixtureDb(modules: RisuModule[] = []) {
    const input = makeInput({ character: makeCharacter({ chaId: 'A' }), modules, enabledModules: modules.map((row) => row.id) })
    return { ...studioDbOf(input), modules: [...modules] }
}

const M1 = moduleOwnerKey('M1')
const live = (index = 0): Record<string, unknown> => db.db.modules[index] as unknown as Record<string, unknown>

/** The `.json` file a module export of the classic page produces for `name`, with a fresh id and no namespace. */
function incomingFile(name: string, description: string): File {
    return new NodeFile([JSON.stringify({ type: 'risuModule', name, id: 'in-' + name, description })], name + '.json') as unknown as File
}

async function replaceImport(file: File): Promise<void> {
    h.files = [file]
    h.answers = ['0']
    await answerImportCard(importModuleOnCard)
}

function typeInto(element: HTMLInputElement, text: string): void {
    element.value = text
    element.dispatchEvent(new InputEvent('input', { bubbles: true }))
    flushSync()
}

let rig: ModuleRig

beforeEach(() => {
    h.files = []
    h.ids = 0
    h.answers = []
    h.errors = []
    h.probe = null
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    resetStudioModuleLoadsForTests()
    resetOpenModuleIdForTests()
    resetTaskHostForTests()
    db.db = fixtureDb([
        residentModule('M1', { name: 'Mod One', description: 'about one', namespace: 'old' }),
        residentModule('M2', { name: 'Mod Two', description: 'about two' }),
    ])
    selection.selId = 0
    setStudioEnabled(true)
    setSessionAssetSizeJobForTests({ peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true } satisfies AssetSizeJob)
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rig = makeModuleRig()
})

afterEach(async () => {
    await unmountAll()
    setSessionAssetSizeJobForTests(undefined)
    resetStudioHistoryAccessorForTests()
    resetStudioScreenForTests()
    resetOpenModuleIdForTests()
    resetBackHandlersForTests()
    resetToastHostForTests()
    resetTaskHostForTests()
    setStudioEnabled(false)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('T9-WITHDRAW-ORDER: the withdraw is in the commit, before anything else can write', () => {
    test('at the end of the replace branch the replaced module is no longer published and a write to it is refused', async () => {
        publishOpenModuleId('M1')
        rig.service.useOwner(M1)
        await rig.service.whenReady(M1)

        const seen: { runs: number, published: string | null, edit: unknown, name: unknown } = { runs: 0, published: 'unset', edit: null, name: null }
        // Records only: `importModuleFile` turns every throw into a refused outcome, so an `expect` here would be swallowed.
        h.probe = () => {
            seen.runs += 1
            seen.published = openStudioModuleId()
            seen.edit = rig.service.editText(M1, 'moduleName', 'x', 'single')
            seen.name = live().name
        }

        await replaceImport(incomingFile('Mod One', 'incoming'))

        expect(seen.runs).toBe(1)
        expect(h.errors).toEqual([])
        expect(live().description).toBe('incoming')
        expect(live().id).toBe('M1')
        expect(seen.published).toBeNull()
        expect(seen.edit).toMatchObject({ ok: false, reason: 'not-selected' })
        expect(seen.name).toBe('Mod One')
    })
})

describe('T9-WITHDRAW-SCOPE: a replace of another module withdraws nothing', () => {
    test('the published module still takes writes and no notice appears', async () => {
        publishOpenModuleId('M1')
        rig.service.useOwner(M1)
        await rig.service.whenReady(M1)

        await replaceImport(incomingFile('Mod Two', 'incoming two'))

        expect(live(1).description).toBe('incoming two')
        expect(openStudioModuleId()).toBe('M1')
        expect(rig.service.editText(M1, 'moduleName', 'Renamed', 'single')).toMatchObject({ ok: true })
        expect(live().name).toBe('Renamed')
        expect(studioScreen.notice).toBeNull()
    })
})

describe('T9-GONE-REPLACE: a form open on a replaced module clears and drops what it held', () => {
    test('held namespace text never lands on the new content, the notice says the module is gone, and reselecting shows the new content', async () => {
        openStudio({ owner: { type: 'module', id: 'M1' }, kind: 'advanced', from: 'chat' }, null)
        mountInto(StudioScreen)
        await settle()
        await rig.service.whenReady(M1)
        await settle()
        expect(openStudioModuleId()).toBe('M1')
        // One landed step before the replace, so the history that must survive it is not empty.
        expect(rig.service.editText(M1, 'moduleDescription', 'typed before', 'single')).toMatchObject({ ok: true })
        flushSync()
        // A namespace draft that is typed and not committed: it flushes when the form unmounts.
        typeInto(part('studio-module-namespace') as HTMLInputElement, 'ns-draft')
        expect(live().namespace).toBe('old')
        // A name composition that is still held beside it: the same flush writes it, so it must be dropped as well.
        const nameField = part('studio-module-name') as HTMLInputElement
        nameField.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        nameField.value = 'Held 하'
        nameField.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
        flushSync()
        expect(live().name).toBe('Mod One')

        await replaceImport(incomingFile('Mod One', 'incoming'))
        await settle()

        // The leave step: unmounts the form when it is still mounted.
        setStudioSelection(ownerKeyOf('character', 'A'), null, null)
        await settle()

        expect(studioScreen.notice).toBe(language.studioRefusalModuleGone)
        expect(live()).toMatchObject({ id: 'M1', name: 'Mod One', description: 'incoming' })
        expect('namespace' in live()).toBe(false)
        expect(rig.service.view(M1).done).toHaveLength(1)
        expect(openStudioModuleId()).toBeNull()

        setStudioSelection(ownerKeyOf('module', 'M1'), 'advanced', null)
        await settle()
        await rig.service.whenReady(M1)
        await settle()
        expect(openStudioModuleId()).toBe('M1')
        expect((part('studio-module-name') as HTMLInputElement).value).toBe('Mod One')
        expect(rig.service.view(M1).done).toHaveLength(1)
    })
})
