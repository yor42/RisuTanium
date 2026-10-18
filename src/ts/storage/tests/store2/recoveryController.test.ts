// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The dispatch reaches the page store selection only through the legacy block owner it disables; the selection drags in
// the app's boot chain, which a protocol test must not load.
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => { throw new Error('The page store is not selected in this test.') },
    getAppStoreKind: async () => { throw new Error('The page store is not selected in this test.') },
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import { changeLanguage, language } from 'src/lang'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import type { AppStoreKind } from 'src/ts/storage/store/appStore'
import {
    createMemoryBackend, Store2BackendFailureError, Store2UnknownOutcomeError,
    type MemoryBackend, type Store2Backend, type Store2Read,
} from 'src/ts/storage/store2/backend'
import { resetStore2BootForTest, type BlockedReason } from 'src/ts/storage/store2/bootActive'
import { dispatchStore2Boot, type Store2BootUi, type Store2RecoveryRequest } from 'src/ts/storage/store2/bootDispatch'
import { classifyCommitRead, firstCommitKey, nextCommitKey } from 'src/ts/storage/store2/commitKey'
import type { FenceExitResult } from 'src/ts/storage/store2/fence'
import { encodeUnit, newStagingId, stagingPrefix, UNIT_TYPE, type StagingLabel } from 'src/ts/storage/store2/format'
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import { convertLegacyProfile, convertLegacyWithout, type LegacyDecoders } from 'src/ts/storage/store2/legacy/convert'
import type { Staging } from 'src/ts/storage/store2/owner'
import { createOwnerIdStore } from 'src/ts/storage/store2/ownerStore'
import { seedStore2Profile } from 'src/ts/storage/store2/bootSeed'
import { listRecoveryCandidates, type ExitResult } from 'src/ts/storage/store2/recovery'
import { installPick, pickCandidate, type InstallResult, type PickResult } from 'src/ts/storage/store2/recoveryPick'
import { resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import { Store2Session } from 'src/ts/storage/store2/session'
import { pickButtonKey, type BootScreenModel } from 'src/ts/storage/store2/ui/bootText'
import { runRecovery, type RecoveryCalls, type RecoveryPort } from 'src/ts/storage/store2/ui/recoveryController'
import type { Database } from 'src/ts/storage/database.svelte'
import { createClock, createPeerDouble, testEnv } from '../store2SaveKit'
import { buildSmall, fakeLists } from './codecFixtures'
import { plantTree, type Planted } from './recoveryFixtures'

/**
 * The recovery controller (`store2/ui/recoveryController.ts`) over the real dispatch, a real session and the memory
 * backend behind a call recorder. A fake port records every screen and lets a test press a button; the exits are the real
 * ones unless a test names a result. Labels: new behaviour; the guards that must pass before and after say so. Mocked: the
 * port (the guard window and the single-answer rule are tested with the real boot screen in `productionBootUi.test.ts`).
 */

const text = () => language.store2Boot

const DAMAGED_COMMIT = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63])
const PEER = 'b'.repeat(26)
const WRITES = new Set(['casCommit', 'casFence', 'putUnit', 'commitOrdinary', 'removeBatch'])

// ---- the recorder and the port ----

interface Recorded {
    backend: Store2Backend
    /** Every call in order, by method name. */
    log: string[]
    faults: { putUnit: boolean }
}

function recorded(inner: Store2Backend): Recorded {
    const log: string[] = []
    const faults = { putUnit: false }
    const backend: Store2Backend = {
        readCommit: () => { log.push('readCommit'); return inner.readCommit() },
        readFence: () => { log.push('readFence'); return inner.readFence() },
        readUnits: (keys) => { log.push('readUnits'); return inner.readUnits(keys) },
        listStore2: () => { log.push('listStore2'); return inner.listStore2() },
        countPrefix: (prefix) => { log.push('countPrefix'); return inner.countPrefix(prefix) },
        casCommit: (expected, next) => { log.push('casCommit'); return inner.casCommit(expected, next) },
        casFence: (expected, next) => { log.push('casFence'); return inner.casFence(expected, next) },
        commitOrdinary: (expected, units, next) => { log.push('commitOrdinary'); return inner.commitOrdinary(expected, units, next) },
        putUnit: async (key, bytes) => {
            log.push('putUnit')
            if (faults.putUnit) {
                throw new Store2BackendFailureError('Injected put failure.')
            }
            return inner.putUnit(key, bytes)
        },
        removeBatch: (keys, commit, fence) => { log.push('removeBatch'); return inner.removeBatch(keys, commit, fence) },
    }
    return { backend, log, faults }
}

function writesIn(log: readonly string[]): number {
    return log.filter((name) => WRITES.has(name)).length
}

function keysOf(model: BootScreenModel): string[] {
    return model.buttons.map((button) => button.key)
}

/** What the controller had called when its final screen was shown. */
interface EndSnapshot {
    log: number
    counts: Record<keyof RecoveryCalls, number>
}

class FakePort implements RecoveryPort {
    screens: BootScreenModel[] = []
    pending: { model: BootScreenModel, resolve: (key: string) => void } | null = null
    terminalModel: BootScreenModel | null = null
    /** Taken inside `terminal`, so a call made after the final screen is up cannot move it. */
    ended: EndSnapshot | null = null
    snapshotEnd: (() => EndSnapshot) | null = null
    reloads = 0

    ask(model: BootScreenModel): Promise<string> {
        this.screens.push(model)
        return new Promise<string>((resolve) => { this.pending = { model, resolve } })
    }

    show(model: BootScreenModel): void {
        this.screens.push(model)
        this.pending = null
    }

    terminal(model: BootScreenModel): void {
        this.screens.push(model)
        this.pending = null
        this.terminalModel = model
        this.ended = this.snapshotEnd?.() ?? null
    }

    reload(): void {
        this.reloads += 1
    }

    get current(): BootScreenModel {
        return this.screens[this.screens.length - 1]
    }

    /** Waits for a question that has a button `key` (a button or a saved-version row) and presses it. */
    async press(key: string): Promise<void> {
        await until(() => {
            const pending = this.pending
            expect(pending !== null && [...pending.model.buttons, ...(pending.model.rows ?? [])].some((button) => button.key === key), `a screen with ${key}; the screen is "${this.current?.title}"`).toBe(true)
        })
        const pending = this.pending
        this.pending = null
        pending?.resolve(key)
    }
}

function until(check: () => void): Promise<void> {
    return vi.waitFor(check, { timeout: 5000, interval: 2 })
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30))

// ---- the rig ----

interface RigOptions {
    kind?: AppStoreKind
    /** The commit key the screen starts over. */
    start?: 'damaged' | 'foreign-recovery-marker'
    mainFile?: boolean
    /** A legacy main file the default decoders cannot read; the fake decoder reads it as the small tree. */
    legacy?: boolean
    calls?: Partial<RecoveryCalls>
    trees?: number
    listStore?: (prefix: string) => Promise<string[]>
}

interface Rig {
    memory: MemoryBackend
    store: MemoryByteStore
    trace: Recorded
    port: FakePort
    request: Store2RecoveryRequest
    planted: Planted[]
    /** The saved versions, newest first. */
    manifests: string[]
    counts: Record<keyof RecoveryCalls, number>
    /** The commit-key read each pick was started over, in order. */
    pickBases: Store2Read[]
    results: { picks: PickResult[], installs: InstallResult[] }
    start(): void
    toOffers(): Promise<void>
    /** Opens the first saved version through the confirmation and waits for its install screen. */
    pickToInstallScreen(index?: number): Promise<void>
    commitKey(): Promise<Uint8Array | null>
    reboot(kind: AppStoreKind): Promise<Store2Session>
}

function legacyTree(): Database {
    return JSON.parse(JSON.stringify(buildSmall(2))) as Database
}

const LEGACY_DECODERS: LegacyDecoders = {
    async strict() { return legacyTree() },
    async lenient() { throw new Error('The file does not decode, even leniently.') },
}

function stagingOf(label: StagingLabel, owner: string): Staging {
    return { owner, prefix: stagingPrefix(newStagingId(testEnv(createClock(), 5))), startedAt: 1_700_000_000_000, label }
}

async function rig(options: RigOptions = {}): Promise<Rig> {
    const clock = createClock()
    const memory = createMemoryBackend()
    const store = createMemoryByteStore()
    if (options.listStore !== undefined) {
        store.list = options.listStore
    }
    const mainFile = options.mainFile ?? options.legacy ?? false
    if (options.legacy === true) {
        store.files.set('database/database.bin', new Uint8Array([1, 2, 3]))
    }
    const planted: Planted[] = []
    for (let tree = 0; tree < (options.trees ?? 2); tree++) {
        planted.push(await plantTree(memory, testEnv(clock, 100 + tree), { seq: 5 + tree }))
        clock.advance(3_600_000)
    }
    const manifests = [...planted].reverse().map((entry) => entry.manifestKey)
    const start = options.start ?? 'damaged'
    memory.poke(COMMIT_KEY, start === 'damaged'
        ? DAMAGED_COMMIT
        : encodeUnit(UNIT_TYPE.commit, firstCommitKey({ current: null, staging: stagingOf('recovery', PEER) }, testEnv(clock, 6))))

    const trace = recorded(memory)
    const requests: Store2RecoveryRequest[] = []
    const ui: Store2BootUi = {
        notice: () => { },
        blocked: async () => { },
        offerRestoreOrImport: async () => { },
        confirmConvert: async () => { throw new Error('Not asked.') },
        declined: async () => { throw new Error('Not asked.') },
        confirmFromBackup: async () => { throw new Error('Not asked.') },
        confirmConvertWithout: async () => { throw new Error('Not asked.') },
        confirmIncomplete: async () => { throw new Error('Not asked.') },
        confirmFlaggedOpen: async () => { throw new Error('Not asked.') },
        foreignMarker: async () => { throw new Error('Not asked.') },
        recovery: async (request) => { requests.push(request) },
        peer: createPeerDouble(),
    }
    const kind = options.kind ?? 'indexeddb'
    const bootEnv = {
        store,
        upstreamMainFile: async () => mainFile,
        listBackupTimes: async () => [],
        readColdStorageItem: async () => ({ status: 'missing' as const }),
    }
    await dispatchStore2Boot(bootEnv, {
        ui, kind, backend: async () => trace.backend, keyEnv: testEnv(clock, 9001), lists: fakeLists, decoders: LEGACY_DECODERS,
    })
    expect(requests).toHaveLength(1)
    const request = requests[0]
    trace.log.length = 0

    const counts: Rig['counts'] = { listCandidates: 0, pick: 0, install: 0, convert: 0, convertWithout: 0, seed: 0 }
    const pickBases: Store2Read[] = []
    const results: Rig['results'] = { picks: [], installs: [] }
    // A controller that retries on its own would spin without a press; the bound turns that into a failure, not a hang.
    const count = (name: keyof RecoveryCalls): void => {
        if (counts[name] >= 20) {
            throw new Error(`The controller called ${name} ${counts[name]} times without a press.`)
        }
        counts[name]++
    }
    const calls: RecoveryCalls = {
        listCandidates: (...args) => { count('listCandidates'); return (options.calls?.listCandidates ?? listRecoveryCandidates)(...args) },
        pick: async (...args) => {
            count('pick')
            pickBases.push(args[1])
            const result = await (options.calls?.pick ?? pickCandidate)(...args)
            results.picks.push(result)
            return result
        },
        install: async (...args) => {
            count('install')
            const result = await (options.calls?.install ?? installPick)(...args)
            results.installs.push(result)
            return result
        },
        convert: (...args) => { count('convert'); return (options.calls?.convert ?? convertLegacyProfile)(...args) },
        convertWithout: (...args) => { count('convertWithout'); return (options.calls?.convertWithout ?? convertLegacyWithout)(...args) },
        seed: (...args) => { count('seed'); return (options.calls?.seed ?? seedStore2Profile)(...args) },
    }
    const port = new FakePort()
    port.snapshotEnd = () => ({ log: trace.log.length, counts: { ...counts } })
    const rigged: Rig = {
        memory, store, trace, port, request, planted, manifests, counts, pickBases, results,
        start: () => { void runRecovery(request, port, calls) },
        toOffers: () => until(() => expect(port.current?.title).toBe(text().recoveryTitle)),
        async pickToInstallScreen(index = 0) {
            await port.press(pickButtonKey(manifests[index]))
            await port.press('recoveryPickGo')
            await until(() => expect(port.current?.title).toBe(text().recoveryInstallTitle))
        },
        commitKey: async () => (await memory.readCommit()).bytes,
        async reboot(rebootKind) {
            return Store2Session.open(store, {
                kind: rebootKind,
                backend: memory,
                ownerStore: createOwnerIdStore(store),
                upstreamMainFile: async () => mainFile,
                env: testEnv(clock, 77),
            })
        },
    }
    return rigged
}

beforeEach(() => {
    changeLanguage('en')
    resetStore2SaveForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
})

afterEach(() => {
    resetStore2SaveForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
})

function terminalOf(t: Rig): BootScreenModel {
    const model = t.port.terminalModel
    if (model === null) {
        throw new Error('The screen did not end.')
    }
    return model
}

/** The screen has ended: Reload is the only button and it has focus. */
function expectEnded(t: Rig, paragraphs: readonly string[]): void {
    const model = terminalOf(t)
    expect(keysOf(model)).toEqual(['reload'])
    expect(model.focus).toBe('reload')
    expect(model.paragraphs).toEqual(paragraphs)
    expect(t.port.current).toBe(model)
}

/** Nothing reached the backend and no exit or read was called after the moment the final screen was shown. */
function expectQuietSinceEnd(t: Rig): void {
    const ended = t.port.ended
    if (ended === null) {
        throw new Error('The screen did not end.')
    }
    expect(t.trace.log.length).toBe(ended.log)
    expect(t.counts).toEqual(ended.counts)
}

/**
 * Waits for the screen to end, then proves that nothing was called from the moment the final screen was shown (a
 * re-read or rebuild made while ending would show) and that no screen follows.
 */
async function endsAndStaysQuiet(t: Rig, paragraphs: readonly string[]): Promise<void> {
    await until(() => expect(t.port.terminalModel).not.toBeNull())
    const screens = t.port.screens.length
    await settle()
    expectEnded(t, paragraphs)
    expectQuietSinceEnd(t)
    expect(t.port.screens.length).toBe(screens)
}

const noMarkerExit = (status: ExitResult): PickResult => ({ status: 'exit', exit: status as Exclude<ExitResult, { status: 'marked' }> })

// ---- nothing writes before the person agrees ----

describe('the pick confirmation precedes every write', () => {
    test('opening the screen, choosing a version and cancelling write nothing; only "Use this version" starts the exit', async () => {
        const t = await rig()
        t.start()
        await t.toOffers()
        expect(t.port.current.rows?.map((row) => row.key)).toEqual(t.manifests.map(pickButtonKey))
        expect(t.port.current.focus).toBeNull()

        await t.port.press(pickButtonKey(t.manifests[0]))
        await until(() => expect(keysOf(t.port.current)).toEqual(['recoveryCancel', 'recoveryPickGo']))
        expect(keysOf(t.port.current)).toEqual(['recoveryCancel', 'recoveryPickGo'])
        expect(t.port.current.focus).toBe('recoveryCancel')
        expect(t.port.current.paragraphs).toEqual([text().recoveryPickBody])
        expect(writesIn(t.trace.log)).toBe(0)
        expect(t.counts.pick).toBe(0)

        await t.port.press('recoveryCancel')
        await t.toOffers()
        expect(writesIn(t.trace.log)).toBe(0)
        expect(t.counts.pick).toBe(0)

        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await until(() => expect(t.port.current.title).toBe(text().recoveryInstallTitle))
        expect(writesIn(t.trace.log)).toBeGreaterThan(0)
        expect(t.counts.pick).toBe(1)
    })

    test('the pick confirmation says the profile stays in recovery until a version is installed, and nothing is deleted', async () => {
        const t = await rig()
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await until(() => expect(t.port.current.paragraphs).toEqual([text().recoveryPickBody]))
        expect(text().recoveryPickBody).toContain('until a version is installed')
        expect(text().recoveryPickBody).toContain('Nothing is deleted')
    })

    test('the checking screen shows Skip from its first frame, with no Cancel, and focus on the heading', async () => {
        const t = await rig({ listStore: () => new Promise<string[]>(() => { }) })
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await until(() => expect(t.port.current.title).toBe(text().recoveryCheckingTitle))
        expect(keysOf(t.port.current)).toEqual(['recoveryCheckSkip'])
        expect(t.port.current.focus).toBeNull()
    })
})

describe('the pick is asked again until this screen holds a marker of its own', () => {
    test('a first pick that wrote no marker (the exit was not offered) is asked again; a pick after a marker is not', async () => {
        const notOffered = noMarkerExit({ status: 'fence', fence: { status: 'not-offered', reason: 'listing-failed', detail: 'the listing failed' } })
        let first = true
        const t = await rig({
            calls: {
                pick: async (...args) => {
                    if (first) {
                        first = false
                        return notOffered
                    }
                    return pickCandidate(...args)
                },
            },
        })
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await until(() => expect(t.port.current.title).toBe(text().recoveryResultTitle))
        expect(writesIn(t.trace.log)).toBe(0)
        await t.port.press('recoveryBack')
        await t.toOffers()

        // No marker was written, so the next pick is still the first write and asks again.
        await t.port.press(pickButtonKey(t.manifests[0]))
        await until(() => expect(keysOf(t.port.current)).toEqual(['recoveryCancel', 'recoveryPickGo']))
        await t.port.press('recoveryPickGo')
        await until(() => expect(t.port.current.title).toBe(text().recoveryInstallTitle))

        // The marker now stands: Cancel, and the next pick starts without a question.
        await t.port.press('recoveryCancel')
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[1]))
        await until(() => expect(t.port.current.title).toBe(text().recoveryInstallTitle))
        expect(t.counts.pick).toBe(3)
    })

    test('a first pick whose manifest is unusable wrote no marker and is asked again', async () => {
        const t = await rig()
        // The newest manifest is removed after the listing was taken, so the manifest read fails before any write.
        t.start()
        await t.toOffers()
        t.memory.poke(t.manifests[0], null)
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await until(() => expect(t.port.current.title).toBe(text().recoveryProblemTitle))
        expect(t.port.current.paragraphs).toEqual([text().recoveryProblemMissing])
        expect(writesIn(t.trace.log)).toBe(0)
        await t.port.press('recoveryBack')
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[1]))
        await until(() => expect(keysOf(t.port.current)).toEqual(['recoveryCancel', 'recoveryPickGo']))
    })
})

describe('every later exit runs over the marker this screen wrote', () => {
    test('the second pick starts over the first pick\'s markerRead, not the session\'s read', async () => {
        const t = await rig()
        t.start()
        await t.toOffers()
        await t.pickToInstallScreen(0)
        await t.port.press('recoveryCancel')
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[1]))
        await until(() => expect(t.port.current.title).toBe(text().recoveryInstallTitle))

        const first = t.results.picks[0]
        expect(first.status).toBe('ready')
        expect(t.pickBases).toHaveLength(2)
        expect(t.pickBases[0]).toBe(t.request.session.commitRead)
        expect(t.pickBases[1]).not.toBe(t.request.session.commitRead)
        expect(t.pickBases[1]).toBe(first.status === 'ready' ? first.marked.markerRead : null)
    })

    test('a conversion after a pick runs over the pick\'s marker', async () => {
        const seen: Store2Read[] = []
        const t = await rig({
            legacy: true,
            calls: {
                convert: async (request) => {
                    if (request.entry.kind === 'exit') {
                        seen.push(request.entry.commitRead)
                    }
                    return { status: 'declined' }
                },
            },
        })
        t.start()
        await t.toOffers()
        await t.pickToInstallScreen(0)
        await t.port.press('recoveryCancel')
        await t.toOffers()
        await t.port.press('recoveryConvertOffer')
        await t.port.press('convertYes')
        await t.toOffers()
        const first = t.results.picks[0]
        expect(seen).toHaveLength(1)
        expect(seen[0]).toBe(first.status === 'ready' ? first.marked.markerRead : null)
    })
})

describe('a ready pick ends the offer to start empty', () => {
    test('before a pick passes, "Start with an empty profile" is offered; after one passed and was cancelled, it is not', async () => {
        const t = await rig()
        t.start()
        await t.toOffers()
        expect(keysOf(t.port.current)).toContain('recoveryFreshOffer')
        await t.pickToInstallScreen(0)
        await t.port.press('recoveryCancel')
        await t.toOffers()
        expect(keysOf(t.port.current)).not.toContain('recoveryFreshOffer')
    })
})

// ---- the install confirmation and the counts ----

/** How many of the two "not counted" sentences the screen shows: exactly one when the counts were not checked. */
function uncheckedSentences(model: BootScreenModel): number {
    return model.paragraphs.filter((paragraph) => paragraph === text().recoveryCountsSkipped || paragraph === text().recoveryCountsUnchecked).length
}

describe('the install confirmation', () => {
    test('counted: the counts of the pick are shown, Cancel has focus, and installing reloads', async () => {
        const t = await rig()
        t.start()
        await t.toOffers()
        await t.pickToInstallScreen(0)
        const ready = t.results.picks[0]
        if (ready.status !== 'ready' || !ready.counts.checked) {
            throw new Error('The pick did not end ready with counts.')
        }
        const model = t.port.current
        expect(model.paragraphs).toContain(text().recoveryMissingImages(ready.counts.missingImages))
        expect(model.paragraphs).toContain(text().recoveryMissingInlays(ready.counts.missingInlays))
        expect(keysOf(model)).toEqual(['recoveryCancel', 'recoveryInstallGo'])
        expect(model.focus).toBe('recoveryCancel')
        const before = writesIn(t.trace.log)

        await t.port.press('recoveryInstallGo')
        await until(() => expect(t.port.reloads).toBe(1))
        expect(t.port.current.title).toBe(text().recoveryInstalledTitle)
        expect(writesIn(t.trace.log)).toBeGreaterThan(before)
        const key = classifyCommitRead(await t.memory.readCommit())
        expect(key.status === 'parsed' && key.value.current !== null && key.value.staging === null).toBe(true)
        // The screen never settles after an install: it does not call anything more.
        const log = t.trace.log.length
        await settle()
        expect(t.trace.log.length).toBe(log)
        expect(t.port.terminalModel).toBeNull()
    })

    test('skipped: the listing is pending, Skip ends the check, the screen says so and install is still reachable', async () => {
        const t = await rig({ listStore: () => new Promise<string[]>(() => { }) })
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await t.port.press('recoveryCheckSkip')
        await until(() => expect(t.port.current.title).toBe(text().recoveryInstallTitle))
        const ready = t.results.picks[0]
        expect(ready.status === 'ready' && ready.counts.checked).toBe(false)
        expect(t.port.current.paragraphs).toContain(text().recoveryCountsSkipped)
        expect(t.port.current.paragraphs).not.toContain(text().recoveryCountsUnchecked)
        expect(uncheckedSentences(t.port.current)).toBe(1)
        expect(t.port.current.paragraphs.join(' ')).not.toMatch(/\b0\b/)
        await t.port.press('recoveryInstallGo')
        await until(() => expect(t.port.reloads).toBe(1))
        expect(t.counts.install).toBe(1)
    })

    test('could not check: a listing that rejects is told without the skipped sentence, and install is still reachable', async () => {
        const t = await rig({ listStore: () => Promise.reject(new Error('the listing failed')) })
        t.start()
        await t.toOffers()
        await t.pickToInstallScreen(0)
        const ready = t.results.picks[0]
        expect(ready.status === 'ready' && ready.counts.checked).toBe(false)
        expect(t.port.current.paragraphs).toContain(text().recoveryCountsUnchecked)
        expect(t.port.current.paragraphs).not.toContain(text().recoveryCountsSkipped)
        expect(uncheckedSentences(t.port.current)).toBe(1)
        await t.port.press('recoveryInstallGo')
        await until(() => expect(t.port.reloads).toBe(1))
    })

    test('a skip in the first pick does not leak into the second pick, which counts', async () => {
        let hang = true
        const t = await rig({ listStore: () => hang ? new Promise<string[]>(() => { }) : Promise.resolve([]) })
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await t.port.press('recoveryCheckSkip')
        await until(() => expect(t.port.current.title).toBe(text().recoveryInstallTitle))
        await t.port.press('recoveryCancel')
        await t.toOffers()
        hang = false
        await t.port.press(pickButtonKey(t.manifests[1]))
        await until(() => expect(t.port.current.title).toBe(text().recoveryInstallTitle))
        const second = t.results.picks[1]
        expect(second.status === 'ready' && second.counts.checked).toBe(true)
    })
})

// ---- B2: a change made elsewhere ends the screen ----

function peerBytes(kind: 'current' | 'no-current' | 'damaged' | 'recovery-marker', manifest: Planted, mine: Uint8Array): Uint8Array {
    const clock = createClock(1_700_000_100_000)
    const env = testEnv(clock, 4040)
    const own = classifyCommitRead({ bytes: mine })
    if (own.status !== 'parsed') {
        throw new Error('The screen\'s marker does not parse.')
    }
    switch (kind) {
        case 'current':
            return encodeUnit(UNIT_TYPE.commit, nextCommitKey(own.value, { current: { key: manifest.manifestKey, at: clock.now }, retained: [], pins: [], staging: null, manifests: [manifest.body] }, env))
        case 'no-current':
            return encodeUnit(UNIT_TYPE.commit, nextCommitKey(own.value, { current: null, retained: [], pins: [], staging: null }, env))
        case 'recovery-marker':
            return encodeUnit(UNIT_TYPE.commit, nextCommitKey(own.value, { current: null, retained: [], pins: [], staging: stagingOf('recovery', PEER) }, env))
        case 'damaged':
            return DAMAGED_COMMIT
    }
}

describe('B2: a change made elsewhere after a marker ends the screen, and the screen writes nothing over it', () => {
    const cases: [string, 'current' | 'no-current' | 'damaged' | 'recovery-marker', number][] = [
        ['a peer installed a current manifest', 'current', 5],
        ['a peer cleared the marker (no current, no marker)', 'no-current', 7],
        ['a peer left a damaged commit key', 'damaged', 4],
        ['a peer started its own recovery', 'recovery-marker', 8],
    ]

    const owners: AppStoreKind[] = ['indexeddb', 'tauri']
    const rows = cases.flatMap(([name, kind, row]) => owners.map((owner): [string, 'current' | 'no-current' | 'damaged' | 'recovery-marker', number, AppStoreKind] => [`${name} (next start on ${owner})`, kind, row, owner]))

    test.each(rows)('%s: the second pick ends in the changed screen, with one compare-and-write and the peer\'s bytes intact', async (_name, kind, row, owner) => {
        const t = await rig({ kind: owner })
        t.start()
        await t.toOffers()
        await t.pickToInstallScreen(0)
        await t.port.press('recoveryCancel')
        await t.toOffers()

        const mine = (await t.memory.readCommit()).bytes as Uint8Array
        const peer = peerBytes(kind, t.planted[1], mine)
        t.memory.poke(COMMIT_KEY, peer)
        const before = t.trace.log.filter((name) => name === 'casCommit').length
        const keysBefore = new Set(t.memory.snapshot().keys())

        await t.port.press(pickButtonKey(t.manifests[1]))
        await endsAndStaysQuiet(t, [text().recoveryChanged])
        expect(Array.from(await t.commitKey() as Uint8Array)).toEqual(Array.from(peer))
        expect(t.trace.log.filter((name) => name === 'casCommit').length - before).toBe(1)
        expect(t.counts.pick).toBe(2)
        expect(t.counts.listCandidates).toBe(1)

        // Reload path: the next start classifies what the peer left, and no unit this page found is gone.
        const reopened = await t.reboot(owner)
        expect(reopened.decision.row).toBe(row)
        const after = new Set(t.memory.snapshot().keys())
        expect([...keysBefore].filter((key) => !after.has(key))).toEqual([])
    })
})

// ---- terminal rows ----

const fenceCases = {
    contended: { status: 'contended', attempts: 5 } satisfies FenceExitResult,
}

const backendError = () => new Store2BackendFailureError('the backend failed')

describe('the screen ends on every outcome that says the profile may have changed, and calls nothing afterwards', () => {
    const exitRows: [string, ExitResult][] = [
        ['conflict', { status: 'conflict', current: { bytes: null, token: { kind: 'bytes', bytes: null } } }],
        ['abandoned', { status: 'abandoned', current: { bytes: null, token: { kind: 'bytes', bytes: null } }, value: firstCommitKey({ current: null, staging: null }, testEnv(createClock(), 1)) }],
        ['fence contended', { status: 'fence', fence: fenceCases.contended }],
    ]

    test.each(exitRows)('a pick that ends %s: the changed screen', async (_name, exit) => {
        const t = await rig({ calls: { pick: async () => ({ status: 'exit', exit: exit as Exclude<ExitResult, { status: 'marked' }> }) } })
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await endsAndStaysQuiet(t, [text().recoveryChanged])
    })

    test('a pick whose outcome is unknown: the unconfirmed screen, never a retry', async () => {
        const unknown: Exclude<ExitResult, { status: 'marked' }> = { status: 'unknown', cause: new Store2UnknownOutcomeError('lost') }
        const t = await rig({ calls: { pick: async () => ({ status: 'exit', exit: unknown }) } })
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await endsAndStaysQuiet(t, [text().recoveryUnknown])
        expect(t.counts.pick).toBe(1)
    })

    const installRows: [string, InstallResult, string[]][] = [
        ['abandoned', { status: 'abandoned', current: { bytes: null, token: { kind: 'bytes', bytes: null } } }, ['changed']],
        ['unknown', { status: 'unknown', cause: new Store2UnknownOutcomeError('lost') }, ['unknown']],
    ]

    test.each(installRows)('an install that ends %s', async (_name, result, kind) => {
        const t = await rig({ calls: { install: async () => result } })
        t.start()
        await t.toOffers()
        await t.pickToInstallScreen(0)
        await t.port.press('recoveryInstallGo')
        await endsAndStaysQuiet(t, [kind[0] === 'changed' ? text().recoveryChanged : text().recoveryUnknown])
        expect(t.counts.install).toBe(1)
    })

    test('a conversion that reclassifies after its marker: the changed screen', async () => {
        const t = await rig({ legacy: true, calls: { convert: async () => ({ status: 'reclassify' }) } })
        t.start()
        await t.toOffers()
        await t.port.press('recoveryConvertOffer')
        await t.port.press('convertYes')
        await endsAndStaysQuiet(t, [text().recoveryChanged])
        expect(t.counts.convert).toBe(1)
    })

    test('a seed that reclassifies after its marker: the changed screen', async () => {
        const t = await rig({ calls: { seed: async () => ({ status: 'reclassify' }) } })
        t.start()
        await t.toOffers()
        await t.port.press('recoveryFreshOffer')
        await t.port.press('recoveryFreshGo')
        await endsAndStaysQuiet(t, [text().recoveryChanged])
        expect(t.counts.seed).toBe(1)
    })

    test('a conversion that stops after its marker (an install reason): the install text, ended, with the details', async () => {
        const t = await rig({ legacy: true, calls: { convert: async () => ({ status: 'blocked', reason: 'install-failed', detail: 'the install failed' }) } })
        t.start()
        await t.toOffers()
        await t.port.press('recoveryConvertOffer')
        await t.port.press('convertYes')
        await endsAndStaysQuiet(t, [text().blockedInstall])
        expect(terminalOf(t).details).toContain('install-failed')
    })

    test('a seed that stops after its marker ends the same way', async () => {
        const t = await rig({ calls: { seed: async () => ({ status: 'blocked', reason: 'install-upload-failed', detail: 'x' }) } })
        t.start()
        await t.toOffers()
        await t.port.press('recoveryFreshOffer')
        await t.port.press('recoveryFreshGo')
        await endsAndStaysQuiet(t, [text().blockedInstall])
    })

    test('a conversion or seed exit that is unknown is the unconfirmed screen, never "This step wrote nothing"', async () => {
        const unknown: Exclude<ExitResult, { status: 'marked' }> = { status: 'unknown', cause: new Store2UnknownOutcomeError('lost') }
        const t = await rig({ legacy: true, calls: { convert: async () => ({ status: 'exit', exit: unknown }) } })
        t.start()
        await t.toOffers()
        await t.port.press('recoveryConvertOffer')
        await t.port.press('convertYes')
        await endsAndStaysQuiet(t, [text().recoveryUnknown])
        expect(t.port.screens.some((model) => model.paragraphs.includes(text().recoveryStepNothingWritten))).toBe(false)
    })

    const throwing: [string, Partial<RecoveryCalls>, (t: Rig) => Promise<void>][] = [
        ['the candidate listing', { listCandidates: async () => { throw new TypeError('listing broke') } }, async () => { }],
        ['the pick', { pick: async () => { throw new TypeError('pick broke') } }, async (t) => {
            await t.toOffers()
            await t.port.press(pickButtonKey(t.manifests[0]))
            await t.port.press('recoveryPickGo')
        }],
        ['the install', { install: async () => { throw new TypeError('install broke') } }, async (t) => {
            await t.toOffers()
            await t.pickToInstallScreen(0)
            await t.port.press('recoveryInstallGo')
        }],
        ['the conversion', { convert: async () => { throw new TypeError('convert broke') } }, async (t) => {
            await t.toOffers()
            await t.port.press('recoveryConvertOffer')
            await t.port.press('convertYes')
        }],
        ['the conversion without the unreadable parts', {
            convert: async () => ({ status: 'all-failed', backupsTried: [] }),
            convertWithout: async () => { throw new TypeError('convert without broke') },
        }, async (t) => {
            await t.toOffers()
            await t.port.press('recoveryConvertOffer')
            await t.port.press('convertYes')
        }],
        ['the seed', { seed: async () => { throw new TypeError('seed broke') } }, async (t) => {
            await t.toOffers()
            await t.port.press('recoveryFreshOffer')
            await t.port.press('recoveryFreshGo')
        }],
    ]

    test.each(throwing)('a rejection of %s ends the screen as unexpected with the message under Details, not back at the offers', async (_name, calls, drive) => {
        const t = await rig({ legacy: true, calls })
        t.start()
        await drive(t)
        await until(() => expect(t.port.terminalModel).not.toBeNull())
        const model = terminalOf(t)
        expect(model.paragraphs).toEqual([text().recoveryUnexpected])
        expect(model.details).toContain(' broke')
        await endsAndStaysQuiet(t, [text().recoveryUnexpected])
    })

    test('a defect in the screen itself (an unknown button) ends it as unexpected too', async () => {
        const t = await rig()
        t.start()
        await t.toOffers()
        t.port.pending?.resolve('nonsense')
        await endsAndStaysQuiet(t, [text().recoveryUnexpected])
    })

    test('a session with no storage ends as unexpected and calls nothing', async () => {
        const t = await rig()
        const port = new FakePort()
        void runRecovery({ ...t.request, session: { ...t.request.session, backend: null } }, port)
        await until(() => expect(port.terminalModel).not.toBeNull())
        expect(port.terminalModel?.paragraphs).toEqual([text().recoveryUnexpected])
        expect(t.trace.log).toEqual([])
    })

    test('a commit key newer than this build ends the screen with the too-new text', async () => {
        const t = await rig({ calls: { pick: async () => ({ status: 'exit', exit: { status: 'refused', reason: 'too-new', detail: 'newer' } }) } })
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await endsAndStaysQuiet(t, [text().recoveryTooNewBody])
        expect(terminalOf(t).title).toBe(text().tooNewTitle)
    })

    test('a fence newer than this build ends the screen with the too-new text', async () => {
        const fence: FenceExitResult = { status: 'not-offered', reason: 'fence-too-new', detail: 'newer' }
        const t = await rig({ calls: { pick: async () => ({ status: 'exit', exit: { status: 'fence', fence } }) } })
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await endsAndStaysQuiet(t, [text().recoveryTooNewBody])
        expect(terminalOf(t).title).toBe(text().tooNewTitle)
    })

    describe('an end after this screen has written never says that nothing was changed', () => {
        /** A first pick that writes its fence and then fails the marker write, so the screen has written when it later ends. */
        function failingMarkerFirst(laterExit: ExitResult | null): Partial<RecoveryCalls> {
            let first = true
            return {
                pick: async (backend, basis, key, options) => {
                    if (first) {
                        first = false
                        const failing: Store2Backend = { ...backend, casCommit: async () => { throw new Store2BackendFailureError('marker write failed') } }
                        return pickCandidate(failing, basis, key, options)
                    }
                    if (laterExit !== null) {
                        return { status: 'exit', exit: laterExit as Exclude<ExitResult, { status: 'marked' }> }
                    }
                    return pickCandidate(backend, basis, key, options)
                },
            }
        }

        function expectNoNothingChanged(t: Rig): void {
            for (const model of t.port.screens) {
                expect(model.title).not.toBe(text().stoppedTitle)
                expect(model.paragraphs).not.toContain(text().stoppedBody)
                expect(model.paragraphs).not.toContain(text().tooNewBody)
            }
        }

        async function writeThenBack(t: Rig): Promise<void> {
            t.start()
            await t.toOffers()
            await t.port.press(pickButtonKey(t.manifests[0]))
            await t.port.press('recoveryPickGo')
            await t.port.press('foreignClear')
            await until(() => expect(t.port.current.paragraphs).toEqual([text().recoveryExitFailed]))
            expect(t.trace.log.filter((name) => name === 'casFence').length).toBeGreaterThan(0)
            await t.port.press('recoveryBack')
            await t.toOffers()
            await t.port.press(pickButtonKey(t.manifests[0]))
            await t.port.press('recoveryPickGo')
        }

        test('Wait on another owner\'s marker, after a fence this screen wrote: the stopped text, not "Nothing was changed"', async () => {
            const t = await rig({ start: 'foreign-recovery-marker', calls: failingMarkerFirst(null) })
            await writeThenBack(t)
            await t.port.press('foreignWait')
            await until(() => expect(t.port.terminalModel).not.toBeNull())
            expectNoNothingChanged(t)
            await endsAndStaysQuiet(t, [text().recoveryWaitBody])
            expect(terminalOf(t).title).toBe(text().recoveryStoppedTitle)
        })

        test('a commit key newer than this build, after a fence this screen wrote: the too-new text without "changed nothing"', async () => {
            const t = await rig({ start: 'foreign-recovery-marker', calls: failingMarkerFirst({ status: 'refused', reason: 'too-new', detail: 'newer' }) })
            await writeThenBack(t)
            await until(() => expect(t.port.terminalModel).not.toBeNull())
            expectNoNothingChanged(t)
            await endsAndStaysQuiet(t, [text().recoveryTooNewBody])
            expect(terminalOf(t).title).toBe(text().tooNewTitle)
        })

        test('a fence newer than this build, after a fence this screen wrote: the too-new text without "changed nothing"', async () => {
            const fence: FenceExitResult = { status: 'not-offered', reason: 'fence-too-new', detail: 'newer' }
            const t = await rig({ start: 'foreign-recovery-marker', calls: failingMarkerFirst({ status: 'fence', fence }) })
            await writeThenBack(t)
            await until(() => expect(t.port.terminalModel).not.toBeNull())
            expectNoNothingChanged(t)
            await endsAndStaysQuiet(t, [text().recoveryTooNewBody])
            expect(terminalOf(t).title).toBe(text().tooNewTitle)
        })
    })
})

// ---- the rows that return to the screen ----

describe('the outcomes that leave the screen usable', () => {
    test('a fence that did not reach the disk offers Back and Try again; Try again runs the exit over the same basis, without a second question', async () => {
        const fence: FenceExitResult = { status: 'not-durable', record: { v: 1 } as never, bytes: new Uint8Array(), attempts: 1 }
        let first = true
        const t = await rig({
            calls: {
                pick: async (...args) => {
                    if (first) {
                        first = false
                        return { status: 'exit', exit: { status: 'fence', fence } }
                    }
                    return pickCandidate(...args)
                },
            },
        })
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await until(() => expect(t.port.current.paragraphs).toEqual([text().recoveryFenceNotDurable]))
        expect(keysOf(t.port.current)).toEqual(['recoveryBack', 'recoveryRetry'])
        expect(t.port.current.focus).toBe('recoveryBack')
        await t.port.press('recoveryRetry')
        await until(() => expect(t.port.current.title).toBe(text().recoveryInstallTitle))
        expect(t.counts.pick).toBe(2)
        expect(t.pickBases[1]).toBe(t.pickBases[0])
    })

    test.each([
        ['a fence whose write failed', { status: 'fence', fence: { status: 'failed', cause: backendError(), attempts: 1 } }, text().recoveryFenceFailed],
        ['a marker write that failed', { status: 'failed', cause: backendError() }, text().recoveryExitFailed],
    ] as const)('%s: its own text and a retry that runs the pick again', async (_name, exit, expected) => {
        let first = true
        const t = await rig({
            calls: {
                pick: async (...args) => {
                    if (first) {
                        first = false
                        return noMarkerExit(exit as ExitResult)
                    }
                    return pickCandidate(...args)
                },
            },
        })
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await until(() => expect(t.port.current.paragraphs).toEqual([expected]))
        expect(t.port.current.paragraphs.join(' ')).not.toContain('Nothing was changed')
        await t.port.press('recoveryRetry')
        await until(() => expect(t.port.current.title).toBe(text().recoveryInstallTitle))
    })

    test('a fence that was not offered says nothing was written and has only Back', async () => {
        const fence: FenceExitResult = { status: 'not-offered', reason: 'fence-unreadable', detail: 'unreadable' }
        const t = await rig({ calls: { pick: async () => ({ status: 'exit', exit: { status: 'fence', fence } }) } })
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await until(() => expect(t.port.current.paragraphs).toEqual([text().recoveryNotOfferedFence]))
        expect(keysOf(t.port.current)).toEqual(['recoveryBack'])
        await t.port.press('recoveryBack')
        await t.toOffers()
    })

    test('a pick whose tree is unusable after its marker names the problem, says the profile stays in recovery and returns to the offers', async () => {
        const t = await rig()
        t.start()
        await t.toOffers()
        // A unit of the newest version goes missing after the listing: the marker is written, then the closure read fails.
        const victim = [...t.planted[1].byRole.get('chunk') ?? []][0]
        t.memory.poke(victim, null)
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await until(() => expect(t.port.current.title).toBe(text().recoveryProblemTitle))
        expect(t.port.current.paragraphs).toEqual([text().recoveryProblemMissing, text().recoveryStaysInRecovery])
        expect(t.port.current.details).toContain(victim)
        await t.port.press('recoveryBack')
        await t.toOffers()
        // The marker stands, so the next pick is not asked.
        await t.port.press(pickButtonKey(t.manifests[1]))
        await until(() => expect(t.port.current.title).toBe(text().recoveryInstallTitle))
    })

    const installRetry: [string, InstallResult][] = [
        ['failed', { status: 'failed', cause: backendError() }],
        ['upload-failed', { status: 'upload-failed', cause: backendError() }],
    ]

    test.each(installRetry)('an install that %s offers Back, which returns to the offers without installing again', async (_name, failure) => {
        const t = await rig({ calls: { install: async () => failure } })
        t.start()
        await t.toOffers()
        await t.pickToInstallScreen(0)
        await t.port.press('recoveryInstallGo')
        await until(() => expect(t.port.current.paragraphs).toEqual([text().recoveryInstallFailed, text().recoveryStaysInRecovery]))
        expect(keysOf(t.port.current)).toEqual(['recoveryBack', 'recoveryRetry'])
        await t.port.press('recoveryBack')
        await t.toOffers()
        await settle()
        expect(t.counts.install).toBe(1)
        expect(t.port.reloads).toBe(0)
        expect(t.port.terminalModel).toBeNull()
    })

    test.each(installRetry)('an install that %s offers Try again, which installs again', async (_name, failure) => {
        let first = true
        const t = await rig({
            calls: {
                install: async (...args) => {
                    if (first) {
                        first = false
                        return failure
                    }
                    return installPick(...args)
                },
            },
        })
        t.start()
        await t.toOffers()
        await t.pickToInstallScreen(0)
        await t.port.press('recoveryInstallGo')
        await until(() => expect(t.port.current.paragraphs).toEqual([text().recoveryInstallFailed, text().recoveryStaysInRecovery]))
        await t.port.press('recoveryRetry')
        await until(() => expect(t.port.reloads).toBe(1))
        expect(t.counts.install).toBe(2)
    })

    test('an install whose tree went unusable returns to the offers with the marker standing', async () => {
        const t = await rig({ calls: { install: async () => ({ status: 'invalid', problem: { kind: 'missing', keys: ['store2/u-x'] } }) } })
        t.start()
        await t.toOffers()
        await t.pickToInstallScreen(0)
        await t.port.press('recoveryInstallGo')
        await until(() => expect(t.port.current.title).toBe(text().recoveryProblemTitle))
        expect(t.port.current.paragraphs).toEqual([text().recoveryProblemMissing, text().recoveryStaysInRecovery])
        await t.port.press('recoveryBack')
        await t.toOffers()
    })
})

describe('a conversion or seed that stopped before its marker returns to the offers', () => {
    const before: BlockedReason[] = ['convert-read-failed', 'convert-main-unreadable', 'convert-lenient-failed']

    test.each(before)('convert stopped with %s: its reason, "This step wrote nothing", no "Nothing was changed", and OK returns to the offers', async (reason) => {
        const t = await rig({ legacy: true, calls: { convert: async () => ({ status: 'blocked', reason, detail: 'the read failed' }) } })
        t.start()
        await t.toOffers()
        await t.port.press('recoveryConvertOffer')
        await t.port.press('convertYes')
        await until(() => expect(t.port.current.title).toBe(text().blockedTitle))
        expect(t.port.current.paragraphs).toEqual([text().blockedRead, text().recoveryStepNothingWritten])
        expect(t.port.current.paragraphs).not.toContain(text().blockedNothingChanged)
        expect(t.port.current.details).toContain(reason)
        expect(keysOf(t.port.current)).toEqual(['recoveryBack'])
        expect(t.port.terminalModel).toBeNull()
        await t.port.press('recoveryBack')
        await t.toOffers()
    })

    test('a conversion the person declines returns to the offers and wrote nothing', async () => {
        const t = await rig({ legacy: true, calls: { convert: async () => ({ status: 'declined' }) } })
        t.start()
        await t.toOffers()
        await t.port.press('recoveryConvertOffer')
        await t.port.press('convertYes')
        await t.toOffers()
        expect(writesIn(t.trace.log)).toBe(0)
    })

    test('"Not now" on the convert offer writes nothing and shows the text before any question', async () => {
        const t = await rig({ legacy: true })
        t.start()
        await t.toOffers()
        await t.port.press('recoveryConvertOffer')
        await until(() => expect(t.port.current.title).toBe(text().convertTitle))
        expect(t.port.current.paragraphs).toEqual([text().convertBody, text().convertMemoryNote])
        expect(t.port.current.focus).toBe('convertNo')
        expect(t.counts.convert).toBe(0)
        await t.port.press('convertNo')
        await t.toOffers()
        expect(t.counts.convert).toBe(0)
        expect(writesIn(t.trace.log)).toBe(0)
    })

    test('"Start with an empty profile" asks first; Cancel writes nothing', async () => {
        const t = await rig()
        t.start()
        await t.toOffers()
        await t.port.press('recoveryFreshOffer')
        await until(() => expect(t.port.current.title).toBe(text().recoveryFreshTitle))
        expect(t.port.current.focus).toBe('recoveryCancel')
        expect(t.counts.seed).toBe(0)
        await t.port.press('recoveryCancel')
        await t.toOffers()
        expect(t.counts.seed).toBe(0)
        expect(writesIn(t.trace.log)).toBe(0)
    })

    test('nothing decodes strictly: the lenient conversion is offered and runs with the same entry', async () => {
        const entries: string[] = []
        const t = await rig({
            legacy: true,
            calls: {
                convert: async () => ({ status: 'all-failed', backupsTried: [] }),
                convertWithout: async (request) => {
                    entries.push(request.entry.kind)
                    return { status: 'declined' }
                },
            },
        })
        t.start()
        await t.toOffers()
        await t.port.press('recoveryConvertOffer')
        await t.port.press('convertYes')
        await t.toOffers()
        expect(t.counts.convertWithout).toBe(1)
        expect(entries).toEqual(['exit'])
    })
})

// ---- a foreign marker ----

describe('another owner\'s standing marker', () => {
    test('Wait ends the screen with the stopped text and writes nothing', async () => {
        const t = await rig({ start: 'foreign-recovery-marker' })
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await t.port.press('foreignWait')
        await endsAndStaysQuiet(t, [text().recoveryWaitBody])
        expect(terminalOf(t).title).toBe(text().recoveryStoppedTitle)
        expect(writesIn(t.trace.log)).toBe(0)
    })

    test('Clear lets the pick continue, and the checking screen is shown again', async () => {
        const t = await rig({ start: 'foreign-recovery-marker' })
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await t.port.press('foreignClear')
        await until(() => expect(t.port.current.title).toBe(text().recoveryInstallTitle))
        expect(t.port.screens.map((model) => model.title)).toContain(text().recoveryCheckingTitle)
        expect(t.counts.pick).toBe(1)
    })

    test('the question has the safe answer first and focused', async () => {
        const t = await rig({ start: 'foreign-recovery-marker' })
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await until(() => expect(t.port.current.title).toBe(text().foreignTitle))
        expect(keysOf(t.port.current)).toEqual(['foreignWait', 'foreignClear'])
        expect(t.port.current.focus).toBe('foreignWait')
    })
})

// ---- the whole run on the real exits ----

describe('a conversion and a seed over a damaged commit key, on the real exits', () => {
    test('convert: the fence, then the marker, then the tree; the screen reloads and the commit key names a current', async () => {
        const t = await rig({ legacy: true })
        t.start()
        await t.toOffers()
        await t.port.press('recoveryConvertOffer')
        await t.port.press('convertYes')
        await until(() => expect(t.port.reloads).toBe(1))
        expect(t.trace.log.indexOf('casFence')).toBeGreaterThan(-1)
        expect(t.trace.log.indexOf('casFence')).toBeLessThan(t.trace.log.indexOf('casCommit'))
        const key = classifyCommitRead(await t.memory.readCommit())
        expect(key.status === 'parsed' && key.value.current !== null && key.value.staging === null && key.value.convertedFrom !== undefined).toBe(true)
        expect(t.port.current.title).toBe(text().recoveryInstalledTitle)
    })

    test('seed: the empty profile is installed and the screen reloads', async () => {
        const t = await rig()
        t.start()
        await t.toOffers()
        await t.port.press('recoveryFreshOffer')
        await t.port.press('recoveryFreshGo')
        await until(() => expect(t.port.reloads).toBe(1))
        const key = classifyCommitRead(await t.memory.readCommit())
        expect(key.status === 'parsed' && key.value.current !== null && key.value.convertedFrom === 'seed').toBe(true)
    })

    test('the working screen is up while a conversion runs and has no button', async () => {
        let release: () => void = () => { }
        const gate = new Promise<void>((resolve) => { release = resolve })
        const t = await rig({ legacy: true, calls: { convert: async () => { await gate; return { status: 'declined' } } } })
        t.start()
        await t.toOffers()
        await t.port.press('recoveryConvertOffer')
        await t.port.press('convertYes')
        await until(() => expect(t.port.current.title).toBe(text().recoveryWorkingTitle))
        expect(t.port.current.buttons).toEqual([])
        expect(t.port.pending).toBeNull()
        release()
        await t.toOffers()
    })
})

// ---- the reload path ----

describe('the reload path: the next start classifies what each ended screen left', () => {
    async function endedWithMarker(label: 'recovery' | 'convert' | 'seed', kind: AppStoreKind) {
        const t = await rig({ kind, legacy: label === 'convert', mainFile: label === 'convert' })
        const keysBefore = new Set(t.memory.snapshot().keys())
        t.start()
        await t.toOffers()
        if (label === 'recovery') {
            await t.pickToInstallScreen(0)
            await t.port.press('recoveryInstallGo')
        } else if (label === 'convert') {
            t.trace.faults.putUnit = true
            await t.port.press('recoveryConvertOffer')
            await t.port.press('convertYes')
        } else {
            t.trace.faults.putUnit = true
            await t.port.press('recoveryFreshOffer')
            await t.port.press('recoveryFreshGo')
        }
        return { t, keysBefore }
    }

    test('an unexpected stop after a pick marker leaves our recovery marker: row 8 on the web and on Tauri', async () => {
        for (const kind of ['indexeddb', 'tauri'] as const) {
            const { t, keysBefore } = await (async () => {
                const t = await rig({ kind, calls: { install: async () => { throw new TypeError('install broke') } } })
                const keysBefore = new Set(t.memory.snapshot().keys())
                t.start()
                await t.toOffers()
                await t.pickToInstallScreen(0)
                await t.port.press('recoveryInstallGo')
                await until(() => expect(t.port.terminalModel).not.toBeNull())
                return { t, keysBefore }
            })()
            const parsed = classifyCommitRead(await t.memory.readCommit())
            expect(parsed.status === 'parsed' && parsed.value.staging?.label === 'recovery' && parsed.value.current === null).toBe(true)
            const reopened = await t.reboot(kind)
            expect(reopened.decision.row, kind).toBe(8)
            const after = new Set(t.memory.snapshot().keys())
            expect([...keysBefore].filter((key) => !after.has(key))).toEqual([])
        }
    })

    test.each(['convert', 'seed'] as const)('a %s that stopped after its marker (the upload failed): a foreign marker on the web (row 9), this device\'s own marker on Tauri (row 9, cleared at start-up)', async (label) => {
        const web = await endedWithMarker(label, 'indexeddb')
        await until(() => expect(web.t.port.terminalModel).not.toBeNull())
        expectEnded(web.t, [text().blockedInstall])
        await settle()
        expectQuietSinceEnd(web.t)
        const staged = classifyCommitRead(await web.t.memory.readCommit())
        expect(staged.status === 'parsed' && staged.value.staging?.label === label && staged.value.current === null).toBe(true)
        const reopenedWeb = await web.t.reboot('indexeddb')
        expect(reopenedWeb.decision).toMatchObject({ row: 9, mode: 'rerun', operation: label, clear: 'foreign-path' })
        expect([...web.keysBefore].filter((key) => !new Set(web.t.memory.snapshot().keys()).has(key))).toEqual([])

        const tauri = await endedWithMarker(label, 'tauri')
        await until(() => expect(tauri.t.port.terminalModel).not.toBeNull())
        const reopenedTauri = await tauri.t.reboot('tauri')
        expect(reopenedTauri.decision).toMatchObject({ row: 9, mode: 'rerun', operation: label, clear: 'own' })
        expect([...tauri.keysBefore].filter((key) => !new Set(tauri.t.memory.snapshot().keys()).has(key))).toEqual([])
    })

    test('guard: a stop before any write (a stubbed pick that writes nothing) leaves the commit key as the boot found it: the same row at the next start', async () => {
        const t = await rig({ calls: { pick: async () => ({ status: 'exit', exit: { status: 'fence', fence: fenceCases.contended } }) } })
        const before = await t.commitKey()
        const keysBefore = new Set(t.memory.snapshot().keys())
        t.start()
        await t.toOffers()
        await t.port.press(pickButtonKey(t.manifests[0]))
        await t.port.press('recoveryPickGo')
        await until(() => expect(t.port.terminalModel).not.toBeNull())
        expect(Array.from(await t.commitKey() as Uint8Array)).toEqual(Array.from(before as Uint8Array))
        expect((await t.reboot('indexeddb')).decision.row).toBe(4)
        expect([...keysBefore].filter((key) => !new Set(t.memory.snapshot().keys()).has(key))).toEqual([])
    })
})
