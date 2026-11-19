/**
 * The asset folder value of a module through the module file formats: `.risum` (the real `exportModuleLegacy` writing
 * the bytes a CharX `module.risum` holds, then the real `importModule` reading a picked file) and `.json` (the Realm
 * payload of `realmModuleJson`, then the real `importModule`).
 *
 * Every test here is a COMPATIBILITY GUARD: it passes before the folder feature and must still pass after it. A module
 * without the field reads as a module without folders (upstream to fork always works), and a value of an unknown version
 * comes back as it went in.
 *
 * What runs for real: `exportModuleLegacy`, `snapshotModuleForRisum`, the `.risum` stream writer and scanner,
 * `readModule`, `importModule`, `commitModule` and `realmModuleJson`. What is replaced: the database list, asset storage,
 * alerts, the RPack layer (the identity, so the container layout is real and the permutation is not) and the card
 * importer, which a `.risum` or `.json` import never reaches.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    log: [] as string[],
    modules: [] as unknown[],
    file: null as unknown as File,
}))

vi.mock('uuid', () => ({ v4: () => 'uuid' }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/alert'), () => {
    const text = (msg: string | Error) => msg instanceof Error ? msg.message : String(msg)
    return {
        alertClear: vi.fn(),
        alertConfirm: vi.fn(async () => false),
        alertError: vi.fn((msg: string | Error) => { h.log.push('error:' + text(msg)) }),
        alertModuleSelect: vi.fn(),
        alertNormal: vi.fn((msg: string) => { h.log.push('normal:' + msg) }),
        alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
        alertWait: vi.fn(),
    } as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => ({ modules: h.modules })),
    setCurrentCharacter: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {
        parts: Uint8Array[] = []
        append(b: Uint8Array) { this.parts.push(b) }
        get buffer() { return Buffer.concat(this.parts) }
    },
    AssetSourceChangedError: class AssetSourceChangedError extends Error {},
    saveAssetFromPieces: vi.fn(async () => 'piece.png'),
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    forageStorage: {},
    readImage: vi.fn(async () => undefined),
    saveAsset: vi.fn(async () => 'saved.png'),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(),
    selectFileByDom: vi.fn(async () => [h.file]),
    sleep: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: Uint8Array) => d),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
    encodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { modules: h.modules } } },
    HideIconStore: { set: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterFile: vi.fn(async () => ({ kind: 'declined' })),
}) as unknown as typeof import('src/ts/characterCards'))

import { exportModuleLegacy, importModule, type RisuModule } from 'src/ts/process/modules'
import { realmModuleJson } from 'src/ts/process/moduleUse'
import { resetTaskHostForTests } from 'src/ts/alertTask.svelte'
import { answerImportCard } from 'src/ts/process/tests/answerImportCard'
import { ASSET_FOLDER_KEY } from 'src/ts/studio/assets/assetOwnerKeys'

type FolderValue = Record<string, unknown>

const V1_VALUE: FolderValue = { v: 1, additional: { order: ['Faces', 'Poses'], of: [['smile', 'Faces'], ['wave', 'Poses']] } }
const UNKNOWN_VALUE: FolderValue = { v: 9, x: 1 }

function moduleWith(folders: FolderValue | null): RisuModule {
    const module: RisuModule = { name: 'Folder Module', description: 'folders', id: 'module-1', lorebook: [] }
    if (folders !== null) {
        module[ASSET_FOLDER_KEY] = structuredClone(folders)
    }
    return module
}

/** The bytes the real `.risum` writer produces for a module (the form a CharX `module.risum` holds). */
async function risumBytesOf(module: RisuModule): Promise<Uint8Array<ArrayBuffer>> {
    const buffer = await exportModuleLegacy(module, { alertEnd: false, saveData: false })
    if (buffer === null) {
        throw new Error('The export refused a module with no assets.')
    }
    return Uint8Array.from(buffer)
}

/** Runs the real import of one picked file and returns the module list it left. */
async function importPicked(bytes: Uint8Array<ArrayBuffer>, name: string): Promise<RisuModule[]> {
    h.modules = []
    h.file = new File([bytes], name)
    const card = await answerImportCard(importModule)
    expect(card?.failure).toBeUndefined()
    expect(h.log).toEqual([])
    return h.modules as RisuModule[]
}

beforeEach(() => {
    h.log = []
    h.modules = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    resetTaskHostForTests()
    vi.restoreAllMocks()
})

describe('.risum', () => {
    test.each([
        ['a v1 value', V1_VALUE],
        ['a value of an unknown version', UNKNOWN_VALUE],
    ])('guard: %s comes back from the real writer and importer as it went in', async (_label, value) => {
        const bytes = await risumBytesOf(moduleWith(value))

        const imported = await importPicked(bytes, 'folders.risum')

        expect(imported).toHaveLength(1)
        expect(imported[0][ASSET_FOLDER_KEY]).toStrictEqual(value)
        expect(JSON.stringify(imported[0][ASSET_FOLDER_KEY])).toBe(JSON.stringify(value))
    })

    test('guard: a module without the field reads as a module without folders', async () => {
        const bytes = await risumBytesOf(moduleWith(null))

        const imported = await importPicked(bytes, 'folders.risum')

        expect(imported).toHaveLength(1)
        expect(imported[0]).not.toHaveProperty('assetFolders')
        expect(imported[0]).not.toHaveProperty(ASSET_FOLDER_KEY)

        // With a value present the unprefixed name is still never written, and the prefixed key holds the value.
        const [withValue] = await importPicked(await risumBytesOf(moduleWith(V1_VALUE)), 'folders.risum')
        expect(withValue).not.toHaveProperty('assetFolders')
        expect(withValue[ASSET_FOLDER_KEY]).toStrictEqual(V1_VALUE)
    })

    test('guard: the export keeps the field on the module the caller passed', async () => {
        const module = moduleWith(V1_VALUE)

        await risumBytesOf(module)

        expect(module[ASSET_FOLDER_KEY]).toStrictEqual(V1_VALUE)
    })
})

describe('.json', () => {
    async function jsonBytesOf(module: RisuModule): Promise<Uint8Array<ArrayBuffer>> {
        h.modules = [module]
        const payload = await realmModuleJson(0)
        if (payload === null) {
            throw new Error('The Realm payload of a loaded module is null.')
        }
        return new TextEncoder().encode(payload.json) as Uint8Array<ArrayBuffer>
    }

    test.each([
        ['a v1 value', V1_VALUE],
        ['a value of an unknown version', UNKNOWN_VALUE],
    ])('guard: %s comes back from the real exporter and importer as it went in', async (_label, value) => {
        const bytes = await jsonBytesOf(moduleWith(value))

        const imported = await importPicked(bytes, 'folders.json')

        expect(imported).toHaveLength(1)
        expect(imported[0][ASSET_FOLDER_KEY]).toStrictEqual(value)
        expect(JSON.stringify(imported[0][ASSET_FOLDER_KEY])).toBe(JSON.stringify(value))
    })

    test('guard: a module without the field reads as a module without folders', async () => {
        const bytes = await jsonBytesOf(moduleWith(null))

        const imported = await importPicked(bytes, 'folders.json')

        expect(imported).toHaveLength(1)
        expect(imported[0]).not.toHaveProperty('assetFolders')
        expect(imported[0]).not.toHaveProperty(ASSET_FOLDER_KEY)

        // With a value present the unprefixed name is still never written, and the prefixed key holds the value.
        const [withValue] = await importPicked(await jsonBytesOf(moduleWith(V1_VALUE)), 'folders.json')
        expect(withValue).not.toHaveProperty('assetFolders')
        expect(withValue[ASSET_FOLDER_KEY]).toStrictEqual(V1_VALUE)
    })
})
