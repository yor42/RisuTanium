/**
 * A `.charx` module file on the import task card (`importModule` in `src/ts/process/modules.ts`): Cancel stays offered
 * while the archive is read, and a press there ends the round Cancelled with nothing saved.
 *
 * The real `modules.ts`, `characterCards.ts`, `processzip.ts`, `importBatch.ts`, `alertTask.svelte.ts` and fflate run. The
 * archive is the module's real CharX export (`exportModule`, `exportCharacterCard`, `CharXWriter`) captured through a
 * writer; the asset store, alerts, database and the lossy codec are recorders, as in `modules.charxFolders.test.ts`. The
 * archive is handed over as a `File` whose `stream()` pulls small chunks and calls a test hook before each one. A mocked
 * store says nothing about native storage.
 *
 * Labels: (RR-m) new behaviour pinned by the mutant that keeps the entry gate of the first stage (M-b28 / M-a5c).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    chunks: [] as Uint8Array[],
    errors: [] as string[],
    assets: new Map<string, Uint8Array>(),
    saved: new Map<string, Uint8Array>(),
    modules: [] as unknown[],
    picked: [] as File[],
    /** called before each chunk of a hooked file's stream */
    beforeChunk: null as null | ((index: number) => void | Promise<void>),
    pulled: 0,
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
        alertSelect: vi.fn(async () => '0'),
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
    DBState: { get db() { return { imageCompression: false, modules: h.modules } } },
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
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

//The RPack layer is the identity, so the module written by the real exporter and a hand-built `.risum` read alike.
vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => new Uint8Array(data)),
    decodeRPack: vi.fn(async (data: Uint8Array) => new Uint8Array(data)),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

import { exportModule, importModule, type RisuModule } from 'src/ts/process/modules'
import { risumBytes } from 'src/ts/process/tests/risumFixtures'
import { answerTask, confirmTask, requestTaskCancel, resetTaskHostForTests, setTaskClockForTests, taskConfirmShowing, taskHostView, taskResultShowing } from 'src/ts/alertTask.svelte'
import type { TaskClock, TaskView } from 'src/lib/Nexus/pattern/taskProgress'

const PORTRAIT = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0,
    0x90, 0x77, 0x53, 0xde, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4, 5, 6, 7, 8])

const CHUNK = 64

function syntheticModule(): RisuModule {
    return {
        name: 'Synthetic Module',
        description: 'module notes',
        id: 'module-1',
        assets: [['webp one', 'key-webp', 'webp']],
        icon: 'key-portrait',
        namespace: 'synthetic-ns',
        customModuleToggle: '<toggle>',
    }
}

/** The module's real CharX bytes, written by the real export through a capturing writer. */
async function exportBytes(mod: RisuModule): Promise<Uint8Array> {
    h.chunks.length = 0
    h.errors.length = 0
    await exportModule(mod, { alertEnd: false })
    expect(h.errors).toEqual([])
    const bytes = Buffer.concat(h.chunks)
    expect(bytes.length).toBeGreaterThan(0)
    return new Uint8Array(bytes)
}

/** A picked file whose `stream()` hands the archive over in small chunks and calls `h.beforeChunk` before each one; `reads` counts its `slice` reads. */
class HookedFile extends File {
    readonly #bytes: Uint8Array
    reads = 0

    constructor(bytes: Uint8Array, name: string) {
        super([bytes as BlobPart], name)
        this.#bytes = bytes
    }

    override slice(start?: number, end?: number, type?: string): Blob {
        this.reads += 1
        return super.slice(start, end, type)
    }

    override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
        const bytes = this.#bytes
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
                const piece = bytes.slice(at, at + CHUNK)
                at += piece.length
                h.pulled += piece.length
                controller.enqueue(piece)
            },
        }, { highWaterMark: 0 })
    }
}

/** Runs the module import and answers every result card; returns every card seen. */
async function runImport(): Promise<TaskView[]> {
    const done = importModule()
    let ended = false
    void done.then(() => { ended = true }, () => { ended = true })
    const cards: TaskView[] = []
    for (let i = 0; i < 5000 && !ended; i++) {
        if (taskConfirmShowing()) confirmTask()
        if (taskResultShowing()) {
            const view = taskHostView()
            if (view) cards.push(view)
            answerTask({ kind: 'ok' })
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await done
    return cards
}

function freshTaskClock(): void {
    resetTaskHostForTests()
    let now = 0
    const clock: TaskClock = {
        now: () => (now += 1000),
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => {},
        hidden: () => false,
    }
    setTaskClockForTests(clock)
}

beforeEach(() => {
    h.saved.clear()
    h.chunks.length = 0
    h.errors.length = 0
    h.modules = []
    h.assets.clear()
    h.assets.set('key-portrait', PORTRAIT)
    h.assets.set('key-webp', WEBP)
    h.beforeChunk = null
    h.pulled = 0
    freshTaskClock()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    resetTaskHostForTests()
    setTaskClockForTests(null)
    vi.restoreAllMocks()
})

describe('the .charx module route keeps its Cancel window', () => {
    //(RR-m) M-b28 / M-a5c: the entry gate of the first stage locked Cancel when a `.charx` module file started, so Cancel was
    //never offered during its archive read and a press was refused.
    test('R-b25: Cancel is offered during the archive read of a .charx module and a press ends the round Cancelled with zero saves', async () => {
        const archive = await exportBytes(syntheticModule())
        expect(Math.ceil(archive.length / CHUNK), 'the archive spans several chunks').toBeGreaterThan(4)

        //The same file imports when nobody presses Cancel, and it saves its assets: the zero below is a real difference.
        h.picked = [new HookedFile(archive, 'x.charx')]
        const control = await runImport()
        expect(control.at(-1)?.result?.headline).toBeTruthy()
        expect(control.at(-1)?.cancelled).toBe(false)
        expect(h.modules).toHaveLength(1)
        expect(h.saved.size).toBeGreaterThan(0)

        h.saved.clear()
        h.modules = []
        h.pulled = 0
        freshTaskClock()
        const x = new HookedFile(archive, 'x.charx')
        const y = new HookedFile(risumBytes({ module: { name: 'Y' } }), 'y.risum')
        h.picked = [x, y]
        const offered: Array<boolean | undefined> = []
        let pressed = false
        h.beforeChunk = (index) => {
            offered.push(taskHostView()?.cancelOffered)
            if (index === 2) {
                requestTaskCancel()
                pressed = true
            }
        }
        const cards = await runImport()

        expect(pressed).toBe(true)
        //Cancel is offered from the start of x's read to the press.
        expect(offered.slice(0, 3)).toEqual([true, true, true])
        expect(cards.at(-1)?.cancelled).toBe(true)
        expect(h.saved.size).toBe(0)
        expect(h.modules).toHaveLength(0)
        expect(h.pulled).toBeLessThan(archive.length)
        //The round ended at the press: the second file was never opened.
        expect(y.reads).toBe(0)
    })
})
