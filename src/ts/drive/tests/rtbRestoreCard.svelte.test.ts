/**
 * The `.rtb` file restore of Settings, the Data page and Welcome on the task card (`restoreFromBinFile` and `runRtbRestore`
 * with `card: true`), the stages' optional card deps (`checking`, `bytes`, `installing`, `leave`), and the Cancel that is
 * accepted only before the copy, the first write of what the file holds.
 *
 * Real: the page of the application (the `saveDb()` store2 loop in a world of its own, the real restore hold over a fake Web
 * Locks manager, the real busy registry and restore run), `settingsRestore.ts`, `backupRouter.ts`, `runRtbRestore` over the
 * real preparation, install and finish stages, the card seam and the card slot, and a file the real writer produced from
 * the page's own profile. Faked: the page's alert surfaces, the password prompt, the page's asset store (an in-memory one)
 * and the committer's answer at the flip (the page's real store has no piece writer). A fresh module graph stands for a
 * fresh page, so the card slot is read through that graph's `alertTask.svelte`. A mocked commit proves the restore reached
 * the commit boundary in the right order, nothing about what lands, and a mocked success is not evidence of device behaviour.
 *
 * Labels: RR = regression reproducer (red on the base, where the restore shows wait dialogs and offers no Cancel);
 * CG = compatibility guard (passes before and after).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { language } from 'src/lang'
import { importSourceOfFile } from 'src/ts/importSource'
import { exportClosure } from 'src/ts/storage/store2/rtb/exportClosure'
import { Store2UnknownOutcomeError } from 'src/ts/storage/store2/backend/errors'
import { prepareSeal } from 'src/ts/drive/rtb/sealed/sealWriter'
import type { CommitResult, Committer } from 'src/ts/storage/store2/commit'
import type { Database } from 'src/ts/storage/database.svelte'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { RtbCopyDeps } from 'src/ts/drive/rtbRestoreCopy'
import type { RtbFinishDeps } from 'src/ts/drive/rtbRestoreFinish'
import { inlayFixture, writeRtbFile, type InlayFixture, type RtbBuild, type WorldLike } from './rtb/rtbRestoreFixtures'
import { finishPlanOf, MemoryByteStore, planOfBytes } from './rtb/rtbInstallFixtures'

vi.setConfig({ testTimeout: 40_000 })

//#region module mocks

const platformBox = vi.hoisted(() => ({ isTauri: false }))
vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

/** What the restore reported to the card seam or to the alert surfaces, with the card as it stood right after the call. */
interface Call {
    kind: 'phase' | 'bytes' | 'lock' | 'cancelled' | 'leave' | 'ask' | 'wait' | 'notice'
    step: string
    text: string | null
    done: number
    /** The label of the step the card showed after the call. */
    label: string | null
    offered: boolean
    /** Whether any card was in the slot. */
    shown: boolean
    cancelled: boolean
    state: string | null
}
const rec = vi.hoisted(() => ({
    calls: [] as Call[],
    /** Runs right after each recorded call, on the call's own stack. */
    hook: null as ((call: Call) => void) | null,
    /** Reads the card of the page under test; set by `openPage`. */
    view: (() => null) as () => null | { steps: readonly { label: string }[], stepIndex: number, cancelOffered: boolean, cancelled: boolean, state: unknown },
}))

const passwordBox = vi.hoisted(() => ({ ask: null as null | (() => Promise<string | null>) }))
const scaleBox = vi.hoisted(() => ({ ask: null as null | (() => Promise<boolean>) }))
/** The save-first and the hold, observed and held by a test. */
const flowBox = vi.hoisted(() => ({
    saveEntered: 0,
    saveHold: null as null | Promise<void>,
    acquired: 0,
    releases: [] as boolean[],
}))
/** What the committer answers at the flip, and what ran. */
const commitBox = vi.hoisted(() => ({ result: 'committed' as 'committed' | 'unknown', ran: false }))

function registerMocks(): void {
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        return {
            DBState: proxy({ db: {} as Record<string, unknown> }),
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
    vi.doMock('src/ts/passwordPrompt', async (importOriginal) => ({
        ...await importOriginal<typeof import('src/ts/passwordPrompt')>(),
        askPassword: () => (passwordBox.ask === null ? Promise.resolve(null) : passwordBox.ask()),
    }))
    // The scale question's double: its real threshold needs a file of gigabytes.
    vi.doMock('src/ts/drive/storeImport', async (importOriginal) => {
        const original = await importOriginal<typeof import('src/ts/drive/storeImport')>()
        return {
            ...original,
            confirmImportScale: (...args: Parameters<typeof original.confirmImportScale>) => (scaleBox.ask === null ? original.confirmImportScale(...args) : scaleBox.ask()),
        }
    })
    // The real save-first, entered and held by a test.
    vi.doMock('src/ts/drive/storeRestore', async (importOriginal) => {
        const original = await importOriginal<typeof import('src/ts/drive/storeRestore')>()
        return {
            ...original,
            saveFirst: async (...args: Parameters<typeof original.saveFirst>) => {
                flowBox.saveEntered += 1
                if (flowBox.saveHold !== null) {
                    await flowBox.saveHold
                }
                return await original.saveFirst(...args)
            },
        }
    })
    // The real hold with its grant and release observed, and the committer's answer at the flip replaced: the page's real
    // store has no piece writer, so the commit would not run here.
    vi.doMock('src/ts/drive/rtbRestoreHold', async (importOriginal) => {
        const original = await importOriginal<typeof import('src/ts/drive/rtbRestoreHold')>()
        return {
            ...original,
            acquireRestoreHold: async (...args: Parameters<typeof original.acquireRestoreHold>) => {
                const acquired = await original.acquireRestoreHold(...args)
                if (acquired.kind !== 'held') {
                    return acquired
                }
                flowBox.acquired += 1
                const real = acquired.hold
                return { kind: 'held' as const, hold: { ...real, release: async (keep: boolean) => { flowBox.releases.push(keep); await real.release(keep) } } }
            },
            rtbGuardedCommitter: (committer: Committer): Committer => ({
                ...committer,
                commit: async (): Promise<CommitResult> => {
                    commitBox.ran = true
                    if (commitBox.result === 'unknown') {
                        return { status: 'unknown', cause: new Store2UnknownOutcomeError('The commit kept an unknown outcome.') }
                    }
                    return { status: 'committed', value: await committer.readCommit() as never, bytes: new Uint8Array(), flushed: true, manifestKey: 'm', mode: 'ordinary' } as unknown as CommitResult
                },
            }),
        }
    })
    vi.doMock('src/ts/storage/store/appStore', async (importOriginal) => {
        const original = await importOriginal<typeof import('src/ts/storage/store/appStore')>()
        const { MemoryByteStore: Memory } = await import('./rtb/rtbInstallFixtures')
        const memory = new Memory()
        return { ...original, getAppStore: async () => memory }
    })
    // The real card seam, recording each progress call with the card as it stands right after it.
    vi.doMock('src/ts/drive/restoreProgress', async (importOriginal) => {
        const actual = await importOriginal<typeof import('src/ts/drive/restoreProgress')>()
        const note = (kind: Call['kind'], step: string, text: string | null, done: number): void => {
            const view = rec.view()
            const call: Call = {
                kind,
                step,
                text,
                done,
                label: view === null ? null : view.steps[view.stepIndex]?.label ?? null,
                offered: view?.cancelOffered ?? false,
                shown: view !== null,
                cancelled: view?.cancelled ?? false,
                state: view === null ? null : String(view.state),
            }
            rec.calls.push(call)
            rec.hook?.(call)
        }
        return {
            ...actual,
            cardRestoreProgress: (...args: Parameters<typeof actual.cardRestoreProgress>) => {
                const real = actual.cardRestoreProgress(...args)
                return {
                    ...real,
                    get cancelRequested() { return real.cancelRequested },
                    phase(step: string, text: string | null) {
                        real.phase(step, text)
                        note('phase', step, text, -1)
                    },
                    bytes(step: string, done: number, total: number, text: string | null) {
                        real.bytes(step, done, total, text)
                        note('bytes', step, text, done)
                    },
                    aside<T>(ask: () => Promise<T>): Promise<T> {
                        return real.aside(() => {
                            note('ask', '', null, -1)
                            return ask()
                        })
                    },
                    lockCancel() {
                        const granted = real.lockCancel()
                        note('lock', granted ? 'granted' : 'refused', null, -1)
                        return granted
                    },
                    cancelled() {
                        real.cancelled()
                        note('cancelled', '', null, -1)
                    },
                    leave() {
                        real.leave()
                        note('leave', '', null, -1)
                    },
                }
            },
        }
    })
}

//#endregion

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

type Entry = Record<string, unknown>

const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks')
const HASH = `${'a1'.repeat(32)}.png`
const INLAY_ID = '0123abcd-0123-4123-a123-0123456789ab'

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
    h.broadcasts.length = 0
    h.channels.length = 0
    platformBox.isTauri = false
    rec.calls.length = 0
    rec.hook = null
    rec.view = () => null
    passwordBox.ask = null
    scaleBox.ask = null
    flowBox.saveEntered = 0
    flowBox.saveHold = null
    flowBox.acquired = 0
    flowBox.releases.length = 0
    commitBox.result = 'committed'
    commitBox.ran = false
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    registerMocks()
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    worlds.parkAll()
    for (const path of ['src/ts/passwordPrompt', 'src/ts/drive/storeImport', 'src/ts/drive/storeRestore', 'src/ts/drive/rtbRestoreHold', 'src/ts/storage/store/appStore', 'src/ts/drive/restoreProgress']) {
        vi.doUnmock(path)
    }
    vi.restoreAllMocks()
    if (originalLocks) {
        Object.defineProperty(window.navigator, 'locks', originalLocks)
    } else {
        Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    }
})

interface Page {
    w: World
    k: Store2Kit
    alert: typeof import('src/ts/alert')
    busy: typeof import('src/ts/process/memory/busyActions')
    settings: typeof import('src/ts/drive/settingsRestore')
    entry: typeof import('src/ts/drive/rtbRestoreEntry')
    hold: typeof import('src/ts/drive/rtbRestoreHold')
    plan: typeof import('src/ts/drive/rtbRestorePlan')
    install: typeof import('src/ts/drive/rtbRestoreInstall')
    finish: typeof import('src/ts/drive/rtbRestoreFinish')
    copy: typeof import('src/ts/drive/rtbRestoreCopy')
    task: typeof import('src/ts/alertTask.svelte')
    world: WorldLike
}

// The page's modules are loaded after the world starts: the world resets the module registry.
async function openPage(): Promise<Page> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha', 'beta'])
    const k = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const bootActive = await import('src/ts/storage/store2/bootActive')
    const task = await import('src/ts/alertTask.svelte')
    // One second per read, so every card report reaches the published view at once.
    let tick = 0
    task.setTaskClockForTests({ now: () => (tick += 1000), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (timer) => clearTimeout(timer), hidden: () => false })
    rec.view = () => task.taskHostView() as ReturnType<typeof rec.view>
    const store = new Map<string, Uint8Array>()
    const closure = await exportClosure(k.counted.memory, { onUnits: async (batch) => { for (const unit of batch) { store.set(unit.key, unit.bytes) } } })
    const page: Page = {
        w,
        k,
        alert: await import('src/ts/alert'),
        busy: await import('src/ts/process/memory/busyActions'),
        settings: await import('src/ts/drive/settingsRestore'),
        entry: await import('src/ts/drive/rtbRestoreEntry'),
        hold: await import('src/ts/drive/rtbRestoreHold'),
        plan: await import('src/ts/drive/rtbRestorePlan'),
        install: await import('src/ts/drive/rtbRestoreInstall'),
        finish: await import('src/ts/drive/rtbRestoreFinish'),
        copy: await import('src/ts/drive/rtbRestoreCopy'),
        task,
        world: { store, manifestKey: closure.manifestKey, refsByRow: new Map(closure.refRows.map((row) => [row, []])) },
    }
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
    vi.mocked(page.alert.alertWait).mockImplementation((text: string) => {
        rec.calls.push({ kind: 'wait', step: '', text, done: -1, label: null, offered: false, shown: task.taskShown(), cancelled: false, state: null })
        return { type: 'wait', msg: text }
    })
    vi.mocked(page.alert.alertNormalWait).mockImplementation(async (text: string) => {
        rec.calls.push({ kind: 'notice', step: '', text, done: -1, label: null, offered: false, shown: task.taskShown(), cancelled: false, state: null })
    })
    w.start()
    await sleepReal(150)
    return page
}

async function writeLockIsFree(page: Page): Promise<boolean> {
    const taken = page.w.api.dbWriteLock.acquire().then((release) => { release(); return true })
    return await Promise.race([taken, sleepReal(250).then(() => false)])
}

const errorsOf = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])
const waitTexts = (): string[] => rec.calls.filter((call) => call.kind === 'wait').map((call) => String(call.text))
const labelOf = (page: Page): string | null => {
    const view = page.task.taskHostView()
    return view === null ? null : view.steps[view.stepIndex]?.label ?? null
}
const offeredNow = (page: Page): boolean => page.task.taskHostView()?.cancelOffered ?? false
const seamCalls = (): Call[] => rec.calls.filter((call) => call.kind !== 'wait' && call.kind !== 'notice')

async function rtbOf(page: Page, build: Partial<RtbBuild> = {}): Promise<Uint8Array> {
    return (await writeRtbFile({ world: page.world, ...build })).bytes
}

function pseudoRandomBytes(length: number, seed: number): Uint8Array {
    const out = new Uint8Array(length)
    let state = seed >>> 0
    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        out[i] = state >>> 24
    }
    return out
}

function held<T>(): { promise: Promise<T>, resolve: (value: T) => void } {
    let resolve: (value: T) => void = () => { }
    const promise = new Promise<T>((r) => { resolve = r })
    return { promise, resolve }
}

/** Replaces the picker's `click` with a capture of the input, so the test chooses the file. */
function capturePicker(): { input: () => HTMLInputElement, clicks: () => number } {
    let captured: HTMLInputElement | null = null
    let clicks = 0
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
        captured = this
        clicks++
    })
    return { input: () => captured as unknown as HTMLInputElement, clicks: () => clicks }
}

/** Starts the Settings restore with `bytes` as the picked file; the promise settles when the whole flow has ended. */
async function startRestore(page: Page, bytes: Uint8Array, name = 'backup.rtb'): Promise<void> {
    const view = capturePicker()
    const flow = page.settings.restoreFromBinFile()
    await until(() => view.clicks() === 1, 'the picker to open')
    const input = view.input()
    Object.defineProperty(input, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], name)], configurable: true })
    const change = (input.onchange as unknown as (event: Event) => Promise<void>).call(input, new Event('change'))
    await Promise.all([flow, change])
}

/** `startRestore` without waiting for its end. */
function beginRestore(page: Page, bytes: Uint8Array, name = 'backup.rtb'): { done: Promise<void> } {
    return { done: startRestore(page, bytes, name) }
}

function pickedOf(bytes: Uint8Array, name = 'backup.rtb') {
    const file = new File([bytes as unknown as Uint8Array<ArrayBuffer>], name)
    return { name: file.name, size: file.size, lastModified: file.lastModified, source: importSourceOfFile(file) }
}

const stepOrder = (...labels: string[]): number[] => {
    const shown: string[] = []
    for (const call of seamCalls()) {
        if (call.label !== null && shown.at(-1) !== call.label) { shown.push(call.label) }
    }
    return labels.map((label) => shown.indexOf(label))
}

describe('the .rtb restore on the task card', () => {
    // RR: base shows `rtbRestoreChecking(n)`, `rtbRestoreCopying(n)` and `rtbRestoreInstalling` waits, with no card.
    test('RR-T1: the steps run tabs, check, copy, load, finish with Cancel offered through check and locked from copy, no legacy wait, and the card leaves after the sides', async () => {
        const page = await openPage()

        await startRestore(page, await rtbOf(page))

        const order = stepOrder(language.restoreStepTabs, language.importStepCheck, language.restoreStepCopy, language.restoreStepLoad, language.restoreStepFinish)
        expect(order.every((index) => index >= 0), `order ${order.join(',')}`).toBe(true)
        expect([...order].sort((a, b) => a - b)).toEqual(order)
        const reports = seamCalls().filter((call) => call.kind === 'phase' || call.kind === 'bytes')
        for (const call of reports.filter((c) => c.label === language.restoreStepTabs || c.label === language.importStepCheck)) {
            expect(call.offered, `Cancel offered at ${call.label}`).toBe(true)
        }
        for (const call of reports.filter((c) => c.label === language.restoreStepCopy || c.label === language.restoreStepLoad || c.label === language.restoreStepFinish)) {
            expect(call.offered, `Cancel locked at ${call.label}`).toBe(false)
        }
        expect(waitTexts()).toEqual([language.store2ImportDone])
        const kinds = rec.calls.map((call) => `${call.kind}:${call.text ?? call.step}`)
        expect(kinds.indexOf('leave:')).toBeGreaterThan(kinds.indexOf('phase:finish'))
        expect(kinds.indexOf('leave:')).toBeLessThan(kinds.indexOf(`wait:${language.store2ImportDone}`))
        expect(commitBox.ran).toBe(true)
        expect(page.task.taskShown()).toBe(false)
        expect(errorsOf(page)).toEqual([])
    })

    // RR: base opens no card, so a refusal has no card to leave and a decline has none to remove.
    test('RR-T1b: a damaged file shows today\'s error with the card gone', async () => {
        const page = await openPage()
        const damagedMagic = new Uint8Array([0x52, 0x54, 0x42, 0x58, 0x00, 0x0A, 0x1A, 0x0A, 1, 0, 0, 0, 0, 0, 0, 0])
        await startRestore(page, damagedMagic, 'backup.bin')
        expect(errorsOf(page)).toEqual([language.rtbRestoreDamaged])
        expect(page.task.taskShown()).toBe(false)
        expect(commitBox.ran).toBe(false)
    })

    // RR: base opens no card, so a decline has none to remove.
    test('RR-T1b: a declined newer-data question ends silently with the card gone', async () => {
        const second = await openPage()
        const at = (await second.k.commitKey()).current?.at as number
        vi.mocked(second.alert.alertConfirm).mockImplementation(async (text) => !(typeof text === 'string' && text.includes('Test device')))
        await startRestore(second, await rtbOf(second, { createdAt: at - 5000 }))
        expect(seamCalls().some((call) => call.kind === 'phase')).toBe(true)
        expect(errorsOf(second)).toEqual([])
        expect(second.task.taskShown()).toBe(false)
        expect(second.task.taskResultShowing()).toBe(false)
        expect(seamCalls().some((call) => call.kind === 'cancelled')).toBe(false)
        expect(commitBox.ran).toBe(false)
    })

    // RR: base posts the sealed key-derivation wait and shows no card.
    test('RR-T2: a sealed file asks for its password with no card behind the prompt, and the card returns at check with Cancel', async () => {
        const page = await openPage()
        const plain = await rtbOf(page)
        const parts: Uint8Array[] = []
        const seal = await prepareSeal('pw', { m: 256, t: 2, chunkSize: 4096 })
        const sink = seal.sink((chunk) => { parts.push(chunk.slice()) })
        await sink.write(plain)
        await sink.finish()
        const sealed = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
        let at = 0
        for (const part of parts) {
            sealed.set(part, at)
            at += part.length
        }
        let shownWhileAsking: boolean | null = null
        passwordBox.ask = async () => {
            shownWhileAsking = page.task.taskShown()
            return 'pw'
        }

        await startRestore(page, sealed)

        expect(shownWhileAsking).toBe(false)
        expect(seamCalls().some((call) => call.kind === 'ask')).toBe(true)
        const afterAsk = seamCalls().slice(seamCalls().findIndex((call) => call.kind === 'ask') + 1)
        const back = afterAsk.find((call) => call.kind === 'phase' && call.step === 'check')
        expect(back?.label).toBe(language.importStepCheck)
        expect(back?.offered).toBe(true)
        expect(waitTexts()).not.toContain(language.rtbRestorePasswordChecking)
        expect(commitBox.ran).toBe(true)
    })

    // RR: base shows no card; the unconfirmed wait stands over nothing.
    test('RR-T3: a commit with an unknown outcome keeps the write lock closed, posts the unconfirmed wait and then the card leaves', async () => {
        const page = await openPage()
        commitBox.result = 'unknown'

        await startRestore(page, await rtbOf(page))

        const kinds = rec.calls.map((call) => `${call.kind}:${call.text ?? call.step}`)
        expect(kinds).toContain(`wait:${language.store2ImportUnconfirmed}`)
        expect(kinds.indexOf('leave:')).toBeGreaterThan(kinds.indexOf(`wait:${language.store2ImportUnconfirmed}`))
        expect(page.task.taskShown()).toBe(false)
        expect(page.task.taskResultShowing()).toBe(false)
        expect(flowBox.releases).toEqual([true])
        expect(await writeLockIsFree(page)).toBe(false)
    })

    // RR: base opens no card.
    test('RR-T4: an install that rejects posts the unconfirmed wait, ends unknown and the card leaves', async () => {
        const page = await openPage()
        const picked = pickedOf(await rtbOf(page))

        const end = await page.entry.runRtbRestore(picked, { install: async () => { throw new Error('install broke its contract') } }, { card: true })

        expect(end).toEqual({ outcome: 'unknown', cause: null })
        const kinds = rec.calls.map((call) => `${call.kind}:${call.text ?? call.step}`)
        expect(kinds.indexOf('leave:')).toBeGreaterThan(kinds.indexOf(`wait:${language.store2ImportUnconfirmed}`))
        expect(kinds.indexOf(`wait:${language.store2ImportUnconfirmed}`)).toBeGreaterThanOrEqual(0)
        expect(page.task.taskShown()).toBe(false)
    })

    // RR: base opens no card.
    test('RR-T5: a finish that rejects posts the reload-or-restart wait, ends committed and the card leaves', async () => {
        const page = await openPage()
        const picked = pickedOf(await rtbOf(page))

        const end = await page.entry.runRtbRestore(picked, { finish: async () => { throw new Error('finish broke its contract') } }, { card: true })

        expect(end).toEqual({ outcome: 'committed', cause: null })
        const kinds = rec.calls.map((call) => `${call.kind}:${call.text ?? call.step}`)
        expect(kinds.indexOf(`wait:${language.restoreSavedReloadOrRestart}`)).toBeGreaterThanOrEqual(0)
        expect(kinds.lastIndexOf('leave:')).toBeGreaterThan(kinds.indexOf(`wait:${language.restoreSavedReloadOrRestart}`))
        expect(page.task.taskShown()).toBe(false)
    })

    // RR: base opens no card; a card opened before a failing beginBusy would be left with Cancel and no run behind it.
    test('a busy entry that cannot be taken rejects with the card already gone', async () => {
        const page = await openPage()
        const picked = pickedOf(await rtbOf(page))

        await expect(page.entry.runRtbRestore(picked, { beginBusy: () => { throw new Error('no busy entry') } }, { card: true })).rejects.toThrow('no busy entry')

        expect(page.task.taskShown()).toBe(false)
        expect(seamCalls().at(-1)?.kind).toBe('leave')
    })

    // CG: the legacy route is today's: no card, today's waits (passes before and after).
    test('RR-T8: runRtbRestore without the card flag posts today\'s waits and makes no card call', async () => {
        const page = await openPage()
        const picked = pickedOf(await rtbOf(page))

        const end = await page.entry.runRtbRestore(picked)

        expect(end.outcome).toBe('committed')
        expect(seamCalls()).toEqual([])
        const waits = waitTexts()
        expect(waits).toContain(language.restoreCheckingOtherTabs)
        expect(waits).toContain(language.rtbRestoreInstalling)
        expect(waits.some((text) => text.startsWith(language.rtbRestoreChecking(0).slice(0, 8)))).toBe(true)
        expect(page.task.taskShown()).toBe(false)
    })

    // CG: the start-up restore's stage calls pass no card option, so each posts today's wait (passes before and after).
    test('RR-T7: the stages called as the start-up restore calls them post today\'s waits and touch no card', async () => {
        const page = await openPage()
        const bytes = await rtbOf(page, { assets: { [HASH]: pseudoRandomBytes(256, 1) } })
        const busy = page.busy.beginBusy('backupLoad')
        const acquired = await page.hold.acquireRestoreHold(busy)
        expect(acquired.kind).toBe('held')
        const verified = await page.plan.verifyAndConfirm(pickedOf(bytes), { ...page.plan.realVerifyDeps(), assetDeps: () => ({
            isNodeStore: () => false,
            probePieceStore: async () => { },
            assetLimit: () => Number.MAX_SAFE_INTEGER,
            inlayLimit: () => Number.MAX_SAFE_INTEGER,
            rule: async () => ({ kind: 'tauri', platform: 'posix' }),
            sizedListing: async () => null,
        }), confirmScale: async () => true }, { newerBase: null })
        expect(verified.kind).toBe('ok')
        const plan = await planOfBytes(bytes)
        const memory = new MemoryByteStore()
        await page.copy.copyRtbEntries(plan, { busy }, { store: async () => memory, createPipeline: async () => null, noteAndSettle: async () => { }, refuseWhileBusy: () => false })

        expect(waitTexts()).toContain(language.restoreCheckingOtherTabs)
        expect(waitTexts().some((text) => text === language.rtbRestoreCopying(100))).toBe(true)
        expect(seamCalls()).toEqual([])
        if (acquired.kind === 'held') {
            await acquired.hold.release(false)
        }
        busy.end()
    })
})

describe('Cancel on the .rtb card', () => {
    // RR: base opens no card, so the press is a no-op and the install is called.
    test('RR-C1: a Cancel during the save ends on the cancelled card with nothing asked, held or installed', async () => {
        const page = await openPage()
        const gate = held<void>()
        flowBox.saveHold = gate.promise

        const run = beginRestore(page, await rtbOf(page))
        await until(() => flowBox.saveEntered === 1, 'the save to start')
        expect(labelOf(page)).toBe(language.restoreStepSave)
        expect(offeredNow(page)).toBe(true)
        page.task.requestTaskCancel()
        gate.resolve()
        await run.done

        expect(page.task.taskResultShowing()).toBe(true)
        expect(page.task.taskHostView()?.cancelled).toBe(true)
        expect(flowBox.acquired).toBe(0)
        expect(commitBox.ran).toBe(false)
        expect(seamCalls().some((call) => call.kind === 'phase' && call.step === 'copy')).toBe(false)
        page.task.answerTask({ kind: 'ok' })
        expect(page.task.taskShown()).toBe(false)
        expect(page.busy.isBusy()).toBe(false)
    })

    // RR: base opens no card, so the press is a no-op and the install is called.
    test('RR-C1: a Cancel at the other-tabs step ends on the cancelled card, the hold is released once and nothing is installed', async () => {
        const page = await openPage()
        rec.hook = (call) => {
            if (call.kind === 'phase' && call.step === 'tabs') {
                page.task.requestTaskCancel()
            }
        }

        await startRestore(page, await rtbOf(page))

        expect(page.task.taskResultShowing()).toBe(true)
        expect(page.task.taskHostView()?.cancelled).toBe(true)
        expect(flowBox.releases).toEqual([false])
        expect(commitBox.ran).toBe(false)
        expect(seamCalls().some((call) => call.kind === 'phase' && call.step === 'copy')).toBe(false)
        expect(errorsOf(page)).toEqual([])
        expect(await writeLockIsFree(page)).toBe(true)
        page.task.answerTask({ kind: 'ok' })
        expect(page.busy.isBusy()).toBe(false)
    })

    // RR: base shows no card at the copy, so the precondition fails.
    test('RR-C5: a Cancel and Back pressed from the first copy report are refused, the restore lands and no result card shows', async () => {
        const page = await openPage()
        let pressed: { offered: boolean, state: string | null } | null = null
        rec.hook = (call) => {
            if (call.kind === 'bytes' && call.step === 'copy' && pressed === null) {
                page.task.requestTaskCancel()
                page.task.taskBackPress()
                pressed = { offered: offeredNow(page), state: page.task.taskHostView() === null ? null : String(page.task.taskHostView()?.state) }
            }
        }

        await startRestore(page, await rtbOf(page, { assets: { [HASH]: pseudoRandomBytes(512, 2) } }))

        expect(pressed).toEqual({ offered: false, state: 'running' })
        expect(commitBox.ran).toBe(true)
        expect(seamCalls().some((call) => call.kind === 'cancelled')).toBe(false)
        expect(page.task.taskResultShowing()).toBe(false)
        expect(page.task.taskShown()).toBe(false)
    })
})

describe('the step change at the confirmation', () => {
    // RR: base opens no card, so nothing is shown after the confirmation.
    test('RR-T10: the card is at check with Cancel while the scale question waits, and at copy with Cancel locked within microtasks of the answer', async () => {
        const page = await openPage()
        const question = held<boolean>()
        scaleBox.ask = () => question.promise

        const run = beginRestore(page, await rtbOf(page, { assets: { [HASH]: pseudoRandomBytes(512, 3) } }))
        await until(() => labelOf(page) === language.importStepCheck && scaleBox.ask !== null && rec.calls.some((call) => call.kind === 'phase' && call.step === 'check'), 'the card at check')
        await sleepReal(50)
        expect(labelOf(page)).toBe(language.importStepCheck)
        expect(offeredNow(page)).toBe(true)

        question.resolve(true)
        for (let i = 0; i < 400 && labelOf(page) !== language.restoreStepCopy; i++) {
            await Promise.resolve()
        }

        expect(labelOf(page)).toBe(language.restoreStepCopy)
        expect(offeredNow(page)).toBe(false)
        expect(rec.calls.some((call) => call.kind === 'bytes' && call.step === 'copy')).toBe(false)
        await run.done
    })
})

describe('the stages\' card deps', () => {
    // RR: base ignores `checking` and posts the other-tabs wait.
    test('RR-T6a: acquireRestoreHold calls `checking` in place of the other-tabs wait, and posts the wait without it', async () => {
        const page = await openPage()
        const busy = page.busy.beginBusy('backupLoad')
        const checking = vi.fn()
        const first = await page.hold.acquireRestoreHold(busy, { checking })
        expect(first.kind).toBe('held')
        expect(checking).toHaveBeenCalledTimes(1)
        expect(waitTexts()).not.toContain(language.restoreCheckingOtherTabs)
        if (first.kind === 'held') {
            await first.hold.release(false)
        }
        const second = await page.hold.acquireRestoreHold(busy)
        expect(waitTexts()).toContain(language.restoreCheckingOtherTabs)
        if (second.kind === 'held') {
            await second.hold.release(false)
        }
        busy.end()
    })

    // RR: base ignores `installing` and posts the installing wait.
    test('RR-T6c: installRtbRestore calls `installing` before the commit in place of the installing wait, and posts the wait without it', async () => {
        const page = await openPage()
        const bytes = await rtbOf(page)
        const run = async (installing: (() => void) | undefined): Promise<{ order: string[] }> => {
            const busy = page.busy.beginBusy('backupLoad')
            const picked = pickedOf(bytes)
            const prepared = await page.plan.prepareRtbRestore(picked, busy, { saveBoundMs: 3000, deps: { confirmScale: async () => true } })
            if (prepared.kind !== 'ready') { throw new Error(`prepare ended ${prepared.kind === 'ended' ? prepared.outcome : prepared.kind}`) }
            const order: string[] = []
            commitBox.ran = false
            const end = await page.install.installRtbRestore(prepared.plan, prepared.hold, {
                ...(installing === undefined ? {} : { installing: () => { order.push(`installing,commit=${commitBox.ran}`); installing() } }),
                wait: (text) => { order.push(`wait:${text}`) },
            })
            expect(end.kind).toBe('landed')
            await prepared.hold.release(false)
            busy.end()
            return { order }
        }
        const calls = vi.fn()
        const withCard = await run(calls)
        expect(withCard.order).toEqual(['installing,commit=false'])
        expect(calls).toHaveBeenCalledTimes(1)
        const legacy = await run(undefined)
        expect(legacy.order).toEqual([`wait:${language.rtbRestoreInstalling}`])
    })

    // RR: base ignores `leave`.
    test('RR-T6d: finishRtbRestore calls `leave` after the sides and before the first notice, and again after the catch\'s wait', async () => {
        const page = await openPage()
        const plan = await finishPlanOf(await rtbOf(page))
        const facts = { assetsWritten: 0, assetsPresent: 0, skippedAssets: [], inlays: { written: 0, skipped: [], changed: false } }
        const log: string[] = []
        const deps: Partial<RtbFinishDeps> = {
            applySide: async (action) => { log.push('side'); return { id: action.id, status: 'cleared', phase: 'write', written: 0, key: null, message: '' } as unknown as Awaited<ReturnType<RtbFinishDeps['applySide']>> },
            notice: async (text) => { log.push(`notice:${text}`) },
            wait: (text) => { log.push(`wait:${text}`) },
            leave: () => { log.push('leave') },
            markReload: () => { log.push('mark') },
            reload: async () => { throw new Error('reload failed') },
        }
        const hold = { release: async (keep: boolean) => { log.push(`release:${keep}`) } }

        await page.finish.finishRtbRestore(plan, hold, { flushed: false, facts, staged: null }, deps)

        const firstLeave = log.indexOf('leave')
        expect(firstLeave).toBeGreaterThanOrEqual(0)
        expect(log.filter((entry) => entry === 'side').length).toBe(log.slice(0, firstLeave).filter((entry) => entry === 'side').length)
        expect(firstLeave).toBeLessThan(log.indexOf(`notice:${language.store2ImportNotFlushed}`))
        expect(log.lastIndexOf('leave')).toBeGreaterThan(log.indexOf(`wait:${language.restoreSavedReloadOrRestart}`))
        expect(log.indexOf(`wait:${language.restoreSavedReloadOrRestart}`)).toBeGreaterThan(log.indexOf('release:true'))
    })

    // CG: a leave that throws never changes how the finish ends.
    test('a `leave` that throws does not stop the finish: the done wait, the release and the reload still run', async () => {
        const page = await openPage()
        const plan = await finishPlanOf(await rtbOf(page))
        const facts = { assetsWritten: 0, assetsPresent: 0, skippedAssets: [], inlays: { written: 0, skipped: [], changed: false } }
        const log: string[] = []
        const hold = { release: async (keep: boolean) => { log.push(`release:${keep}`) } }

        await page.finish.finishRtbRestore(plan, hold, { flushed: true, facts, staged: null }, {
            wait: (text) => { log.push(`wait:${text}`) },
            leave: () => { throw new Error('the card broke') },
            markReload: () => { log.push('mark') },
            reload: async () => { log.push('reload') },
        })

        expect(log).toEqual([`wait:${language.store2ImportDone}`, 'release:true', 'mark', 'reload'])
    })
})

describe('bytes inside a copied entry (RR-T9)', () => {
    async function copyOf(page: Page, build: Partial<RtbBuild>, deps: Partial<RtbCopyDeps>): Promise<{ total: number }> {
        const bytes = await rtbOf(page, build)
        const plan = await planOfBytes(bytes)
        const memory = new MemoryByteStore()
        const busy = page.busy.beginBusy('backupLoad')
        const end = await page.copy.copyRtbEntries(plan, { busy }, { store: async () => memory, createPipeline: async () => null, noteAndSettle: async () => { }, refuseWhileBusy: () => false, inlayLimit: () => Number.MAX_SAFE_INTEGER, ...deps })
        busy.end()
        expect(end.kind).toBe('copied')
        return { total: plan.assets.copyBytes + plan.inlays.copyBytes }
    }

    const stepsOf = (values: readonly number[], total: number): { below: number[], last: number } => ({ below: values.filter((value) => value < total), last: values.at(-1) ?? -1 })

    // RR: base ignores `bytes` and reports only through `wait`, once at the end of the entry.
    test.each([
        ['a small asset (read whole)', { assets: { [HASH]: pseudoRandomBytes(3_500_000, 4) } }, {}],
        ['a large asset (streamed through a piece writer)', { assets: { [HASH]: pseudoRandomBytes(3_500_000, 5) } }, { chunkMax: 1024 * 1024 }],
    ] as const)('%s reports rising values below its size before its end', async (_name, build, deps) => {
        const page = await openPage()
        const values: number[] = []
        const { total } = await copyOf(page, build, { ...deps, bytes: (done) => { values.push(done) } })
        const { below, last } = stepsOf(values, total)
        expect(below.length).toBeGreaterThanOrEqual(3)
        expect([...below].sort((a, b) => a - b)).toEqual(below)
        expect(last).toBe(total)
    })

    // RR: base ignores `bytes`.
    test('an inlay body reports rising values below its size while it is read', async () => {
        const page = await openPage()
        const alphabet = 'abcdefghijklmnopqrstuvwxyz'
        const random = pseudoRandomBytes(3_500_000, 6)
        const body = Array.from(random, (value) => alphabet[value % alphabet.length]).join('')
        const inlays: InlayFixture[] = [inlayFixture(INLAY_ID, body)]
        const values: number[] = []
        const { total } = await copyOf(page, { inlays }, { bytes: (done) => { values.push(done) } })
        const { below, last } = stepsOf(values, total)
        expect(below.length).toBeGreaterThanOrEqual(3)
        expect([...below].sort((a, b) => a - b)).toEqual(below)
        expect(last).toBe(total)
    })

    // RR: base ignores `bytes`; an entry the target already holds is never read, so only the entry-end report moves the line.
    test('an asset the target already holds moves the line once, at its entry end', async () => {
        const page = await openPage()
        const data = pseudoRandomBytes(300, 8)
        const bytes = await rtbOf(page, { assets: { 'plain.png': data } })
        const plan = await planOfBytes(bytes, { listing: { kind: 'tauri-sized', items: [{ key: 'assets/plain.png', size: data.length }] } })
        expect(Array.from(plan.assets.mode)).toEqual([1])
        const memory = new MemoryByteStore({}, { 'assets/plain.png': data })
        const values: number[] = []
        const busy = page.busy.beginBusy('backupLoad')
        const end = await page.copy.copyRtbEntries(plan, { busy }, { store: async () => memory, createPipeline: async () => null, noteAndSettle: async () => { }, refuseWhileBusy: () => false, bytes: (done) => { values.push(done) } })
        busy.end()
        expect(end.kind).toBe('copied')
        expect(values).toEqual([data.length])
    })

    // CG: without `bytes` the copy posts exactly today's waits (passes before and after).
    test('without `bytes` the copy posts one wait per whole-file percent change at entry ends and nothing inside an entry', async () => {
        const page = await openPage()
        const waits: string[] = []
        await copyOf(page, { assets: { [HASH]: pseudoRandomBytes(3_500_000, 7) } }, { wait: (text) => { waits.push(text) } })
        expect(waits).toEqual([language.rtbRestoreCopying(100)])
    })
})
