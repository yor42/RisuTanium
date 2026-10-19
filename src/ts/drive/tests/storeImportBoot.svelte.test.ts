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

afterEach(() => {
    worlds.parkAll()
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
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
    test('new behaviour: with no page mode and no residency, the cold entries of the file are read from the file and none is stored or attempted', async () => {
        const boot = await openBoot()
        oldUnits.set(ID.inlineChatUnit, { message: [{ time: 1, data: 'the OLD profile\'s unit', role: 'char' }] })
        const seen: Seen = { reads: new Map(), sourceHadTree: false }

        const end = await pickAtBoot(recordingTarget(seen, { status: 'blocked', reason: 'install-failed', detail: 'recorded' }), golden('upstream-full.bin'))

        expect(setColdStorageItemMock).not.toHaveBeenCalled()
        expect(boot.w.store.mutating().filter((op) => op.key.startsWith('coldstorage/'))).toEqual([])
        expect(boot.w.store.peek(`coldstorage/${ID.inlineChatUnit}`)).toBeNull()
        expect(seen.sourceHadTree).toBe(true)
        expect(end).toEqual({ kind: 'finished', result: { status: 'blocked', reason: 'install-failed', detail: 'recorded' } })
    })

    test('new behaviour: the unit the file holds wins over the old profile\'s unit of the same id, and an id the file lacks falls back to the boot\'s reader, never the page\'s', async () => {
        await openBoot()
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
})
