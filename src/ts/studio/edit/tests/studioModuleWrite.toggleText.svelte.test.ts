// @vitest-environment jsdom
// A module's `customModuleToggle` text write through the production path: the real `DBState` as a `$state` object with
// the real database change effects (so the `modules` dirty mark is the one a save pass reads), the real history service
// and setters, and the real `getModules` / `refreshModules` / `bumpModuleGui` behind the production slot port. The write
// must set the `modules` mark, reset the `getModules` memo and tell module screens, and must touch no character.
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
        selectedCharID: writable(-1),
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
import { registerDbChangeEffects } from 'src/ts/storage/dbChangeEffects.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { getModules, refreshModules, type RisuModule } from 'src/ts/process/modules'
import { bumpModuleGui } from 'src/ts/process/moduleGuiBump'
import { createModuleSlotPort } from 'src/ts/studio/history/studioHistoryService.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { moduleOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { createModuleLiveReader } from '../studioSetters'

const M1 = moduleOwnerKey('M1')

function moduleOf(id: string, over: Partial<RisuModule> = {}): RisuModule {
    return { id, name: id, description: '', ...over } as RisuModule
}

const slot = (index = 0): RisuModule => DBState.db.modules[index]

let service: OwnerHistoryService
let tracker: toSaveType
let stopEffects: (() => void) | undefined

function installTracker(): toSaveType {
    const installed: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    stopEffects = $effect.root(() => {
        registerDbChangeEffects({ tracker: installed, markChanged: vi.fn() })
    })
    flushSync()
    installed.modules = false
    installed.character.length = 0
    return installed
}

beforeEach(async () => {
    resetStudioScreenForTests()
    DBState.db.modules = [moduleOf('M1', { customModuleToggle: 'a=A' }), moduleOf('M2', { customModuleToggle: 'm2=2' })]
    DBState.db.characters = [{ chaId: 'c1', name: 'c1', desc: 'resident desc', customModuleToggle: 'c=C' }] as unknown as typeof DBState.db.characters
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
    tracker = installTracker()
})

afterEach(() => {
    stopEffects?.()
    stopEffects = undefined
    resetStudioScreenForTests()
})

describe('C1: the module write sets the modules dirty mark and only that', () => {
    test('a text write, its undo and its redo each set the modules mark and no character mark', () => {
        expect(tracker.modules).toBe(false)
        const characters = JSON.stringify(DBState.db.characters)
        expect(characters).toContain('c=C')
        expect(service.editText(M1, 'customModuleToggle', 'a=B', 'single')).toEqual({ ok: true })
        flushSync()
        expect(tracker.modules).toBe(true)
        expect(tracker.character).toEqual([])
        expect(JSON.stringify(DBState.db.characters)).toBe(characters)
        expect(slot().customModuleToggle).toBe('a=B')

        tracker.modules = false
        expect(service.undo(M1)).toMatchObject({ ok: true })
        flushSync()
        expect(tracker.modules).toBe(true)
        expect(tracker.character).toEqual([])
        expect(JSON.stringify(DBState.db.characters)).toBe(characters)
        expect(slot().customModuleToggle).toBe('a=A')

        tracker.modules = false
        expect(service.redo(M1)).toMatchObject({ ok: true })
        flushSync()
        expect(tracker.modules).toBe(true)
        expect(tracker.character).toEqual([])
        expect(JSON.stringify(DBState.db.characters)).toBe(characters)
    })

    test('an unchanged text and a refused intent set no mark', () => {
        expect(service.editText(M1, 'customModuleToggle', 'a=A', 'single')).toEqual({ ok: true, unchanged: true })
        expect(service.editText(M1, 'desc', 'x', 'single')).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editField(M1, 'desc', 'x')).toEqual({ ok: false, reason: 'precondition' })
        flushSync()
        expect(tracker.modules).toBe(false)
    })
})

describe('C5: a chat run and module screens see the new definition', () => {
    test('getModules after the write returns the new slot with the new text, and the screens are told once', () => {
        const before = getModules()
        expect(before[0].customModuleToggle).toBe('a=A')
        const pointer = get(ReloadGUIPointer)

        expect(service.editText(M1, 'customModuleToggle', 'a=B', 'single')).toEqual({ ok: true })

        const after = getModules()
        expect(after[0]).not.toBe(before[0])
        expect(after[0]).toBe(slot())
        expect(after[0].customModuleToggle).toBe('a=B')
        expect(get(ReloadGUIPointer)).toBe(pointer + 1)
    })
})

describe('C8: the module reader reports the toggle and no other field', () => {
    test('a string toggle is present, an absent or non-string toggle is not', () => {
        expect(createModuleLiveReader(moduleOf('M1', { customModuleToggle: 'a=A' })).field('customModuleToggle')).toEqual({ had: true, value: 'a=A' })
        expect(createModuleLiveReader(moduleOf('M1')).field('customModuleToggle')).toEqual({ had: false })
        const odd = { ...moduleOf('M1'), customModuleToggle: 3 } as unknown as RisuModule
        expect(createModuleLiveReader(odd).field('customModuleToggle')).toEqual({ had: false })
    })

    test('desc, note, first messages and the boolean field read as absent even when the module carries such keys', () => {
        const carrying = { ...moduleOf('M1'), desc: 'd', note: 'n', firstMessage: 'f', exampleMessage: 'e', hideChatIcon: true, description: 'text' } as unknown as RisuModule
        const reader = createModuleLiveReader(carrying)
        for (const path of ['desc', 'note', 'firstMessage', 'exampleMessage', 'hideChatIcon'] as const) {
            expect(reader.field(path), path).toEqual({ had: false })
        }
    })
})
