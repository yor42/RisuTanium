/**
 * PNG, CharX and JSON export through `exportCharacterCard` in `src/ts/characterCards.ts` onto a `TauriWriter`.
 *
 * The real `characterCards.ts`, `pngChunk.ts`, `processzip.ts` (the real `CharXWriter` on the real fflate) and the real
 * `TauriWriter` run against synthetic data. The Tauri file system is an in-memory recorder that can refuse a call, and
 * the `LocalWriter` of `globalApi.svelte` is replaced by a pass-through to a `TauriWriter` that also records every
 * byte it was handed, so the file written can be compared with what the exporter produced. A mocked file system is
 * not evidence of native file behaviour.
 *
 * Labels: (R) fails when a PNG export does not wait for its writer to close, when a card image read error does
 * not reject the export, or when a failure after a desktop write does not add the incomplete-file sentence; (G) is a
 * guard that passes with or without the change.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({
    errors: [] as string[],
    log: [] as string[],
    png: new Uint8Array() as Uint8Array,
    recorded: [] as Uint8Array[],
    files: new Map<string, Uint8Array>(),
    calls: [] as Array<{ append: boolean, length: number }>,
    failCall: null as null | (() => boolean),
    cleared: 0,
    download: vi.fn(),
    initResult: true,
    inits: [] as Array<{ name: string, ext: string[], file: string | undefined }>,
    events: [] as string[],
    path: 'synthetic/out',
    android: false,
    invoked: [] as Array<{ command: string, bytes: number, last: boolean }>,
}))

vi.mock('uuid', () => ({
    v4: () => 'uuid-1',
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: true,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(async (command: string, args: { data: string, last: boolean }) => {
        const bytes = Buffer.from(args.data, 'base64').byteLength
        h.invoked.push({ command, bytes, last: args.last })
        return { written: bytes, synced: true }
    }),
}))

// Only the Android check is steered, and read at call time so a test can switch it; the real base64 helper stays.
vi.mock(import('src/ts/storage/tauriByteTransport'), async (importOriginal) => ({
    ...await importOriginal(),
    isAndroidTransport: () => h.android,
}))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/alert'), () => {
    const text = (msg: string | Error) => msg instanceof Error ? msg.message : String(msg)
    return {
        alertCardExport: vi.fn(),
        alertClear: vi.fn(() => { h.cleared++ }),
        alertConfirm: vi.fn(async () => true),
        alertError: vi.fn((msg: string | Error) => { h.errors.push(text(msg)); h.log.push('error:' + text(msg)) }),
        alertInput: vi.fn(async () => ''),
        alertMd: vi.fn(),
        alertNormal: vi.fn((msg: string) => { h.log.push('normal:' + msg); h.events.push('notice') }),
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
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: [], goCharacterOnImport: false })),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => ({
    asBuffer: (a: unknown) => a,
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    isKnownUri: vi.fn(() => false),
    selectFileByDom: vi.fn(async () => null),
    sleep: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => { }),
    characterFormatUpdate: vi.fn((c: unknown) => c),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    const { TauriWriter } = await import('src/ts/exportWriters')
    class LocalWriter {
        private writer = new TauriWriter(h.path)
        async init(name?: string, ext?: string[], file?: string) {
            h.inits.push({ name: name ?? '', ext: ext ?? [], file })
            h.events.push('init')
            return h.initResult
        }
        async write(data: Uint8Array) {
            h.events.push('write:' + Buffer.from(data).toString('utf-8'))
            h.recorded.push(data.slice())
            await this.writer.write(data)
        }
        async close() {
            h.events.push('close')
            await this.writer.close()
        }
        abort(reason: unknown) { void this.writer.abort(reason) }
    }
    return {
        AppendableBuffer,
        BlankWriter: class {
            async init() { }
            async write() { }
            async end() { }
        },
        LocalWriter,
        VirtualWriter: class { },
        checkCharOrder: vi.fn(),
        downloadFile: h.download,
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async () => h.png),
        saveAsset: vi.fn(async () => 'saved'),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'PNG'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: [] } } },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    selectedCharID: { set: vi.fn() },
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    readModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async () => new Uint8Array()),
    writeFile: vi.fn(async (path: string, data: Uint8Array, options?: { append?: boolean }) => {
        const append = options?.append === true
        h.calls.push({ append, length: data.byteLength })
        if (h.failCall?.()) {
            throw new Error('synthetic write failure')
        }
        const previous = append ? h.files.get(path) ?? new Uint8Array() : new Uint8Array()
        const next = new Uint8Array(previous.byteLength + data.byteLength)
        next.set(previous, 0)
        next.set(data, previous.byteLength)
        h.files.set(path, next)
    }),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

//#endregion

import { exportCharacterCard } from 'src/ts/characterCards'
import { LocalWriter, readImage } from 'src/ts/globalApi.svelte'
import type { character } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'

// The failing call has already reached the file system, so the desktop file counts as kept and the notice says so.
const failedWithFileKept = 'synthetic write failure\n' + language.exportFailedFileIncomplete

function syntheticPng(): Uint8Array {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]
    const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]
    return new Uint8Array([...signature, ...ihdr, ...iend])
}

function syntheticCharacter(): character {
    return {
        name: 'Synthetic',
        image: 'synthetic-image',
        globalLore: [],
        desc: 'd',
        firstMessage: 'hi',
        ccAssets: [],
    } as unknown as character
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.byteLength
    }
    return out
}

beforeEach(() => {
    h.errors.length = 0
    h.log.length = 0
    h.recorded.length = 0
    h.files.clear()
    h.calls.length = 0
    h.failCall = null
    h.cleared = 0
    h.download.mockReset()
    h.download.mockResolvedValue(true)
    h.initResult = true
    h.inits.length = 0
    h.events.length = 0
    h.path = 'synthetic/out'
    h.android = false
    h.invoked.length = 0
    h.png = syntheticPng()
})

describe('PNG export onto a TauriWriter', () => {
    test('(G) the file written is the concatenation of the bytes the exporter produced, and success is reported', async () => {
        await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })
        expect(h.errors).toEqual([])
        expect(h.log).toContain('normal:' + language.successExport)
        const file = h.files.get('synthetic/out')!
        expect(file.byteLength).toBeGreaterThan(h.png.byteLength)
        expect(Buffer.from(file).equals(Buffer.from(concat(h.recorded)))).toBe(true)
        expect(h.calls[0].append).toBe(false)
    })

    test('(R) a failing final flush shows the error and never the success message', async () => {
        h.failCall = () => true
        await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })
        expect(h.errors).toEqual([failedWithFileKept])
        expect(h.log).not.toContain('normal:' + language.successExport)
    })
})

describe('Export portrait: placeholder only for an absent image', () => {
    const realFetch = globalThis.fetch

    function stubPlaceholder() {
        const fetchMock = vi.fn(async () => new Response(syntheticPng().buffer as ArrayBuffer, { status: 200 }))
        globalThis.fetch = fetchMock as unknown as typeof fetch
        return fetchMock
    }

    afterEach(() => {
        globalThis.fetch = realFetch
        vi.mocked(readImage).mockImplementation(async () => h.png)
    })

    test('(G) a character with no image exports with the placeholder', async () => {
        const fetchMock = stubPlaceholder()
        const char = syntheticCharacter()
        char.image = ''
        await exportCharacterCard(char, 'png', { spec: 'v3' })
        expect(fetchMock).toHaveBeenCalledWith('/none.webp')
        expect(h.errors).toEqual([])
        expect(h.log).toContain('normal:' + language.successExport)
    })

    test('(G) an image missing from storage exports with the placeholder', async () => {
        const fetchMock = stubPlaceholder()
        vi.mocked(readImage).mockImplementation(async () => { throw new Error('The asset "synthetic-image" does not exist.') })
        await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })
        expect(fetchMock).toHaveBeenCalledWith('/none.webp')
        expect(h.errors).toEqual([])
        expect(h.log).toContain('normal:' + language.successExport)
    })

    test('(R) an I/O error while reading the image rejects the export and writes nothing', async () => {
        const fetchMock = stubPlaceholder()
        vi.mocked(readImage).mockImplementation(async () => { throw new Error('synthetic read failure') })
        await expect(exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })).rejects.toThrow('synthetic read failure')
        expect(h.log).not.toContain('normal:' + language.successExport)
        expect(fetchMock).not.toHaveBeenCalled()
        expect(h.recorded).toEqual([])
    })

    test('(R) an I/O error while reading the image rejects for a caller that supplies its own writer', async () => {
        const fetchMock = stubPlaceholder()
        vi.mocked(readImage).mockImplementation(async () => { throw new Error('synthetic read failure') })
        const writer = new LocalWriter()
        await expect(exportCharacterCard(syntheticCharacter(), 'charx', { spec: 'v3', writer })).rejects.toThrow('synthetic read failure')
        expect(h.errors).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
        expect(h.recorded).toEqual([])
    })
})

describe('exportCharacterCard result for a caller that supplies its own writer', () => {
    test('(R) a failure inside the export shows the error and resolves false', async () => {
        h.failCall = () => true
        const result = await exportCharacterCard(syntheticCharacter(), 'charx', { spec: 'v3', writer: new LocalWriter() })
        expect(result).toBe(false)
        expect(h.errors).toEqual([failedWithFileKept])
    })

    test('(R) a failing png export has shown its error when the false result arrives', async () => {
        h.failCall = () => true
        const result = await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3', writer: new LocalWriter() })
        expect(result).toBe(false)
        expect(h.log).toEqual(['error:' + failedWithFileKept])
    })

    test('(R) a completed png export resolves true, with and without a supplied writer', async () => {
        expect(await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3', writer: new LocalWriter() })).toBe(true)
        expect(await exportCharacterCard(syntheticCharacter(), 'png', { spec: 'v3' })).toBe(true)
        expect(h.errors).toEqual([])
    })

    test('(R) a completed json export resolves true for both card specs', async () => {
        expect(await exportCharacterCard(syntheticCharacter(), 'json', { spec: 'v2' })).toBe(true)
        expect(await exportCharacterCard(syntheticCharacter(), 'json', { spec: 'v3' })).toBe(true)
        expect(h.errors).toEqual([])
        expect(h.log).toEqual(['normal:' + language.successExport, 'normal:' + language.successExport])
        expect(h.cleared).toBe(0)
    })

    test('(R) a dismissed json save dialog shows no notice, no error and resolves false, for both card specs', async () => {
        // The JSON card saves through the writer's own dialog; a dismissal leaves nothing to clear or to say.
        h.initResult = false
        expect(await exportCharacterCard(syntheticCharacter(), 'json', { spec: 'v2' })).toBe(false)
        expect(await exportCharacterCard(syntheticCharacter(), 'json', { spec: 'v3' })).toBe(false)
        expect(h.inits).toHaveLength(2)
        expect(h.download).not.toHaveBeenCalled()
        expect(h.errors).toEqual([])
        expect(h.log).toEqual([])
    })
})

describe('JSON export onto a LocalWriter', () => {
    const assetBytes = (index: number) => Buffer.from(`asset-${index}-` + String(index).repeat(40 + index))
    const base64Of = (index: number) => assetBytes(index).toString('base64')

    function characterWithAssets(count: number): character {
        const char = syntheticCharacter()
        char.ccAssets = Array.from({ length: count }, (_, index) => ({ type: 'x-risu-asset', uri: `synthetic-asset/a${index}`, name: `a${index}`, ext: 'png' }))
        return char
    }

    function installReads(failOn?: string) {
        vi.mocked(readImage).mockImplementation(async (key: string) => {
            h.events.push('read:' + key)
            if (key === failOn) {
                throw new Error('synthetic read failure')
            }
            const match = /^synthetic-asset\/a(\d+)$/.exec(key)
            return match ? new Uint8Array(assetBytes(Number(match[1]))) : h.png
        })
    }

    afterEach(() => {
        vi.mocked(readImage).mockImplementation(async () => h.png)
    })

    test('(R) each asset is written before the next is read, and no write holds two assets', async () => {
        installReads()
        expect(await exportCharacterCard(characterWithAssets(3), 'json', { spec: 'v3' })).toBe(true)
        const firstWrite = (index: number) => h.events.findIndex(event => event.startsWith('write:') && event.includes(base64Of(index)))
        expect(firstWrite(0)).toBeGreaterThan(-1)
        expect(firstWrite(0)).toBeLessThan(h.events.indexOf('read:synthetic-asset/a1'))
        expect(firstWrite(1)).toBeLessThan(h.events.indexOf('read:synthetic-asset/a2'))
        for (const event of h.events.filter(entry => entry.startsWith('write:'))) {
            expect([0, 1, 2].filter(index => event.includes(base64Of(index))).length).toBeLessThanOrEqual(1)
        }
        expect(h.events.slice(-2)).toEqual(['close', 'notice'])
        expect(h.download).not.toHaveBeenCalled()
        const card = JSON.parse(Buffer.concat(h.recorded).toString('utf-8'))
        expect(card.data.assets.map((asset: { uri: string }) => asset.uri)).toEqual([0, 1, 2].map(index => 'data:application/octet-stream;base64,' + base64Of(index)))
    })

    test('(G) a v2 JSON card is written as one piece and then closed', async () => {
        expect(await exportCharacterCard(characterWithAssets(2), 'json', { spec: 'v2' })).toBe(true)
        expect(h.events.filter(event => event.startsWith('write:'))).toHaveLength(1)
        expect(h.events.slice(-2)).toEqual(['close', 'notice'])
        expect(h.download).not.toHaveBeenCalled()
    })

    test('(R) a dismissed save dialog reads no asset and says nothing', async () => {
        installReads()
        h.initResult = false
        expect(await exportCharacterCard(characterWithAssets(3), 'json', { spec: 'v3' })).toBe(false)
        expect(h.inits).toEqual([{ name: 'JSON File', ext: ['json'], file: 'Synthetic_export.json' }])
        expect(h.events.filter(event => event.startsWith('read:synthetic-asset/'))).toEqual([])
        expect(h.recorded).toEqual([])
        expect(h.errors).toEqual([])
        expect(h.log).toEqual([])
    })

    test('(G) a failing file write gives one error with the incomplete-file sentence and no success notice', async () => {
        installReads()
        h.failCall = () => true
        expect(await exportCharacterCard(characterWithAssets(2), 'json', { spec: 'v3' })).toBe(false)
        expect(h.errors).toEqual([failedWithFileKept])
        expect(h.log).toEqual(['error:' + failedWithFileKept])
    })

    test('(G) a read failure on an Android document gives the incomplete-file sentence, since the document exists already', async () => {
        installReads('synthetic-asset/a1')
        h.path = 'content://synthetic/document'
        h.android = true
        expect(await exportCharacterCard(characterWithAssets(3), 'json', { spec: 'v3' })).toBe(false)
        expect(h.errors).toEqual(['synthetic read failure\n' + language.exportFailedFileIncomplete])
        expect(h.events).not.toContain('read:synthetic-asset/a2')
        expect(h.events).not.toContain('close')
    })

    test('(G) a read failure on desktop before any flush gives the plain error', async () => {
        installReads('synthetic-asset/a1')
        expect(await exportCharacterCard(characterWithAssets(3), 'json', { spec: 'v3' })).toBe(false)
        expect(h.errors).toEqual(['synthetic read failure'])
        expect(h.log).toEqual(['error:synthetic read failure'])
    })

    test('(G) the success notice names the saved file on desktop and the chosen location on Android, once, after the close', async () => {
        installReads()
        expect(await exportCharacterCard(characterWithAssets(2), 'json', { spec: 'v3' })).toBe(true)
        expect(h.log).toEqual(['normal:' + language.successExport])
        expect(h.events.slice(-2)).toEqual(['close', 'notice'])
        h.log.length = 0
        h.path = 'content://synthetic/document'
        h.android = true
        expect(await exportCharacterCard(characterWithAssets(2), 'json', { spec: 'v3' })).toBe(true)
        expect(h.log).toEqual(['normal:' + language.successExportChosenLocation])
        expect(h.invoked.length).toBeGreaterThan(0)
        expect(h.invoked[h.invoked.length - 1].last).toBe(true)
    })
})

describe('CharX export onto a TauriWriter', () => {
    test('(G) the file written is the concatenation of the bytes the exporter produced, and success is reported', async () => {
        await exportCharacterCard(syntheticCharacter(), 'charx', { spec: 'v3' })
        expect(h.errors).toEqual([])
        expect(h.log).toContain('normal:' + language.successExport)
        const file = h.files.get('synthetic/out')!
        expect(file.byteLength).toBeGreaterThan(0)
        expect(Buffer.from(file).equals(Buffer.from(concat(h.recorded)))).toBe(true)
        expect(Array.from(file.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    })

    test('(G) a failing final flush shows the error and never the success message', async () => {
        h.failCall = () => true
        await exportCharacterCard(syntheticCharacter(), 'charx', { spec: 'v3' })
        expect(h.errors).toEqual([failedWithFileKept])
        expect(h.log).not.toContain('normal:' + language.successExport)
    })
})
