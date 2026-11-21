/**
 * The export progress seam and the pure parts of the shell around it.
 * SH0a-SH0c (G) are compatibility guards on the legacy implementation (`gateProgress`): the seam must post exactly the
 * wait, prompt and notice calls that the export made before it existed. SH1-SH10 are on the card implementation
 * (`cardProgress` through `runExport`'s card option) with the real task slot and adapter.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const posted = vi.hoisted(() => ({ log: [] as string[] }))
const platformBox = vi.hoisted(() => ({ isTauri: false }))

vi.mock('../../alert', () => ({
    alertError: vi.fn((msg: string) => { posted.log.push(`error:${msg}`) }),
    alertMd: vi.fn((msg: string) => { posted.log.push(`md:${msg}`) }),
    alertNormal: vi.fn((msg: string) => { posted.log.push(`normal:${msg}`) }),
    alertNormalWait: vi.fn(async (msg: string) => { posted.log.push(`normalWait:${msg}`) }),
}))

vi.mock('../../exportCancel', () => {
    class ExportCancelledError extends Error { }
    class ExportCancelToken {
        cancelled = false
        cancel(): void {
            this.cancelled = true
        }
        throwIfCancelled(): void {
            if (this.cancelled) {
                throw new ExportCancelledError()
            }
        }
    }
    return { ExportCancelledError, ExportCancelToken, createExportWaitGate: vi.fn() }
})

vi.mock('../../globalApi.svelte', () => ({
    LocalWriter: class { },
    TauriWriter: class {
        constructor(public path: string) { }
        get touchedFile(): boolean { return true }
    },
}))
vi.mock('../../exportWriters', () => ({ cancelledFileState: vi.fn(), webWriterNeedsGesture: vi.fn(() => false) }))
vi.mock('@tauri-apps/plugin-fs', () => ({ remove: vi.fn(async () => { }) }))
vi.mock('../exportDialogBusy', () => ({ openOutsideBusy: async <T>(_busy: unknown, open: () => Promise<T>) => await open() }))
vi.mock('../exportModules', () => ({
    ExportModuleUnreadableError: class extends Error {
        readonly reason = 'unreadable' as const
        constructor(public readonly moduleId: string, public readonly moduleName: string, _cause: unknown) { super('unreadable') }
    },
}))
vi.mock('../inlayBackupExport', () => ({
    ExportReadError: class extends Error {
        constructor(public readonly key: string, _cause: unknown) { super('read') }
    },
}))
vi.mock('src/ts/platform', () => ({ get isTauri() { return platformBox.isTauri } }))

import { remove } from '@tauri-apps/plugin-fs'
import { language } from 'src/lang'
import { alertMd } from '../../alert'
import { requestTaskCancel, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskShown } from '../../alertTask.svelte'
import { ExportCancelToken, type ExportWaitGate } from '../../exportCancel'
import { cancelledFileState } from '../../exportWriters'
import { LocalWriter, TauriWriter } from '../../globalApi.svelte'
import { ExportModuleUnreadableError } from '../exportModules'
import { ExportReadError } from '../inlayBackupExport'
import {
    BackupAssetChangedError, BackupAssetTooLargeError, confirmDuringExport, ensureGestureForWriter, failedExportText, gateProgress,
    reportFailedExport, runExport, type ExportSession, type ExportShellCard,
} from '../exportShell'
import type { ExportOutcome } from '../operationEnd'

function gateFake(): ExportWaitGate {
    return {
        wait: vi.fn((msg: string) => { posted.log.push(`wait:${msg}`) }),
        clear: vi.fn(() => { posted.log.push('clear') }),
    }
}

function sessionOf(gate: ExportWaitGate): ExportSession {
    return { writer: null, describeAsset: (key) => `<${key}>`, cancel: new ExportCancelToken(), progress: gateProgress(gate) }
}

beforeEach(() => {
    posted.log.length = 0
    platformBox.isTauri = false
    resetTaskHostForTests()
    // Each clock read advances, so the card publishes every report at once instead of throttling it.
    let tick = 0
    setTaskClockForTests({ now: () => (tick += 1000), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (timer) => clearTimeout(timer), hidden: () => false })
})

afterEach(() => {
    setTaskClockForTests(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('gateProgress (G)', () => {
    test('SH0a phase, count and bytes post their text as the wait, and a null text posts nothing', () => {
        const progress = gateProgress(gateFake())
        progress.phase('collect', 'P')
        progress.count('assets', 1, 3, 'C')
        progress.bytes('finish', 1, 3, 'B')
        expect(posted.log).toEqual(['wait:P', 'wait:C', 'wait:B'])
        posted.log.length = 0
        progress.phase('collect', null)
        progress.count('assets', 1, 3, null)
        progress.bytes('finish', 1, 3, null)
        expect(posted.log).toEqual([])
    })

    test('SH0a prompt and sheet each clear the wait, then ask; dialog leaves the wait; dismissed clears', async () => {
        const progress = gateProgress(gateFake())
        expect(await progress.prompt(async () => { posted.log.push('ask'); return 1 })).toBe(1)
        expect(await progress.sheet(async () => { posted.log.push('sheet'); return 2 })).toBe(2)
        expect(await progress.dialog(async () => { posted.log.push('open'); return 3 })).toBe(3)
        progress.dismissed()
        expect(posted.log).toEqual(['clear', 'ask', 'clear', 'sheet', 'open', 'clear'])
    })

    test('SH0a done joins the summary with blank lines; notice posts the markdown or plain notice', () => {
        const progress = gateProgress(gateFake())
        progress.done(['a', 'b'])
        progress.notice('markdown', 'm')
        progress.notice('normal', 'n')
        expect(posted.log).toEqual(['normal:a\n\nb', 'md:m', 'normal:n'])
    })
})

describe('failedExportText (G)', () => {
    test('SH0b returns the text reportFailedExport posts, for each of its five outcomes', () => {
        const session = sessionOf(gateFake())
        const cases: Array<[unknown, 'untouched' | 'deleted' | 'kept', string]> = [
            [new BackupAssetTooLargeError('k', 5), 'kept', language.backupFailedAssetTooLarge('<k>', 'kept')],
            [new ExportModuleUnreadableError('id', 'mod', null), 'untouched', language.backupFailedModuleUnreadable('mod', 'unreadable')],
            [new Error('x'), 'untouched', language.backupFailedNothingWritten()],
            [new BackupAssetChangedError('a', null), 'deleted', language.backupFailedFileDeleted('<a>')],
            [new ExportReadError('r', null), 'kept', language.backupFailedFileKept('<r>')],
        ]
        for (const [error, file, expected] of cases) {
            expect(failedExportText(session, error, file)).toBe(expected)
        }
    })

    test('SH0b reportFailedExport posts that text as an error and returns the file state', async () => {
        const session = sessionOf(gateFake())
        expect(await reportFailedExport(session, new Error('x'))).toBe('untouched')
        expect(posted.log).toEqual([`error:${language.backupFailedNothingWritten()}`])
    })
})

describe('confirmDuringExport (G)', () => {
    test('SH0c with asks false never clears the wait; with asks true it clears before confirm', async () => {
        const gate = gateFake()
        const session = sessionOf(gate)
        await confirmDuringExport(session, false, async () => { posted.log.push('confirm'); return true })
        expect(posted.log).toEqual(['confirm'])
        posted.log.length = 0
        expect(await confirmDuringExport(session, true, async () => { posted.log.push('confirm'); return false })).toBe(false)
        expect(posted.log).toEqual(['clear', 'confirm'])
        posted.log.length = 0
        await confirmDuringExport(session, true, async () => { posted.log.push('sheet'); return true }, 'sheet')
        expect(posted.log).toEqual(['clear', 'sheet'])
    })
})

//#region the card implementation

const CARD: ExportShellCard = {
    def: {
        title: 'Card title',
        steps: [{ id: 'collect', label: 'Collect' }, { id: 'assets', label: 'Assets', noun: 'Assets' }, { id: 'finish', label: 'Write' }],
        doneHeadline: 'Card done',
        failedHeadline: 'Card failed',
    },
}

const declined: ExportOutcome = { status: 'declined', cause: 'incomplete-data-declined' }

/** A body that only samples the slot where it starts, then ends as a decline. */
const sampleFirst = (sampled: { view: ReturnType<typeof taskHostView> }) => async (_session: ExportSession): Promise<ExportOutcome> => {
    sampled.view = taskHostView()
    return declined
}

/** A desktop output file this run touched: the shell removes it before it reports a failure. */
function desktopFileOf(): LocalWriter {
    return Object.assign(new LocalWriter(), { writer: new TauriWriter('out.bin') })
}

describe('runExport with a card (SH1-SH10)', () => {
    test('SH1 the card is in the slot before the body runs; Cancel is offered on the web and wired to the run, not on Tauri', async () => {
        const sampled: { view: ReturnType<typeof taskHostView> } = { view: null }
        await runExport(sampleFirst(sampled), undefined, CARD)
        expect(sampled.view?.title).toBe('Card title')
        expect(sampled.view?.cancelOffered).toBe(true)

        let cancelled = false
        await runExport(async (session) => {
            requestTaskCancel()
            cancelled = session.cancel.cancelled
            return declined
        }, undefined, CARD)
        expect(cancelled).toBe(true)

        platformBox.isTauri = true
        const desktop: { view: ReturnType<typeof taskHostView> } = { view: null }
        await runExport(sampleFirst(desktop), undefined, CARD)
        expect(desktop.view?.title).toBe('Card title')
        expect(desktop.view?.cancelOffered).toBe(false)
    })

    test('SH2 a Cancel on the card ends as cancelled with the incomplete-file line, and posts no separate notice', async () => {
        vi.mocked(cancelledFileState).mockReturnValue('kept')
        const outcome = await runExport(async (session) => {
            requestTaskCancel()
            session.cancel.throwIfCancelled()
            return declined
        }, undefined, CARD)

        expect(outcome).toEqual({ status: 'declined', cause: 'export-cancelled', file: 'kept' })
        expect(taskHostView()?.cancelled).toBe(true)
        expect(taskHostView()?.result?.summary).toEqual([language.exportFailedFileIncomplete])
        expect(posted.log).toEqual([])
    })

    describe('SH3 a failure ends on the fail card after the file was given up', () => {
        const failing = (error: unknown, writer: LocalWriter | null) => async (session: ExportSession): Promise<ExportOutcome> => {
            session.writer = writer
            throw error
        }

        test('(a) a desktop file is removed before the card settles, and the detail says it was deleted', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => { })
            let release: () => void = () => { }
            vi.mocked(remove).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))

            const running = runExport(failing(new Error('boom'), desktopFileOf()), undefined, CARD)
            await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
            expect(taskHostView()?.state).toBe('running')
            release()
            const outcome = await running

            expect(outcome).toMatchObject({ status: 'failed', file: 'deleted' })
            expect(taskHostView()?.state).toBe('failed')
            expect(taskHostView()?.failure?.detail).toBe(language.backupFailedFileDeleted(null))
            expect(taskHostView()?.failure?.headline).toBe('Card failed')
            expect(posted.log).toEqual([])
            expect(console.error).toHaveBeenCalledTimes(1)
        })

        test('(b) a file that cannot be removed is kept', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => { })
            vi.mocked(remove).mockRejectedValueOnce(new Error('locked'))
            await runExport(failing(new Error('boom'), desktopFileOf()), undefined, CARD)
            expect(taskHostView()?.failure?.detail).toBe(language.backupFailedFileKept(null))
        })

        test('(c) a stream that may have reached the browser is aborted and kept', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => { })
            const abort = vi.fn(async () => { })
            const stream = Object.assign(new LocalWriter(), { writer: { write: async () => { }, close: async () => { }, abort } })
            await runExport(failing(new Error('boom'), stream), undefined, CARD)
            expect(abort).toHaveBeenCalledTimes(1)
            expect(taskHostView()?.failure?.detail).toBe(language.backupFailedFileKept(null))
        })

        test('(d) an asset too large for an entry, and (e) an unreadable module, name themselves', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => { })
            await runExport(failing(new BackupAssetTooLargeError('k', 5), null), undefined, CARD)
            expect(taskHostView()?.failure?.detail).toBe(language.backupFailedAssetTooLarge(`'k'`, 'untouched'))
            await runExport(failing(new ExportModuleUnreadableError('id', 'mod', null), null), undefined, CARD)
            expect(taskHostView()?.failure?.detail).toBe(language.backupFailedModuleUnreadable('mod', 'unreadable'))
        })

        test('(f) a save dialog that rejects on Tauri brings the card back and fails it with nothing written', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => { })
            platformBox.isTauri = true
            const outcome = await runExport(async (session) => {
                await session.progress.dialog(async () => { throw new Error('save') })
                return declined
            }, undefined, CARD)

            expect(outcome).toMatchObject({ status: 'failed', file: 'untouched' })
            expect(taskHostView()?.state).toBe('failed')
            expect(taskHostView()?.failure?.detail).toBe(language.backupFailedNothingWritten())
            expect(posted.log).toEqual([])
        })
    })

    test('SH4 a declined outcome leaves no card and posts nothing', async () => {
        await runExport(async () => declined, undefined, CARD)
        expect(taskShown()).toBe(false)
        expect(posted.log).toEqual([])
    })

    test('SH5 a prompt leaves the same card in the slot at the same step, and brings a held card back first', async () => {
        const seen: Array<{ shown: boolean, id: number | undefined, step: number | undefined }> = []
        const sample = () => seen.push({ shown: taskShown(), id: taskHostView()?.id, step: taskHostView()?.stepIndex })
        let before: number | undefined
        let after: number | undefined
        await runExport(async (session) => {
            session.progress.phase('assets', null)
            before = taskHostView()?.id
            await session.progress.prompt(async () => { sample() })
            after = taskHostView()?.id
            // A sheet takes the card out of the slot; the next prompt brings it back at the recorded step.
            await session.progress.sheet(async () => { sample() })
            await session.progress.prompt(async () => { sample() })
            return declined
        }, undefined, CARD)

        expect(seen).toEqual([
            { shown: true, id: before, step: 1 },
            { shown: false, id: undefined, step: undefined },
            { shown: true, id: seen[2].id, step: 1 },
        ])
        expect(after).toBe(before)
        expect(seen[2].id).not.toBe(before)
    })

    test('SH5b a sheet empties the slot until the next report', async () => {
        const seen: boolean[] = []
        await runExport(async (session) => {
            await session.progress.sheet(async () => { seen.push(taskShown()) })
            seen.push(taskShown())
            session.progress.phase('assets', null)
            seen.push(taskShown())
            return declined
        }, undefined, CARD)
        expect(seen).toEqual([false, false, true])
    })

    test('SH6 a native dialog empties the slot on Tauri, and keeps the card with Cancel on the web', async () => {
        const web: Array<{ shown: boolean, cancel: boolean | undefined }> = []
        await runExport(async (session) => {
            await session.progress.dialog(async () => { web.push({ shown: taskShown(), cancel: taskHostView()?.cancelOffered }) })
            return declined
        }, undefined, CARD)
        expect(web).toEqual([{ shown: true, cancel: true }])

        platformBox.isTauri = true
        const tauri: boolean[] = []
        await runExport(async (session) => {
            await session.progress.dialog(async () => { tauri.push(taskShown()) })
            return declined
        }, undefined, CARD)
        expect(tauri).toEqual([false])
    })

    test('SH7 a clean save ends on the done card with the summary, and posts nothing', async () => {
        await runExport(async (session) => {
            session.progress.done(['a', 'b'])
            return declined
        }, undefined, CARD)
        expect(taskHostView()?.state).toBe('done')
        expect(taskHostView()?.result?.headline).toBe('Card done')
        expect(taskHostView()?.result?.summary).toEqual(['a', 'b'])
        expect(posted.log).toEqual([])
    })

    test('SH8 the gesture notice is asked over the card in the slot', async () => {
        vi.stubGlobal('navigator', { userActivation: { isActive: false } })
        const sampled: { id: number | undefined, shown: boolean } = { id: undefined, shown: false }
        const { alertNormalWait } = await import('../../alert')
        vi.mocked(alertNormalWait).mockImplementationOnce(async () => {
            sampled.id = taskHostView()?.id
            sampled.shown = taskShown()
        })
        let first: number | undefined
        await runExport(async (session) => {
            first = taskHostView()?.id
            await ensureGestureForWriter(session, true)
            return declined
        }, undefined, CARD)

        expect(sampled.shown).toBe(true)
        expect(sampled.id).toBe(first)
    })

    test('SH9 a confirm that is not asked leaves the card in the slot, whichever cover it names', async () => {
        const seen: boolean[] = []
        await runExport(async (session) => {
            await confirmDuringExport(session, false, async () => { seen.push(taskShown()); return true })
            await confirmDuringExport(session, false, async () => { seen.push(taskShown()); return true }, 'sheet')
            return declined
        }, undefined, CARD)
        expect(seen).toEqual([true, true])
    })

    test('SH10 a notice closes the card before it posts, and posts even when a newer task replaced the card', async () => {
        let shownAtNotice: boolean | null = null
        vi.mocked(alertMd).mockImplementationOnce(() => { shownAtNotice = taskShown() })
        await runExport(async (session) => {
            session.progress.notice('markdown', 'the report')
            return declined
        }, undefined, CARD)
        expect(shownAtNotice).toBe(false)
        expect(alertMd).toHaveBeenCalledWith('the report')
        expect(taskShown()).toBe(false)
    })
})

//#endregion
