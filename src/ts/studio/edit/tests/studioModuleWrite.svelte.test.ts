// @vitest-environment jsdom
// A Studio module write replaces the module's slot the way the module loader does: the module's `assets` is an
// `AssetList` (so the list stays out of the reactive graph), the slot is assigned once, the `getModules` memo is reset
// (so a run never reads the replaced module) and module screens are told. Real `DBState` as a `$state` object, the real
// history service and setters, the real `getModules` / `refreshModules` / `bumpModuleGui` and the production port
// builder; the database accessors and the module formats' collaborators are replaced.
import { flushSync } from 'svelte'
import { get } from 'svelte/store'
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

import { ReloadGUIPointer, DBState } from 'src/ts/stores.svelte'
import { AssetList, toAssetList } from 'src/ts/storage/assetList'
import { getModules, refreshModules, type RisuModule } from 'src/ts/process/modules'
import { bumpModuleGui } from 'src/ts/process/moduleGuiBump'
import { createModuleSlotPort } from 'src/ts/studio/history/studioHistoryService.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { moduleOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
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

beforeEach(async () => {
    resetStudioScreenForTests()
    DBState.db.modules = [moduleOf('M1'), moduleOf('M2')]
    refreshModules()
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => 0,
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
        onModuleSlotReplaced: createModuleSlotPort(refreshModules, bumpModuleGui),
    })
    await service.whenReady(M1)
})

afterEach(() => {
    resetStudioScreenForTests()
})

describe('a Studio module asset write replaces the slot as the module loader does', () => {
    const writes: Record<string, () => unknown> = {
        'a delete': () => service.assetDelete(M1, 'assets', [1]),
        'an insert': () => service.assetInsert(M1, 'assets', [['fresh', 'assets/fresh.png', 'png']]),
        'a rename': () => service.assetRename(M1, 'assets', 0, 'smile2'),
    }

    for (const [name, write] of Object.entries(writes)) {
        test(`${name} leaves the module's assets an AssetList`, () => {
            expect(slot().assets).toBeInstanceOf(AssetList)
            expect(write()).toMatchObject({ ok: true })
            expect(slot().assets).toBeInstanceOf(AssetList)
        })
    }

    test('getModules after a write returns the new module and its rows, not the replaced one', () => {
        const before = getModules()
        expect(before.map((module) => module.id)).toEqual(['M1', 'M2'])
        expect(before[0].assets).toHaveLength(3)

        expect(service.assetDelete(M1, 'assets', [1])).toMatchObject({ ok: true })

        const after = getModules()
        expect(after[0]).not.toBe(before[0])
        expect(after[0]).toBe(slot())
        expect(after[0].assets).toHaveLength(2)
    })

    test('module screens are told once per write', () => {
        const before = get(ReloadGUIPointer)
        expect(service.assetRename(M1, 'assets', 0, 'smile2')).toMatchObject({ ok: true })
        expect(get(ReloadGUIPointer)).toBe(before + 1)
    })

    test('an effect reading one tuple of the written list does not re-run when that tuple is written', () => {
        expect(service.assetRename(M1, 'assets', 0, 'smile2')).toMatchObject({ ok: true })
        let runs = 0
        const stop = $effect.root(() => {
            $effect(() => {
                void slot().assets?.[0][1]
                runs += 1
            })
        })
        flushSync()
        expect(runs).toBe(1)

        const tuple = slot().assets?.[0]
        if (tuple) {
            tuple[1] = 'assets/other.png'
        }
        flushSync()
        stop()

        expect(runs).toBe(1)
    })
})
