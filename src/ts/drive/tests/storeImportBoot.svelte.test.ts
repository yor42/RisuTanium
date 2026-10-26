/**
 * The start-up `.bin` import (`loadBackupAtBoot` -> `LoadLocalBackup` with a boot target): the file flow of the Settings
 * import with the boot's installer as its target. At boot no page mode is set and no residency is registered, yet the store
 * still holds the old upstream profile, whose cold-storage units may carry the same ids as the file's entries.
 *
 * Gate 1 C1: the file's cold-storage entries are indexed and read on demand and NEVER written, because the import target
 * is a boot, whatever `getResidency()` says. A path that chose by the residency would take the block-era branch at boot
 * and overwrite the old units.
 *
 * Runs over the real `saveDb()` world of `storeImport.svelte.test.ts` with the page mode reset to `unset` and the
 * residency cleared, the way a boot sees the page. The unit store of the old profile is a double (`coldUnits`). A mocked
 * success here is not evidence of native behaviour.
 *
 * Labels: new behaviour, mutant (a recorded temporary edit that turns the named test red: the lazy reader following
 * `getResidency()`, the cold-storage write, and the removed picker `cancel` listener).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, sleepReal, settled, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import type { BootImportResult, BootImportTarget } from 'src/ts/storage/store2/legacy/bootImport'
import type { LegacyEntryReader } from 'src/ts/storage/store2/legacy/resolve'
import { ID } from 'src/ts/storage/tests/store2/legacyFixtures'
import type { Database } from 'src/ts/storage/database.svelte'

vi.setConfig({ testTimeout: 60_000 })

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

/** The old upstream profile's cold units by id: what the boot's reader answers, and what a block-era write would overwrite. */
const oldUnits = new Map<string, unknown>()
const setColdStorageItemMock = vi.fn(async () => false)
const pageReadMock = vi.fn(async (key: string) => ({ status: 'missing' as const, key }))

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
    oldUnits.clear()
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
    // The page's own unit store is a double that records writes and answers nothing: a boot import must reach neither.
    vi.doMock('src/ts/process/coldstorage.svelte', async () => ({
        getColdStorageItem: vi.fn(),
        getColdStorageBackupKey: (await import('src/ts/process/coldstorageData')).getColdStorageBackupKey,
        readColdStorageItem: pageReadMock,
        setColdStorageItem: setColdStorageItemMock,
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(async () => {
    const { overrideBackupWindowBytes } = await import('src/ts/drive/backupContainer')
    overrideBackupWindowBytes(null)
    worlds.parkAll()
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
    vi.doUnmock('src/ts/drive/inlayBackupImport')
    vi.restoreAllMocks()
    if (originalLocks) {
        Object.defineProperty(window.navigator, 'locks', originalLocks)
    } else {
        Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    }
})

interface Boot {
    w: World
    alert: typeof import('src/ts/alert')
}

/** A page as a boot sees it: no page mode and no residency, with the world's byte store holding the old profile's files. */
async function openBoot(): Promise<Boot> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha'])
    const k = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const alert = await import('src/ts/alert')
    vi.mocked(alert.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(alert.alertStore, 'set').mockImplementation(() => { })
    w.pageMode.setPageStorageMode({ kind: 'unset' })
    ;(await import('src/ts/storage/store2/residencyActive')).resetResidencyForTest()
    w.start()
    await sleepReal(100)
    await settled(w)
    return { w, alert }
}

const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

function golden(name: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, name)))
}

/** The goldens run at the default windows and again at windows so small that every golden crosses window edges in both passes. */
const GOLDEN_WINDOWS: readonly (number | undefined)[] = [undefined, 4, 64]

/** Set after `openBoot()`: the world re-imports the app's modules, and the seam must be the one the world's `backuplocal` reads. */
async function useGoldenWindows(windowBytes: number | undefined): Promise<void> {
    const { overrideBackupWindowBytes } = await import('src/ts/drive/backupContainer')
    overrideBackupWindowBytes(windowBytes === undefined ? null : { walk: windowBytes, copy: windowBytes })
}

/** Drives the real `loadBackupAtBoot()` with `bytes` as the chosen file; resolves with what the flow came to. */
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

interface Seen {
    reads: Map<string, unknown>
    sourceHadTree: boolean
}

/** A boot installer that only records what the flow handed it: the reader answers are read here, the install is not run. */
function recordingTarget(seen: Seen, result: BootImportResult): BootImportTarget {
    return {
        readColdStorageItem: async (key) => oldUnits.has(key) ? { status: 'ok', value: oldUnits.get(key) } : { status: 'missing' },
        async install(source, reader: LegacyEntryReader) {
            seen.sourceHadTree = source.tree !== null
            for (const id of Object.values(ID)) {
                const read = await reader.read(id)
                seen.reads.set(id, read)
            }
            return result
        },
    }
}

describe('the start-up .bin import never writes a cold-storage unit (Gate 1 C1)', () => {
    // Choosing the lazy reader by the page's residency or mode would send a boot import down the block-era branch,
    // which stores every cold entry of the file over the old upstream profile's same-id units. The boot import did not
    // exist on the base, so this is a new-behaviour test pinned by mutants, not a base reproducer.
    test.each(GOLDEN_WINDOWS)('new behaviour: with no page mode and no residency, the cold entries of the file are read from the file and none is stored or attempted (windows: %s)', async (windowBytes) => {
        const boot = await openBoot()
        await useGoldenWindows(windowBytes)
        oldUnits.set(ID.inlineChatUnit, { message: [{ time: 1, data: 'the OLD profile\'s unit', role: 'char' }] })
        const seen: Seen = { reads: new Map(), sourceHadTree: false }

        const end = await pickAtBoot(recordingTarget(seen, { status: 'blocked', reason: 'install-failed', detail: 'recorded' }), golden('upstream-full.bin'))

        expect(setColdStorageItemMock).not.toHaveBeenCalled()
        expect(boot.w.store.mutating().filter((op) => op.key.startsWith('coldstorage/'))).toEqual([])
        expect(boot.w.store.peek(`coldstorage/${ID.inlineChatUnit}`)).toBeNull()
        expect(seen.sourceHadTree).toBe(true)
        expect(end).toEqual({ kind: 'finished', result: { status: 'blocked', reason: 'install-failed', detail: 'recorded' } })
    })

    test.each(GOLDEN_WINDOWS)('new behaviour: the unit the file holds wins over the old profile\'s unit of the same id, and an id the file lacks falls back to the boot\'s reader, never the page\'s (windows: %s)', async (windowBytes) => {
        await openBoot()
        await useGoldenWindows(windowBytes)
        const oldMissing = { message: [{ time: 1, data: 'only in the old profile', role: 'char' }] }
        oldUnits.set(ID.inlineChatUnit, { message: [{ time: 1, data: 'the OLD profile\'s unit', role: 'char' }] })
        oldUnits.set(ID.missingChatUnit, oldMissing)
        const seen: Seen = { reads: new Map(), sourceHadTree: false }

        await pickAtBoot(recordingTarget(seen, { status: 'blocked', reason: 'install-failed', detail: 'recorded' }), golden('upstream-full.bin'))

        const inFile = seen.reads.get(ID.inlineChatUnit) as { status: string, value?: { message?: { data?: string }[] } }
        expect(inFile.status).toBe('ok')
        expect(JSON.stringify(inFile.value)).not.toContain('the OLD profile')
        expect(seen.reads.get(ID.missingChatUnit)).toEqual({ status: 'ok', value: oldMissing })
        expect(pageReadMock).not.toHaveBeenCalled()
    })

    test('new behaviour: dismissing the picker (the input\'s cancel event) ends the flow cancelled, so the boot can ask again', async () => {
        await openBoot()
        const installed = vi.fn(async () => ({ status: 'declined' as const }))
        const target: BootImportTarget = { readColdStorageItem: async () => ({ status: 'missing' }), install: installed }
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
            chosen.dispatchEvent(new Event('cancel'))
            expect(await ended).toEqual({ kind: 'cancelled' })
        } finally {
            spy.mockRestore()
        }
        expect(installed).not.toHaveBeenCalled()
    })

    // A file whose first entry is an asset the store refuses by name, followed by the upstream golden (its database is the last entry).
    function withRefusedAsset(): Uint8Array {
        const name = new TextEncoder().encode('.badname')
        const body = new Uint8Array([1, 2, 3])
        const chunk = new Uint8Array(4 + name.length + 4 + body.length)
        const view = new DataView(chunk.buffer)
        view.setUint32(0, name.length, true)
        chunk.set(name, 4)
        view.setUint32(4 + name.length, body.length, true)
        chunk.set(body, 8 + name.length)
        const rest = golden('upstream-full.bin')
        const out = new Uint8Array(chunk.length + rest.length)
        out.set(chunk, 0)
        out.set(rest, chunk.length)
        return out
    }

    /** The page's store refuses the one name, as a real store does for a key it cannot hold. */
    function refuseBadName(boot: Boot): void {
        const realWrite = boot.w.store.write.bind(boot.w.store)
        vi.spyOn(boot.w.store, 'write').mockImplementation(async (...args: Parameters<typeof realWrite>) => {
            if (args[0] === 'assets/.badname') {
                throw new boot.w.errors.StoreInvalidKeyError(args[0], 'refused for the test')
            }
            return realWrite(...args)
        })
    }

    const installedResult: BootImportResult = { status: 'installed', manifestKey: 'm', flushed: true, repair: { dropped: 0, changed: 0, recovered: 0 } }

    /** The notice is shown once the restore has run, however long it takes; the bound stays far inside the file's test timeout. */
    const NOTICE_WAIT = { timeout: 10_000 }

    /**
     * Releases the held notice and waits for the flow to end, so a test that failed before its own release cannot leave a flow
     * running into the next test through the shared alert mock. Errors of the flow are dropped here: the test's own failure,
     * or its own assertion on `ended`, is what reports.
     */
    async function endFlow(release: () => void, ended: Promise<unknown>): Promise<void> {
        release()
        await ended.catch(() => { })
    }

    test('new behaviour: an installed boot import shows the skipped-inlay notice, awaited, before the flow resolves', async () => {
        // The inlay pass is the real collector's; only its outcome is replaced, so the test pins that the boot path
        // hands the inlay skips to the notices (the asset skips alone would not show it).
        vi.doMock('src/ts/drive/inlayBackupImport', async (importOriginal) => ({
            ...await importOriginal<typeof import('src/ts/drive/inlayBackupImport')>(),
            restoreCollectedInlays: vi.fn(async () => ({ written: 0, skipped: [{ label: 'lost-inlay', reason: 'invalid' as const }], changed: false })),
        }))
        const boot = await openBoot()
        const { language } = await import('src/lang')
        let release: () => void = () => { }
        const held = new Promise<void>((resolve) => { release = resolve })
        vi.mocked(boot.alert.alertNormalWait).mockImplementation(() => held)
        const seen: Seen = { reads: new Map(), sourceHadTree: false }

        let resolved = false
        const ended = pickAtBoot(recordingTarget(seen, installedResult), golden('upstream-full.bin'))
        void ended.then(() => { resolved = true })
        try {
            await vi.waitFor(() => expect(boot.alert.alertNormalWait).toHaveBeenCalledWith(language.restoreInlaysInvalid(1, ['lost-inlay'])), NOTICE_WAIT)

            expect(seen.sourceHadTree).toBe(true)
            expect(resolved).toBe(false)
            release()
            expect(await ended).toEqual({ kind: 'finished', result: installedResult })
        } finally {
            await endFlow(release, ended)
        }
    })

    test('reproducer: an installed boot import shows the skipped-asset notice, awaited, before the flow resolves', async () => {
        const boot = await openBoot()
        const { language } = await import('src/lang')
        let release: () => void = () => { }
        const held = new Promise<void>((resolve) => { release = resolve })
        vi.mocked(boot.alert.alertNormalWait).mockImplementation(() => held)
        refuseBadName(boot)
        const seen: Seen = { reads: new Map(), sourceHadTree: false }

        let resolved = false
        const ended = pickAtBoot(recordingTarget(seen, installedResult), withRefusedAsset())
        void ended.then(() => { resolved = true })
        try {
            await vi.waitFor(() => expect(boot.alert.alertNormalWait).toHaveBeenCalledWith(language.restoreAssetsSkipped(1, ['.badname'])), NOTICE_WAIT)

            // The skip really happened: the pass ran past the refused entry, wrote the file's valid asset and refused the bad key.
            expect(seen.sourceHadTree).toBe(true)
            expect(boot.w.store.peek('assets/golden-avatar.png')).not.toBeNull()
            expect(boot.w.store.peek('assets/.badname')).toBeNull()
            expect(resolved).toBe(false)
            release()
            expect(await ended).toEqual({ kind: 'finished', result: installedResult })
        } finally {
            await endFlow(release, ended)
        }
    })

    test('guard: a cancelled boot import shows no skip notice', async () => {
        const boot = await openBoot()
        refuseBadName(boot)
        const installed = vi.fn(async () => ({ status: 'declined' as const }))
        const target: BootImportTarget = { readColdStorageItem: async () => ({ status: 'missing' }), install: installed }

        const end = await pickAtBoot(target, withRefusedAsset())

        expect(end).toEqual({ kind: 'cancelled' })
        expect(boot.alert.alertNormalWait).not.toHaveBeenCalled()
    })

    test('guard: an import that finished without installing (blocked) shows no skip notice', async () => {
        const boot = await openBoot()
        refuseBadName(boot)
        const seen: Seen = { reads: new Map(), sourceHadTree: false }

        const end = await pickAtBoot(recordingTarget(seen, { status: 'blocked', reason: 'install-failed', detail: 'recorded' }), withRefusedAsset())

        expect(end.kind).toBe('finished')
        expect(boot.alert.alertNormalWait).not.toHaveBeenCalled()
    })

    test('new behaviour: a file with no database entry is a refusal the flow shows, and it ends cancelled with nothing installed', async () => {
        const boot = await openBoot()
        const installed = vi.fn(async () => ({ status: 'declined' as const }))
        const target: BootImportTarget = { readColdStorageItem: async () => ({ status: 'missing' }), install: installed }

        // A file with no database entry is a refusal the flow shows itself.
        const end = await pickAtBoot(target, new Uint8Array([0, 0, 0, 0]))

        expect(end).toEqual({ kind: 'cancelled' })
        expect(installed).not.toHaveBeenCalled()
        expect(vi.mocked(boot.alert.alertError).mock.calls.length).toBeGreaterThan(0)
    })

    test('write reproducer: a complete database followed by a partial extra entry is refused at boot with nothing installed', async () => {
        const boot = await openBoot()
        const { language } = await import('src/lang')
        const installed = vi.fn(async () => ({ status: 'declined' as const }))
        const target: BootImportTarget = { readColdStorageItem: async () => ({ status: 'missing' }), install: installed }
        const partial = new Uint8Array(12)
        new DataView(partial.buffer).setUint32(0, 9, true)
        const rest = golden('upstream-full.bin')
        const bytes = new Uint8Array(rest.length + partial.length)
        bytes.set(rest, 0)
        bytes.set(partial, rest.length)

        const end = await pickAtBoot(target, bytes)

        expect(end).toEqual({ kind: 'cancelled' })
        expect(installed).not.toHaveBeenCalled()
        expect(vi.mocked(boot.alert.alertError)).toHaveBeenCalledWith(language.backupFileEndsEarly)
        expect(boot.w.store.mutating()).toEqual([])
    })
})
