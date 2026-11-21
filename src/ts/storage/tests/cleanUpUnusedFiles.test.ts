/**
 * `cleanUpUnusedFiles.ts`: the button's offer rule, the outcome-to-message table and the click flow.
 *
 * MOCKED: the alerts (recorded) and `runManualCleanUp` (a scripted engine that drives the UI object the flow hands it).
 * `src/lang` and the boot-session holder are real. The engine's own behaviour is covered in `maintenanceRunner.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AssetSweepResult } from 'src/ts/storage/store2/sweep'
import type { ManualCleanUpOutcome, ManualCleanUpPlan, ManualCleanUpUi } from 'src/ts/storage/store2/maintenance'
import type { Store2Session } from 'src/ts/storage/store2/session'

//#region module mocks

const alerts = vi.hoisted(() => ({
    alertWait: vi.fn(),
    alertConfirm: vi.fn(async (_msg: string) => true),
    alertNormal: vi.fn(),
    alertClear: vi.fn(),
}))

vi.mock(import('src/ts/alert'), () => alerts as unknown as typeof import('src/ts/alert'))

const engine = vi.hoisted(() => ({
    runManualCleanUp: vi.fn<(ui: ManualCleanUpUi) => Promise<ManualCleanUpOutcome>>(),
}))

vi.mock(import('src/ts/storage/store2/maintenance'), () => engine as unknown as typeof import('src/ts/storage/store2/maintenance'))

//#endregion

import { language } from 'src/lang'
import { resetStore2BootForTest, setStore2BootSession } from 'src/ts/storage/store2/bootActive'
import { cleanUpMessage, cleanUpOfferedFor, startCleanUpUnusedFiles } from 'src/ts/storage/cleanUpUnusedFiles'

const done = (over: Partial<Extract<AssetSweepResult, { status: 'done' }>> = {}): AssetSweepResult =>
    ({ status: 'done', phase: 'swept', candidates: 3, deleted: 3, failed: 0, keptLive: 0, batches: 1, recorded: false, ...over })

const ended = (result: AssetSweepResult, approved = 3): ManualCleanUpOutcome => ({ status: 'ended', result, approved })

beforeEach(() => {
    resetStore2BootForTest()
    vi.clearAllMocks()
    alerts.alertConfirm.mockImplementation(async () => true)
})

afterEach(() => {
    resetStore2BootForTest()
})

describe('cleanUpMessage (U2): every outcome has its message', () => {
    test.each<[string, ManualCleanUpOutcome, string | null]>([
        ['busy', { status: 'busy' }, language.cleanUnusedFilesBusy],
        ['ended, plan stopped yielded with nothing deleted', ended(done({ deleted: 0, stopped: 'yielded' })), language.cleanUnusedFilesBusy],
        ['unavailable', { status: 'unavailable' }, language.cleanUnusedFilesRefused],
        ['nothing', { status: 'nothing' }, language.cleanUnusedFilesNone],
        ['wait (plan-step young, or delete-step young)', { status: 'wait' }, language.cleanUnusedFilesNodeWait],
        ['cancelled with nothing deleted', { status: 'cancelled', deleted: 0 }, language.cleanUnusedFilesCancelled(0)],
        ['cancelled after 2 deletes', { status: 'cancelled', deleted: 2 }, language.cleanUnusedFilesCancelled(2)],
        ['ended, refused other-tab', ended({ status: 'refused', reason: 'other-tab' }), language.cleanUnusedFilesOtherTab],
        ['ended, refused no-web-locks', ended({ status: 'refused', reason: 'no-web-locks' }), language.cleanUnusedFilesNoTabCheck],
        ['ended, refused keep-incomplete', ended({ status: 'refused', reason: 'keep-incomplete' }), language.cleanUnusedFilesRefused],
        ['ended, refused staging', ended({ status: 'refused', reason: 'staging' }), language.cleanUnusedFilesRefused],
        ['ended, refused other-tab carrying deleted 2', ended({ status: 'refused', reason: 'other-tab', deleted: 2 }), language.cleanUnusedFilesStopped(2)],
        ['ended, done stopped other-tab after 1', ended(done({ deleted: 1, stopped: 'other-tab' })), language.cleanUnusedFilesStopped(1)],
        ['ended, done stopped yielded after 1', ended(done({ deleted: 1, stopped: 'yielded' })), language.cleanUnusedFilesStopped(1)],
        ['ended, done all deleted', ended(done()), language.cleanUnusedFilesDone(3, 0)],
        ['ended, done with 1 kept', ended(done({ deleted: 2 })), language.cleanUnusedFilesDone(2, 1)],
        ['ended, Node note-only (nothing approved, record written)', ended(done({ phase: 'recorded', deleted: 0, recorded: true }), 0), language.cleanUnusedFilesNodeWait],
        ['declined', { status: 'declined' }, null],
    ])('%s', (_name, outcome, expected) => {
        expect(cleanUpMessage(outcome)).toBe(expected)
    })

    test('the messages are distinct where the person must act differently', () => {
        const texts = new Set([
            language.cleanUnusedFilesBusy, language.cleanUnusedFilesRefused, language.cleanUnusedFilesNone, language.cleanUnusedFilesNodeWait,
            language.cleanUnusedFilesOtherTab, language.cleanUnusedFilesNoTabCheck, language.cleanUnusedFilesStopped(1), language.cleanUnusedFilesDone(1, 0),
        ])
        expect(texts.size).toBe(8)
    })
})

describe('cleanUpOfferedFor', () => {
    const session = (kind: Store2Session['kind']): Store2Session => ({ kind }) as Store2Session

    test.each(['tauri', 'node'] as const)('a store2 page with a %s boot session is offered', (kind) => {
        setStore2BootSession(session(kind))
        expect(cleanUpOfferedFor({ kind: 'store2' })).toBe(true)
    })

    test('no session is not offered', () => {
        setStore2BootSession(null)
        expect(cleanUpOfferedFor({ kind: 'store2' })).toBe(false)
    })

    test('a page that is not store2 is never offered, whatever the session', () => {
        setStore2BootSession(session('node'))
        expect(cleanUpOfferedFor({ kind: 'unset' })).toBe(false)
        expect(cleanUpOfferedFor({ kind: 'read-only', reason: 'backend-unavailable' })).toBe(false)
    })
})

describe('startCleanUpUnusedFiles', () => {
    test('measuring and deleting popups carry the cancel, the confirm text follows the plan, and the result is shown', async () => {
        engine.runManualCleanUp.mockImplementation(async (ui) => {
            ui.progress('measuring', () => {})
            expect(await ui.confirm({ kind: 'tauri', deletable: 4, bytes: 3 * 1024 * 1024, later: 0 })).toBe(true)
            ui.progress('deleting', () => {})
            return ended(done({ deleted: 4 }), 4)
        })

        await startCleanUpUnusedFiles()

        expect(alerts.alertWait.mock.calls.map((call) => call[0])).toEqual([language.cleanUnusedFilesMeasuring, language.cleanUnusedFilesDeleting])
        expect(alerts.alertWait.mock.calls.every((call) => typeof call[1] === 'function')).toBe(true)
        expect(alerts.alertConfirm).toHaveBeenCalledExactlyOnceWith(language.cleanUnusedFilesConfirm(4, 3 * 1024 * 1024))
        expect(alerts.alertNormal).toHaveBeenCalledExactlyOnceWith(language.cleanUnusedFilesDone(4, 0))
        expect(alerts.alertClear).not.toHaveBeenCalled()
    })

    test.each<[string, ManualCleanUpPlan, string]>([
        ['node with deletable files', { kind: 'node', deletable: 2, bytes: null, later: 5 }, language.cleanUnusedFilesConfirmNode(2, null, 5)],
        ['node with nothing deletable yet', { kind: 'node', deletable: 0, bytes: null, later: 5 }, language.cleanUnusedFilesNoteNode(5)],
        ['tauri', { kind: 'tauri', deletable: 1, bytes: 10, later: 0 },language.cleanUnusedFilesConfirm(1, 10)],
    ])('confirm text: %s', async (_name, plan, expected) => {
        engine.runManualCleanUp.mockImplementation(async (ui) => {
            await ui.confirm(plan)
            return { status: 'declined' }
        })

        await startCleanUpUnusedFiles()

        expect(alerts.alertConfirm).toHaveBeenCalledExactlyOnceWith(expected)
    })

    test('a No closes the popup and shows no result message', async () => {
        engine.runManualCleanUp.mockImplementation(async (ui) => {
            alerts.alertConfirm.mockImplementationOnce(async () => false)
            expect(await ui.confirm({ kind: 'tauri', deletable: 1, bytes: 1, later: 0 })).toBe(false)
            return { status: 'declined' }
        })

        await startCleanUpUnusedFiles()

        expect(alerts.alertClear).toHaveBeenCalledTimes(1)
        expect(alerts.alertNormal).not.toHaveBeenCalled()
    })

    test('an error from the engine is logged and the person sees the generic refusal', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        engine.runManualCleanUp.mockRejectedValue(new Error('boom'))

        await startCleanUpUnusedFiles()

        expect(error).toHaveBeenCalledTimes(1)
        expect(alerts.alertNormal).toHaveBeenCalledExactlyOnceWith(language.cleanUnusedFilesRefused)
        error.mockRestore()
    })

    test('single flight: a second press during a run does nothing, and a press after it ends runs again', async () => {
        let release: (outcome: ManualCleanUpOutcome) => void = () => {}
        engine.runManualCleanUp.mockImplementationOnce(() => new Promise<ManualCleanUpOutcome>((resolve) => { release = resolve }))

        const first = startCleanUpUnusedFiles()
        await vi.waitFor(() => expect(engine.runManualCleanUp).toHaveBeenCalledTimes(1))
        await startCleanUpUnusedFiles()
        expect(engine.runManualCleanUp).toHaveBeenCalledTimes(1)

        release({ status: 'nothing' })
        await first
        expect(alerts.alertNormal).toHaveBeenCalledExactlyOnceWith(language.cleanUnusedFilesNone)

        engine.runManualCleanUp.mockResolvedValueOnce({ status: 'nothing' })
        await startCleanUpUnusedFiles()
        expect(engine.runManualCleanUp).toHaveBeenCalledTimes(2)
    })

    test('an error does not leave the single flight locked', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        engine.runManualCleanUp.mockRejectedValueOnce(new Error('boom'))
        await startCleanUpUnusedFiles()
        engine.runManualCleanUp.mockResolvedValueOnce({ status: 'nothing' })

        await startCleanUpUnusedFiles()

        expect(engine.runManualCleanUp).toHaveBeenCalledTimes(2)
        error.mockRestore()
    })
})
