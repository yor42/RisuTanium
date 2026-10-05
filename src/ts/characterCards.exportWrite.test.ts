/**
 * PNG and CharX export through `exportCharacterCard` in `src/ts/characterCards.ts` onto a `TauriWriter`.
 *
 * The real `characterCards.ts`, `pngChunk.ts`, `processzip.ts` (the real `CharXWriter` on the real fflate) and the real
 * `TauriWriter` run against synthetic data. The Tauri file system is an in-memory recorder that can refuse a call, and
 * the `LocalWriter` of `globalApi.svelte` is replaced by a pass-through to a `TauriWriter` that also records every
 * byte it was handed, so the file written can be compared with what the exporter produced. A mocked file system is
 * not evidence of native file behaviour.
 *
 * Labels: (R) fails when a PNG export does not wait for its writer to close; (G) is a guard that passes with or
 * without the change.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({
    errors: [] as string[],
    log: [] as string[],
    png: new Uint8Array() as Uint8Array,
    recorded: [] as Uint8Array[],
    files: new Map<string, Uint8Array>(),
    calls: [] as Array<{ append: boolean, length: number }>,
    failCall: null as null | (() => boolean),
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
        alertConfirm: vi.fn(async () => true),
        alertError: vi.fn((msg: string | Error) => { h.errors.push(text(msg)); h.log.push('error:' + text(msg)) }),
        alertInput: vi.fn(async () => ''),
        alertMd: vi.fn(),
        alertNormal: vi.fn((msg: string) => { h.log.push('normal:' + msg) }),
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
        private writer = new TauriWriter('synthetic/out')
        async init() { return true }
        async write(data: Uint8Array) {
            h.recorded.push(data.slice())
            await this.writer.write(data)
        }
        async close() { await this.writer.close() }
    }
    return {
        AppendableBuffer,
        BlankWriter: class { },
        LocalWriter,
        VirtualWriter: class { },
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(async () => { }),
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
import type { character } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'

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
        expect(h.errors).toEqual(['synthetic write failure'])
        expect(h.log).not.toContain('normal:' + language.successExport)
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
        expect(h.errors).toEqual(['synthetic write failure'])
        expect(h.log).not.toContain('normal:' + language.successExport)
    })
})
