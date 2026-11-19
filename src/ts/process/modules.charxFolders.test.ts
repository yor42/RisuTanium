/**
 * A module's asset folder document through a real CharX export and a real CharX import.
 *
 * The exports run for real (`exportModule`, `exportCharacterCard`, `CharXWriter`) and the import runs for real
 * (`importModule`, `importCharacterFile`, `CharXImporter`); the asset store, the file writer, the alerts, the database
 * and the lossy codec are replaced, as in `charxFraming.test.ts`. A mocked writer is not evidence of native file behaviour.
 *
 * Labels: (R) regression reproducer, fails on a converter without the carry rule; (G) compatibility guard, passes before
 * and after; (F) feature guard.
 */
import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
    process.env.TZ = 'Asia/Seoul'
    return {
        chunks: [] as Uint8Array[],
        errors: [] as string[],
        assets: new Map<string, Uint8Array>(),
        saved: new Map<string, Uint8Array>(),
        modules: [] as unknown[],
        picked: [] as File[],
        db: { imageCompression: false } as Record<string, unknown>,
    }
})

vi.mock('uuid', () => ({
    v4: () => 'uuid-1',
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: true,
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
        alertConfirm: vi.fn(async () => true),
        alertError: vi.fn((msg: string | Error) => { h.errors.push(text(msg)) }),
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
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: [], goCharacterOnImport: false, modules: h.modules })),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => {
    class Semaphore {
        private available: number
        private waiting: Array<() => void> = []
        constructor(max: number) { this.available = max }
        async acquire() {
            if (this.available > 0) {
                this.available -= 1
                return
            }
            await new Promise<void>(resolve => this.waiting.push(resolve))
        }
        release() {
            const next = this.waiting.shift()
            if (next) {
                next()
                return
            }
            this.available += 1
        }
    }
    return {
        Semaphore,
        asBuffer: (a: unknown) => a,
        checkNullish: (v: unknown) => v === null || v === undefined,
        checkPersonaBinded: vi.fn(),
        decryptBuffer: vi.fn(async (d: unknown) => d),
        isKnownUri: (uri: string) => uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('ccdefault:') || uri.startsWith('embeded://'),
        selectFileByDom: vi.fn(async () => h.picked),
        selectSingleFile: vi.fn(),
        sleep: vi.fn(async () => { }),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => { }),
    characterFormatUpdate: vi.fn((c: unknown) => c),
    createBlankChar: vi.fn(() => ({
        name: '',
        firstMessage: '',
        desc: '',
        emotionImages: [],
        bias: [],
        viewScreen: 'none',
        globalLore: [],
        utilityBot: false,
        customscript: [],
        exampleMessage: '',
        creatorNotes: '',
        systemPrompt: '',
        alternateGreetings: [],
        tags: [],
    })),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    class LocalWriter {
        async init() { return true }
        async write(data: Uint8Array) { h.chunks.push(data.slice()) }
        async close() { }
        useCancel() { }
        abort() { }
    }
    return {
        AppendableBuffer,
        AssetSourceChangedError: class extends Error { },
        BlankWriter: class {
            async init() { }
            async write() { }
            async end() { }
        },
        LocalWriter,
        VirtualWriter: class { },
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(async () => { }),
        forageStorage: {},
        loadAsset: vi.fn(async (key: string) => h.assets.get(key)),
        openURL: vi.fn(),
        pieceStoreOrNull: vi.fn(async () => null),
        readImage: vi.fn(async (key: string) => h.assets.get(key)),
        saveAsset: vi.fn(async (data: Uint8Array) => {
            const id = 'saved-' + h.saved.size
            h.saved.set(id, data.slice())
            return id
        }),
        saveAssetFromPieces: vi.fn(async () => { throw new Error('pieces are not used by a small card') }),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/media/compressImage/lossyCompression'), () => ({
    doLossyCompression: vi.fn(async (data: Uint8Array) => Buffer.from(data)),
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { ...h.db, modules: h.modules } } },
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

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => Uint8Array.from(data, b => (b * 7 + 3) & 0xff)),
    decodeRPack: vi.fn(async (data: Uint8Array) => Uint8Array.from(data, b => ((b - 3 + 256) * 183) & 0xff)),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

import { exportModule, exportModuleLegacy, importModule, type RisuModule } from 'src/ts/process/modules'
import { resetTaskHostForTests } from 'src/ts/alertTask.svelte'
import { answerImportCard } from 'src/ts/process/tests/answerImportCard'
import { ASSET_FOLDER_KEY } from 'src/ts/studio/assets/assetOwnerKeys'
import { readFolderDoc } from 'src/ts/studio/assets/folderCodec'

const PORTRAIT = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0,
    0x90, 0x77, 0x53, 0xde, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4, 5, 6, 7, 8])

const v1Document = {
    v: 1,
    additional: { order: ['Faces'], of: [['webp one', 'Faces'], ['Smile', 'Faces']] },
}
const unknownVersionDocument = { v: 9, mystery: [1, { deep: true }], folders: 'not a list' }

function syntheticModule(doc?: unknown): RisuModule {
    const mod: RisuModule = {
        name: 'Synthetic Module',
        description: 'module notes',
        id: 'module-1',
        assets: [['webp one', 'key-webp', 'webp']],
        icon: 'key-portrait',
        namespace: 'synthetic-ns',
        customModuleToggle: '<toggle>',
    }
    if (doc !== undefined) {
        mod[ASSET_FOLDER_KEY] = doc
    }
    return mod
}

/** The module's real CharX bytes, written by the real export through a capturing writer. */
async function exportBytes(mod: RisuModule): Promise<Uint8Array> {
    h.chunks.length = 0
    h.errors.length = 0
    await exportModule(mod, { alertEnd: false })
    expect(h.errors).toEqual([])
    const bytes = Buffer.concat(h.chunks)
    expect(bytes.length).toBeGreaterThan(0)
    return bytes
}

/** The module the real importer places in the module list for these bytes. */
async function importBytes(bytes: Uint8Array, fileName = 'synthetic.charx'): Promise<RisuModule> {
    h.modules.length = 0
    h.errors.length = 0
    h.picked = [new File([Uint8Array.from(bytes)], fileName)]
    const card = await answerImportCard(importModule)
    expect(card?.failure).toBeUndefined()
    expect(h.errors).toEqual([])
    expect(h.modules).toHaveLength(1)
    return h.modules[0] as RisuModule
}

type CardJson = { data: { extensions: Record<string, unknown> } & Record<string, unknown> } & Record<string, unknown>

function cardJsonOf(bytes: Uint8Array): CardJson {
    const files = unzipSync(bytes)
    return JSON.parse(new TextDecoder().decode(files['card.json']))
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-04T05:06:07.000Z'))
    h.saved.clear()
    h.chunks.length = 0
    h.errors.length = 0
    h.modules.length = 0
    h.assets.clear()
    h.assets.set('key-portrait', PORTRAIT)
    h.assets.set('key-webp', WEBP)
})

afterEach(() => {
    resetTaskHostForTests()
})

describe('a module CharX export and import', () => {
    test('(R) a v1 folder document survives a real export and a real import', async () => {
        const back = await importBytes(await exportBytes(syntheticModule(v1Document)))
        expect(back[ASSET_FOLDER_KEY]).toEqual(v1Document)
        expect(back.name).toBe('Synthetic Module')
    })

    test('(R) the exported card holds the document at data.extensions, not in the risuai extension', async () => {
        const card = cardJsonOf(await exportBytes(syntheticModule(v1Document)))
        expect(card.data.extensions[ASSET_FOLDER_KEY]).toEqual(v1Document)
        expect(JSON.stringify(card.data.extensions.risuai ?? null)).not.toContain('Faces')
    })

    test('(G) the fork producer from a module without the field imports with no folders and no error', async () => {
        const bytes = await exportBytes(syntheticModule())
        expect(ASSET_FOLDER_KEY in cardJsonOf(bytes).data.extensions).toBe(false)
        const back = await importBytes(bytes)
        expect('assetFolders' in back).toBe(false)
        expect(ASSET_FOLDER_KEY in back).toBe(false)
        expect(back.name).toBe('Synthetic Module')
    })

    test('(R) with a document present the unprefixed name is never written and the prefixed key holds the value', async () => {
        const withDoc = await importBytes(await exportBytes(syntheticModule(v1Document)))
        expect('assetFolders' in withDoc).toBe(false)
        expect(withDoc[ASSET_FOLDER_KEY]).toEqual(v1Document)
    })

    test('(F) a CharX with an unknown-version document keeps it verbatim in the imported module', async () => {
        const back = await importBytes(await exportBytes(syntheticModule(unknownVersionDocument)))
        expect(back[ASSET_FOLDER_KEY]).toEqual(unknownVersionDocument)
    })

    test('(F) two real exports differ only at data.extensions of the folder key', async () => {
        const without = cardJsonOf(await exportBytes(syntheticModule()))
        const withDoc = cardJsonOf(await exportBytes(syntheticModule(v1Document)))
        expect(withDoc.data.extensions[ASSET_FOLDER_KEY]).toEqual(v1Document)
        const { [ASSET_FOLDER_KEY]: _carried, ...withoutKey } = withDoc.data.extensions
        expect({ ...withDoc, data: { ...withDoc.data, extensions: withoutKey } })
            .toEqual(without)
        // The fields upstream reads from a module card and its risuai extension are equal.
        for (const field of ['name', 'creator_notes', 'character_book', 'description']) {
            expect(withDoc.data[field]).toEqual(without.data[field])
        }
        expect(withDoc.data.extensions.risuai).toEqual(without.data.extensions.risuai)
    })
})

/** A module that holds the unprefixed name instead of the folder key, as a foreign producer could write it. */
function moduleWithUnprefixedName(doc: unknown): RisuModule {
    return Object.assign(syntheticModule(), { assetFolders: doc })
}

/** The module's real `.risum` bytes, as the real legacy export writes them. */
async function risumBytesOf(mod: RisuModule): Promise<Uint8Array> {
    const bytes = await exportModuleLegacy(mod, { alertEnd: false, saveData: false })
    expect(bytes).not.toBeNull()
    return Uint8Array.from(bytes ?? [])
}

describe('the unprefixed name is never read as the folder document', () => {
    test('(G) a .risum carrier: an unprefixed name reads as no folders, and the value is kept verbatim as an unknown field', async () => {
        const back = await importBytes(await risumBytesOf(moduleWithUnprefixedName(v1Document)), 'synthetic.risum')
        expect(ASSET_FOLDER_KEY in back).toBe(false)
        expect(JSON.stringify(Reflect.get(back, 'assetFolders'))).toBe(JSON.stringify(v1Document))
    })

    test('(F) a .risum carrier: a module with the folder key reads its folders and no unprefixed name appears', async () => {
        const back = await importBytes(await risumBytesOf(syntheticModule(v1Document)), 'synthetic.risum')
        expect(back[ASSET_FOLDER_KEY]).toEqual(v1Document)
        expect('assetFolders' in back).toBe(false)
        const read = readFolderDoc(back[ASSET_FOLDER_KEY])
        expect(read.state).toBe('ok')
        expect(read.doc.additional.of).toEqual([['webp one', 'Faces'], ['Smile', 'Faces']])
    })

    test('(G) a CharX carrier: an unprefixed name is not carried into the card and reads as no folders', async () => {
        const bytes = await exportBytes(moduleWithUnprefixedName(v1Document))
        const extensions = cardJsonOf(bytes).data.extensions
        expect(ASSET_FOLDER_KEY in extensions).toBe(false)
        expect('assetFolders' in extensions).toBe(false)
        const back = await importBytes(bytes)
        expect(ASSET_FOLDER_KEY in back).toBe(false)
        expect('assetFolders' in back).toBe(false)
    })
})
