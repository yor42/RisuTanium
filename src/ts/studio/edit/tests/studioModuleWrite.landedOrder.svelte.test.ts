// @vitest-environment jsdom
// A Studio module write notifies the module slot port only after the history save is armed, and the port runs outside
// the live write: a port that throws leaves the landed step on top with its save running, and the module's rows are
// already replaced. Real `DBState` as a `$state` object, the real history service and setters, the real `getModules` /
// `refreshModules`; the database accessors and the module formats' collaborators are replaced. The mock block repeats
// studioModuleWrite.svelte.test.ts because `vi.mock` factories are hoisted per file.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('uuid', () => ({ v4: () => 'uuid' }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => false),
    alertError: vi.fn(),
    alertModuleSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => '0'),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    AssetSourceChangedError: class AssetSourceChangedError extends Error {},
    saveAssetFromPieces: vi.fn(async () => 'piece.png'),
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    forageStorage: {},
    getSaveMarkCount: () => 0,
    readImage: vi.fn(async () => undefined),
    saveAsset: vi.fn(async () => 'saved.png'),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(),
    selectFileByDom: vi.fn(async () => []),
    sleep: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
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

vi.mock(import('src/ts/process/moduleLoader'), () => ({
    loadModuleStubsOf: vi.fn(async () => ({ kind: 'loaded' })),
}) as unknown as typeof import('src/ts/process/moduleLoader'))

// The database object is genuinely reactive: an effect that reads it re-runs on a write.
vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: { characters: [], modules: [] } as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        HideIconStore: { set: vi.fn() },
        moduleBackgroundEmbedding: { set: vi.fn() },
        ReloadGUIPointer: writable(0),
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    return {
        getCurrentCharacter: vi.fn(),
        getCurrentChat: vi.fn(),
        getDatabase: vi.fn(() => DBState.db),
        setCurrentCharacter: vi.fn(),
        setDatabase: vi.fn(),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

// A run reads every resident module; the real reference rules are not the subject here.
vi.mock(import('src/ts/process/moduleRefList'), async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    const rows = () => DBState.db.modules as unknown as { id: string }[]
    return {
        moduleRefIdsOf: () => rows().map((module) => module.id),
        moduleListOf: (ids: string[]) => rows().filter((module) => ids.includes(module.id)),
        hasModuleStubs: () => false,
        unloadedModulesOf: () => [],
        moduleLoadFailedText: (names: string[]) => names.join(', '),
    } as unknown as typeof import('src/ts/process/moduleRefList')
})

import { DBState } from 'src/ts/stores.svelte'
import { toAssetList } from 'src/ts/storage/assetList'
import { refreshModules, type RisuModule } from 'src/ts/process/modules'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { moduleOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock, drainMicrotasks } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type MemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'

const M1 = moduleOwnerKey('M1')

function moduleOf(id: string): RisuModule {
    return {
        id,
        name: id,
        description: '',
        assets: toAssetList([['smile', 'assets/smile.png', 'png'], ['grin', 'assets/grin.png', 'png'], ['wave', 'assets/wave.png', 'png']]),
    } as RisuModule
}

const slot = (index = 0): RisuModule => DBState.db.modules[index]

let service: OwnerHistoryService
let store: MemoryStudioStore
// The calls of the module slot port, and how many steps the owner showed in each; the port throws while `portThrows`
// is set.
let portCalls: number
let stepsWhenTold: number[]
let portThrows: boolean

beforeEach(async () => {
    resetStudioScreenForTests()
    DBState.db.modules = [moduleOf('M1'), moduleOf('M2')]
    refreshModules()
    store = createMemoryStudioStore()
    portCalls = 0
    stepsWhenTold = []
    portThrows = false
    service = createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => 0,
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
        onModuleSlotReplaced: () => {
            portCalls += 1
            stepsWhenTold.push(service.view(M1).done.length)
            if (portThrows) {
                throw new Error('port')
            }
        },
    })
    await service.whenReady(M1)
    await drainMicrotasks()
})

afterEach(() => {
    resetStudioScreenForTests()
})

describe('the module slot port runs after the history save is armed', () => {
    test('a port that throws after a landed module delete leaves the step on top and its save running', async () => {
        const saved = store.counts.save
        portThrows = true

        expect(() => service.assetDelete(M1, 'assets', [1])).toThrow('port')

        expect(portCalls).toBe(1)
        expect(slot().assets).toHaveLength(2)
        expect(service.view(M1).done).toHaveLength(1)
        await drainMicrotasks()
        expect(store.counts.save).toBe(saved + 1)
    })

    test('the port is told once per landed module write, and the step is already on top when it runs', () => {
        const result = service.assetRename(M1, 'assets', 0, 'smile2')

        expect(result).toMatchObject({ ok: true })
        expect(portCalls).toBe(1)
        expect(stepsWhenTold).toEqual([1])
    })
})
