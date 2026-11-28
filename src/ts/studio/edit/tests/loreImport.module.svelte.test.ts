// @vitest-environment jsdom
// T14, import part: a Studio import into a module's lorebook leaves no entry below version 2, so the module's repair
// question stays `'none'`, the repair does nothing, and the import still undoes. Real `DBState` as a `$state` object, the
// real history service and the production module slot port, as `studioModuleWrite.svelte.test.ts`; the module
// formats' collaborators are replaced.
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
    alertMd: vi.fn(),
    alertModuleSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => '0'),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
    waitAlert: vi.fn(async () => undefined),
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

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: (list: unknown[]) => list,
}) as unknown as typeof import('src/ts/characters'))

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
import { bumpModuleGui } from 'src/ts/process/moduleGuiBump'
import { lorebookRepairNeed, repairModuleLorebook } from 'src/ts/process/moduleLorebookRepair'
import { createModuleSlotPort } from 'src/ts/studio/history/studioHistoryService.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { moduleOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { loreImport } from '../loreImport'
import type { LoreIds } from '../loreListOps'

const M1 = moduleOwnerKey('M1')
type Row = Record<string, unknown>

function moduleOf(id: string, lorebook: unknown[]): RisuModule {
    return { id, name: id, description: '', assets: toAssetList([]), lorebook } as unknown as RisuModule
}

const slot = (): RisuModule => DBState.db.modules[0]
const lore = (): Row[] => slot().lorebook as unknown as Row[]
let service: OwnerHistoryService

function ids(): LoreIds {
    let n = 0
    return { newId: () => `n${++n}`, newFolderKey: () => `k${++n}` }
}

// The element shape `convertExternalLorebook` produces: no id, no bookVersion.
function ccEntry(comment: string, content: string, extra: Row = {}): Row {
    return { key: 'k', insertorder: 100, comment, content, mode: 'normal', alwaysActive: false, secondkey: '', selective: false, ...extra }
}

beforeEach(async () => {
    resetStudioScreenForTests()
    DBState.db.modules = [moduleOf('M1', [{ ...ccEntry('live', 'x'), bookVersion: 2 }]), moduleOf('M2', [])]
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

describe('T14: a Studio import into a module', () => {
    test('a CC book leaves no entry below version 2, the repair question stays none, and the import undoes after the repair ran', async () => {
        expect(lorebookRepairNeed(slot())).toBe('none')
        const before = JSON.stringify(lore())
        const book = [ccEntry('cc1', '<char> hi'), ccEntry('cc2', 'plain', { activationPercent: 25 })]
        expect(service.objEdit(M1, loreImport('module', book, ids()).build)).toEqual({ ok: true })
        expect(lore()).toHaveLength(3)
        expect(lore().every((entry) => entry.bookVersion === 2)).toBe(true)
        expect(lore()[1].content).toBe('{{char}} hi')
        expect(lore()[2]).toMatchObject({ content: '@@probability 25\nplain', activationPercent: null })
        expect(lorebookRepairNeed(slot())).toBe('none')

        const imported = JSON.stringify(lore())
        expect(await repairModuleLorebook(slot())).toEqual({ changed: false })
        expect(JSON.stringify(lore())).toBe(imported)
        expect(service.undo(M1)).toEqual({ ok: true })
        expect(JSON.stringify(lore())).toBe(before)
    })
})
