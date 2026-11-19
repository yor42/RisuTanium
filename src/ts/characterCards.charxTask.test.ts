/**
 * Charx card import on the task card through `importCharacter` in `src/ts/characterCards.ts`: what the count shows while
 * the archive is read, and that Cancel works until the first asset save starts and not after.
 *
 * The real `characterCards.ts`, `processzip.ts` (`CharXImporter`, `CharXWriter`), `importBatch.ts`, `alertTask.svelte.ts`
 * and fflate run on archives written by the fork's producer (`CharXWriter`) and by the upstream framing
 * (`fflateZipArchive`). The archive is handed over as a `File` whose `stream()` pulls small chunks and calls a test hook
 * before each one, so a test looks at the card or presses Cancel in the middle of the read. Asset storage, alerts and the
 * database are recorders.
 *
 * Labels: (RR-m) new behaviour pinned by mutants. R-b2 was designed as a reproducer; the base has no open count to compare
 * against, so it is pinned by the mutant that uses the closed count in the read phase.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
    type Alert = { type?: string, msg?: string, submsg?: string }
    return {
        errors: [] as string[],
        alerts: [] as Alert[],
        characters: [] as Array<Record<string, unknown>>,
        files: [] as File[],
        uuid: 0,
        /** whole-entry saves that began */
        saveStarts: 0,
        saved: 0,
        /** held until released: the first save does not end before it */
        firstSave: null as Promise<void> | null,
        onSaveStart: null as null | ((n: number) => void),
        /** called before each chunk of the archive is handed to the reader */
        beforeChunk: null as null | ((index: number) => void | Promise<void>),
        /** archive bytes handed to the reader so far */
        pulled: 0,
        onBuild: null as null | (() => void),
    }
})

vi.mock('uuid', () => ({ v4: () => { h.onBuild?.(); return `uuid-${++h.uuid}` } }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/alert'), () => ({
    alertCardExport: vi.fn(),
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn((msg: string | Error) => { h.errors.push(msg instanceof Error ? msg.message : String(msg)) }),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: (v: { type?: string, msg?: string, submsg?: string }) => { h.alerts.push(v) }, subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn((msg: string) => { h.alerts.push({ type: 'wait', msg }) }),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: h.characters, goCharacterOnImport: false })),
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
        decryptBuffer: vi.fn(async (d: unknown) => d),
        isKnownUri: vi.fn(() => false),
        selectFileByDom: vi.fn(async () => h.files),
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
        AssetSourceChangedError: class extends Error {},
        BlankWriter: class {},
        LocalWriter: class {},
        VirtualWriter: class {},
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(async () => {}),
        forageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async (d: unknown) => d),
        pieceStoreOrNull: vi.fn(async () => null),
        saveAssetFromPieces: vi.fn(),
        saveAsset: vi.fn(async (data: Uint8Array) => {
            h.saveStarts += 1
            const n = h.saveStarts
            h.onSaveStart?.(n)
            if (n === 1 && h.firstSave) await h.firstSave
            h.saved += 1
            return `asset-${n}-${data.length}`
        }),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: h.characters } } },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
    alertStore: { set: vi.fn(), subscribe: (run: (v: { type: string }) => void) => { run({ type: 'none' }); return () => {} }, update: vi.fn() },
    selectedCharID: { set: vi.fn() },
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn(async (d: Uint8Array) => `len${d.length}`),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(async () => ({ lorebook: [], trigger: [], regex: [] })),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(async () => new Uint8Array()) }))
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn(async () => vi.fn()) }))

import { importCharacter } from 'src/ts/characterCards'
import { CharXWriter } from 'src/ts/process/processzip'
import { fflateZipArchive, type ZipEntry } from 'src/ts/process/tests/zipFixtures'
import { answerTask, requestTaskCancel, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskResultShowing } from 'src/ts/alertTask.svelte'
import { taskAmountText, type TaskClock, type TaskLabels, type TaskView } from 'src/lib/Nexus/pattern/taskProgress'
import { language } from 'src/lang'

const enc = new TextEncoder()
const CHUNK = 8 * 1024
const ASSET_COUNT = 5
const ASSET_BYTES = 20 * 1024

//The strings the card renders its count with.
const labels: TaskLabels = {
    stepOf: language.patternTaskStepOf,
    fileOf: language.patternTaskFileOf,
    count: language.patternTaskCount,
    countFound: language.patternTaskCountFound,
    bytes: language.patternTaskBytes,
    cancelling: language.patternTaskCancelling,
    cancelledHeadline: language.patternTaskCancelled,
    skippedTitle: language.patternTaskSkippedTitle,
}

function assetBytes(seed: number): Uint8Array {
    const out = new Uint8Array(ASSET_BYTES)
    let x = seed
    for (let i = 0; i < out.length; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff
        out[i] = (x >> 16) & 0xff
    }
    return out
}

const assetNames = Array.from({ length: ASSET_COUNT }, (_, i) => `assets/a${i}.bin`)

const cardJson = JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
        name: 'Synthetic', description: 'd', first_mes: 'hi', character_version: '1',
        extensions: { risuai: {} },
        assets: assetNames.map((name) => ({ type: 'x-risu-asset', uri: `embeded://${name}`, name, ext: 'bin' })),
    },
})

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
        out.set(p, at)
        at += p.length
    }
    return out
}

/** The archive the fork's exporter writes: card.json first, then the assets. */
async function writerArchive(): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    const writer = new CharXWriter({ write: async (chunk: Uint8Array) => { parts.push(chunk.slice()) }, close: async () => {} } as unknown as ConstructorParameters<typeof CharXWriter>[0])
    await writer.write('card.json', cardJson)
    for (let i = 0; i < ASSET_COUNT; i++) {
        await writer.write(assetNames[i], assetBytes(i + 1), 0)
    }
    await writer.end()
    return concat(parts)
}

/** The same entries in the framing upstream writes (streaming zip, data descriptors). */
async function upstreamArchive(): Promise<Uint8Array> {
    const entries: ZipEntry[] = [['card.json', enc.encode(cardJson), 0], ...assetNames.map((name, i): ZipEntry => [name, assetBytes(i + 1), 0])]
    return fflateZipArchive(entries)
}

/** A picked file whose `stream()` hands the archive over in small chunks and calls `h.beforeChunk` before each one. */
class GatedFile extends File {
    readonly #bytes: Uint8Array

    constructor(bytes: Uint8Array, name: string) {
        super([bytes as BlobPart], name)
        this.#bytes = bytes
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

const chunkCount = (bytes: Uint8Array) => Math.ceil(bytes.length / CHUNK)

//Lets the importer's pending microtasks (saves that finished, the progress they reported) run before a sample is taken.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Runs the picker import and answers its result card; returns the card the import ended on. */
async function runImport(): Promise<TaskView | null> {
    const done = importCharacter()
    let ended = false
    void done.then(() => { ended = true }, () => { ended = true })
    let card: TaskView | null = null
    for (let i = 0; i < 5000 && !ended; i++) {
        if (taskResultShowing()) {
            card = taskHostView()
            answerTask({ kind: 'ok' })
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await done
    return card
}

beforeEach(() => {
    h.errors = []
    h.alerts = []
    h.characters = []
    h.files = []
    h.uuid = 0
    h.saveStarts = 0
    h.saved = 0
    h.firstSave = null
    h.onSaveStart = null
    h.beforeChunk = null
    h.pulled = 0
    h.onBuild = null
    let now = 0
    const clock: TaskClock = {
        now: () => (now += 1000),
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => {},
        hidden: () => false,
    }
    setTaskClockForTests(clock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    resetTaskHostForTests()
    setTaskClockForTests(null)
    vi.restoreAllMocks()
})

const producers: Array<[string, () => Promise<Uint8Array>]> = [
    ['CharXWriter archive (fork producer)', writerArchive],
    ['fflateZipArchive archive (upstream framing)', upstreamArchive],
]

describe('charx read: the count while the archive is read', () => {
    //(RR-m) During the read the number of assets is still growing: the count is open and says "found so far"; once every
    //entry is queued it is closed and reaches n/n. M-b3 (the read phase reports the closed count) fails the open checks.
    test.each(producers)('R-b2: %s: the count is open with found-so-far text and a growing total during the read, then closed at n/n', async (_label, build) => {
        const bytes = await build()
        h.files = [new GatedFile(bytes, 'card.charx')]
        let releaseFirst: () => void = () => {}
        //The first save stays in flight until the last chunk is handed over, so later entries are queued while it is held.
        h.firstSave = new Promise<void>((resolve) => { releaseFirst = resolve })
        type Sample = { step: number, done: number, total: number, open: boolean, text: string }
        const during: Sample[] = []
        h.beforeChunk = async (index) => {
            await settle()
            const view = taskHostView()
            if (view?.count) {
                during.push({ step: view.stepIndex, done: view.count.done, total: view.count.total, open: view.count.open === true, text: taskAmountText(view, labels) })
            }
            if (index === chunkCount(bytes) - 1) {
                releaseFirst()
            }
        }
        let atAdd: { done: number, total: number, open?: boolean } | undefined
        h.onBuild = () => {
            const count = taskHostView()?.count
            atAdd ??= count && { done: count.done, total: count.total, open: count.open }
        }
        const card = await runImport()

        expect(h.characters).toHaveLength(1)
        expect(card?.result?.headline).toBe(language.importTaskImported(1))
        expect(h.saveStarts).toBe(ASSET_COUNT)
        //Every sample taken while the archive was read is the open count of the Read step.
        expect(during.length).toBeGreaterThanOrEqual(3)
        expect(during.every((s) => s.open && s.step === 0)).toBe(true)
        //The read step carries the assets noun, so the open count reads "Assets 2 saved, 5 found so far".
        expect(during.every((s) => s.text === language.patternTaskCountFound(language.importNounAssets, s.done, s.total))).toBe(true)
        const totals = during.map((s) => s.total)
        expect(totals).toEqual([...totals].sort((a, b) => a - b))
        expect(new Set(totals).size, 'expected the total to grow while entries were queued').toBeGreaterThanOrEqual(2)
        expect(during.every((s) => s.done <= s.total)).toBe(true)
        //At the add the count is closed and complete.
        expect(atAdd).toMatchObject({ done: ASSET_COUNT, total: ASSET_COUNT })
        expect(atAdd?.open).not.toBe(true)
    })
})

describe('charx cancel', () => {
    //(RR-m) A Cancel before the first save leaves nothing and stops the read. M-b9 (the parse loop ignores the abandon) and
    //M-b11 (the write hook's result is ignored) both make a save or a full read happen.
    test.each(producers)('R-b6: %s: Cancel before the first save: no save, no character, the archive is not read to its end', async (_label, build) => {
        const bytes = await build()
        h.files = [new GatedFile(bytes, 'card.charx')]
        let offeredAtPress: boolean | undefined
        let pressed = false
        let pulledAtPress = 0
        h.beforeChunk = (index) => {
            //The first asset entry is not complete before several chunks have been read.
            if (index === 1) {
                offeredAtPress = taskHostView()?.cancelOffered
                pulledAtPress = h.pulled
                requestTaskCancel()
                pressed = true
            }
        }
        const card = await runImport()

        expect(pressed).toBe(true)
        expect(offeredAtPress).toBe(true)
        expect(card?.cancelled).toBe(true)
        expect(h.saveStarts).toBe(0)
        expect(h.characters).toEqual([])
        expect(h.pulled).toBeLessThan(bytes.length)
        //The press itself ends the read: at most the chunk in flight is still taken, well before the first asset entry is
        //complete (a later save hook would also stop the read, but only after that entry).
        expect(h.pulled - pulledAtPress).toBeLessThanOrEqual(CHUNK)
        expect(h.errors).toEqual([])
    })

    //(RR-m) The first save to start locks Cancel: the card withdraws it, a press is refused and the import completes.
    //M-b11 (the hook's result ignored) leaves the lock to the first asset save of the card spec, after the read.
    test.each(producers)('R-b7: %s: Cancel is offered during the read, locked at the first save start, and a later press is refused', async (_label, build) => {
        const bytes = await build()
        h.files = [new GatedFile(bytes, 'card.charx')]
        let offeredAtRead: boolean | undefined
        h.beforeChunk = (index) => {
            if (index === 1) offeredAtRead = taskHostView()?.cancelOffered
        }
        let offeredAtSave: boolean | undefined
        let stateAfterPress: string | undefined
        h.onSaveStart = (n) => {
            if (n !== 1) return
            offeredAtSave = taskHostView()?.cancelOffered
            requestTaskCancel()
            stateAfterPress = taskHostView()?.state
        }
        const card = await runImport()

        expect(offeredAtRead).toBe(true)
        expect(offeredAtSave).toBe(false)
        expect(stateAfterPress).toBe('running')
        expect(card?.cancelled).toBe(false)
        expect(card?.result?.headline).toBe(language.importTaskImported(1))
        expect(h.saveStarts).toBe(ASSET_COUNT)
        expect(h.characters).toHaveLength(1)
    })
})
