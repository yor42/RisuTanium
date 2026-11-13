/**
 * The install transaction of a theme pack (`install.ts`, layout A): the order of the write (archive, read-back check, record,
 * active id) under one busy entry with a save asked for after it, the refusals that write nothing (busy, a restore, a
 * read-only page, a list this build cannot read, the intake's verdict), Replace? by `packId` or by name, Remove by the live
 * entry, and the active id.
 *
 * `DBState` is a real `$state` object (the page's database is a reactive proxy, and Remove's identity check depends on it).
 * The asset store, the save and the page storage selection are stand-ins; the busy registry, the restore signal and the page
 * storage mode are the real modules. The intake is a fake verifier: the archive is opaque bytes here, and a mocked success is
 * not evidence about a native store. Every record here is written inline, in the shape the install emits.
 */
import { createHash } from 'node:crypto'
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../storage/database.svelte'
import { busyKinds, beginBusy, isBusy, resetBusyActionsForTest } from '../process/memory/busyActions'
import { beginRestoreRun, resetRestoreInProgressForTests } from '../drive/restoreInProgress'
import { resetPageStorageModeForTests, setPageStorageMode } from '../storage/pageStorageMode'
import { language } from 'src/lang'

//#region module mocks

/** The asset store stand-in and everything the install did to it, in order. */
const world = vi.hoisted(() => ({
    files: new Map<string, Uint8Array>(),
    log: [] as string[],
    /** `busyKinds()` at each write, and what `DBState.db.themePacks` held at each write and read. */
    busyAtWrite: [] as string[][],
    packsAtWrite: [] as unknown[],
    packsAtRead: [] as unknown[],
    failWrite: null as Error | null,
    /** After a write: keep the bytes, drop them, or store damaged ones. */
    afterWrite: 'keep' as 'keep' | 'drop' | 'damage',
    perValueLimit: Number.POSITIVE_INFINITY,
    /** The key `saveAsset` answers instead of the derived one. */
    answerKey: null as string | null,
    saveCalls: [] as Uint8Array[],
    selection: { answer: false as boolean | 'throws' },
    snapshotPacks: (): unknown => undefined,
    /** The busy registry's `busyKinds`, set once the real module is imported. */
    busyKinds: (): string[] => [],
    /** How many times the page's asset store was asked for: a Remove must never touch it. */
    storeAccesses: 0,
}))
const requestSaveNow = vi.hoisted(() => vi.fn())
const alertError = vi.hoisted(() => vi.fn())

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))
vi.mock(import('../platform'), () => ({ isTauri: false, isNodeServer: false }) as unknown as typeof import('../platform'))
vi.mock(import('../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => (globalThis as unknown as { __testDB: Database }).__testDB),
    setDatabase: vi.fn(),
    setDatabaseLite: vi.fn(),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../storage/database.svelte'))
vi.mock(import('../alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertError,
    alertPluginConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../alert'))
vi.mock(import('../util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => { }),
}) as unknown as typeof import('../util'))
vi.mock(import('../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    readImage: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }) },
    requestSaveNow,
    // The page's save: the key is the content name and the extension of the file name, written through the store stand-in.
    saveAsset: vi.fn(async (data: Uint8Array, customId = '', fileName = '') => {
        world.saveCalls.push(data)
        const key = world.answerKey ?? `assets/${customId}.${fileName.split('.').pop()}`
        world.log.push(`write:${key}`)
        world.busyAtWrite.push([...world.busyKinds()])
        world.packsAtWrite.push(world.snapshotPacks())
        if (world.failWrite !== null) {
            throw world.failWrite
        }
        if (data.length > world.perValueLimit) {
            throw new Error('the store refuses a value this large')
        }
        if (world.afterWrite === 'keep') {
            world.files.set(key, data.slice())
        } else if (world.afterWrite === 'damage') {
            const damaged = data.slice()
            damaged[0] ^= 0xff
            world.files.set(key, damaged)
        }
        return key
    }),
}) as unknown as typeof import('../globalApi.svelte'))
vi.mock(import('../storage/store/appStore'), () => ({
    getAppStore: async () => {
        world.storeAccesses += 1
        return {
            read: async (key: string) => {
                world.log.push(`read:${key}`)
                world.packsAtRead.push(world.snapshotPacks())
                return { bytes: world.files.get(key) ?? null }
            },
        }
    },
    pageStoreIsOpfsTransitional: async () => {
        if (world.selection.answer === 'throws') {
            throw new Error('the store could not be selected')
        }
        return world.selection.answer
    },
}) as unknown as typeof import('../storage/store/appStore'))
vi.mock(import('../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        hotReloading: writable(false),
        selectedCharID: writable(-1),
    } as unknown as typeof import('../stores.svelte')
})
vi.mock(import('../plugins/pluginSafeClass'), () => ({
    SafeDocument: class { },
    SafeIdbFactory: class { },
    SafeLocalStorage: class {
        getItem = vi.fn()
        setItem = vi.fn()
        removeItem = vi.fn()
        clear = vi.fn()
        key = vi.fn()
        keys = vi.fn()
    },
}) as unknown as typeof import('../plugins/pluginSafeClass'))
vi.mock(import('../plugins/apiV3/v3.svelte'), () => ({ loadV3Plugins: vi.fn(async () => { }) }) as unknown as typeof import('../plugins/apiV3/v3.svelte'))
vi.mock(import('../plugins/apiV3/transpiler'), () => ({ pluginCodeTranspiler: vi.fn((code: string) => code) }) as unknown as typeof import('../plugins/apiV3/transpiler'))

//#endregion

import { DBState } from '../stores.svelte'
import { installThemePack, removeThemePackAt, setActiveThemePack, type InstallOutcome, type InstallRequest, type PackVerifyOutcome } from './install'
import { listThemePacks, readPackRecord, type PackManifestFields, type ThemePackRecordV1 } from './packRecord'
import { allowedDbKeys, getV2PluginAPIs } from '../plugins/plugins.svelte'

//#region fixtures

type Slot = Record<string, unknown>

const ARCHIVE = Uint8Array.from({ length: 300 }, (_, index) => (index * 7 + 3) % 251)
const HASH = createHash('sha256').update(ARCHIVE).digest('hex')
const KEY = `assets/tp-${HASH}.risutheme`
const NOW = 1_700_000_000_000

function manifestOf(extra: Partial<PackManifestFields> = {}): PackManifestFields {
    return {
        packId: 'origin-navy', name: 'Origin Navy', version: '1.0.0', license: 'MIT', attribution: 'A. Author',
        modes: ['light', 'dark'], fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1' }, { file: 'fonts/b.woff2', license: 'OFL-1.1', attribution: 'B. Fonts' }],
        ...extra,
    }
}

/** The record the install must emit for `manifestOf()`, written out field by field (T2-9 pins the equality). */
function recordFixture(extra: Slot = {}): Slot {
    return {
        v: 1, id: 'pack-1', packId: 'origin-navy', name: 'Origin Navy', version: '1.0.0', license: 'MIT', attribution: 'A. Author',
        modes: ['light', 'dark'],
        fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1' }, { file: 'fonts/b.woff2', license: 'OFL-1.1', attribution: 'B. Fonts' }],
        archive: KEY, bytes: ARCHIVE.length, installedAt: NOW, ...extra,
    }
}

interface Calls {
    verify: ReturnType<typeof vi.fn>
    confirmReplace: ReturnType<typeof vi.fn>
}

function requestOf(options: {
    manifest?: PackManifestFields
    refusal?: string
    replaceAnswer?: boolean
    newId?: string
    bytes?: Uint8Array
    onConfirm?: () => void
} = {}): { request: InstallRequest<string>, calls: Calls } {
    const verify = vi.fn(async (): Promise<PackVerifyOutcome<string>> =>
        options.refusal === undefined ? { ok: true, manifest: options.manifest ?? manifestOf() } : { ok: false, refusal: options.refusal })
    const confirmReplace = vi.fn(async (): Promise<boolean> => {
        options.onConfirm?.()
        return options.replaceAnswer ?? true
    })
    const request: InstallRequest<string> = {
        bytes: options.bytes ?? ARCHIVE,
        verify,
        confirmReplace,
        now: () => NOW,
        newId: () => options.newId ?? 'pack-1',
    }
    return { request, calls: { verify, confirmReplace } }
}

const fields = (): Slot => DBState.db as unknown as Slot
const livePacks = (): unknown[] => fields().themePacks as unknown[]
const snapshotOf = (value: unknown): unknown => $state.snapshot(value)

function installDb(extra: Slot = {}): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {}, characters: [],
        ...extra,
    } as unknown as Database
    // Read back after assignment: Svelte re-proxies on assign, and the plugin APIs read the live proxy.
    ;(globalThis as unknown as { __testDB: Database }).__testDB = DBState.db
}

function expectNothingWritten(): void {
    expect(world.log).toEqual([])
    expect(world.files.size).toBe(0)
}

beforeEach(() => {
    world.files.clear()
    world.log.length = 0
    world.busyAtWrite.length = 0
    world.packsAtWrite.length = 0
    world.packsAtRead.length = 0
    world.saveCalls.length = 0
    world.failWrite = null
    world.afterWrite = 'keep'
    world.storeAccesses = 0
    world.perValueLimit = Number.POSITIVE_INFINITY
    world.answerKey = null
    world.selection.answer = false
    world.snapshotPacks = () => snapshotOf(fields().themePacks)
    world.busyKinds = busyKinds
    requestSaveNow.mockReset()
    alertError.mockReset()
    resetBusyActionsForTest()
    resetRestoreInProgressForTests()
    resetPageStorageModeForTests()
    installDb()
})

afterEach(() => {
    resetBusyActionsForTest()
    resetRestoreInProgressForTests()
    resetPageStorageModeForTests()
})

function okOf(outcome: InstallOutcome<string>): Extract<InstallOutcome<string>, { ok: true }> {
    expect(outcome.ok).toBe(true)
    if (outcome.ok === false) {
        throw new Error(`The install answered ${outcome.kind}.`)
    }
    return outcome
}

//#endregion

describe('the order of the install and the record it writes', () => {
    test('T2-9: archive written, read back, then the record, then the active id, under one busy entry, with the save asked for after it ends', async () => {
        const { request } = requestOf()
        let saveAskedWhileBusy: boolean | null = null
        let packsWhenSaveAsked: unknown = null
        requestSaveNow.mockImplementation(() => {
            saveAskedWhileBusy = isBusy()
            packsWhenSaveAsked = snapshotOf(fields().themePacks)
        })

        const outcome = okOf(await installThemePack(request))

        expect(world.log).toEqual([`write:${KEY}`, `read:${KEY}`])
        expect(world.packsAtWrite).toEqual([undefined])
        expect(world.packsAtRead).toEqual([undefined])
        expect(world.busyAtWrite).toEqual([['themePack']])
        expect(outcome.replaced).toBe(false)
        expect(snapshotOf(fields().themePacks)).toEqual([recordFixture()])
        expect(fields().activeThemePack).toBe('pack-1')
        expect(requestSaveNow).toHaveBeenCalledTimes(1)
        expect(saveAskedWhileBusy).toBe(false)
        expect(packsWhenSaveAsked).toEqual([recordFixture()])
        expect(isBusy()).toBe(false)
        // The stored archive is the very array the intake judged.
        expect(world.saveCalls).toEqual([ARCHIVE])
        expect(world.saveCalls[0]).toBe(request.bytes)
    })

    test.each([
        ['with an author id', manifestOf(), recordFixture()],
        ['without an author id', manifestOf({ packId: undefined, fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1' }] }), (() => {
            const record = recordFixture({ fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1' }] })
            delete record.packId
            return record
        })()],
    ])('T2-9: the returned record and the live entry are strictly equal to the stored-record fixture, %s', async (_label, manifest, fixture) => {
        const { request } = requestOf({ manifest })

        const outcome = okOf(await installThemePack(request))

        expect(outcome.record).toStrictEqual(fixture)
        expect(snapshotOf(listThemePacks(livePacks())[0].entry)).toStrictEqual(fixture)
        expect(Object.keys(snapshotOf(livePacks()[0]) as Slot).sort()).toEqual(Object.keys(fixture).sort())
        // The record reads ok in the same session through the live proxy, and never carries an own undefined key.
        const read = readPackRecord(livePacks()[0])
        expect(read.ok).toBe(true)
        expect(read.ok && read.record).toStrictEqual(fixture)
    })

    test('T2-9: the manifest\'s arrays are copied, so a later change of the manifest never reaches the record', async () => {
        const manifest = manifestOf()
        const { request } = requestOf({ manifest })

        okOf(await installThemePack(request))
        ;(manifest.modes as ('light' | 'dark')[]).push('light')
        ;(manifest.fonts as { file: string, license: string }[])[0].license = 'changed'

        expect(snapshotOf(livePacks()[0])).toEqual(recordFixture())
    })

    test('T2-9: a first install activates the pack, and a second install activates itself', async () => {
        okOf(await installThemePack(requestOf().request))
        okOf(await installThemePack(requestOf({ manifest: manifestOf({ packId: 'banana-cocoa', name: 'Banana Cocoa' }), newId: 'pack-2', bytes: Uint8Array.from([9, 9, 9]) }).request))

        expect((snapshotOf(fields().themePacks) as Slot[]).map((pack) => pack.id)).toEqual(['pack-1', 'pack-2'])
        expect(fields().activeThemePack).toBe('pack-2')
    })

    test('T2-9: a refused verdict writes nothing and answers the refusal as it is', async () => {
        const { request, calls } = requestOf({ refusal: 'not a pack' })

        const outcome = await installThemePack(request)

        expect(outcome).toEqual({ ok: false, kind: 'refused', refusal: 'not a pack' })
        expect(calls.verify).toHaveBeenCalledTimes(1)
        expect(calls.verify).toHaveBeenCalledWith(request.bytes)
        expectNothingWritten()
        expect(Object.hasOwn(fields(), 'themePacks')).toBe(false)
        expect(Object.hasOwn(fields(), 'activeThemePack')).toBe(false)
        expect(requestSaveNow).not.toHaveBeenCalled()
    })

    test('T2-9: a verify that rejects propagates and writes nothing', async () => {
        const { request } = requestOf()
        request.verify = vi.fn(async () => { throw new Error('the judge crashed') })

        await expect(installThemePack(request)).rejects.toThrow('the judge crashed')

        expectNothingWritten()
        expect(Object.hasOwn(fields(), 'themePacks')).toBe(false)
        expect(isBusy()).toBe(false)
    })

    test('T2-9: a write that throws answers writeFailed with the error and leaves no record', async () => {
        world.failWrite = new Error('the disk is full')

        const outcome = await installThemePack(requestOf().request)

        expect(outcome).toEqual({ ok: false, kind: 'writeFailed', error: world.failWrite })
        expect(Object.hasOwn(fields(), 'themePacks')).toBe(false)
        expect(Object.hasOwn(fields(), 'activeThemePack')).toBe(false)
        expect(requestSaveNow).not.toHaveBeenCalled()
        expect(isBusy()).toBe(false)
    })

    test('T2-9: a store that answers a key that is not the pack archive form is refused with no record', async () => {
        world.answerKey = 'assets/user-photo.png'

        const outcome = await installThemePack(requestOf().request)

        expect(outcome).toMatchObject({ ok: false, kind: 'writeFailed' })
        expect(Object.hasOwn(fields(), 'themePacks')).toBe(false)
    })

    test('T2-19: a store that answers success but holds damaged bytes (a Tauri-like has-short-circuit) is filesDamaged, with no record', async () => {
        world.afterWrite = 'damage'

        const outcome = await installThemePack(requestOf().request)

        expect(outcome).toEqual({ ok: false, kind: 'filesDamaged' })
        expect(world.log).toEqual([`write:${KEY}`, `read:${KEY}`])
        expect(Object.hasOwn(fields(), 'themePacks')).toBe(false)
        expect(Object.hasOwn(fields(), 'activeThemePack')).toBe(false)
        expect(requestSaveNow).not.toHaveBeenCalled()
    })

    test('T2-19: a store that answers success but holds nothing under the key is filesDamaged, with no record', async () => {
        world.afterWrite = 'drop'

        const outcome = await installThemePack(requestOf().request)

        expect(outcome).toEqual({ ok: false, kind: 'filesDamaged' })
        expect(Object.hasOwn(fields(), 'themePacks')).toBe(false)
    })

    test('T2A-2: a store with a 100 MiB per-value limit refuses an archive over it, and nothing is recorded', async () => {
        world.perValueLimit = 100 * 1024 * 1024
        const big = new Uint8Array(100 * 1024 * 1024 + 1)

        const outcome = await installThemePack(requestOf({ bytes: big }).request)

        expect(outcome).toMatchObject({ ok: false, kind: 'writeFailed' })
        expect(Object.hasOwn(fields(), 'themePacks')).toBe(false)
        expect(world.files.size).toBe(0)
    })

    test('guard: a themePacks value that is present but not a list is kept as it is, and the install is refused before the intake runs', async () => {
        installDb({ themePacks: { v: 99, future: true } })
        const { request, calls } = requestOf()

        const outcome = await installThemePack(request)

        expect(outcome).toEqual({ ok: false, kind: 'listUnreadable' })
        expect(calls.verify).not.toHaveBeenCalled()
        expectNothingWritten()
        expect(snapshotOf(fields().themePacks)).toEqual({ v: 99, future: true })
    })

    test('T2-11: an entry this build cannot read is kept byte for byte across another install', async () => {
        const unreadable = { v: 99, future: { a: { b: { c: { d: { e: [KEY, { n: 1 }] } } } } }, name: 'Next', id: 'future-1' }
        installDb({ themePacks: [structuredClone(unreadable)], activeThemePack: 'future-1' })

        okOf(await installThemePack(requestOf({ newId: 'pack-2' }).request))

        const list = snapshotOf(fields().themePacks) as Slot[]
        expect(list).toHaveLength(2)
        expect(list[0]).toStrictEqual(unreadable)
        expect(list[1].id).toBe('pack-2')
        expect(fields().activeThemePack).toBe('pack-2')
    })
})

describe('the refusals that write nothing', () => {
    test('T2-18: an install is refused while another action is registered, before the intake runs', async () => {
        beginBusy('import')
        const { request, calls } = requestOf()

        const outcome = await installThemePack(request)

        expect(outcome).toEqual({ ok: false, kind: 'busy' })
        expect(calls.verify).not.toHaveBeenCalled()
        expectNothingWritten()
    })

    test('T2-18: an install is refused while a restore is asking, before the intake runs', async () => {
        beginRestoreRun()
        const { request, calls } = requestOf()

        const outcome = await installThemePack(request)

        expect(outcome).toEqual({ ok: false, kind: 'restoring' })
        expect(calls.verify).not.toHaveBeenCalled()
        expectNothingWritten()
    })

    test('T2-18: a second install started while the first one writes is refused as busy', async () => {
        const first = installThemePack(requestOf().request)
        const second = await installThemePack(requestOf({ newId: 'pack-2' }).request)
        okOf(await first)

        expect(second).toEqual({ ok: false, kind: 'busy' })
        expect((snapshotOf(fields().themePacks) as Slot[]).map((pack) => pack.id)).toEqual(['pack-1'])
    })

    test('T2-18 replace-race: a restore that starts as a busy entry while the Replace? dialog is open stops the write', async () => {
        installDb({ themePacks: [recordFixture({ id: 'old-1' })] })
        const { request } = requestOf({ onConfirm: () => { beginBusy('backupLoad') } })

        const outcome = await installThemePack(request)

        expect(outcome).toMatchObject({ ok: false })
        expect(['busy', 'restoring']).toContain((outcome as { kind: string }).kind)
        expectNothingWritten()
        expect((snapshotOf(fields().themePacks) as Slot[]).map((pack) => pack.id)).toEqual(['old-1'])
        expect(requestSaveNow).not.toHaveBeenCalled()
    })

    test('T2-18 replace-race: a restore that starts as a run while the Replace? dialog is open stops the write', async () => {
        installDb({ themePacks: [recordFixture({ id: 'old-1' })] })
        const { request } = requestOf({ onConfirm: () => { beginRestoreRun() } })

        const outcome = await installThemePack(request)

        expect(outcome).toEqual({ ok: false, kind: 'restoring' })
        expectNothingWritten()
        expect((snapshotOf(fields().themePacks) as Slot[]).map((pack) => pack.id)).toEqual(['old-1'])
    })

    test('T2-18: the write phase runs under the busy entry and the entry is gone when the install returns, whatever the outcome', async () => {
        world.failWrite = new Error('the disk is full')

        await installThemePack(requestOf().request)

        expect(world.busyAtWrite).toEqual([['themePack']])
        expect(busyKinds()).toEqual([])
    })
})

describe('an install on a read-only page', () => {
    // Each state: the page mode, whether the store runs from OPFS this time, and what the page's own refusal says.
    const STATES: { label: string, mode: 'read-only' | 'writable', opfs: boolean | 'throws', cause: 'opfs' | 'mode' | null }[] = [
        { label: 'the transitional OPFS page', mode: 'writable', opfs: true, cause: 'opfs' },
        { label: 'the OPFS page that also set the read-only mode (the OPFS notice wins)', mode: 'read-only', opfs: true, cause: 'opfs' },
        { label: 'a page the boot made read-only on another store', mode: 'read-only', opfs: false, cause: 'mode' },
        { label: 'a read-only page whose store selection cannot be had', mode: 'read-only', opfs: 'throws', cause: 'mode' },
        { label: 'a writable page', mode: 'writable', opfs: false, cause: null },
        { label: 'a writable page whose store selection cannot be had', mode: 'writable', opfs: 'throws', cause: null },
    ]

    test.each(STATES)('T2-18 read-only: $label: the install refuses exactly when the page\'s own refusal does, with the cause that selects the same notice', async ({ mode, opfs, cause }) => {
        const { refuseOnReadOnlyPage } = await import('../storage/readOnlyPage')
        setPageStorageMode(mode === 'read-only' ? { kind: 'read-only', reason: 'server-capability' } : { kind: 'store2' })
        world.selection.answer = opfs
        const { request, calls } = requestOf()

        const outcome = await installThemePack(request)

        // The install shows no notice of its own.
        expect(alertError).not.toHaveBeenCalled()
        if (cause === null) {
            expect(outcome.ok).toBe(true)
        } else {
            expect(outcome).toEqual({ ok: false, kind: 'readOnly', cause })
            expect(calls.verify).not.toHaveBeenCalled()
            expectNothingWritten()
        }
        // The page's own refusal, run now, agrees on whether and on which notice.
        const refused = await refuseOnReadOnlyPage()
        expect(refused).toBe(cause !== null)
        if (cause === 'opfs') {
            expect(alertError).toHaveBeenCalledWith(language.opfsReadOnlyNotice)
        } else if (cause === 'mode') {
            expect(alertError).toHaveBeenCalledWith(language.store2Boot.readOnlyRefusal)
        } else {
            expect(alertError).not.toHaveBeenCalled()
        }
    })
})

describe('Replace?', () => {
    test('T2A-1: one key per pack: an equal archive under a second record names the same key, and nothing is written twice under another name', async () => {
        okOf(await installThemePack(requestOf({ manifest: manifestOf({ packId: 'one' }), newId: 'a' }).request))
        okOf(await installThemePack(requestOf({ manifest: manifestOf({ packId: 'two' }), newId: 'b' }).request))

        const archives = (snapshotOf(fields().themePacks) as Slot[]).map((pack) => pack.archive)
        expect(archives).toEqual([KEY, KEY])
        expect(world.files.size).toBe(1)
    })

    test('T2A-1: an equal author id asks Replace? (the names differ), and a confirmed replacement keeps one record at the old index and activates it', async () => {
        installDb({
            themePacks: [recordFixture({ id: 'other', packId: 'other-pack', name: 'Other' }), recordFixture({ id: 'old-1', name: 'Old name' })],
            activeThemePack: 'other',
        })
        const { request, calls } = requestOf({ newId: 'pack-new' })

        const outcome = okOf(await installThemePack(request))

        expect(calls.confirmReplace).toHaveBeenCalledTimes(1)
        expect((calls.confirmReplace.mock.calls[0] as unknown as [ThemePackRecordV1])[0].id).toBe('old-1')
        expect(outcome.replaced).toBe(true)
        const list = snapshotOf(fields().themePacks) as Slot[]
        expect(list.map((pack) => pack.id)).toEqual(['other', 'pack-new'])
        expect(fields().activeThemePack).toBe('pack-new')
    })

    test('T2A-1: with no author id on either side the same name asks Replace?, and a replacement keeps the old index', async () => {
        const old = recordFixture({ id: 'old-1' })
        delete old.packId
        installDb({ themePacks: [old, recordFixture({ id: 'last', packId: 'last-pack', name: 'Last' })] })
        const { request, calls } = requestOf({ manifest: manifestOf({ packId: undefined }), newId: 'pack-new' })

        const outcome = okOf(await installThemePack(request))

        expect(calls.confirmReplace).toHaveBeenCalledTimes(1)
        expect(outcome.replaced).toBe(true)
        expect((snapshotOf(fields().themePacks) as Slot[]).map((pack) => pack.id)).toEqual(['pack-new', 'last'])
    })

    test('T2A-1: declining Replace? writes nothing and keeps the page as it was', async () => {
        installDb({ themePacks: [recordFixture({ id: 'old-1' })], activeThemePack: 'old-1' })
        const { request } = requestOf({ replaceAnswer: false })

        const outcome = await installThemePack(request)

        expect(outcome).toEqual({ ok: false, kind: 'declinedReplace' })
        expectNothingWritten()
        expect((snapshotOf(fields().themePacks) as Slot[]).map((pack) => pack.id)).toEqual(['old-1'])
        expect(fields().activeThemePack).toBe('old-1')
        expect(requestSaveNow).not.toHaveBeenCalled()
    })

    test('T2A-1: the same name under two different author ids asks nothing and appends a second record', async () => {
        installDb({ themePacks: [recordFixture({ id: 'old-1', packId: 'author-one' })] })
        const { request, calls } = requestOf({ manifest: manifestOf({ packId: 'author-two' }), newId: 'pack-2' })

        const outcome = okOf(await installThemePack(request))

        expect(calls.confirmReplace).not.toHaveBeenCalled()
        expect(outcome.replaced).toBe(false)
        expect((snapshotOf(fields().themePacks) as Slot[]).map((pack) => pack.id)).toEqual(['old-1', 'pack-2'])
    })

    test('T2A-1: the same name when only one side has an author id asks nothing, in both directions', async () => {
        const withoutId = recordFixture({ id: 'old-1' })
        delete withoutId.packId
        installDb({ themePacks: [withoutId] })
        const first = requestOf({ manifest: manifestOf({ packId: 'author-one' }), newId: 'pack-2' })
        okOf(await installThemePack(first.request))
        installDb({ themePacks: [recordFixture({ id: 'old-2', packId: 'author-one' })] })
        const second = requestOf({ manifest: manifestOf({ packId: undefined }), newId: 'pack-3' })
        okOf(await installThemePack(second.request))

        expect(first.calls.confirmReplace).not.toHaveBeenCalled()
        expect(second.calls.confirmReplace).not.toHaveBeenCalled()
    })

    test('T2A-1: a record that was removed while the dialog was open is not resurrected: the new record is appended', async () => {
        installDb({ themePacks: [recordFixture({ id: 'old-1' })] })
        const { request } = requestOf({
            newId: 'pack-new',
            onConfirm: () => {
                const entry = listThemePacks(livePacks())[0]
                removeThemePackAt(entry.index, entry.entry)
            },
        })

        const outcome = okOf(await installThemePack(request))

        expect(outcome.replaced).toBe(false)
        expect((snapshotOf(fields().themePacks) as Slot[]).map((pack) => pack.id)).toEqual(['pack-new'])
    })

    test('guard: an unreadable entry never matches by name or id and is never asked about', async () => {
        installDb({ themePacks: [{ v: 99, name: 'Origin Navy', packId: 'origin-navy', id: 'x' }] })
        const { request, calls } = requestOf({ newId: 'pack-2' })

        okOf(await installThemePack(request))

        expect(calls.confirmReplace).not.toHaveBeenCalled()
        expect((snapshotOf(fields().themePacks) as Slot[])).toHaveLength(2)
    })
})

describe('Remove and the active id', () => {
    async function twoInstalled(): Promise<void> {
        okOf(await installThemePack(requestOf({ manifest: manifestOf({ packId: 'one' }), newId: 'a' }).request))
        okOf(await installThemePack(requestOf({ manifest: manifestOf({ packId: 'two', name: 'Two' }), newId: 'b', bytes: Uint8Array.from([5, 6, 7]) }).request))
    }

    test('T2-21: the entry the list returns removes exactly that entry and never touches the store', async () => {
        await twoInstalled()
        world.log.length = 0
        const accessesBefore = world.storeAccesses
        const entry = listThemePacks(livePacks())[0]

        expect(removeThemePackAt(entry.index, entry.entry)).toEqual({ ok: true })

        expect((snapshotOf(fields().themePacks) as Slot[]).map((pack) => pack.id)).toEqual(['b'])
        expect(world.log).toEqual([])
        expect(world.storeAccesses).toBe(accessesBefore)
        expect(world.files.size).toBe(2)
    })

    test('T2-21: the raw record an install returned is never equal to its live entry, so the call answers changed and the list stays', async () => {
        const outcome = okOf(await installThemePack(requestOf().request))

        expect(removeThemePackAt(0, outcome.record)).toEqual({ ok: false, kind: 'changed' })

        expect(livePacks()).toHaveLength(1)
        expect(fields().activeThemePack).toBe('pack-1')
    })

    test('T2-21: removing the active pack clears the id, and removing another pack leaves it', async () => {
        await twoInstalled()
        expect(fields().activeThemePack).toBe('b')
        const first = listThemePacks(livePacks())[0]
        expect(removeThemePackAt(first.index, first.entry)).toEqual({ ok: true })
        expect(fields().activeThemePack).toBe('b')

        const last = listThemePacks(livePacks())[0]
        expect(removeThemePackAt(last.index, last.entry)).toEqual({ ok: true })

        expect(Object.hasOwn(fields(), 'activeThemePack')).toBe(false)
        expect(livePacks()).toEqual([])
    })

    test('T2-21: an unreadable entry can be removed, and a built-in active id is not cleared by it', async () => {
        installDb({ themePacks: [{ v: 99, future: true }], activeThemePack: 'builtin:origin-navy' })
        const entry = listThemePacks(livePacks())[0]

        expect(entry.read.ok).toBe(false)
        expect(removeThemePackAt(entry.index, entry.entry)).toEqual({ ok: true })

        expect(livePacks()).toEqual([])
        expect(fields().activeThemePack).toBe('builtin:origin-navy')
    })

    test('T2-21: a stale index answers changed and removes nothing', async () => {
        await twoInstalled()
        const entry = listThemePacks(livePacks())[0]

        expect(removeThemePackAt(1, entry.entry)).toEqual({ ok: false, kind: 'changed' })
        expect(removeThemePackAt(7, entry.entry)).toEqual({ ok: false, kind: 'changed' })
        expect(removeThemePackAt(-1, entry.entry)).toEqual({ ok: false, kind: 'changed' })
        expect(removeThemePackAt(0, undefined)).toEqual({ ok: false, kind: 'changed' })

        expect(livePacks()).toHaveLength(2)
    })

    test('guard: with no list at all, Remove answers changed', () => {
        expect(removeThemePackAt(0, undefined)).toEqual({ ok: false, kind: 'changed' })
        expect(removeThemePackAt(0, {})).toEqual({ ok: false, kind: 'changed' })
    })

    test('setActiveThemePack sets a record id or a built-in id, and undefined deletes the key', () => {
        setActiveThemePack('pack-1')
        expect(fields().activeThemePack).toBe('pack-1')
        setActiveThemePack('builtin:banana-cocoa')
        expect(fields().activeThemePack).toBe('builtin:banana-cocoa')

        setActiveThemePack(undefined)

        expect(Object.hasOwn(fields(), 'activeThemePack')).toBe(false)
    })
})

describe('plugin exposure of the theme pack fields', () => {
    test('T2-22 guard: neither field is an allowed plugin database key, and the V2 database proxy neither answers nor lists them', () => {
        installDb({ themePacks: [recordFixture()], activeThemePack: 'pack-1' })
        const pluginDb = getV2PluginAPIs().getDatabase() as unknown as Record<string, unknown>

        for (const field of ['themePacks', 'activeThemePack']) {
            expect(allowedDbKeys).not.toContain(field)
            expect(pluginDb[field]).toBeUndefined()
            expect(Object.keys(pluginDb)).not.toContain(field)
        }
    })

    test('T2-22 guard: a V2 write of either field lands in plugin storage and leaves the field untouched', () => {
        installDb({ themePacks: [recordFixture()], activeThemePack: 'pack-1' })
        const pluginDb = getV2PluginAPIs().getDatabase() as unknown as Record<string, unknown>

        pluginDb.themePacks = [{ id: 'evil' }]
        pluginDb.activeThemePack = 'evil'
        flushSync()

        expect(snapshotOf(fields().themePacks)).toEqual([recordFixture()])
        expect(fields().activeThemePack).toBe('pack-1')
    })
})
