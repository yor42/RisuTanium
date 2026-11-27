/**
 * The producer of a non-string 배경 HTML (Studio SC-1, T6): `importCharacterFile` of a v3 JSON card whose
 * `extensions.risuai.backgroundHTML` is not a string stores that value unchanged on the character, and always stores
 * `virtualscript` as the empty string. The history rows for both paths keep a foreign value because card import can store one.
 *
 * Compatibility guard: it passes before and after the history rows exist. What runs for real: `importCharacterFile` and the
 * v3 decoder. What is replaced: the asset reads and saves, the writer, the alerts, the database and the lossy codec.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({
    errors: [] as string[],
    db: { imageCompression: false, characters: [] as Array<Record<string, unknown>>, modules: [] as Array<Record<string, unknown>> },
}))

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
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: h.db.characters, goCharacterOnImport: false })),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

// The real `util` reads the Tauri window at import time when `isTauri` is on.
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
        selectFileByDom: vi.fn(async () => null),
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
        async write() { }
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
        loadAsset: vi.fn(async () => undefined),
        openURL: vi.fn(),
        pieceStoreOrNull: vi.fn(async () => null),
        readImage: vi.fn(async () => undefined),
        saveAsset: vi.fn(async () => 'saved-0'),
        saveAssetFromPieces: vi.fn(async () => { throw new Error('pieces are not used by a small card') }),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/media/compressImage/lossyCompression'), () => ({
    doLossyCompression: vi.fn(async (data: Uint8Array) => Buffer.from(data)),
}))

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

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

//#endregion

import { importCharacterFile } from 'src/ts/characterCards'

beforeEach(() => {
    h.db.characters.length = 0
    h.db.modules.length = 0
    h.errors.length = 0
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

async function importedWith(risuai: Record<string, unknown>): Promise<Record<string, unknown>> {
    const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Held', description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai } } }
    const outcome = await importCharacterFile({ name: 'card.json', data: new TextEncoder().encode(JSON.stringify(card)), returnCharacter: true })
    expect(h.errors).toEqual([])
    expect(outcome.kind).toBe('imported')
    if (outcome.kind !== 'imported') {
        throw new Error(`The import ended as ${outcome.kind}.`)
    }
    return (outcome.character ?? h.db.characters[outcome.index as number]) as unknown as Record<string, unknown>
}

describe('T6: what a v3 card import stores for the two SC-1 paths', () => {
    test('a number in backgroundHTML is stored unchanged', async () => {
        const imported = await importedWith({ backgroundHTML: 7 })

        expect(imported.backgroundHTML).toBe(7)
    })

    test('a string in backgroundHTML is stored unchanged', async () => {
        const imported = await importedWith({ backgroundHTML: '<p>hi</p>' })

        expect(imported.backgroundHTML).toBe('<p>hi</p>')
    })

    test('virtualscript is stored as the empty string whatever the card carries', async () => {
        const imported = await importedWith({ virtualscript: 'alert(1)' })

        expect(imported.virtualscript).toBe('')
    })
})
