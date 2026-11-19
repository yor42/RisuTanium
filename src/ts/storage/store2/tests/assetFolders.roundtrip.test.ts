/**
 * The asset-folder values of a character (under `extentions`) and of a module (at its top level) through
 * the store2 codec: the unit encode and the assemble that reads the units back.
 *
 * Every test here is a COMPATIBILITY GUARD: it passes before the folder feature and must still pass after it. The
 * character is the one the real importer (`importCharacterFile`) builds from a v3 card; the module is the one the real
 * `importModule` commits to the database list (`commitModule`). Both are encoded by the real codec and assembled back,
 * and the values must be deep-equal, including a value of an unknown version, which no codec step may rewrite or drop.
 *
 * What is replaced: the database object the importers write to, asset storage, alerts and the RPack layer. The codec,
 * the importers and the module commit run for real. A pass says nothing about a real backend's bytes on disk.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    log: [] as string[],
    file: null as unknown as File,
    db: { imageCompression: false, characters: [] as Array<Record<string, unknown>>, modules: [] as Array<Record<string, unknown>> },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
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
        alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
        alertWait: vi.fn(),
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
    appVer: 'test',
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
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => { }),
    characterFormatUpdate: vi.fn((c: unknown) => c),
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

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return h.db } },
    HideIconStore: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    selectedCharID: { set: vi.fn() },
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

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

import { importCharacterFile } from 'src/ts/characterCards'
import { importModule } from 'src/ts/process/modules'
import { resetTaskHostForTests } from 'src/ts/alertTask.svelte'
import { answerImportCard } from 'src/ts/process/tests/answerImportCard'
import { assembleDatabase, unitMapSource } from 'src/ts/storage/store2/codec'
import { asDatabase, buildSmall, encodeWith, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'
import { ASSET_FOLDER_KEY } from 'src/ts/studio/assets/assetOwnerKeys'

type FolderValue = Record<string, unknown>

const V1_VALUE: FolderValue = { v: 1, additional: { order: ['Faces', 'Poses'], of: [['smile', 'Faces'], ['wave', 'Poses']] } }
const UNKNOWN_VALUE: FolderValue = { v: 9, x: 1 }

/** The character the real importer builds from a v3 card whose extensions hold the key at the top level (or no key). */
async function importedCharacter(value: FolderValue | null): Promise<Obj> {
    h.db.characters.length = 0
    const extensions: Obj = { risuai: {} }
    if (value !== null) {
        extensions[ASSET_FOLDER_KEY] = structuredClone(value)
    }
    const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Folder Holder', description: 'd', first_mes: 'hi', character_version: '1', extensions } }
    const outcome = await importCharacterFile({ name: 'card.json', data: new TextEncoder().encode(JSON.stringify(card)) })
    expect(outcome.kind).toBe('imported')
    expect(h.db.characters).toHaveLength(1)
    return h.db.characters[0]
}

/** The module the real `importModule` commits to the list from a picked `.json` file of the Realm payload shape. */
async function committedModule(value: FolderValue | null): Promise<Obj> {
    h.db.modules.length = 0
    const payload: Obj = { type: 'risuModule', name: 'Folder Module', description: 'folders', id: 'module-1', lorebook: [] }
    if (value !== null) {
        payload[ASSET_FOLDER_KEY] = structuredClone(value)
    }
    h.file = new File([JSON.stringify(payload)], 'folders.json')
    const card = await answerImportCard(importModule)
    expect(card?.failure).toBeUndefined()
    expect(h.log).toEqual([])
    expect(h.db.modules).toHaveLength(1)
    return h.db.modules[0]
}

/** One encode and assemble over a small profile whose character and module are the importers' own. */
function storedAndRead(character: Obj, module: Obj): { character: Obj, module: Obj } {
    const base = buildSmall(1) as unknown as Obj
    const db = asDatabase({ ...base, characters: [character], characterOrder: [character.chaId], modules: [module] })
    const tree = encodeWith(db, { env: seededEnv(7) })
    const assembled = assembleDatabase(tree.manifest, unitMapSource(tree.units)) as unknown as { characters: Obj[], modules: Obj[] }
    expect(assembled.characters).toHaveLength(1)
    expect(assembled.modules).toHaveLength(1)
    return { character: assembled.characters[0], module: assembled.modules[0] }
}

beforeEach(() => {
    h.log = []
    h.db.characters.length = 0
    h.db.modules.length = 0
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    resetTaskHostForTests()
    vi.restoreAllMocks()
})

describe('asset-folder values through the store2 unit encode and assemble', () => {
    test.each([
        ['a v1 value', V1_VALUE],
        ['a value of an unknown version', UNKNOWN_VALUE],
    ])('guard: %s on an imported character and on a committed module reads back deep-equal', async (_label, value) => {
        const character = await importedCharacter(value)
        const module = await committedModule(value)
        expect((character.extentions as Obj)[ASSET_FOLDER_KEY]).toStrictEqual(value)
        expect(module[ASSET_FOLDER_KEY]).toStrictEqual(value)

        const back = storedAndRead(character, module)

        // Equal as values: the codec writes canonical JSON, so the order of an object's keys is not kept.
        expect((back.character.extentions as Obj)[ASSET_FOLDER_KEY]).toStrictEqual(value)
        expect(back.module[ASSET_FOLDER_KEY]).toStrictEqual(value)
    })

    test('guard: the key stays at the top level of the character extentions, not under risuai', async () => {
        const character = await importedCharacter(V1_VALUE)
        const module = await committedModule(null)

        const back = storedAndRead(character, module)

        expect(Object.keys(back.character.extentions as Obj)).toStrictEqual([ASSET_FOLDER_KEY])
    })

    test('guard: a character and a module without a value read back without one', async () => {
        const character = await importedCharacter(null)
        const module = await committedModule(null)

        const back = storedAndRead(character, module)

        expect(back.character.extentions as Obj).not.toHaveProperty(ASSET_FOLDER_KEY)
        expect(back.module).not.toHaveProperty('assetFolders')
        expect(back.module).not.toHaveProperty(ASSET_FOLDER_KEY)

        // With a value present the unprefixed name is still never written, and the prefixed key holds the value.
        const withValue = storedAndRead(character, await committedModule(V1_VALUE))
        expect(withValue.module).not.toHaveProperty('assetFolders')
        expect(withValue.module[ASSET_FOLDER_KEY]).toStrictEqual(V1_VALUE)
    })
})
