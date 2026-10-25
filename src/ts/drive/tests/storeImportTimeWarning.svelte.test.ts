/**
 * The Android time and space warning before a large `.bin` import (`confirmImportScale`, asked at the one site where the
 * database-size warning used to be): shown once, only on a store2 page or boot on an Android transport whose assets
 * (file less database entry) exceed the threshold, with the database-size sentence folded in; a decline writes nothing of
 * the import. Runs over the real store2 `saveDb()` world of `storeImport.svelte.test.ts`; the operating-system plugin is a
 * box, and the threshold is a few KiB through the `importEstimate` mock so no fixture is a gigabyte. A mocked success is
 * not evidence about a phone.
 *
 * Every Android test asserts the prompt text: a missing plugin mock would make `transportKind()` answer `other`, and a
 * test that only asserted absence would pass for that reason. After an accepted prompt the box answers `other` again, so
 * the rest of the import runs as the world's ordinary page.
 *
 * Labels: new behaviour (red on the base, which has no time prompt), guard (passes with or without the change).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, sleepReal, settled, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { language } from 'src/lang'
import type { Committer } from 'src/ts/storage/store2/commit'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { BootImportTarget } from 'src/ts/storage/store2/legacy/bootImport'
import type { Database } from 'src/ts/storage/database.svelte'

vi.setConfig({ testTimeout: 60_000 })

const osBox = vi.hoisted(() => ({ os: 'android' as string }))
const thresholdBox = vi.hoisted(() => ({ bytes: 2000 }))

const freeBox = vi.hoisted(() => ({ bytes: null as number | null, calls: 0 }))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => osBox.os }))

vi.mock('src/ts/storage/appFreeSpace', () => ({
    readAppDataFreeBytes: async () => {
        freeBox.calls++
        return freeBox.bytes
    },
}))

vi.mock('src/ts/drive/importEstimate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/drive/importEstimate')>()
    return {
        ...actual,
        get IMPORT_TIME_WARNING_BYTES() { return thresholdBox.bytes },
    }
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

type Entry = Record<string, unknown>

const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks')

beforeAll(() => {
    class FakeChannel {
        onmessage: ((event: { data: unknown }) => void) | null = null
        constructor(public name: string) { h.channels.push(this) }
        postMessage(data: unknown) { h.broadcasts.push(data) }
        close() {}
    }
    Object.defineProperty(window, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
})

beforeEach(() => {
    vi.clearAllMocks()
    osBox.os = 'android'
    thresholdBox.bytes = 2000
    freeBox.bytes = null
    freeBox.calls = 0
    h.broadcasts.length = 0
    h.channels.length = 0
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        return {
            DBState: proxy({ db: {} as Entry }),
            selectedCharID: writable(-1),
            selIdState: { selId: -1 },
            alertStore: writable({ type: 'none', msg: '' }),
            MobileGUI: writable(false),
            botMakerMode: writable(false),
            loadedStore: writable(false),
            LoadingStatusState: { text: '' },
            ReloadGUIPointer: writable(0),
            bodyIntercepterStore: writable(null),
            savingStoppedReason: writable(''),
            frozenSaveKeysStore: writable([]),
        } as unknown as typeof import('src/ts/stores.svelte')
    })
    vi.doMock('src/ts/process/coldstorage.svelte', async () => ({
        getColdStorageItem: vi.fn(),
        getColdStorageBackupKey: (await import('src/ts/process/coldstorageData')).getColdStorageBackupKey,
        readColdStorageItem: async () => ({ status: 'missing' }),
        setColdStorageItem: vi.fn(async () => false),
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(async () => {
    worlds.parkAll()
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
    vi.restoreAllMocks()
    if (originalLocks) {
        Object.defineProperty(window.navigator, 'locks', originalLocks)
    } else {
        Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    }
})

interface Page {
    w: World
    alert: typeof import('src/ts/alert')
    reloads: { count: number }
}

async function openPage(mode: 'store2' | 'block' = 'store2'): Promise<Page> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha', 'beta'])
    const k = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const bootActive = await import('src/ts/storage/store2/bootActive')
    const reloads = { count: 0 }
    const page: Page = { w, alert: await import('src/ts/alert'), reloads }
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer as Committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode(mode === 'store2' ? { kind: 'store2' } : { kind: 'block' })
    vi.spyOn(page.alert.alertStore, 'set').mockImplementation(() => { })
    vi.spyOn(window.location, 'reload').mockImplementation(() => { reloads.count++ })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { })
    w.start()
    await sleepReal(150)
    await settled(w)
    return page
}

/** A page as a boot sees it: no page mode and no residency. */
async function openBoot(): Promise<Page> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha'])
    const k = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const alert = await import('src/ts/alert')
    vi.spyOn(alert.alertStore, 'set').mockImplementation(() => { })
    w.pageMode.setPageStorageMode({ kind: 'unset' })
    ;(await import('src/ts/storage/store2/residencyActive')).resetResidencyForTest()
    w.start()
    await sleepReal(100)
    await settled(w)
    return { w, alert, reloads: { count: 0 } }
}

/** Answers every confirm with `decision`, records nothing else, and turns the box back to `other` so an accepted import runs as the world's page. */
function answer(page: Page, decision: boolean): void {
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => {
        osBox.os = 'other'
        return decision
    })
}

const confirmTexts = (page: Page): string[] => vi.mocked(page.alert.alertConfirm).mock.calls.map((call) => String(call[0]))
const alertErrorTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])

async function writeLockIsFree(page: Page): Promise<boolean> {
    const taken = page.w.api.dbWriteLock.acquire().then((release) => { release(); return true })
    return await Promise.race([taken, sleepReal(250).then(() => false)])
}

// ---- .bin construction ----

function binEntry(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBytes.length + 4 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, nameBytes.length, true)
    out.set(nameBytes, 4)
    view.setUint32(4 + nameBytes.length, data.length, true)
    out.set(data, 8 + nameBytes.length)
    return out
}

function binOf(...entries: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(entries.reduce((total, entry) => total + entry.length, 0))
    let offset = 0
    for (const entry of entries) {
        out.set(entry, offset)
        offset += entry.length
    }
    return out
}

/** The asset entry plus both entry headers: what `file.size - database entry` comes to for `binWith`. */
const ASSET_BODY = 2000
const ASSET_BYTES = ASSET_BODY + 'asset.png'.length + 8 + 'database.risudat'.length + 8

/** A file of one asset and a zero-filled database entry of `databaseBytes`. */
function binWith(databaseBytes: number, assetBody: number = ASSET_BODY): Uint8Array {
    return binOf(binEntry('asset.png', new Uint8Array(assetBody)), binEntry('database.risudat', new Uint8Array(databaseBytes)))
}

async function loadBin(bytes: Uint8Array): Promise<void> {
    const { LoadLocalBackup } = await import('src/ts/drive/backuplocal')
    const realCreateElement = document.createElement.bind(document)
    let input: HTMLInputElement | null = null
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = realCreateElement(tag)
        if (tag === 'input') {
            input = element as HTMLInputElement
        }
        return element
    })
    try {
        LoadLocalBackup()
        const chosen = input as HTMLInputElement | null
        if (chosen === null) {
            throw new Error('LoadLocalBackup did not create a file input')
        }
        Object.defineProperty(chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
        await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
    } finally {
        spy.mockRestore()
    }
}

async function pickAtBoot(target: BootImportTarget, bytes: Uint8Array) {
    const { loadBackupAtBoot } = await import('src/ts/drive/backuplocal')
    const realCreateElement = document.createElement.bind(document)
    let input: HTMLInputElement | null = null
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = realCreateElement(tag)
        if (tag === 'input') {
            input = element as HTMLInputElement
        }
        return element
    })
    try {
        const ended = loadBackupAtBoot(target)
        const chosen = input as HTMLInputElement | null
        if (chosen === null) {
            throw new Error('loadBackupAtBoot did not create a file input')
        }
        Object.defineProperty(chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
        await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
        return await ended
    } finally {
        spy.mockRestore()
    }
}

/** The text of a two-entry file with a 100-byte database: 2 files, a 5 minute estimate, 0.6 GB free space needed. */
const SMALL_DATABASE_TEXT = language.store2ImportTimeWarning(2, 5, 0.6, null)
/** The same file with a 17 MiB database (17,825,792 bytes, 18 decimal megabytes): the tail makes it 10 minutes and the database sentence is folded in. */
const LARGE_DATABASE_TEXT = language.store2ImportTimeWarning(2, 10, 0.6, 18)

describe('the Android time warning on a store2 page', () => {
    test('new behaviour: assets over the threshold show the time and space text, once, before anything is written', async () => {
        const page = await openPage()
        answer(page, false)
        page.w.store.ops.length = 0

        await loadBin(binWith(100))

        expect(confirmTexts(page)).toEqual([SMALL_DATABASE_TEXT])
        expect(SMALL_DATABASE_TEXT).toContain('0.6 GB')
        expect(SMALL_DATABASE_TEXT).toContain('about 5 minutes')
    })

    test('new behaviour: a decline writes nothing of the import, takes no reload and leaves the write lock free', async () => {
        const page = await openPage()
        answer(page, false)
        page.w.store.ops.length = 0

        await loadBin(binWith(100))

        expect(confirmTexts(page)).toEqual([SMALL_DATABASE_TEXT])
        expect(alertErrorTexts(page)).toEqual([])
        expect(page.w.store.mutating()).toEqual([])
        expect(page.reloads.count).toBe(0)
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('new behaviour: accepting goes on to the import (the zero-filled database then fails to decode)', async () => {
        const page = await openPage()
        answer(page, true)

        await loadBin(binWith(100))

        expect(confirmTexts(page)).toEqual([SMALL_DATABASE_TEXT])
        expect(alertErrorTexts(page).length).toBeGreaterThan(0)
    })

    test('new behaviour: the threshold is a strict bound on the asset bytes: at it no time text, one byte over it the text', async () => {
        thresholdBox.bytes = ASSET_BYTES
        const atBound = await openPage()
        answer(atBound, false)
        await loadBin(binWith(100))
        expect(confirmTexts(atBound)).toEqual([])

        worlds.parkAll()
        osBox.os = 'android'
        thresholdBox.bytes = ASSET_BYTES - 1
        const over = await openPage()
        answer(over, false)
        await loadBin(binWith(100))
        expect(confirmTexts(over)).toEqual([SMALL_DATABASE_TEXT])
    })

    test('new behaviour: a large database with a large file but few asset bytes gets the size text only, not the time text', async () => {
        thresholdBox.bytes = 1024 * 1024
        const page = await openPage()
        answer(page, false)

        await loadBin(binWith(17 * 1024 * 1024))

        expect(confirmTexts(page)).toEqual([language.store2ImportSizeWarning(18, true)])
    })

    test('new behaviour: assets over the threshold and a database over 16 MiB give one prompt that holds both, in decimal megabytes', async () => {
        const page = await openPage()
        answer(page, false)

        await loadBin(binWith(17 * 1024 * 1024))

        expect(confirmTexts(page)).toEqual([LARGE_DATABASE_TEXT])
        expect(LARGE_DATABASE_TEXT).toContain('18 MB')
    })

    test.each(['windows', 'linux', 'macos', 'ios'])('guard: a %s page gets no time text for the same file', async (os) => {
        osBox.os = os
        const page = await openPage()
        answer(page, false)
        osBox.os = os

        await loadBin(binWith(100))

        expect(confirmTexts(page)).toEqual([])
    })

    test.each(['windows', 'ios'])('guard: a %s page with a database over 16 MiB keeps the size text unchanged', async (os) => {
        osBox.os = os
        const page = await openPage()
        answer(page, false)
        osBox.os = os

        await loadBin(binWith(17 * 1024 * 1024))

        expect(confirmTexts(page)).toEqual([language.store2ImportSizeWarning(18, true)])
    })

    test('guard: the warning belongs to store2 pages, so an Android block-mode import over the threshold shows no time text', async () => {
        const page = await openPage('block')
        answer(page, false)
        osBox.os = 'android'

        await loadBin(binWith(100))

        expect(confirmTexts(page)).not.toContain(SMALL_DATABASE_TEXT)
        expect(confirmTexts(page).some((text) => text.includes('free space'))).toBe(false)
    })
})

/**
 * The free-space check on Android (reader mocked through `freeBox`). Fixtures: the file's non-database bytes come to
 * 2041, so the need is 0.6 GB. 1.5e9 free bytes is enough, 5e8 is short (0.5 GB shown, rounded down).
 */
const ENOUGH_BYTES = 1_500_000_000
const SHORT_BYTES = 500_000_000
const SMALL_IMPORT_THRESHOLD = 1_000_000

describe('the Android free-space check', () => {
    test('new behaviour: a large import with enough space says how much is free, in the one time prompt', async () => {
        freeBox.bytes = ENOUGH_BYTES
        const page = await openPage()
        answer(page, false)

        await loadBin(binWith(100))

        const expected = language.store2ImportTimeWarning(2, 5, 0.6, null, 1.5, false)
        expect(confirmTexts(page)).toEqual([expected])
        expect(expected).toContain('About 1.5 GB is free.')
        expect(expected).not.toContain('cannot check')
        expect(expected).not.toContain('runs out of space')
    })

    test('new behaviour: a large import that is short says so and that the import stops, and says that copied files replace same-name files before the import finishes', async () => {
        freeBox.bytes = SHORT_BYTES
        const page = await openPage()
        answer(page, false)

        await loadBin(binWith(100))

        const expected = language.store2ImportTimeWarning(2, 5, 0.6, null, 0.5, true)
        expect(confirmTexts(page)).toEqual([expected])
        expect(expected).toContain('Only about 0.5 GB is free')
        expect(expected).toContain('the import stops')
        expect(expected).toContain('Your saved data is not replaced until the import has finished.')
        expect(expected).toContain('replace any stored file with the same name')
    })

    test('guard: a large import whose free space cannot be read keeps the cannot-check text', async () => {
        freeBox.bytes = null
        const page = await openPage()
        answer(page, false)

        await loadBin(binWith(100))

        expect(confirmTexts(page)).toEqual([SMALL_DATABASE_TEXT])
        expect(SMALL_DATABASE_TEXT).toContain('The app cannot check how much is free.')
        expect(freeBox.calls).toBe(1)
    })

    test('new behaviour: a small import that is short shows one space prompt with the need and the free figure; a decline writes nothing', async () => {
        thresholdBox.bytes = SMALL_IMPORT_THRESHOLD
        freeBox.bytes = SHORT_BYTES
        const page = await openPage()
        answer(page, false)
        page.w.store.ops.length = 0

        await loadBin(binWith(100))

        const expected = language.store2ImportSpaceWarning(0.6, 0.5, null)
        expect(confirmTexts(page)).toEqual([expected])
        expect(expected).toContain('0.6 GB')
        expect(expected).toContain('0.5 GB')
        expect(alertErrorTexts(page)).toEqual([])
        expect(page.w.store.mutating()).toEqual([])
        expect(page.reloads.count).toBe(0)
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('new behaviour: accepting the space prompt goes on to the import (the zero-filled database then fails to decode)', async () => {
        thresholdBox.bytes = SMALL_IMPORT_THRESHOLD
        freeBox.bytes = SHORT_BYTES
        const page = await openPage()
        answer(page, true)

        await loadBin(binWith(100))

        expect(confirmTexts(page)).toEqual([language.store2ImportSpaceWarning(0.6, 0.5, null)])
        expect(alertErrorTexts(page).length).toBeGreaterThan(0)
    })

    test('new behaviour: a small import that is short with a database over 16 MiB gets one prompt that holds the size sentence too', async () => {
        thresholdBox.bytes = 1024 * 1024
        freeBox.bytes = SHORT_BYTES
        const page = await openPage()
        answer(page, false)

        await loadBin(binWith(17 * 1024 * 1024))

        const texts = confirmTexts(page)
        expect(texts).toHaveLength(1)
        expect(texts[0]).toContain('only about 0.5 GB is free')
        expect(texts[0]).toContain('18 MB')
        expect(texts).not.toContain(language.store2ImportSizeWarning(18, true))
        expect(texts).toEqual([language.store2ImportSpaceWarning(0.6, 0.5, 18)])
    })

    test('guard: a small import with enough space shows no new prompt', async () => {
        thresholdBox.bytes = SMALL_IMPORT_THRESHOLD
        freeBox.bytes = ENOUGH_BYTES
        const page = await openPage()
        answer(page, false)

        await loadBin(binWith(100))

        expect(confirmTexts(page)).toEqual([])
        expect(freeBox.calls).toBe(1)
    })

    test('guard: a small import whose free space cannot be read behaves as before (database size text only)', async () => {
        thresholdBox.bytes = 1024 * 1024
        freeBox.bytes = null
        const page = await openPage()
        answer(page, false)

        await loadBin(binWith(17 * 1024 * 1024))

        expect(confirmTexts(page)).toEqual([language.store2ImportSizeWarning(18, true)])
        expect(freeBox.calls).toBe(1)
    })

    test('guard: a small import with enough space and a database over 16 MiB keeps the size text', async () => {
        thresholdBox.bytes = 1024 * 1024
        freeBox.bytes = ENOUGH_BYTES
        const page = await openPage()
        answer(page, false)

        await loadBin(binWith(17 * 1024 * 1024))

        expect(confirmTexts(page)).toEqual([language.store2ImportSizeWarning(18, true)])
    })

    test('the reader is called once per Android import', async () => {
        freeBox.bytes = ENOUGH_BYTES
        const page = await openPage()
        answer(page, false)

        await loadBin(binWith(100))

        expect(freeBox.calls).toBe(1)
    })

    test.each(['windows', 'linux', 'macos', 'ios'])('guard: a %s page never reads the free space and shows no space text, even when it would be short', async (os) => {
        osBox.os = os
        freeBox.bytes = SHORT_BYTES
        const page = await openPage()
        answer(page, false)
        osBox.os = os

        await loadBin(binWith(100))

        expect(confirmTexts(page)).toEqual([])
        expect(freeBox.calls).toBe(0)
    })

    test('guard: the existing four-argument time text is unchanged and carries the cannot-check sentence', () => {
        const text = language.store2ImportTimeWarning(2, 5, 0.6, null)

        expect(text).toBe(language.store2ImportTimeWarning(2, 5, 0.6, null, null, false))
        expect(text).toContain('The import needs about 0.6 GB of free space on this phone. The app cannot check how much is free. ')
    })
})

describe('the Android time warning at boot', () => {
    function target(installs: unknown[]): BootImportTarget {
        return {
            readColdStorageItem: async () => ({ status: 'missing' }),
            async install(source) {
                installs.push(source)
                return { status: 'blocked', reason: 'install-failed', detail: 'recorded' }
            },
        }
    }

    test('new behaviour: the boot import shows the same text once, and a decline ends cancelled with the installer never called', async () => {
        const page = await openBoot()
        answer(page, false)
        const installs: unknown[] = []
        page.w.store.ops.length = 0

        const end = await pickAtBoot(target(installs), binWith(100))

        expect(confirmTexts(page)).toEqual([SMALL_DATABASE_TEXT])
        expect(end).toEqual({ kind: 'cancelled' })
        expect(installs).toEqual([])
        expect(page.w.store.mutating()).toEqual([])
    })

    test('guard: a boot on a desktop transport gets no time text', async () => {
        const page = await openBoot()
        answer(page, false)
        osBox.os = 'windows'

        await pickAtBoot(target([]), binWith(100))

        expect(confirmTexts(page)).toEqual([])
    })
})
