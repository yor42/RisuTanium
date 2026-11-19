/**
 * Cancel on the import task card, across every character, preset and module flow of `src/ts/characterCards.ts` and
 * `src/ts/dropImport.ts`: a Cancel pressed during a scan or check ends the round Cancelled without a write, a Cancel pressed
 * at the last checkpoint before a flow's write gate writes nothing either, and a character that was added is never run
 * again by Retry.
 *
 * The real `characterCards.ts`, `dropImport.ts`, `modules.ts`, `processzip.ts`, `importBatch.ts`, `alertTask.svelte.ts` and
 * fflate run on synthetic files; the embedded module of the charx case is written by the real `exportModuleLegacy` and
 * `CharXWriter`. The store seams (`saveAsset`, `saveAssetFromPieces`, `importPreset`, `archiveCharacterNow` and the
 * `push` of the character and module lists) are recorders, so a test reads which write happened and when. A mocked store
 * says nothing about native storage.
 *
 * Gate dominance (R-b14) is measured, not guessed: a first run without a press records how many clock readings the card's
 * controller had made when the first write arrived; the second run presses Cancel at the reading two before that one,
 * which is the first progress report after the flow's last cancel check and before its write gate.
 *
 * Labels: (RR-m) new behaviour pinned by mutants, each named at its test.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import crc32 from 'crc/crc32'
import * as fflate from 'fflate'

const h = vi.hoisted(() => {
    const state = {
        errors: [] as string[],
        /** every store write, in order, named by its seam */
        writes: [] as string[],
        /** the clock readings made when the first write arrived */
        firstWriteAt: null as number | null,
        clockCalls: 0,
        /** press Cancel at this clock reading (once) */
        pressAt: null as number | null,
        pressed: false,
        characters: [] as Array<Record<string, unknown>>,
        modules: [] as Array<Record<string, unknown>>,
        files: [] as File[],
        opened: new Map<string, Uint8Array>(),
        archive: false,
        uuid: 0,
        assets: new Map<string, Uint8Array>(),
        /** called before each read of a hooked file; may press Cancel */
        beforeRead: null as null | ((index: number) => void | Promise<void>),
        /** called before each chunk of a hooked file's stream */
        beforeChunk: null as null | ((index: number) => void | Promise<void>),
        pulled: 0,
        saves: 0,
        onLog: null as null | ((message: string) => void),
        /** called when a low-level-access question is asked, before it is answered */
        onConfirm: null as null | (() => void),
        /** called before each RPack decode; the first one of a module is its scan, before the module's first cancel check */
        onDecode: null as null | (() => void),
        /** called when an asset save starts */
        onSaveAsset: null as null | (() => void),
    }
    //`h` is this one object, so a recorder and a test always read and write the same fields.
    const note = (what: string) => {
        state.writes.push(what)
        state.firstWriteAt ??= state.clockCalls
    }
    const spied = <T>(label: string): T[] => {
        const list: T[] = []
        list.push = (...items: T[]) => {
            note(label)
            return Array.prototype.push.apply(list, items)
        }
        return list
    }
    return Object.assign(state, { note, spied })
})

vi.mock('uuid', () => ({ v4: () => `uuid-${++h.uuid}` }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/drive/backupWorkGuard'), () => ({
    refuseImportWhileRestoring: () => false,
}) as unknown as typeof import('src/ts/drive/backupWorkGuard'))

vi.mock(import('src/ts/alert'), () => ({
    alertCardExport: vi.fn(),
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => { h.onConfirm?.(); return true }),
    alertError: vi.fn((msg: string | Error) => { h.errors.push(msg instanceof Error ? msg.message : String(msg)) }),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertModuleSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => {}),
    alertSelect: vi.fn(async () => '0'),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(async () => { h.note('importPreset') }),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: h.characters, goCharacterOnImport: false, modules: h.modules })),
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
        selectFileByDom: vi.fn(async () => h.files),
        selectSingleFile: vi.fn(),
        sleep: vi.fn(async () => { }),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => { }),
    characterFormatUpdate: vi.fn((c: unknown) => c),
    createBlankChar: vi.fn(() => ({ name: '', firstMessage: '', desc: '', emotionImages: [], bias: [], viewScreen: 'none', globalLore: [], utilityBot: false, customscript: [], exampleMessage: '', creatorNotes: '', systemPrompt: '', alternateGreetings: [], tags: [] })),
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
        downloadFile: vi.fn(async () => { }),
        forageStorage: {},
        loadAsset: vi.fn(async (key: string) => h.assets.get(key)),
        openURL: vi.fn(),
        pieceStoreOrNull: vi.fn(async () => null),
        readImage: vi.fn(async (key: string) => h.assets.get(key)),
        saveAsset: vi.fn(async (data: Uint8Array) => {
            h.onSaveAsset?.()
            h.note('saveAsset')
            h.saves += 1
            return `saved-${h.saves}-${data.length}`
        }),
        saveAssetFromPieces: vi.fn(async (pieces: AsyncIterable<Uint8Array>) => {
            h.note('saveAssetFromPieces')
            h.saves += 1
            for await (const _piece of pieces) { /* drained */ }
            return `saved-pieces-${h.saves}`
        }),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/process/coldCharacterArchive'), () => ({
    archiveCharacterNow: vi.fn(async () => {
        h.note('archiveCharacterNow')
        return { ok: true, index: 0 }
    }),
}) as unknown as typeof import('src/ts/process/coldCharacterArchive'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: h.characters, modules: h.modules, archiveCharacters: h.archive } } },
    HideIconStore: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
    alertStore: { set: vi.fn(), subscribe: (run: (v: { type: string }) => void) => { run({ type: 'none' }); return () => {} }, update: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    selectedCharID: { set: vi.fn() },
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn(async (d: Uint8Array) => `len${d.length}`),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

//The RPack layer is the identity, so a module written by the real exporter and a hand-built `.risum` read alike.
vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => new Uint8Array(data)),
    decodeRPack: vi.fn(async (data: Uint8Array) => { h.onDecode?.(); return new Uint8Array(data) }),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

vi.mock(import('src/ts/importSource'), async (importOriginal) => {
    const original = await importOriginal()
    return {
        ...original,
        openDesktopImportSource: vi.fn(async (path: string) => original.importSourceOfBytes(path, h.opened.get(path) ?? new Uint8Array())),
    } as unknown as typeof import('src/ts/importSource')
})

vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(async () => new Uint8Array()) }))
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn(async () => vi.fn()) }))

import { importCharacter, importCharacterFile, importOpenedSources } from 'src/ts/characterCards'
import { IMPORT_STEPS, ImportCancelled, makeImportProgress } from 'src/ts/importProgress'
import { importDroppedFile } from 'src/ts/dropImport'
import { exportModuleLegacy, type RisuModule } from 'src/ts/process/modules'
import { CharXWriter } from 'src/ts/process/processzip'
import { noteBootArchiveSession, resetBootArchiveStateForTest } from 'src/ts/process/memory/bootArchiveState'
import { risumBytes } from 'src/ts/process/tests/risumFixtures'
import { answerTask, requestTaskCancel, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskResultShowing } from 'src/ts/alertTask.svelte'
import type { TaskClock, TaskView } from 'src/lib/Nexus/pattern/taskProgress'
import { language } from 'src/lang'

//#region fixtures

const U8 = Uint8Array
const enc = new TextEncoder()
const SIG = new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new U8(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
        out.set(p, at)
        at += p.length
    }
    return out
}

function chunk(type: string, body: Uint8Array): Uint8Array {
    const t = enc.encode(type)
    const len = new U8(4)
    new DataView(len.buffer).setUint32(0, body.length)
    const crc = new U8(4)
    new DataView(crc.buffer).setUint32(0, crc32(Buffer.from(concat([t, body]))))
    return concat([len, t, body, crc])
}

const text = (key: string, value: string) => chunk('tEXt', concat([enc.encode(key), new U8([0]), enc.encode(value)]))
const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64')
const assetValue = (index: number, size: number) => Buffer.from(new U8(size).map((_, i) => (i * 31 + index * 17 + 5) & 0xff)).toString('base64')
const ASSET_SIZES = [300, 1500, 40_000]

/** The exporter's chunk order: image header and data, the assets, the card chunk, the end. */
function exportOrderPng(): Uint8Array {
    const v2 = JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: 'Synthetic', description: 'd', first_mes: 'hi', character_version: '1',
            extensions: { risuai: { additionalAssets: ASSET_SIZES.map((_, i) => [`a${i}`, `__asset:${i}`, 'bin']) } },
        },
    })
    return concat([
        SIG,
        chunk('IHDR', new U8(13).fill(1)), chunk('IDAT', new U8(40).fill(7)),
        ...ASSET_SIZES.map((s, i) => text(`chara-ext-asset_:${i}`, assetValue(i, s))),
        text('chara', b64(v2)),
        chunk('IEND', new U8(0)),
    ])
}

const OLD_CARD = JSON.stringify({ name: 'Synthetic', description: 'd', first_mes: 'hi' })

/** An old-format (tavern) card in a PNG: the card chunk holds no spec, so the image is the only asset. */
function tavernPng(): Uint8Array {
    return concat([SIG, chunk('IHDR', new U8(13).fill(1)), chunk('IDAT', new U8(40).fill(7)), text('chara', b64(OLD_CARD)), chunk('IEND', new U8(0))])
}

/** A v2 JSON card with three base64 emotions: three asset saves, no archive entries. */
function jsonCardWithEmotions(): string {
    return JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: 'Synthetic', description: 'd', first_mes: 'hi', character_version: '1',
            extensions: { risuai: { emotions: [['a', Buffer.from('one').toString('base64')], ['b', Buffer.from('two').toString('base64')], ['c', Buffer.from('three').toString('base64')]] } },
        },
    })
}

const YAML_CARD = 'name: Synthetic\ncontext: d\ngreeting: hi\n'
const PRESET = '{"name":"synthetic preset"}'

/**
 * The module the real exporter writes for a `module.risum` entry: one listed asset with its record in the file, so the
 * embedded read has a record to save and reaches its write gate. (`saveData: false` returns the bytes instead of a file.)
 */
async function embeddedModuleBytes(): Promise<Uint8Array> {
    h.assets.set('key-asset', new U8([1, 2, 3, 4, 5, 6, 7, 8]))
    const mod: RisuModule = { name: 'Embedded', id: 'embedded-1', description: 'd', assets: [['asset one', 'key-asset', 'png']] }
    const bytes = await exportModuleLegacy(mod, { alertEnd: false, saveData: false })
    expect(bytes, 'the real exporter wrote the module bytes').toBeTruthy()
    return new U8(bytes as Uint8Array)
}

/** A charx written by `CharXWriter` with no zip asset and an embedded module that has an asset. */
async function charxWithEmbeddedModule(): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    const writer = new CharXWriter({ write: async (c: Uint8Array) => { parts.push(c.slice()) }, close: async () => {} } as unknown as ConstructorParameters<typeof CharXWriter>[0])
    await writer.write('card.json', JSON.stringify({
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: { name: 'Synthetic', description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: {} }, assets: [] },
    }))
    await writer.write('module.risum', await embeddedModuleBytes())
    await writer.end()
    return concat(parts)
}

/** A Backyard archive as the samples have it: manifest, directories, images, then the character and scenario JSON. */
function byafArchive(): Uint8Array {
    const png = (n: number, seed: number) => {
        const a = new U8(n)
        let x = seed
        for (let i = 0; i < n; i++) {
            x = (x * 1103515245 + 12345) & 0x7fffffff
            a[i] = (x >> 16) & 0xff
        }
        a.set([0x89, 0x50, 0x4e, 0x47], 0)
        return a
    }
    const dir = 'characters/c1/'
    const files: fflate.Zippable = {}
    const put = (name: string, data: Uint8Array | string) => { files[name] = [typeof data === 'string' ? enc.encode(data) : data, { level: 0 }] }
    put('manifest.json', JSON.stringify({ schemaVersion: 1, createdAt: '2025-06-12T19:03:56.873Z', author: { name: 'Ann Author', backyardURL: 'https://example.invalid/ann' }, characters: [dir + 'character.json'], scenarios: ['scenarios/s1.json'] }))
    put('characters/', new U8(0))
    put(dir, new U8(0))
    put(dir + 'images/', new U8(0))
    put(dir + 'images/avatar.png', png(2000, 1))
    put('backgrounds/bg.bin', png(5000, 7))
    put('stray.txt', 'stray')
    put(dir + 'character.json', JSON.stringify({
        schemaVersion: 1, id: 'c1', name: 'Annie', displayName: 'Ann', isNSFW: true, persona: 'Persona of {character} for {user}',
        createdAt: '2025-06-12T19:03:56.873Z', updatedAt: '2025-06-13T19:03:56.873Z',
        loreItems: [{ key: 'cat, dog', value: 'Pets of {user}' }],
        images: [{ path: 'images/avatar.png', label: 'avatar' }],
    }))
    put('scenarios/', new U8(0))
    put('scenarios/s1.json', JSON.stringify({
        schemaVersion: 1, title: 'Dropped title', narrative: 'Narrative of {user}', formattingInstructions: 'Format for {character}',
        exampleMessages: [{ characterID: 'c1', text: '#{user}: hi\n#{character}: hello' }],
        firstMessages: [{ characterID: 'c1', text: 'Hello {user}' }], temperature: 0.7,
    }))
    return fflate.zipSync(files)
}

const BYAF_CHUNK = 512
const READ_CHUNK = 8 * 1024

/**
 * A file that tells a test about every read and every stream chunk before it happens: `slice(...).arrayBuffer()` calls
 * `h.beforeRead(index)` and `stream()` hands the bytes over in small chunks after calling `h.beforeChunk(index)`.
 */
class HookedFile extends File {
    readonly #bytes: Uint8Array
    readonly #chunk: number
    #reads = 0

    constructor(bytes: Uint8Array, name: string, chunkBytes: number = READ_CHUNK) {
        super([bytes as BlobPart], name)
        this.#bytes = bytes
        this.#chunk = chunkBytes
    }

    override slice(start?: number, end?: number, type?: string): Blob {
        const blob = super.slice(start, end, type)
        const read = blob.arrayBuffer.bind(blob)
        blob.arrayBuffer = async () => {
            this.#reads += 1
            await h.beforeRead?.(this.#reads)
            return await read()
        }
        return blob
    }

    override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
        const bytes = this.#bytes
        const size = this.#chunk
        let at = 0
        let index = 0
        return new ReadableStream<Uint8Array<ArrayBuffer>>({
            pull: async (controller) => {
                if (at >= bytes.length) {
                    controller.close()
                    return
                }
                await h.beforeChunk?.(index)
                index += 1
                const piece = bytes.slice(at, at + size)
                at += piece.length
                h.pulled += piece.length
                controller.enqueue(piece)
            },
        }, { highWaterMark: 0 })
    }
}

//#endregion

//#region running an import

/** Runs the action and answers every result card; Retry is pressed when offered and `retry` is set. Returns every card seen. */
async function runCards(run: () => Promise<unknown>, retry = false): Promise<TaskView[]> {
    const done = run()
    let ended = false
    void done.then(() => { ended = true }, () => { ended = true })
    const cards: TaskView[] = []
    for (let i = 0; i < 5000 && !ended; i++) {
        if (taskResultShowing()) {
            const view = taskHostView()
            if (view) cards.push(view)
            const offered = (view?.result?.actions ?? view?.failure?.actions ?? []).some((a) => a.id === 'retry')
            answerTask(retry && offered ? { kind: 'action', id: 'retry' } : { kind: 'ok' })
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await done
    return cards
}

/** Empties every recorder and gives the next run a fresh card slot and clock; a Cancel is pressed at reading `pressAt`. */
function resetRun(pressAt: number | null = null): void {
    resetTaskHostForTests()
    h.errors = []
    h.writes = []
    h.firstWriteAt = null
    h.clockCalls = 0
    h.pressAt = pressAt
    h.pressed = false
    h.characters = h.spied<Record<string, unknown>>('characters.push')
    h.modules = h.spied<Record<string, unknown>>('modules.push')
    h.beforeRead = null
    h.beforeChunk = null
    h.onLog = null
    h.onConfirm = null
    h.onDecode = null
    h.onSaveAsset = null
    h.pulled = 0
    h.saves = 0
    h.uuid = 0
    let now = 0
    const clock: TaskClock = {
        now: () => {
            h.clockCalls += 1
            if (h.pressAt !== null && h.clockCalls === h.pressAt) {
                h.pressAt = null
                h.pressed = true
                requestTaskCancel()
            }
            return (now += 1000)
        },
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => {},
        hidden: () => false,
    }
    setTaskClockForTests(clock)
}

beforeEach(() => {
    h.assets = new Map()
    h.opened = new Map()
    h.archive = false
    //The setup stub is a JSON round trip, which cannot clone `undefined`; the production helper can.
    vi.stubGlobal('safeStructuredClone', structuredClone)
    resetBootArchiveStateForTest()
    resetRun()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
        if (typeof message === 'string') h.onLog?.(message)
    })
})

afterEach(() => {
    resetTaskHostForTests()
    setTaskClockForTests(null)
    resetBootArchiveStateForTest()
    vi.restoreAllMocks()
})

//#endregion

describe('Cancel during a scan or check', () => {
    //(RR-m) M-b19: the PNG catch maps a cancel to "the card file changed" and the runner check is gone.
    test('R-b8: a PNG cancelled during its scan ends Cancelled and never reports "the card file changed"', async () => {
        h.files = [new HookedFile(exportOrderPng(), 'card.png')]
        const control = await runCards(() => importCharacter())
        expect(control.at(-1)?.result?.headline, 'the fixture imports').toBe(language.importTaskImported(1))
        expect(h.characters).toHaveLength(1)

        resetRun()
        h.files = [new HookedFile(exportOrderPng(), 'card.png')]
        //The first read is the signature check; the scan that follows reads through the cancel-aware wrapper.
        h.beforeRead = (index) => {
            if (index === 1) {
                requestTaskCancel()
                h.pressed = true
            }
        }
        const cards = await runCards(() => importCharacter())

        expect(h.pressed).toBe(true)
        expect(cards.at(-1)?.cancelled).toBe(true)
        expect(cards.at(-1)?.failure).toBeUndefined()
        expect(h.writes).toEqual([])
        expect(h.errors).toEqual([])
        //Only the cancel itself was logged: the changed-file refusal (a `PngCardSourceChanged`) never was.
        const logged = vi.mocked(console.error).mock.calls.map((call) => call[0])
        expect(logged.every((entry) => entry instanceof Error && entry.name === 'ImportCancelled')).toBe(true)
    })

    //(RR-m) M-b9: the parse loop ignores the abandon, so pass 1 reads the whole archive.
    test('R-b9: a byaf cancelled during pass 1 stops reading and saves nothing', async () => {
        const bytes = byafArchive()
        h.files = [new HookedFile(bytes, 'card.byaf', BYAF_CHUNK)]
        const control = await runCards(() => importCharacter())
        expect(control.at(-1)?.failure ?? control.at(-1)?.result?.headline, 'the fixture imports').toBe(language.importTaskImported(1))
        expect(h.characters).toHaveLength(1)

        resetRun()
        h.files = [new HookedFile(bytes, 'card.byaf', BYAF_CHUNK)]
        let offered: boolean | undefined
        h.beforeChunk = (index) => {
            if (index === 3) {
                offered = taskHostView()?.cancelOffered
                requestTaskCancel()
                h.pressed = true
            }
        }
        const cards = await runCards(() => importCharacter())

        expect(h.pressed).toBe(true)
        expect(offered).toBe(true)
        expect(cards.at(-1)?.cancelled).toBe(true)
        expect(h.writes).toEqual([])
        expect(h.characters).toHaveLength(0)
        //Pass 1 stopped at the press: the archive was not read to its end.
        expect(h.pulled).toBeLessThan(bytes.length / 2)
    })

    //(RR-m) M-b13: the card-spec write gate is gone, so the press during the check does not stop the saves.
    test('R-b10: a JSON card cancelled during its check saves nothing and adds no character', async () => {
        h.files = [new File([jsonCardWithEmotions()], 'card.json')]
        const control = await runCards(() => importCharacter())
        expect(control.at(-1)?.result?.headline, 'the fixture imports').toBe(language.importTaskImported(1))
        expect(h.saves).toBe(3)

        resetRun()
        h.files = [new File([jsonCardWithEmotions()], 'card.json')]
        let stepAtPress: number | undefined
        h.onLog = (message) => {
            if (message.startsWith('Importing chara_card') && !h.pressed) {
                stepAtPress = taskHostView()?.stepIndex
                requestTaskCancel()
                h.pressed = true
            }
        }
        const cards = await runCards(() => importCharacter())

        expect(h.pressed).toBe(true)
        //Step 1 of the card's steps is the check.
        expect(stepAtPress).toBe(1)
        expect(cards.at(-1)?.cancelled).toBe(true)
        expect(h.writes).toEqual([])
        expect(h.characters).toHaveLength(0)
    })
})

type Flow = { label: string, character: boolean, run: () => Promise<TaskView[]> }

const picker = (name: string, bytes: Uint8Array | string): (() => Promise<TaskView[]>) => async () => {
    h.files = [new File([bytes as BlobPart], name)]
    return await runCards(() => importCharacter())
}
const opened = (name: string, bytes: Uint8Array | string): (() => Promise<TaskView[]>) => async () => {
    const path = `content://provider/${name}`
    h.opened.set(path, typeof bytes === 'string' ? enc.encode(bytes) : bytes)
    return await runCards(() => importOpenedSources([{ name, path, type: '' }]))
}
const dropped = (name: string, bytes: Uint8Array | string): (() => Promise<TaskView[]>) => async () =>
    await runCards(() => importDroppedFile(new File([bytes as BlobPart], name)))

const flows: Flow[] = [
    { label: 'YAML card', character: true, run: picker('card.yaml', YAML_CARD) },
    { label: 'old-format JSON card', character: true, run: picker('old.json', OLD_CARD) },
    { label: 'card-spec JSON with base64 assets', character: true, run: picker('card.json', jsonCardWithEmotions()) },
    { label: 'PNG with a card spec and assets', character: true, run: picker('card.png', exportOrderPng()) },
    { label: 'PNG tavern card', character: true, run: picker('tavern.png', tavernPng()) },
    { label: 'charx with no zip asset and an embedded module with an asset', character: true, run: async () => await picker('card.charx', await charxWithEmbeddedModule())() },
    { label: 'picker preset', character: false, run: opened('p.risup', PRESET) },
    { label: 'drop preset', character: false, run: dropped('p.risup', PRESET) },
]

describe('gate dominance: a Cancel at the last checkpoint before the write gate writes nothing', () => {
    //(RR-m) Each flow is run twice. The first run, with no press, records the clock reading at its first write; the second
    //presses Cancel two readings earlier, after the flow's last cancel check, and no write seam may then be called.
    //Mutants shown killed: M-b12 (YAML, old card), M-b13 (JSON base64), M-b14 (PNG spec), M-b15 (PNG tavern), M-b22
    //(picker preset), M-b25 (drop preset). The module-push gates and the embedded module's gate are pinned below at a
    //fixed structural seam, because removing them moves a self-calibrated press point.
    const cases = flows.flatMap((flow) => flow.character ? [[flow, false], [flow, true]] as const : [[flow, false]] as const)
    test.each(cases)('R-b14: %s writes nothing when Cancel is pressed just before its gate (archive %s)', async (flow, archive) => {
        const arrange = () => {
            h.archive = archive
            noteBootArchiveSession(archive)
        }
        arrange()
        const control = await flow.run()
        expect(control.at(-1)?.result?.headline, 'the flow imports when nobody presses Cancel').toBe(language.importTaskImported(1))
        expect(h.writes.length, 'the flow reached a store write').toBeGreaterThan(0)
        const firstWrite = h.firstWriteAt as number
        expect(firstWrite).toBeGreaterThan(2)
        if (flow.character) {
            //The write that adds the character is the one the archive switch selects.
            expect(h.writes).toContain(archive ? 'archiveCharacterNow' : 'characters.push')
        }

        resetRun(firstWrite - 2)
        arrange()
        const cards = await flow.run()

        expect(h.pressed, 'Cancel was pressed').toBe(true)
        expect(cards.at(-1)?.cancelled).toBe(true)
        //Zero calls on saveAsset, saveAssetFromPieces, archiveCharacterNow, importPreset and both list pushes.
        expect(h.writes).toEqual([])
        expect(h.characters).toHaveLength(0)
        expect(h.modules).toHaveLength(0)
    })
})

describe('gate dominance at a fixed structural seam', () => {
    //Each press lands where the flow's own code, not a measured clock reading, puts it: after the last cancel check that
    //could catch it and before the gate under test, so removing that gate cannot move the press out of the window.
    const zeroAssetModule = () => risumBytes({ module: { name: 'Zero', lowLevelAccess: true } })
    const viaPicker = opened
    const viaDrop = dropped

    //(RR-m) M-b24 (picker module push gate) and M-b26 (drop module push gate). A zero-asset module has no gate in `readModule`,
    //so the push gate is the only one: the press inside the low-level question runs after readModule's last cancel check.
    test.each([['picker', viaPicker], ['drop', viaDrop]] as const)('R-b14s: a zero-asset .risum cancelled inside its low-level question writes nothing (%s)', async (_label, via) => {
        const control = await via('m.risum', zeroAssetModule())()
        expect(control.at(-1)?.result?.headline, 'the module imports when nobody presses Cancel').toBe(language.importTaskImported(1))
        expect(h.writes).toEqual(['modules.push'])

        resetRun()
        let asked = 0
        h.onConfirm = () => {
            asked += 1
            requestTaskCancel()
            h.pressed = true
        }
        const cards = await via('m.risum', zeroAssetModule())()

        expect(asked).toBe(1)
        expect(h.pressed).toBe(true)
        expect(cards.at(-1)?.cancelled).toBe(true)
        expect(h.writes).toEqual([])
        expect(h.modules).toHaveLength(0)
    })

    //(RR-m) M-b16: the embedded module is read without the round's gate and cancel checks. The press lands at the module's
    //scan (its first RPack decode), before the nested read's own cancel check and before any of its records is saved.
    test('R-b14m: a charx whose embedded module is cancelled at its scan saves no asset of it', async () => {
        const bytes = await charxWithEmbeddedModule()
        const control = await picker('card.charx', bytes)()
        expect(control.at(-1)?.result?.headline, 'the charx imports when nobody presses Cancel').toBe(language.importTaskImported(1))
        expect(h.writes, 'the embedded module saved its asset').toContain('saveAsset')

        resetRun()
        h.onDecode = () => {
            if (!h.pressed) {
                requestTaskCancel()
                h.pressed = true
            }
        }
        const cards = await picker('card.charx', bytes)()

        expect(h.pressed).toBe(true)
        expect(cards.at(-1)?.cancelled).toBe(true)
        expect(h.writes).toEqual([])
        expect(h.characters).toHaveLength(0)
    })

    //(RR-m) M-b16b: the embedded module gets the file's own progress, so its steps move the card and its bytes show on it.
    //The nested read has no steps or sinks of its own: while its asset is saved the card stays on the check step.
    test('R-b14n: the embedded module of a charx saves its asset while the card is still on the check step with no bytes', async () => {
        const bytes = await charxWithEmbeddedModule()
        const seen: Array<{ label: string | undefined, bytes: unknown }> = []
        h.onSaveAsset = () => {
            const view = taskHostView()
            seen.push({ label: view?.steps[view.stepIndex]?.label, bytes: view?.bytes })
        }
        const cards = await picker('card.charx', bytes)()

        expect(cards.at(-1)?.result?.headline).toBe(language.importTaskImported(1))
        expect(seen).toHaveLength(1)
        expect(seen[0].label).toBe(language.importStepCheck)
        expect(seen[0].bytes).toBeUndefined()
    })
})

describe('a Cancel that ends a PNG scan without a runner', () => {
    //(RR-m) M-b19: the PNG catch maps the abort to "the card file changed". With no runner nothing else turns the outcome
    //into a cancel, so the file-level outcome itself must carry the cancel.
    test('R-b8f: importCharacterFile on a PNG whose progress aborts during the scan fails with ImportCancelled, not a file-changed refusal', async () => {
        const controller = new AbortController()
        const quiet = () => {}
        const progress = makeImportProgress({
            signal: controller.signal, steps: IMPORT_STEPS, gate: { locked: false }, round: { number: 0, index: 0, count: 1 },
            lock: () => true, setStep: quiet, bytes: quiet, count: quiet, found: quiet, onCommitted: quiet, onNotice: quiet,
        })
        const file = new HookedFile(exportOrderPng(), 'card.png')
        //The first read is the signature check; the scan that follows reads through the cancel-aware wrapper.
        h.beforeRead = (index) => {
            if (index === 1) {
                controller.abort()
                h.pressed = true
            }
        }
        const outcome = await importCharacterFile({ name: 'card.png', data: file }, null, progress)

        expect(h.pressed).toBe(true)
        expect(outcome.kind).toBe('failed')
        expect(outcome.kind === 'failed' && outcome.error instanceof ImportCancelled).toBe(true)
        expect(h.writes).toEqual([])
    })
})

describe('Retry after a character was added', () => {
    //(RR-m) M-b18: `committed()` is dropped in `addImportedCharacter`, on the live push and on the archive return. The failure
    //is injected after the character is added: the success line reads `language.importedCharacter`, which throws once here.
    //The item is then failed with its marker set, so the data state is unknown and Retry is not offered; without the marker
    //Retry would add the character a second time.
    test.each([false, true])('R-b13b: an item that fails after its character was added reports the data as changed and Retry does not run it again (archive %s)', async (archive) => {
        h.archive = archive
        noteBootArchiveSession(archive)
        const original = Object.getOwnPropertyDescriptor(language, 'importedCharacter') as PropertyDescriptor
        let thrown = false
        Object.defineProperty(language, 'importedCharacter', {
            configurable: true,
            get() {
                if (!thrown) {
                    thrown = true
                    throw new Error('late failure')
                }
                return original.value
            },
        })
        try {
            h.files = [new File([OLD_CARD], 'old.json')]
            const cards = await runCards(() => importCharacter(), true)

            expect(thrown).toBe(true)
            //The character is added once, by the live push or by the archive write; Retry never adds it again.
            expect(h.writes).toEqual([archive ? 'archiveCharacterNow' : 'characters.push'])
            expect(h.characters).toHaveLength(archive ? 0 : 1)
            expect(cards).toHaveLength(1)
            expect(cards[0].failure?.dataState).toBe('unknown')
            expect(cards[0].failure?.actions ?? []).toEqual([])
        } finally {
            Object.defineProperty(language, 'importedCharacter', original)
        }
    })
})
