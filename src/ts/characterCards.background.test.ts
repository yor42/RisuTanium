// @vitest-environment happy-dom

/**
 * "Keep going in the background" on the cards the user starts inside the app (MC-2480): the Characters picker and a drop
 * offer it, and a file the OS hands over does not. A backgrounded picker import reports it through `report`, which is how
 * `addCharacter` and Home skip the selection (MC-2483).
 *
 * The real `characterCards.ts`, `dropImport.ts`, `importBatch.ts`, `alertTask.svelte.ts` and `processzip.ts` run on
 * synthetic cards; the mocks are those of `characterCards.picker.test.ts`. The toast presenter is a fake.
 *
 * Labels: (RR) fails on the tree before the wiring; (CG) compatibility guard that holds before and after.
 */

import { createHash } from 'node:crypto'
import crc32 from 'crc/crc32'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fflate from 'fflate'

//#region module mocks

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
    /** called inside every asset save, while the card is running */
    probe: null as null | (() => void),
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
            h.probe?.()
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

//#endregion

import { importCharacter, importOpenedFiles } from 'src/ts/characterCards'
import { importDroppedFile } from 'src/ts/dropImport'
import { fflateZipArchive } from 'src/ts/process/tests/zipFixtures'
import {
    answerTask,
    backgroundTask,
    resetTaskHostForTests,
    setTaskToastPresenter,
    taskHostView,
    taskResultShowing,
    type TaskToastPresenter,
} from 'src/ts/alertTask.svelte'
import { answerImportCard } from 'src/ts/process/tests/answerImportCard'

// ---------------------------------------------------------------------------------------------
// Synthetic files (no real images, no user data)
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Synthetic files (no real images, no user data)
// ---------------------------------------------------------------------------------------------

const U8 = Uint8Array
const enc = new TextEncoder()

const v3Json = (name: string, over: { lowLevelAccess?: boolean, assets?: number } = {}) => JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
        name, description: 'd', first_mes: 'hi', character_version: '1',
        extensions: { risuai: over.lowLevelAccess ? { lowLevelAccess: true } : {} },
        assets: Array.from({ length: over.assets ?? 0 }, (_, i) => ({ type: 'x-risu-asset', uri: `embeded://assets/a${i}.bin`, name: `a${i}`, ext: 'bin' })),
    },
})

function charx(name: string, over: { lowLevelAccess?: boolean, assets?: number } = {}, fileName = `${name}.charx`): File {
    const files: fflate.Zippable = { 'card.json': [enc.encode(v3Json(name, over)), { level: 0 }] }
    for (let i = 0; i < (over.assets ?? 0); i++) {
        files[`assets/a${i}.bin`] = [new U8(64).fill(i + 1), { level: 0 }]
    }
    return new File([new U8(fflate.zipSync(files))], fileName, { type: 'application/zip' })
}

function pngChunk(type: string, body: Uint8Array): Uint8Array {
    const t = enc.encode(type)
    const out = new U8(12 + body.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, body.length)
    out.set(t, 4)
    out.set(body, 8)
    view.setUint32(8 + body.length, crc32(Buffer.from(out.subarray(4, 8 + body.length))))
    return out
}

const v2Json = (name: string) => JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name, description: 'd', personality: '', scenario: '', first_mes: 'hi', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: '', character_version: '1', extensions: { risuai: {} } },
})

function pngBytes(name: string): Uint8Array {
    const card = v2Json(name)
    const parts = [
        new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', new U8(13).fill(1)),
        pngChunk('tEXt', new U8([...enc.encode('chara'), 0, ...enc.encode(Buffer.from(card).toString('base64'))])),
        pngChunk('IDAT', new U8(20).fill(2)),
        pngChunk('IEND', new U8(0)),
    ]
    const out = new U8(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) { out.set(p, at); at += p.length }
    return out
}

const png = (name: string) => new File([new U8(pngBytes(name))], `${name}.png`, { type: 'image/png' })
/** A card image cut inside its card chunk. */
const cutPng = (name: string) => new File([new U8(pngBytes(name).subarray(0, 33 + 20))], `${name}.png`, { type: 'image/png' })
const textFile = (name: string) => new File([new U8([1, 2, 3])], name, { type: 'text/plain' })

const concatBytes = (parts: Uint8Array[]): Uint8Array => {
    const out = new U8(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) { out.set(p, at); at += p.length }
    return out
}
/** A complete PNG with no card chunk: signature, IHDR, IDAT and IEND. */
const pngPhoto = (): Uint8Array => concatBytes([
    new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', new U8(13).fill(1)),
    pngChunk('IDAT', new U8(20).fill(2)),
    pngChunk('IEND', new U8(0)),
])
/** A JPEG image with no archive behind it. */
const JPEG_HEAD = concatBytes([new U8([0xff, 0xd8, 0xff, 0xe0]), new U8(600).fill(0x11), new U8([0xff, 0xd9])])
/** A card archive written behind a JPEG image, the way a jpg-charx is. */
const jpgCharx = (name: string): Uint8Array => fflateZipArchive([['card.json', enc.encode(v3Json(name))]], { prefix: JPEG_HEAD })
/** The largest JSON an opened or shared source may be before it is read. */
const JSON_CAP = 64 * 1024 * 1024
const bigZeros = (size: number): Uint8Array => new U8(size)
/** A v2 card padded with trailing spaces to exactly `size` bytes. */
const paddedV2 = (name: string, size: number): Uint8Array => {
    const card = enc.encode(v2Json(name))
    const out = new U8(size).fill(0x20)
    out.set(card, 0)
    return out
}
const putFile = (path: string, bytes: Uint8Array) => { h.files.set(path, bytes) }

const names = () => h.characters.map((c) => (c as { name?: string }).name)

let ends: { open(): void, end(): void }[] = []

function installPresenter(): void {
    ends = []
    const presenter: TaskToastPresenter = {
        post: (_view, on) => { ends.push(on); return ends.length },
        update: () => { },
        end: () => { },
    }
    setTaskToastPresenter(presenter)
}

/** What the shown card's `background` was at each asset save of the import. */
let seen: (true | undefined)[] = []

beforeEach(() => {
    h.last = 'none'
    h.errors = []
    h.characters = []
    h.picked = null
    h.confirm = true
    h.saveFails = null
    h.ordered = 0
    h.uuid = 0
    h.files.clear()
    h.readSizes = []
    h.openHandles = 0
    h.bytesRead = 0
    h.saves = []
    h.os = 'windows'
    seen = []
    h.probe = () => { seen.push(taskHostView()?.background) }
    installPresenter()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
    h.probe = null
    resetTaskHostForTests()
    vi.restoreAllMocks()
})

const withAssets = (name: string) => charx(name, { assets: 1 })

describe('the Characters picker', () => {
    test('R4-24 (RR): a two-file pick shows a running card that offers the background', async () => {
        h.picked = [withAssets('One'), withAssets('Two')]
        await answerImportCard(() => importCharacter())
        expect(names()).toEqual(['One', 'Two'])
        expect(seen).toEqual([true, true])
    })

    test('R4-24 (RR): a one-file pick offers it too, whatever the file count', async () => {
        h.picked = [withAssets('Solo')]
        await answerImportCard(() => importCharacter())
        expect(seen).toEqual([true])
    })

    test('R4-32 (RR): a pick that was sent to the background reports it, and still returns the slots it added', async () => {
        h.picked = [withAssets('Away')]
        let pressed = false
        h.probe = () => { if (!pressed) pressed = backgroundTask() }
        const report: { backgrounded?: boolean } = {}
        const done = importCharacter(report)
        let slots: Awaited<typeof done> = []
        void done.then((added) => { slots = added })
        for (let i = 0; i < 400 && slots.length === 0; i++) {
            ends[0]?.end()
            if (!pressed && taskResultShowing()) answerTask({ kind: 'ok' })
            await new Promise((resolve) => setTimeout(resolve, 0))
        }
        await done
        expect(pressed).toBe(true)
        expect(report.backgrounded).toBe(true)
        expect(names()).toEqual(['Away'])
        expect(slots).toHaveLength(1)
    })

    test('R4-32 (CG): a pick that stays in front leaves the report unset', async () => {
        h.picked = [withAssets('Front')]
        const report: { backgrounded?: boolean } = {}
        await answerImportCard(() => importCharacter(report))
        expect(report.backgrounded).toBeUndefined()
        expect(names()).toEqual(['Front'])
    })
})

describe('a dropped file', () => {
    test('R4-24 (RR): the drop card offers the background', async () => {
        await answerImportCard(() => importDroppedFile(withAssets('Dropped')))
        expect(names()).toEqual(['Dropped'])
        expect(seen).toEqual([true])
    })
})

describe('files the OS hands over', () => {
    test('R4-24 (CG): an opened archive shows a card that does not offer the background', async () => {
        h.files.set('/home/u/Opened.charx', new Uint8Array(await withAssets('Opened').arrayBuffer()))
        await answerImportCard(() => importOpenedFiles(['/home/u/Opened.charx']))
        expect(names()).toEqual(['Opened'])
        expect(seen).toEqual([undefined])
    })
})
