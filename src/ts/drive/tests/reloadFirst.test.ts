/**
 * The "reload first" orchestrator over fake dependencies and a fake clock. These are ordering and deadline tests:
 * a faked `isSaveClean` proves nothing about what the save covers, which is pinned against the real save loop in
 * `storage/tests/globalApi.saveStore2.svelte.test.ts`. The module is new, so against a skeleton that exports in
 * place (or reloads without waiting) every case that expects the other outcome fails by assertion.
 *
 * MOCKED: the application modules the real dependency set imports, so the module loads; none of them is called by
 * these tests, which pass their own dependencies.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/alert'), () => ({}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/alertPrompts'), () => ({}) as unknown as typeof import('src/ts/alertPrompts'))
vi.mock(import('src/ts/stores.svelte'), () => ({}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/storage/tauriByteTransport'), () => ({}) as unknown as typeof import('src/ts/storage/tauriByteTransport'))
vi.mock(import('src/ts/storage/store2/saveLoop'), () => ({}) as unknown as typeof import('src/ts/storage/store2/saveLoop'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/process/sessionUse'), () => ({}) as unknown as typeof import('src/ts/process/sessionUse'))
vi.mock(import('src/ts/reloadGuard'), () => ({}) as unknown as typeof import('src/ts/reloadGuard'))
vi.mock(import('src/ts/drive/backuplocal'), () => ({}) as unknown as typeof import('src/ts/drive/backuplocal'))
vi.mock(import('src/ts/drive/restoreReload'), () => ({}) as unknown as typeof import('src/ts/drive/restoreReload'))

import type { alertData } from 'src/ts/alert'
import type { ExportOutcome } from 'src/ts/drive/operationEnd'
import { isBusy, withBusy } from 'src/ts/process/memory/busyActions'
import {
    RELOAD_ALIVE_CHECK_MS, RELOAD_WAIT_CAP_MS, askReloadFirstThenExport, resetReloadFirstForTest, type ReloadFirstDeps,
} from '../reloadFirst'
import { DECLINED_KEY, RESUME_NOTE_KEY, parseResumeNote, type ResumeOp } from '../reloadFirstPolicy'

const DECLINED_EXPORT: ExportOutcome = { status: 'declined', cause: 'save-dialog-cancelled' }

interface Harness {
    deps: ReloadFirstDeps
    events: string[]
    storage: Map<string, string>
    state: {
        now: number
        clean: boolean
        cleanAfterMs: number | null
        parked: boolean
        drafts: boolean
        busy: boolean
        shown: boolean
        covered: boolean
        promptWaiting: boolean
        wholeAvailable: boolean
        requestAccepted: boolean
        answer: string
        noteWriteSticks: boolean
        reloadFlipsShown: boolean
        onSleep: (() => void) | null
    }
    notice: alertData
    exported: ResumeOp[]
}

function harness(): Harness {
    const events: string[] = []
    const storage = new Map<string, string>()
    const exported: ResumeOp[] = []
    const notice: alertData = { type: 'wait', msg: 'Saving' }
    const state: Harness['state'] = {
        now: 1_000_000,
        clean: false,
        cleanAfterMs: 1000,
        parked: false,
        drafts: false,
        busy: false,
        shown: true,
        covered: false,
        promptWaiting: false,
        wholeAvailable: true,
        requestAccepted: true,
        answer: '0',
        noteWriteSticks: true,
        reloadFlipsShown: false,
        onSleep: null,
    }
    const start = state.now
    const fakeStorage = {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
            if (state.noteWriteSticks) {
                storage.set(key, value)
            }
            events.push('setItem:' + key)
        },
        removeItem: (key: string) => { storage.delete(key); events.push('removeItem:' + key) },
    } as unknown as Storage
    const deps: ReloadFirstDeps = {
        android: () => true,
        storeMode: () => 'store2',
        used: () => true,
        counts: () => ({ characters: 500, modules: 164 }),
        storage: () => fakeStorage,
        now: () => state.now,
        sleep: async (ms) => {
            state.now += ms
            state.onSleep?.()
            if (state.cleanAfterMs !== null && state.now - start >= state.cleanAfterMs) {
                state.clean = true
            }
        },
        work: () => ({ drafts: state.drafts, inFlight: false, busy: state.busy, chokePoint: false, parked: state.parked }),
        wholeSaveAvailable: () => state.wholeAvailable,
        requestWholeSave: () => { events.push('requestWholeSave'); return state.requestAccepted },
        isSaveClean: () => {
            // The orchestrator must not hold a busy entry of its own while it waits.
            events.push(isBusy() ? 'busy-during-wait' : 'poll')
            return state.clean
        },
        isSaveLoopParked: () => state.parked,
        ask: async () => { events.push('ask'); return state.answer },
        showWait: () => { events.push('showWait'); return notice },
        noticeShown: () => state.shown,
        clearNotice: () => { events.push('clearNotice') },
        toastDidNotReload: () => { events.push('toastDidNotReload') },
        pageCovered: () => state.covered,
        promptWaiting: () => state.promptWaiting,
        exportInPlace: async (kind) => { events.push('export:' + kind); exported.push(kind); return DECLINED_EXPORT },
        markReload: () => { events.push('markReload') },
        reload: async () => {
            events.push('reload')
            if (state.reloadFlipsShown) {
                state.shown = false
            }
        },
    }
    return { deps, events, storage, state, notice, exported }
}

beforeEach(() => {
    resetReloadFirstForTest()
})

describe('askReloadFirstThenExport: the offer', () => {
    test('guard: nothing to ask (declined earlier) exports in place with no prompt, note or reload', async () => {
        const t = harness()
        t.storage.set(DECLINED_KEY, '1')
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.exported).toEqual(['export-full'])
        expect(t.events).toEqual(['export:export-full'])
    })

    test('reproducer: local drafts present means no prompt and one export in place', async () => {
        const t = harness()
        t.state.drafts = true
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.events).toEqual(['export:export-full'])
    })

    test('reproducer: a whole save that cannot be asked for means no prompt and no notice', async () => {
        const t = harness()
        t.state.wholeAvailable = false
        await askReloadFirstThenExport('export-partial', t.deps)
        expect(t.events).toEqual(['export:export-partial'])
    })

    test('reproducer: "No" writes the key and exports in place; the next tap does not ask; a dismissal remembers nothing', async () => {
        const t = harness()
        t.state.answer = '1'
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.storage.get(DECLINED_KEY)).toBe('1')
        expect(t.exported).toEqual(['export-full'])
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.events.filter((event) => event === 'ask')).toHaveLength(1)
        expect(t.exported).toEqual(['export-full', 'export-full'])

        const dismissed = harness()
        dismissed.state.answer = ''
        await askReloadFirstThenExport('export-full', dismissed.deps)
        expect(dismissed.storage.has(DECLINED_KEY)).toBe(false)
        expect(dismissed.exported).toEqual(['export-full'])
        expect(dismissed.events).not.toContain('showWait')
    })

    test('guard: a second tap while the prompt is up does nothing', async () => {
        const t = harness()
        let release: (answer: string) => void = () => { }
        t.deps.ask = () => new Promise<string>((resolve) => { release = resolve })
        const first = askReloadFirstThenExport('export-full', t.deps)
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.exported).toEqual([])
        release('1')
        await first
        expect(t.exported).toEqual(['export-full'])
    })

    test('reproducer: a second call while an in-place export is still pending reaches the export', async () => {
        const t = harness()
        t.state.answer = '1'
        const calls: ResumeOp[] = []
        const release: Array<() => void> = []
        t.deps.exportInPlace = (kind) => {
            calls.push(kind)
            return new Promise<ExportOutcome>((resolve) => { release.push(() => resolve(DECLINED_EXPORT)) })
        }
        const first = askReloadFirstThenExport('export-full', t.deps)
        await vi.waitFor(() => expect(calls).toEqual(['export-full']))
        const second = askReloadFirstThenExport('export-partial', t.deps)
        await vi.waitFor(() => expect(calls).toEqual(['export-full', 'export-partial']))
        release.forEach((resolve) => resolve())
        await Promise.all([first, second])
    })

    test('reproducer: a settled export of an earlier call does not clear the flag a later call holds', async () => {
        const t = harness()
        let asks = 0
        const answers: Array<(answer: string) => void> = []
        t.deps.ask = () => {
            asks += 1
            if (asks === 1) {
                return Promise.resolve('')
            }
            return new Promise<string>((resolve) => { answers.push(resolve) })
        }
        const calls: ResumeOp[] = []
        const settle: Array<() => void> = []
        t.deps.exportInPlace = (kind) => {
            calls.push(kind)
            return new Promise<ExportOutcome>((resolve) => { settle.push(() => resolve(DECLINED_EXPORT)) })
        }
        const first = askReloadFirstThenExport('export-full', t.deps)
        await vi.waitFor(() => expect(calls).toEqual(['export-full']))
        const second = askReloadFirstThenExport('export-partial', t.deps)
        await vi.waitFor(() => expect(asks).toBe(2))
        settle[0]()
        await first
        // The second call still holds the flag at its prompt, so this one asks nothing.
        void askReloadFirstThenExport('export-full', t.deps)
        expect(asks).toBe(2)
        answers[0]('')
        await vi.waitFor(() => expect(calls).toHaveLength(2))
        settle[1]()
        await second
    })})

describe('askReloadFirstThenExport: wait, note and reload', () => {
    test('reproducer: a clean page inside the cap reloads after the note, and the export waits for the reloaded page', async () => {
        const t = harness()
        // A reload that takes the page down: the call never returns.
        t.deps.reload = () => { t.events.push('reload'); return new Promise<void>(() => { }) }
        void askReloadFirstThenExport('export-partial', t.deps)
        await vi.waitFor(() => expect(t.events).toContain('reload'))
        const order = t.events.filter((event) => ['ask', 'requestWholeSave', 'showWait', 'setItem:' + RESUME_NOTE_KEY, 'markReload', 'reload'].includes(event))
        expect(order).toEqual(['ask', 'requestWholeSave', 'showWait', 'setItem:' + RESUME_NOTE_KEY, 'markReload', 'reload'])
        expect(t.events).not.toContain('busy-during-wait')
        expect(t.exported).toEqual([])
        expect(parseResumeNote(t.storage.get(RESUME_NOTE_KEY), t.state.now)).toBe('export-partial')
    })

    test('reproducer: a page that does not become clean within 20 s from the answer means no reload, no note and one export', async () => {
        const t = harness()
        t.state.cleanAfterMs = null
        const answeredAt = t.state.now
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.events).not.toContain('reload')
        expect(t.storage.has(RESUME_NOTE_KEY)).toBe(false)
        expect(t.exported).toEqual(['export-full'])
        expect(t.state.now - answeredAt).toBeGreaterThanOrEqual(RELOAD_WAIT_CAP_MS)
        expect(t.state.now - answeredAt).toBeLessThan(RELOAD_WAIT_CAP_MS + 1000)
    })

    test('reproducer: a request the loop does not accept after the answer refuses with no notice', async () => {
        const t = harness()
        t.state.requestAccepted = false
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.events).not.toContain('showWait')
        expect(t.events).not.toContain('reload')
        expect(t.exported).toEqual(['export-full'])
    })

    test('reproducer: a loop that parks during the wait refuses', async () => {
        const t = harness()
        t.state.cleanAfterMs = null
        t.state.onSleep = () => { t.state.parked = true }
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.events).not.toContain('reload')
        expect(t.exported).toEqual(['export-full'])
    })

    test('reproducer: work that starts during the wait is caught by the re-check before the note', async () => {
        const t = harness()
        t.state.onSleep = () => { t.state.busy = true }
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.events).not.toContain('setItem:' + RESUME_NOTE_KEY)
        expect(t.events).not.toContain('reload')
        expect(t.exported).toEqual(['export-full'])
    })

    test('reproducer: work that starts while the note is written is caught by the re-check before the reload, and the note is removed', async () => {
        const t = harness()
        const original = t.deps.storage()!.setItem.bind(t.deps.storage())
        t.deps.storage = () => ({
            getItem: (key: string) => t.storage.get(key) ?? null,
            setItem: (key: string, value: string) => { original(key, value); t.state.drafts = true },
            removeItem: (key: string) => { t.storage.delete(key); t.events.push('removeItem:' + key) },
        }) as unknown as Storage
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.events).not.toContain('reload')
        expect(t.storage.has(RESUME_NOTE_KEY)).toBe(false)
        expect(t.exported).toEqual(['export-full'])
    })

    test('reproducer: a prompt waiting behind the reload prompt refuses at the re-check before the note', async () => {
        const t = harness()
        t.state.onSleep = () => { t.state.promptWaiting = true }
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.events).not.toContain('setItem:' + RESUME_NOTE_KEY)
        expect(t.events).not.toContain('reload')
        expect(t.exported).toEqual(['export-full'])
    })

    test('reproducer: a prompt that arrives while the note is written refuses at the re-check before the reload', async () => {
        const t = harness()
        t.deps.storage = () => ({
            getItem: (key: string) => t.storage.get(key) ?? null,
            setItem: (key: string, value: string) => { t.storage.set(key, value); t.state.promptWaiting = true },
            removeItem: (key: string) => { t.storage.delete(key) },
        }) as unknown as Storage
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.events).not.toContain('reload')
        expect(t.storage.has(RESUME_NOTE_KEY)).toBe(false)
        expect(t.exported).toEqual(['export-full'])
    })

    test('reproducer: a page that stops being clean after the wait is caught by the re-check before the note', async () => {
        const t = harness()
        const baseClean = t.deps.isSaveClean
        let cleanAnswers = 0
        t.deps.isSaveClean = () => {
            const clean = baseClean()
            if (clean) {
                cleanAnswers += 1
            }
            // The wait loop's own check is the first clean answer; every later one finds new unsaved work.
            return clean && cleanAnswers < 2
        }
        await askReloadFirstThenExport('export-full', t.deps)
        expect(cleanAnswers).toBeGreaterThanOrEqual(2)
        expect(t.events).not.toContain('setItem:' + RESUME_NOTE_KEY)
        expect(t.events).not.toContain('reload')
        expect(t.exported).toEqual(['export-full'])
    })

    test('reproducer: a page that stops being clean while the note is written is caught by the re-check before the reload, and the note is removed', async () => {
        const t = harness()
        t.deps.storage = () => ({
            getItem: (key: string) => t.storage.get(key) ?? null,
            setItem: (key: string, value: string) => { t.storage.set(key, value); t.state.clean = false },
            removeItem: (key: string) => { t.storage.delete(key) },
        }) as unknown as Storage
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.events).not.toContain('reload')
        expect(t.storage.has(RESUME_NOTE_KEY)).toBe(false)
        expect(t.exported).toEqual(['export-full'])
    })

    test('reproducer: a note that does not stick means no reload', async () => {
        const t = harness()
        t.state.noteWriteSticks = false
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.events).not.toContain('reload')
        expect(t.exported).toEqual(['export-full'])
    })

    test('reproducer: a reload that does not happen removes the note, says so, and exports nothing', async () => {
        const t = harness()
        const startedAt = t.state.now
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.events).toContain('reload')
        expect(t.state.now - startedAt).toBeGreaterThanOrEqual(RELOAD_ALIVE_CHECK_MS)
        expect(t.storage.has(RESUME_NOTE_KEY)).toBe(false)
        expect(t.events.slice(-3)).toEqual(['removeItem:' + RESUME_NOTE_KEY, 'clearNotice', 'toastDidNotReload'])
        expect(t.exported).toEqual([])
    })

    test('guard: the orchestrator holds no busy entry while it waits', async () => {
        const t = harness()
        t.state.cleanAfterMs = 3000
        // A real busy entry elsewhere would block the offer, so this also shows the check reads the real registry.
        await askReloadFirstThenExport('export-full', t.deps)
        expect(t.events).not.toContain('busy-during-wait')
        await withBusy('backupSave', async () => {
            const blocked = harness()
            blocked.deps.work = () => ({ drafts: false, inFlight: false, busy: isBusy(), chokePoint: false, parked: false })
            await askReloadFirstThenExport('export-full', blocked.deps)
            expect(blocked.events).toEqual(['export:export-full'])
        })
    })
})

describe('askReloadFirstThenExport: the wait notice is displaced', () => {
    test('reproducer: a toast took its place (taps work again): no note, no reload, the export starts at once', async () => {
        const t = harness()
        t.state.cleanAfterMs = null
        t.state.onSleep = () => { t.state.shown = false; t.state.covered = false }
        const answeredAt = t.state.now
        await askReloadFirstThenExport('export-full', t.deps)
        // The refusal comes at the next poll, not at the 20 s cap.
        expect(t.state.now - answeredAt).toBeLessThan(RELOAD_WAIT_CAP_MS / 2)
        expect(t.events).not.toContain('setItem:' + RESUME_NOTE_KEY)
        expect(t.events).not.toContain('reload')
        expect(t.exported).toEqual(['export-full'])
    })

    test('reproducer: an alert that covers the page took its place: the export starts only after it closes', async () => {
        const t = harness()
        t.state.cleanAfterMs = null
        t.state.onSleep = () => { t.state.shown = false; t.state.covered = true }
        let sleepsWhileCovered = 0
        const baseSleep = t.deps.sleep
        t.deps.sleep = async (ms) => {
            await baseSleep(ms)
            if (t.state.shown === false && t.state.covered) {
                sleepsWhileCovered += 1
                if (sleepsWhileCovered === 3) {
                    t.state.covered = false
                    t.state.onSleep = null
                }
            }
        }
        const exportedWhileCovered: boolean[] = []
        const baseExport = t.deps.exportInPlace
        t.deps.exportInPlace = async (kind) => {
            exportedWhileCovered.push(t.state.covered)
            return baseExport(kind)
        }
        await askReloadFirstThenExport('export-full', t.deps)
        expect(sleepsWhileCovered).toBeGreaterThanOrEqual(3)
        expect(exportedWhileCovered).toEqual([false])
        expect(t.events).not.toContain('reload')
        expect(t.exported).toEqual(['export-full'])
    })

    test('reproducer: a call made during the wait or during the covered wait does nothing', async () => {
        const t = harness()
        t.state.cleanAfterMs = null
        t.state.onSleep = () => { t.state.shown = false; t.state.covered = true }
        let asks = 0
        const baseAsk = t.deps.ask
        t.deps.ask = () => { asks += 1; return baseAsk() }
        let sleeps = 0
        const baseSleep = t.deps.sleep
        t.deps.sleep = async (ms) => {
            await baseSleep(ms)
            sleeps += 1
            if (sleeps === 1 || sleeps === 3) {
                await askReloadFirstThenExport('export-partial', t.deps)
            }
            if (sleeps === 4) {
                t.state.covered = false
                t.state.onSleep = null
            }
        }
        await askReloadFirstThenExport('export-full', t.deps)
        expect(sleeps).toBeGreaterThanOrEqual(4)
        expect(asks).toBe(1)
        expect(t.exported).toEqual(['export-full'])
    })})
