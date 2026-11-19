/**
 * The two fork-prefixed owner fields (the asset folder document and the retained asset paths) through the archive and
 * stub machinery that carries an owner's body apart from its list slot: an archived character, and a module stub.
 *
 * Every test here is a COMPATIBILITY GUARD: it passes before the fields are written by any feature and must still pass
 * after. A guard fails when a later change makes the unit encode, the archive, the restore, the stub carry or the module
 * load drop or rename either field, or lets a stub hold a value that only the owner's body may hold.
 *
 * The character is the one the real importer (`importCharacterFile`) builds from a v3 card; both fields are then set on
 * it. The archive (`archiveCharacterNow`), the stub (`buildColdStub`), the restore (`restoreColdCharacter`) and, for the
 * full character, the unit encode and assemble (the real codec split) run for real. The module is saved by the real encoder over a real module list
 * derivation, replaced by the stub `moduleStubOf` mints, carried by the encoder's next pass, and loaded by the real
 * `loadModuleStubsOf` through a store2 boot over a memory backend.
 *
 * What is replaced: the page's byte store under the cold units, asset storage, alerts, the RPack layer and the database
 * object the importer writes to. A pass says nothing about a real backend's bytes on disk.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type Obj = Record<string, unknown>

const h = vi.hoisted(() => ({
    log: [] as string[],
    file: null as unknown as File,
    db: {
        imageCompression: false,
        formatversion: 5,
        archiveCharacters: true,
        plugins: [] as unknown[],
        pluginCustomStorage: {},
        characters: [] as Array<Record<string, unknown>>,
        modules: [] as Array<Record<string, unknown>>,
        enabledModules: [] as string[],
    } as Record<string, unknown> & { characters: Array<Record<string, unknown>>, modules: Array<Record<string, unknown>> },
    /** The page's byte store content under the cold units. */
    units: new Map<string, Uint8Array>(),
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/alert'), () => {
    const text = (msg: string | Error) => msg instanceof Error ? msg.message : String(msg)
    return {
        alertCardExport: vi.fn(),
        alertClear: vi.fn(),
        alertConfirm: vi.fn(async () => false),
        alertError: vi.fn((msg: string | Error) => { h.log.push('error:' + text(msg)) }),
        alertInput: vi.fn(async () => ''),
        alertMd: vi.fn(),
        alertModuleSelect: vi.fn(),
        alertNormal: vi.fn(),
        alertNormalWait: vi.fn(async () => { }),
        alertSelect: vi.fn(),
        alertToast: vi.fn(),
        alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
        alertWait: vi.fn(),
        waitAlert: vi.fn(async () => { }),
    } as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: h.db.characters, modules: h.db.modules, goCharacterOnImport: false })),
    setDatabaseLite: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    appVer: 'test',
    appSubVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => ({
    asBuffer: (a: unknown) => a,
    checkNullish: (v: unknown) => v === null || v === undefined,
    checkPersonaBinded: vi.fn(),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    isKnownUri: () => false,
    selectFileByDom: vi.fn(async () => [h.file]),
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
    changeFullscreen: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => { }),
    characterFormatUpdate: vi.fn((c: unknown) => c),
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    return {
        AppendableBuffer,
        AssetSourceChangedError: class extends Error { },
        BlankWriter: class { },
        LocalWriter: class { },
        VirtualWriter: class { },
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(),
        forageStorage: {},
        loadAsset: vi.fn(async () => undefined),
        openURL: vi.fn(),
        pieceStoreOrNull: vi.fn(async () => null),
        readImage: vi.fn(async () => undefined),
        saveAsset: vi.fn(async () => 'saved.png'),
        saveAssetFromPieces: vi.fn(async () => 'piece.png'),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

// The database is a plain object here: the setter lets the module loader's slot writes and the boot's installed database land in it.
vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: {
            get db() { return h.db },
            set db(value: unknown) { h.db = value as typeof h.db },
        },
        HideIconStore: { set: vi.fn() },
        ReloadGUIPointer: { set: vi.fn() },
        SettingsMenuIndex: { set: vi.fn() },
        ShowRealmFrameStore: { set: vi.fn() },
        alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
        moduleBackgroundEmbedding: { set: vi.fn() },
        selectedCharID: writable(-1),
        settingsOpen: { set: vi.fn() },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: Uint8Array) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
    encodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

// The module loader refreshes the module screens after an install; the real importer and converters stay real.
vi.mock(import('src/ts/process/modules'), async (importOriginal) => ({
    ...await importOriginal(),
    refreshModules: vi.fn(),
    bumpModuleGui: vi.fn(),
}))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        realStorage: unknown = undefined
        async getItem() { return null }
        async setItem() { }
        async keys() { return [] }
        async removeItem() { }
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { createForageBackedStore } = await import('src/ts/storage/tests/forageBackedStore')
    const store = createForageBackedStore({
        getItem: async (key) => h.units.get(key) ?? null,
        setItem: async (key, value) => { h.units.set(key, value) },
        keys: async () => Array.from(h.units.keys()),
        removeItem: async (key) => { h.units.delete(key) },
    })
    return { getAppStore: async () => store } as unknown as typeof import('src/ts/storage/store/appStore')
})

import { importCharacterFile } from 'src/ts/characterCards'
import { archiveCharacterNow } from 'src/ts/process/coldCharacterArchive'
import { restoreColdCharacter } from 'src/ts/process/coldCharacterRestore'
import { loadModuleStubsOf } from 'src/ts/process/moduleLoader'
import { noteBootArchiveSession, resetBootArchiveStateForTest } from 'src/ts/process/memory/bootArchiveState'
import { resetRetainedForTest } from 'src/ts/process/coldRetained'
import { resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { assembleDatabase, IDENTITY, moduleHandles, unitMapSource } from 'src/ts/storage/store2/codec'
import { keyOfRef } from 'src/ts/storage/store2/format'
import { createListDerivation } from 'src/ts/storage/store2/lists'
import { moduleStubOf } from 'src/ts/storage/store2/moduleStubMatch'
import { getResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import { resetStore2BootForTest } from 'src/ts/storage/store2/bootActive'
import { unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { isModuleStub } from 'src/ts/storage/moduleStub'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { asDatabase, buildSmall, encodeWith, seededEnv } from 'src/ts/storage/tests/store2/codecFixtures'
import { bootThroughDispatch, createClock, savedDatabase, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import type { Database } from 'src/ts/storage/database.svelte'
import { ASSET_FOLDER_KEY, ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'

const FOLDER_VALUE: Obj = { v: 1, additional: { order: ['Faces', 'Poses'], of: [['smile', 'Faces'], ['wave', 'Poses']] } }
const RETAINED_VALUE: string[] = ['assets/' + 'ab'.repeat(32) + '.png', 'assets/' + 'cd'.repeat(32) + '.png']

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

beforeEach(() => {
    h.log = []
    h.units.clear()
    h.db.characters.length = 0
    h.db.modules.length = 0
    resetRetainedForTest()
    resetCharacterSaveMarksForTest()
    resetBootArchiveStateForTest()
    noteBootArchiveSession(true)
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
    unregisterModuleLoader()
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageStorageModeForTests()
})

/** The character the real importer builds from a v3 card, with both owner fields set the way the feature sets them. */
async function importedCharacterWithBothFields(): Promise<Obj> {
    const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Field Holder', description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: {} } } }
    const outcome = await importCharacterFile({ name: 'card.json', data: new TextEncoder().encode(JSON.stringify(card)) })
    expect(outcome.kind).toBe('imported')
    expect(h.db.characters).toHaveLength(1)
    const character = h.db.characters[0]
    const extentions = (character.extentions ?? {}) as Obj
    Object.assign(extentions, { [ASSET_FOLDER_KEY]: clone(FOLDER_VALUE) })
    Object.assign(character, { extentions, [ASSET_RETAINED_KEY]: clone(RETAINED_VALUE) })
    return character
}

describe('an archived character keeps both owner fields in its unit', () => {
    test('guard: archive, stub, unit encode and restore return the folder document and the retained paths deep-equal, and the stub holds neither', async () => {
        const character = await importedCharacterWithBothFields()
        const chaId = character.chaId as string
        expect((character.extentions as Obj)[ASSET_FOLDER_KEY]).toStrictEqual(FOLDER_VALUE)
        expect(character[ASSET_RETAINED_KEY]).toStrictEqual(RETAINED_VALUE)
        const loaded = clone(character)

        const result = await archiveCharacterNow({ kind: 'loaded', character: character as never })

        expect(result.ok).toBe(true)
        if (result.ok === false) {
            return
        }
        const stub = h.db.characters[result.index]
        expect(stub.coldstorage).toBeTruthy()
        // The unit stays authoritative: neither value is copied onto the stub that stands for the character in the list.
        expect(stub).not.toHaveProperty(ASSET_RETAINED_KEY)
        expect(JSON.stringify(stub.extentions ?? {})).not.toContain(ASSET_FOLDER_KEY)

        // The full character the stub stands for goes through the real unit encode and assemble (the split) as a loaded one does.
        const base = buildSmall(1) as unknown as Obj
        const tree = encodeWith(asDatabase({ ...base, characters: [clone(loaded)], characterOrder: [chaId], modules: [] }), { env: seededEnv(7) })
        const assembled = assembleDatabase(tree.manifest, unitMapSource(tree.units)) as unknown as { characters: Obj[] }
        expect(assembled.characters).toHaveLength(1)
        expect((assembled.characters[0].extentions as Obj)[ASSET_FOLDER_KEY]).toStrictEqual(FOLDER_VALUE)
        expect(assembled.characters[0][ASSET_RETAINED_KEY]).toStrictEqual(RETAINED_VALUE)

        const restored = await restoreColdCharacter(stub as never)

        expect(restored.status).toBe('restored')
        const full = h.db.characters[result.index]
        expect(full.coldstorage).toBeUndefined()
        expect((full.extentions as Obj)[ASSET_FOLDER_KEY]).toStrictEqual(FOLDER_VALUE)
        expect(full[ASSET_RETAINED_KEY]).toStrictEqual(RETAINED_VALUE)
    })
})

describe('an archived character keeps the render-when-complete key in its unit', () => {
    test('guard: archive, unit encode and restore return the key, and the stub that stands for the character holds none', async () => {
        const key = 'risutanium_render_when_complete'
        const character = await importedCharacterWithBothFields()
        character[key] = true
        const chaId = character.chaId as string
        const loaded = clone(character)

        const result = await archiveCharacterNow({ kind: 'loaded', character: character as never })

        expect(result.ok).toBe(true)
        if (result.ok === false) {
            return
        }
        const stub = h.db.characters[result.index]
        expect(stub).not.toHaveProperty(key)

        const base = buildSmall(1) as unknown as Obj
        const tree = encodeWith(asDatabase({ ...base, characters: [clone(loaded)], characterOrder: [chaId], modules: [] }), { env: seededEnv(7) })
        const assembled = assembleDatabase(tree.manifest, unitMapSource(tree.units)) as unknown as { characters: Obj[] }
        expect(assembled.characters[0][key]).toBe(true)

        const restored = await restoreColdCharacter(stub as never)

        expect(restored.status).toBe('restored')
        expect(h.db.characters[result.index][key]).toBe(true)
    })
})

function moduleBody(id: string, extra: Obj = {}): Obj {
    return {
        id, name: `Module ${id}`, description: `about ${id}`, regex: [], trigger: [], assets: [],
        lorebook: [{ comment: 'c', content: `text of ${id}`, key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal', bookVersion: 2 }],
        ...extra,
    }
}

describe('a module stub keeps both owner fields in the stored module unit', () => {
    test('guard: a stub carried by the next pass leaves the stored module with both fields, the stub and its index entry hold neither, and the loader installs both', async () => {
        const lists = createListDerivation()
        const bodies = [moduleBody('id-a'), moduleBody('id-b', { [ASSET_FOLDER_KEY]: clone(FOLDER_VALUE), [ASSET_RETAINED_KEY]: clone(RETAINED_VALUE) }), moduleBody('id-c')]
        const memory = createMemoryBackend()
        const source = { ...(buildSmall(2) as unknown as Obj), archiveCharacters: false, modules: clone(bodies) } as unknown as Database
        await seedTree(memory, clone(source), testEnv(createClock(), 4242), lists)
        expect(((await savedDatabase(memory)).modules as unknown as Obj[])[1]).toStrictEqual(bodies[1])

        const booted = await bootThroughDispatch(memory, { lists })
        if (booted.result.kind !== 'store2') {
            throw new Error(`The boot answered ${booted.result.kind}.`)
        }
        const context = getActiveStore2Save()
        const residency = getResidency()
        const index = context?.encoder?.acknowledged().objects?.moduleIndex
        const committer = context?.session.committer
        if (context?.encoder === undefined || residency === null || index === undefined || !committer) {
            throw new Error('The boot registered no residency or no encoder.')
        }
        const handle = moduleHandles(index.entries)[1]
        const entry = residency.moduleEntryOf(handle)
        if (entry === null) {
            throw new Error('No entry for the module.')
        }
        // As a boot leaves a stubbed module: its three units carry no digest until a load hydrates them.
        for (const prefix of [IDENTITY.module, IDENTITY.alModule, IDENTITY.ilModule]) {
            const unit = context.encoder.acknowledged().units.get(`${prefix}${handle}`)
            if (unit !== undefined) {
                delete unit.digest
            }
        }
        const database = booted.result.database as unknown as { modules: Obj[], enabledModules: string[] }
        database.enabledModules = []
        const stub = moduleStubOf(entry) as Obj
        database.modules[1] = stub
        h.db = database as unknown as typeof h.db

        // The stub holds neither field, and neither does the index entry it is minted from.
        expect(isModuleStub(stub)).toBe(true)
        for (const holder of [stub, entry]) {
            expect(holder).not.toHaveProperty(ASSET_FOLDER_KEY)
            expect(holder).not.toHaveProperty(ASSET_RETAINED_KEY)
            expect(JSON.stringify(holder)).not.toContain(ASSET_FOLDER_KEY)
            expect(JSON.stringify(holder)).not.toContain(ASSET_RETAINED_KEY)
        }

        // Saved again as a stub: the encoder carries the entry and writes no module unit for it.
        const unitsBefore = new Set(memory.snapshot().keys())
        const plan = await context.encoder.plan(database as unknown as Database, { marked: new Set(), modules: true, whole: false })
        const commit = await committer.commit(await committer.readCommit(), plan.commitRequest())
        expect(commit.status).toBe('committed')
        plan.acknowledge()
        const moduleUnitKey = keyOfRef(entry.unit)
        expect(unitsBefore.has(moduleUnitKey)).toBe(true)
        expect(((await savedDatabase(memory)).modules as unknown as Obj[])[1]).toStrictEqual(bodies[1])
        expect(database.modules[1]).toBe(stub)

        // Loaded: the loader installs the stored body, which holds both fields.
        const loaded = await loadModuleStubsOf('id-b')

        expect(loaded.kind).toBe('loaded')
        const installed = (h.db.modules as Obj[])[1]
        expect(isModuleStub(installed)).toBe(false)
        expect(installed[ASSET_FOLDER_KEY]).toStrictEqual(FOLDER_VALUE)
        expect(installed[ASSET_RETAINED_KEY]).toStrictEqual(RETAINED_VALUE)
    })
})
