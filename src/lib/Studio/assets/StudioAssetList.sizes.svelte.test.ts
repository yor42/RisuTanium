// @vitest-environment jsdom
/**
 * The size job of the Studio asset list: it starts only after the list is shown, reads one size at a time on the web
 * and several on a native store, keeps its answers for the session, and ends with the list or the owner it was
 * started for. The job is the real one over a double reader; the stores are doubles at their seams, so nothing
 * here proves native behaviour.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
    pieceStoreOrNull: vi.fn(async () => null),
}))
vi.mock('src/ts/storage/store/appStore', () => ({ getAppStoreKind: vi.fn(async () => 'tauri') }))
vi.mock('src/ts/storage/tauriByteTransport', () => ({
    isDesktopTransport: () => false,
    isAndroidTransport: () => false,
    transportKind: () => 'web',
    readRangedPieces: vi.fn(),
    statStoredSize: vi.fn(),
}))

const db = $state({ db: { characters: [] as LiveCharacter[], useAdditionalAssetsPreview: false, modules: [] as unknown[] } })
const selection = $state({ selId: 0 })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return db },
        get selIdState() { return selection },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        frozenSaveKeysStore: writable([]),
        clearCharEmotionCache: () => {},
    }
})
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = { sidebarUi: { noAssets: 'noAssets' } }
    for (const key of ['studioAssetEmotionsElsewhere', 'studioAssetRowMenu']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import type { ExportAssetSource } from 'src/ts/drive/assetPieces'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { ByteStore } from 'src/ts/storage/store/contract'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioToastsForTests } from 'src/ts/studio/edit/studioToasts'
import { resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { createAssetSizeJob, NATIVE_SIZE_CONCURRENCY, type AssetSizeJob } from '../../../ts/studio/assets/assetSizes'
import { createOwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../../ts/studio/history/tests/studioStoreDoubles'
import { assetRow } from '../../../ts/studio/assets/assetFixtures.test-helpers'
import StudioAssetList from './StudioAssetList.svelte'

interface LiveCharacter {
    chaId: string
    type: string
    desc: string
    alternateGreetings: string[]
    chats: { id: string; note: string; fmIndex?: number }[]
    chatPage: number
    additionalAssets: string[][]
    emotionImages: string[][]
}

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

function makeCharacter(chaId: string, count: number, prefix = chaId): LiveCharacter {
    return {
        chaId,
        type: 'character',
        desc: '',
        alternateGreetings: [],
        chats: [{ id: 'c1', note: '' }],
        chatPage: 0,
        additionalAssets: Array.from({ length: count }, (_, i) => assetRow(`${prefix}${i}`, `assets/${prefix}${i}.png`)),
        emotionImages: [],
    }
}

function webSource(): ExportAssetSource {
    return { kind: 'web', pieces: { node: false, open: async function* () { } }, store: {} as ByteStore }
}

function nativeSource(): ExportAssetSource {
    return { kind: 'tauri', pieces: { node: false, open: async function* () { } }, store: {} as ByteStore }
}

// A reader that counts how many reads are in flight at once. With a gate every read waits for it.
function meteredReader(gate?: Promise<void>) {
    const meter = { now: 0, max: 0, started: [] as string[] }
    const sizeOf = vi.fn(async (key: string) => {
        meter.now++
        meter.started.push(key)
        meter.max = Math.max(meter.max, meter.now)
        try {
            await (gate ?? new Promise<void>((resolve) => setTimeout(resolve, 1)))
            return 100 + key.length
        } finally {
            meter.now--
        }
    })
    return { meter, sizeOf }
}

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Waits on real timers (the reader's own delay) until `done` holds, so a slow machine only makes the test longer.
async function until(done: () => boolean): Promise<void> {
    for (let waited = 0; !done() && waited < 5000; waited += 5) {
        await pause(5)
    }
}

function show(props: { chaId: string; sizeJob?: () => Promise<AssetSizeJob> }): void {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioAssetList, { target: host, props }), host })
}

async function unmountAll(): Promise<void> {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
}

beforeEach(async () => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    db.db.characters = [makeCharacter('A', 20), makeCharacter('B', 2)]
    selection.selId = 0
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests({ noteEdit: () => {}, dispose: () => {} } as never)
})

afterEach(async () => {
    await unmountAll()
    resetStudioToastsForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('when the sizes start', () => {
    test('nothing is asked for before the list is mounted, and the job is built once it is shown', async () => {
        const { sizeOf } = meteredReader()
        const factory = vi.fn(async () => createAssetSizeJob({ source: nativeSource(), sizeOf }))
        expect(factory).not.toHaveBeenCalled()
        expect(sizeOf).not.toHaveBeenCalled()
        show({ chaId: 'A', sizeJob: factory })
        flushSync()
        await settle()
        expect(factory).toHaveBeenCalledTimes(1)
        expect(sizeOf).toHaveBeenCalled()
    })

    test('a list with no rows reads nothing and builds no job', async () => {
        db.db.characters = [makeCharacter('A', 0)]
        const { sizeOf } = meteredReader()
        const factory = vi.fn(async () => createAssetSizeJob({ source: nativeSource(), sizeOf }))
        show({ chaId: 'A', sizeJob: factory })
        await settle()
        expect(factory).not.toHaveBeenCalled()
        expect(sizeOf).not.toHaveBeenCalled()
    })
})

describe('how many sizes are read at once', () => {
    test('on the web at most one read is in flight, and every row is sized', async () => {
        const { meter, sizeOf } = meteredReader()
        show({ chaId: 'A', sizeJob: async () => createAssetSizeJob({ source: webSource(), sizeOf }) })
        await until(() => sizeOf.mock.calls.length === 20 && meter.now === 0)
        await settle()
        expect(meter.max).toBe(1)
        expect(sizeOf).toHaveBeenCalledTimes(20)
        expect(document.querySelectorAll('[data-part="studio-asset-meta"]')).toHaveLength(20)
        expect(document.querySelector('[data-part="studio-asset-meta"]')?.textContent).toMatch(/^png · \d+ B$/)
    })

    test('on a native store several reads run at once, up to the native limit', async () => {
        const { meter, sizeOf } = meteredReader()
        show({ chaId: 'A', sizeJob: async () => createAssetSizeJob({ source: nativeSource(), sizeOf }) })
        await until(() => sizeOf.mock.calls.length === 20 && meter.now === 0)
        await settle()
        expect(meter.max).toBeGreaterThan(1)
        expect(meter.max).toBeLessThanOrEqual(NATIVE_SIZE_CONCURRENCY)
        expect(sizeOf).toHaveBeenCalledTimes(20)
    })
})

describe('when the sizes stop', () => {
    test('unmounting the list starts no further read', async () => {
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const { meter, sizeOf } = meteredReader(gate)
        show({ chaId: 'A', sizeJob: async () => createAssetSizeJob({ source: webSource(), sizeOf }) })
        await settle()
        expect(meter.started).toHaveLength(1)
        await unmountAll()
        release()
        await pause(30)
        await settle()
        expect(sizeOf).toHaveBeenCalledTimes(1)
    })

    test('a change of owner ends the old owner\'s reads and reads the new owner\'s rows', async () => {
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const { meter, sizeOf } = meteredReader(gate)
        const job = createAssetSizeJob({ source: webSource(), sizeOf })
        const props = $state({ chaId: 'A', sizeJob: async (): Promise<AssetSizeJob> => job })
        show(props)
        await settle()
        expect(meter.started).toEqual(['assets/A0.png'])
        props.chaId = 'B'
        await settle()
        release()
        await pause(30)
        await settle()
        // The one read already in flight finished; no other row of the old owner was read, and the new owner's were.
        expect(meter.started.filter((key) => key.startsWith('assets/A'))).toEqual(['assets/A0.png'])
        expect(meter.started.filter((key) => key.startsWith('assets/B'))).toEqual(['assets/B0.png', 'assets/B1.png'])
        expect(document.querySelectorAll('[data-part="studio-asset-meta"]')).toHaveLength(2)
    })
})

describe('the session cache', () => {
    test('a list shown again over the same job reads no row twice and shows the sizes at once', async () => {
        const { sizeOf } = meteredReader()
        const job = createAssetSizeJob({ source: nativeSource(), sizeOf })
        show({ chaId: 'B', sizeJob: async () => job })
        await until(() => sizeOf.mock.calls.length === 2)
        await pause(20)
        await settle()
        expect(sizeOf).toHaveBeenCalledTimes(2)
        await unmountAll()
        show({ chaId: 'B', sizeJob: async () => job })
        await settle()
        expect(sizeOf).toHaveBeenCalledTimes(2)
        expect(Array.from(document.querySelectorAll('[data-part="studio-asset-meta"]')).map((el) => el.textContent)).toEqual(['png · 113 B', 'png · 113 B'])
    })
})
