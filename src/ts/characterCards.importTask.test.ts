/**
 * Character import on the task card through `importCharacter` in `src/ts/characterCards.ts`: what the card shows while a
 * PNG or JSON card saves its assets, and that nothing legacy is posted for a migrated flow.
 *
 * The real `characterCards.ts`, `pngChunk.ts`, `importBatch.ts`, `alertTask.svelte.ts` and `busyActions.ts` run on
 * synthetic cards; asset storage, alerts and the database are recorders. The observer reads both progress surfaces: the
 * legacy `progress` alert (fraction = submsg / 100) and the task card's count.
 *
 * Labels: (RR) regression reproducer, fails on the base before the card; (RR-m) new behaviour pinned by mutants.
 */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import crc32 from 'crc/crc32'

const h = vi.hoisted(() => {
    type Alert = { type?: string, msg?: string, submsg?: string }
    return {
        saved: [] as Array<{ id: string, length: number }>,
        errors: [] as string[],
        alerts: [] as Alert[],
        characters: [] as Array<Record<string, unknown>>,
        files: [] as File[],
        uuid: 0,
        confirm: true,
        onSave: null as null | (() => void),
        //When set, a save awaits it after onSave ran and before the save resolves; the first save also signals `holding`.
        hold: null as null | Promise<void>,
        holding: null as null | (() => void),
        //Called when the character is built, which is after every save and before the Add step clears the count.
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
    alertConfirm: vi.fn(async () => h.confirm),
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

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    isKnownUri: vi.fn(() => false),
    selectFileByDom: vi.fn(async () => h.files),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

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
        saveAsset: vi.fn(async (data: Uint8Array) => {
            h.onSave?.()
            h.holding?.()
            if (h.hold) await h.hold
            const id = createHash('sha1').update(data).digest('hex')
            h.saved.push({ id, length: data.length })
            return id
        }),
        //Drains the pieces like the real piece save, then resolves after the hold like a whole-asset save.
        saveAssetFromPieces: vi.fn(async (pieces: AsyncIterable<Uint8Array>) => {
            let length = 0
            for await (const piece of pieces) length += piece.length
            h.onSave?.()
            h.holding?.()
            if (h.hold) await h.hold
            h.saved.push({ id: `pieces-${length}`, length })
            return `pieces-${length}`
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
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    selectedCharID: { set: vi.fn() },
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn(async (d: Uint8Array) => `len${d.length}`),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/processzip'), () => ({
    CharXImporter: class {},
    CharXWriter: class {},
    assetByteLimit: () => 200 * 1024 * 1024,
}) as unknown as typeof import('src/ts/process/processzip'))

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(async () => new Uint8Array()) }))
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn(async () => vi.fn()) }))

import { importCharacter } from 'src/ts/characterCards'
import { answerTask, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskResultShowing } from 'src/ts/alertTask.svelte'
import type { TaskClock } from 'src/lib/Nexus/pattern/taskProgress'
import { alertConfirm } from 'src/ts/alert'
import { language } from 'src/lang'
import { ASSET_PIECE_SAVE_MIN_BYTES } from 'src/ts/assetHash'

const U8 = Uint8Array
const SIG = new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const utf8 = (s: string) => new TextEncoder().encode(s)

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
    const t = utf8(type)
    const len = new U8(4)
    new DataView(len.buffer).setUint32(0, body.length)
    const crc = new U8(4)
    new DataView(crc.buffer).setUint32(0, crc32(Buffer.from(concat([t, body]))))
    return concat([len, t, body, crc])
}

const text = (key: string, value: string) => chunk('tEXt', concat([utf8(key), new U8([0]), utf8(value)]))
const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64')
const assetValue = (index: number, size: number) => Buffer.from(new U8(size).map((_, i) => (i * 31 + index * 17 + 5) & 0xff)).toString('base64')

const ASSET_SIZES = [300, 1500, 40_000]

//The exporter's chunk order: image header and data, the assets, the card chunk, the end.
function exportOrderPng(sizes: number[] = ASSET_SIZES): Uint8Array {
    const v2 = JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: 'Synthetic', description: 'd', first_mes: 'hi', character_version: '1',
            extensions: { risuai: { additionalAssets: sizes.map((_, i) => [`a${i}`, `__asset:${i}`, 'bin']) } },
        },
    })
    return concat([
        SIG,
        chunk('IHDR', new U8(13).fill(1)), chunk('IDAT', new U8(40).fill(7)),
        ...sizes.map((s, i) => text(`chara-ext-asset_:${i}`, assetValue(i, s))),
        text('chara', b64(v2)),
        chunk('IEND', new U8(0)),
    ])
}

//A v2 JSON card with three base64 emotions and one entry that maps to an asset chunk and saves nothing.
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

const fileOf = (bytes: Uint8Array | string, name: string, type: string) => new File([bytes as BlobPart], name, { type })

/** The progress fraction a user could see now: the card's count when it has one, else the last legacy progress bar. */
function fractionNow(): number | null {
    const count = taskHostView()?.count
    if (count && count.total > 0) return count.done / count.total
    const bars = h.alerts.filter((a) => a.type === 'progress')
    const last = bars[bars.length - 1]
    return last ? Number(last.submsg) / 100 : null
}

async function runImport(): Promise<void> {
    const done = importCharacter()
    let ended = false
    void done.then(() => { ended = true }, () => { ended = true })
    for (let i = 0; i < 400 && !ended; i++) {
        if (taskResultShowing()) answerTask({ kind: 'ok' })
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await done
}

beforeEach(() => {
    h.saved = []
    h.errors = []
    h.alerts = []
    h.characters = []
    h.files = []
    h.uuid = 0
    h.confirm = true
    h.onSave = null
    h.onBuild = null
    h.hold = null
    h.holding = null
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

describe('character import progress on the card', () => {
    //(RR) The PNG asset bar started at 0 % and never reached 100 %.
    test('R-b1: a PNG card with three assets reaches 100 % at its add and is above 0 % once the first asset is saved', async () => {
        h.files = [fileOf(exportOrderPng(), 'card.png', 'image/png')]
        const seen: Array<number | null> = []
        h.onSave = () => { seen.push(fractionNow()) }
        let atAdd: number | null = null
        h.onBuild = () => { atAdd ??= fractionNow() }
        await runImport()
        expect(h.characters).toHaveLength(1)
        expect(seen.length).toBeGreaterThanOrEqual(4)
        //The second save starts after the first resolved: its observation is above zero.
        expect(seen[1]).toBeGreaterThan(0)
        expect(atAdd).toBe(1)
    })

    //(RR) The card-spec bars counted entries before their save and never showed the last one done.
    test('R-b5: a v2 JSON card counts its three saving entries and reaches the total at its add', async () => {
        h.files = [fileOf(jsonCardWithEmotions(), 'card.json', 'application/json')]
        const seen: Array<number | null> = []
        h.onSave = () => { seen.push(fractionNow()) }
        let atAdd: number | null = null
        h.onBuild = () => { atAdd ??= fractionNow() }
        await runImport()
        expect(h.characters).toHaveLength(1)
        expect(seen).toHaveLength(3)
        expect(seen[1]).toBeGreaterThan(0)
        expect(atAdd).toBe(1)
    })
})

const v2JsonWith = (risuai: Record<string, unknown>) => JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name: 'Synthetic', description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai } },
})
const v3JsonWithDataUri = () => JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
        name: 'Synthetic', description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: {} },
        assets: [{ type: 'x-risu-asset', uri: `data:application/octet-stream;base64,${Buffer.from('payload').toString('base64')}`, name: 'one', ext: 'bin' }],
    },
})

/**
 * Runs the import with every save held until the observer has looked, and returns the count's done value seen while the
 * first save was still pending plus the count at the character's add.
 */
async function importHoldingFirstSave(file: File): Promise<{ doneWhileHeld: number, atAdd: number | undefined }> {
    h.files = [file]
    let release!: () => void
    h.hold = new Promise<void>((resolve) => { release = resolve })
    let reached!: () => void
    const reachedFirstSave = new Promise<void>((resolve) => { reached = resolve })
    h.holding = reached
    let atAdd: number | undefined
    h.onBuild = () => { atAdd ??= taskHostView()?.count?.done }
    const run = runImport()
    await reachedFirstSave
    //Let every continuation that could report the pending save run before sampling.
    await new Promise((resolve) => setTimeout(resolve, 20))
    //A card with no count shown yet reads as zero saved.
    const doneWhileHeld = taskHostView()?.count?.done ?? 0
    release()
    await run
    expect(h.characters).toHaveLength(1)
    return { doneWhileHeld, atAdd }
}

describe('a save counts only once it has resolved', () => {
    //(RR-m) Reporting a save before it resolves would show a finished asset that is still being written.
    test.each([
        ['PNG whole asset', () => fileOf(exportOrderPng(), 'card.png', 'image/png')],
        ['card-spec emotion', () => fileOf(jsonCardWithEmotions(), 'card.json', 'application/json')],
        ['card-spec additional asset', () => fileOf(v2JsonWith({ additionalAssets: [['a', Buffer.from('one').toString('base64'), 'bin']] }), 'card.json', 'application/json')],
        ['v3 data URI asset', () => fileOf(v3JsonWithDataUri(), 'card.json', 'application/json')],
    ])('R-b1o: %s: the count is still 0 while the first save is pending', async (_label, makeFile) => {
        const { doneWhileHeld } = await importHoldingFirstSave(makeFile())
        expect(doneWhileHeld).toBe(0)
    })

    //(RR-m) The piece save path reports each asset after its save resolves, and the last one too.
    test('R-b1p: a PNG asset at the piece threshold counts only after its piece save resolves and reaches the total at the add', async () => {
        const png = exportOrderPng([ASSET_PIECE_SAVE_MIN_BYTES + 1024])
        const { doneWhileHeld, atAdd } = await importHoldingFirstSave(fileOf(png, 'big.png', 'image/png'))
        expect(h.saved.some((s) => s.id.startsWith('pieces-'))).toBe(true)
        expect(doneWhileHeld).toBe(0)
        expect(atAdd).toBe(2)
    })
})

//A v2 JSON card with no assets, for a batch that mixes it with PNG cards.
function plainJsonCard(name: string): string {
    return JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name, description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: {} } },
    })
}

/** Runs the picker import, answering Retry on the first result card when it offers one and OK on every later card. */
async function runImportRetryingOnce(): Promise<{ offeredRetry: boolean, retried: boolean }> {
    const done = importCharacter()
    let ended = false
    void done.then(() => { ended = true }, () => { ended = true })
    let offeredRetry = false
    let retried = false
    for (let i = 0; i < 800 && !ended; i++) {
        if (taskResultShowing()) {
            const view = taskHostView()
            const actions = view?.result?.actions ?? view?.failure?.actions ?? []
            if (!retried && actions.some((a) => a.id === 'retry')) {
                offeredRetry = true
                retried = true
                answerTask({ kind: 'action', id: 'retry' })
            } else {
                answerTask({ kind: 'ok' })
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await done
    return { offeredRetry, retried }
}

describe('character batch on the card', () => {
    //(RR-m) Retry runs only the file that failed without reaching its write; the others are not imported twice.
    test('R-b13: Retry after one failed PNG imports exactly three characters from two PNGs and one JSON', async () => {
        h.files = [
            fileOf(exportOrderPng(), 'one.png', 'image/png'),
            fileOf(exportOrderPng(), 'two.png', 'image/png'),
            fileOf(plainJsonCard('FromJson'), 'three.json', 'application/json'),
        ]
        let failedOnce = false
        //The second file's first asset save fails once, before its character exists.
        h.onSave = () => {
            if (taskHostView()?.file?.index === 1 && !failedOnce) {
                failedOnce = true
                throw new Error('store full')
            }
        }
        const run = await runImportRetryingOnce()

        expect(failedOnce).toBe(true)
        expect(run.offeredRetry).toBe(true)
        expect(h.characters).toHaveLength(3)
        const names = h.characters.map((c) => c.name)
        expect(names.filter((n) => n === 'FromJson')).toHaveLength(1)
        expect(names.filter((n) => n === 'Synthetic')).toHaveLength(2)
    })
})

describe('legacy alerts on a tasked character flow', () => {
    const legacyAlerts = () => h.alerts.filter((a) => a.type === 'wait' || a.type === 'progress')

    //(RR-m) The over-limit data URI is still reported with its own error, and no legacy bar or wait shows around it.
    test('R-b21: an oversize data URI in a v3 JSON card is reported by alertError and posts no legacy wait or progress', async () => {
        const oversize = 'A'.repeat(50 * 1024 * 1024 + 4)
        const card = JSON.stringify({
            spec: 'chara_card_v3',
            spec_version: '3.0',
            data: {
                name: 'Big', description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: {} },
                assets: [{ type: 'x-risu-asset', uri: `data:application/octet-stream;base64,${oversize}`, name: 'big', ext: 'bin' }],
            },
        })
        h.files = [fileOf(card, 'big.json', 'application/json')]
        await runImport()

        expect(h.errors).toContain(language.errors.dataUriTooLarge)
        expect(h.saved).toEqual([])
        expect(legacyAlerts()).toEqual([])
    })

    //(RR-m) The low-level-access question is asked in flow whichever way it is answered.
    test.each([true, false])('R-b21: a JSON card with low-level access asks the question (answer %s) and posts no legacy wait or progress', async (answer) => {
        h.confirm = answer
        const card = JSON.stringify({
            spec: 'chara_card_v2',
            spec_version: '2.0',
            data: { name: 'Risky', description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: { lowLevelAccess: true } } },
        })
        h.files = [fileOf(card, 'risky.json', 'application/json')]
        await runImport()

        expect(alertConfirm).toHaveBeenCalledWith(language.lowLevelAccessConfirm)
        expect(h.characters).toHaveLength(answer ? 1 : 0)
        expect(legacyAlerts()).toEqual([])
    })
})
