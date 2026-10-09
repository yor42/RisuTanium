// @vitest-environment happy-dom

/**
 * Closing the file chooser of the character import without choosing a file does
 * nothing: no busy indicator toggles for an empty import, no message appears.
 * The real characterCards.ts runs; the picker answers `[]` as `selectFileByDom`
 * does when the chooser is closed, and the busy runner is a spy.
 */

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({
    /** what the single alert slot holds: every alert function replaces it */
    last: 'none' as string,
    errors: [] as string[],
    characters: [] as Array<Record<string, unknown>>,
    /** the files the picker hands over */
    picked: null as File[] | null,
    confirm: true,
    /** every asset save fails with this message while it is set */
    saveFails: null as string | null,
    ordered: 0,
    uuid: 0,
    /** the files a desktop open-with hands over, by path */
    files: new Map<string, Uint8Array>(),
    /** the buffer size of every plugin `read` */
    readSizes: [] as number[],
    openHandles: 0,
    /** the bytes every plugin `read` has handed out */
    bytesRead: 0,
    /** every asset save: a hash of the asset and the bytes the open files had handed out at that moment */
    saves: [] as { hash: string, bytesRead: number }[],
    os: 'windows',
    busy: vi.fn(async (_kind: string, run: () => Promise<void>) => { await run() }),
}))

vi.mock('uuid', () => ({
    v4: () => `uuid-${++h.uuid}`,
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
        alertClear: vi.fn(() => { h.last = 'none' }),
        alertConfirm: vi.fn(async () => { h.last = 'ask'; const answer = h.confirm; h.last = 'none'; return answer }),
        alertError: vi.fn((msg: string | Error) => { h.errors.push(text(msg)); h.last = 'error:' + text(msg) }),
        alertInput: vi.fn(async () => ''),
        alertMd: vi.fn(),
        alertModuleSelect: vi.fn(),
        alertNormal: vi.fn((msg: string) => { h.last = 'normal:' + msg }),
        alertStore: {
            set: (v: { type?: string, msg?: string }) => { h.last = v.type === 'none' ? 'none' : `${v.type}:${v.msg}` },
            subscribe: vi.fn(),
            update: vi.fn(),
        },
        alertWait: vi.fn((msg: string) => { h.last = 'wait:' + msg }),
    } as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: h.characters, modules: [], goCharacterOnImport: false })),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => {
    class Semaphore {
        private available: number
        private readonly max: number
        private waiting: Array<() => void> = []
        constructor(max: number) { this.available = max; this.max = max }
        async acquire(): Promise<void> {
            if (this.available > 0) { this.available -= 1; return }
            await new Promise<void>((resolve) => this.waiting.push(resolve))
        }
        release(): void {
            const next = this.waiting.shift()
            if (next) { next(); return }
            if (this.available < this.max) this.available += 1
        }
    }
    return {
        asBuffer: (a: unknown) => a,
        Semaphore,
        checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
        checkPersonaBinded: vi.fn(),
        decryptBuffer: vi.fn(async (d: unknown) => d),
        isKnownUri: vi.fn(() => false),
        selectFileByDom: vi.fn(async () => h.picked),
        selectSingleFile: vi.fn(async () => null),
        sleep: vi.fn(async () => {}),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => {}),
    characterFormatUpdate: vi.fn((c: unknown) => c),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    return {
        AppendableBuffer,
        BlankWriter: class {},
        LocalWriter: class {},
        VirtualWriter: class {},
        checkCharOrder: vi.fn(() => { h.ordered++ }),
        downloadFile: vi.fn(async () => {}),
        forageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async (d: unknown) => d),
        saveAsset: vi.fn(async (data: Uint8Array) => {
            h.saves.push({ hash: createHash('sha256').update(data).digest('hex'), bytesRead: h.bytesRead })
            if (h.saveFails !== null) throw new Error(h.saveFails)
            return `asset-${data[0]}-${data.length}`
        }),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: h.characters, modules: [] } } },
    HideIconStore: { set: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
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

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async (d: Uint8Array) => d),
    encodeRPack: vi.fn(async (d: Uint8Array) => d),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

/** The largest file payload one plugin call may carry; a call above it rejects, the way the per-call bound would fail it. */
const CALL_CAP = 4 * 1024 * 1024

vi.mock('@tauri-apps/plugin-fs', () => ({
    SeekMode: { Start: 0, Current: 1, End: 2 },
    readFile: vi.fn(async (path: string) => {
        const data = h.files.get(path) ?? new Uint8Array()
        if (data.length > CALL_CAP) {
            throw new Error(`readFile carries ${data.length} bytes, above the per-call bound`)
        }
        return data
    }),
    open: vi.fn(async (path: string) => {
        const data = h.files.get(path)
        if (data === undefined) {
            throw `failed to open ${path} (os error 2)`
        }
        let position = 0
        h.openHandles++
        return {
            read: async (buffer: Uint8Array) => {
                h.readSizes.push(buffer.byteLength)
                if (buffer.byteLength > CALL_CAP) {
                    throw new Error(`read asks for ${buffer.byteLength} bytes, above the per-call bound`)
                }
                if (position >= data.length) {
                    return null
                }
                const count = Math.min(buffer.byteLength, data.length - position)
                buffer.set(data.subarray(position, position + count), 0)
                position += count
                h.bytesRead += count
                return count
            },
            seek: async (offset: number) => {
                position = offset
                return position
            },
            stat: async () => ({ size: data.length, mtime: null }),
            close: async () => { h.openHandles-- },
        }
    }),
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.os }))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

//#endregion

vi.mock(import('src/ts/process/memory/busyActions'), () => ({
    withBusy: h.busy,
    beginBusy: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/busyActions'))

import { importCharacter } from 'src/ts/characterCards'

beforeEach(() => {
    h.last = 'none'
    h.errors = []
    h.characters = []
    h.picked = null
    h.busy.mockClear()
})

afterEach(() => {
    vi.clearAllMocks()
})

describe('importCharacter', () => {
    test('closing the chooser neither toggles the busy indicator nor shows a message', async () => {
        h.picked = []

        await importCharacter()

        expect(h.busy).not.toHaveBeenCalled()
        expect(h.last).toBe('none')
        expect(h.errors).toEqual([])
    })

    test('guard: nothing returned by the picker does the same', async () => {
        h.picked = null

        await importCharacter()

        expect(h.busy).not.toHaveBeenCalled()
        expect(h.last).toBe('none')
    })
})
