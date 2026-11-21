/**
 * What the Data page's backup flow runs for each answer of the chooser and of the leave-out sheet. Post-fix guard (new
 * module): the engines are fake functions, so only the choice logic is exercised.
 */
import { describe, expect, test, vi } from 'vitest'
import { language } from '../../lang'
import type { BackupExportOptions } from '../drive/backuplocal'
import type { BinLeaveOutEntry } from '../drive/binLeaveOut'
import type { ExportOutcome } from '../drive/operationEnd'
import { runDataBackup, type DataBackupDeps } from './dataBackupFlow'
import type { BackupChoice, LeaveOutAnswer } from './dataSheets.svelte'

const SAVED: ExportOutcome = {
    status: 'saved',
    notices: [],
    omitted: { assets: [], oversize: [], units: [], inlays: [], oldStoreUnlisted: false, repaired: null },
    inlays: null,
}
const SUMMARY: BinLeaveOutEntry[] = [{ kind: 'taskPresets', count: 2, names: ['a', 'b'] }, { kind: 'usageStats', count: 1 }]

interface Setup {
    outcome?: ExportOutcome
    /** What the export hands the leave-out question; null makes the engine skip the question. */
    asks?: readonly BinLeaveOutEntry[] | null
    answer?: LeaveOutAnswer | null
}

function deps(choice: BackupChoice | null, setup: Setup = {}) {
    const outcome = setup.outcome ?? SAVED
    const asks = setup.asks === undefined ? null : setup.asks
    const run = async (options: BackupExportOptions): Promise<ExportOutcome> => {
        if (asks !== null) await options.askLeaveOut?.(asks)
        return outcome
    }
    const spies = {
        saveBin: vi.fn(run),
        savePartialBin: vi.fn(async (options: BackupExportOptions, _entry: { assetsExplained: boolean }) => await run(options)),
        startRtb: vi.fn(async (_password?: string) => null),
        startSettingsRtb: vi.fn(async (_password?: string) => null),
        askLeaveOut: vi.fn(async (_summary: readonly BinLeaveOutEntry[]) => setup.answer ?? null),
        setLeftOut: vi.fn((_text: string | null) => {}),
    }
    const live: DataBackupDeps = {
        chooseBackup: vi.fn(async () => choice),
        saveBin: spies.saveBin,
        savePartialBin: spies.savePartialBin,
        startRtb: spies.startRtb,
        startSettingsRtb: spies.startSettingsRtb,
        askLeaveOut: spies.askLeaveOut,
        setLeftOut: spies.setLeftOut,
    }
    return { live, spies }
}

const BIN: BackupChoice = { format: 'bin', scope: 'full' }

describe('runDataBackup', () => {
    test('S1-U1: no answer runs nothing', async () => {
        const { live, spies } = deps(null)
        await runDataBackup(live)
        expect(spies.saveBin).not.toHaveBeenCalled()
        expect(spies.savePartialBin).not.toHaveBeenCalled()
        expect(spies.startRtb).not.toHaveBeenCalled()
    })

    test('S1-U1: a full .rtb starts the full .rtb export only', async () => {
        const { live, spies } = deps({ format: 'rtb', scope: 'full' })
        await runDataBackup(live)
        expect(spies.startRtb).toHaveBeenCalledTimes(1)
        expect(spies.startSettingsRtb).not.toHaveBeenCalled()
        expect(spies.saveBin).not.toHaveBeenCalled()
        expect(spies.savePartialBin).not.toHaveBeenCalled()
        expect(spies.askLeaveOut).not.toHaveBeenCalled()
    })

    test('R2: a settings-only .rtb starts the settings export only, with the chooser\'s password or none', async () => {
        const plain = deps({ format: 'rtb', scope: 'settings' })
        await runDataBackup(plain.live)
        expect(plain.spies.startSettingsRtb).toHaveBeenCalledTimes(1)
        expect(plain.spies.startSettingsRtb.mock.calls[0][0]).toBeUndefined()
        expect(plain.spies.startRtb).not.toHaveBeenCalled()
        expect(plain.spies.saveBin).not.toHaveBeenCalled()
        expect(plain.spies.savePartialBin).not.toHaveBeenCalled()
        expect(plain.spies.askLeaveOut).not.toHaveBeenCalled()
        const sealed = deps({ format: 'rtb', scope: 'settings', password: ' Pẃ 한 ' })
        await runDataBackup(sealed.live)
        expect(sealed.spies.startSettingsRtb).toHaveBeenCalledWith(' Pẃ 한 ')
        expect(sealed.spies.startRtb).not.toHaveBeenCalled()
    })

    test('T-S2-9: .rtb hands the export exactly the chooser\'s password, and undefined when there is none', async () => {
        const sealed = deps({ format: 'rtb', scope: 'full', password: ' Pẃ 한 ' })
        await runDataBackup(sealed.live)
        expect(sealed.spies.startRtb).toHaveBeenCalledTimes(1)
        expect(sealed.spies.startRtb).toHaveBeenCalledWith(' Pẃ 한 ')
        const plain = deps({ format: 'rtb', scope: 'full' })
        await runDataBackup(plain.live)
        expect(plain.spies.startRtb).toHaveBeenCalledTimes(1)
        expect(plain.spies.startRtb.mock.calls[0][0]).toBeUndefined()
    })

    test('S1-U1: .bin in full saves once, handing the export the leave-out question', async () => {
        const { live, spies } = deps(BIN)
        await runDataBackup(live)
        expect(spies.saveBin).toHaveBeenCalledTimes(1)
        expect(spies.saveBin).toHaveBeenCalledWith({ askLeaveOut: expect.any(Function) })
        expect(spies.savePartialBin).not.toHaveBeenCalled()
        expect(spies.startRtb).not.toHaveBeenCalled()
    })

    test('S1-U1: .bin partial saves with the assets-explained entry and the leave-out question', async () => {
        const { live, spies } = deps({ format: 'bin', scope: 'partial' })
        await runDataBackup(live)
        expect(spies.savePartialBin).toHaveBeenCalledWith({ askLeaveOut: expect.any(Function) }, { assetsExplained: true })
        expect(spies.savePartialBin).toHaveBeenCalledTimes(1)
        expect(spies.saveBin).not.toHaveBeenCalled()
        expect(spies.startRtb).not.toHaveBeenCalled()
    })
})

describe('runDataBackup leave-out answers', () => {
    test('S2-R7: the answer maps to what the export is told: bin true, rtb and cancel false, none null', async () => {
        const told: Array<boolean | null | undefined> = []
        for (const answer of ['bin', 'rtb', 'cancel', null] as const) {
            const { live, spies } = deps(BIN, { asks: SUMMARY, answer, outcome: { status: 'declined', cause: 'oversize-declined' } })
            spies.saveBin.mockImplementationOnce(async (options: BackupExportOptions) => {
                told.push(await options.askLeaveOut?.(SUMMARY))
                return { status: 'declined' as const, cause: 'oversize-declined' as const }
            })
            await runDataBackup(live)
            expect(spies.askLeaveOut).toHaveBeenCalledWith(SUMMARY)
        }
        expect(told).toEqual([true, false, false, null])
    })

    test('S2-R7: the secondary answer starts the .rtb after an export declined for its leave-out', async () => {
        const { live, spies } = deps(BIN, { asks: SUMMARY, answer: 'rtb', outcome: { status: 'declined', cause: 'incomplete-data-declined' } })
        await runDataBackup(live)
        expect(spies.startRtb).toHaveBeenCalledTimes(1)
        // The instead path is a plain .rtb: it passes no password argument at all.
        expect(spies.startRtb).toHaveBeenCalledWith()
        expect(spies.setLeftOut).toHaveBeenLastCalledWith(null)
    })

    test('S2-R7: the same answer starts the .rtb after a partial export declined for its leave-out', async () => {
        const { live, spies } = deps({ format: 'bin', scope: 'partial' }, { asks: SUMMARY, answer: 'rtb', outcome: { status: 'declined', cause: 'incomplete-data-declined' } })
        await runDataBackup(live)
        expect(spies.startRtb).toHaveBeenCalledTimes(1)
    })

    test('S2-R8: the .rtb never starts after a decline for another cause, a cancelled export, a failure or a saved file', async () => {
        const outcomes: ExportOutcome[] = [
            { status: 'declined', cause: 'oversize-declined' },
            { status: 'declined', cause: 'export-cancelled', file: 'untouched' },
            { status: 'failed', cause: new Error('boom'), file: 'untouched' },
            SAVED,
        ]
        for (const outcome of outcomes) {
            const { live, spies } = deps(BIN, { asks: SUMMARY, answer: 'rtb', outcome })
            await runDataBackup(live)
            expect(spies.startRtb, JSON.stringify(outcome)).not.toHaveBeenCalled()
        }
    })

    test('S2-R8: no other answer starts the .rtb, even when the export declined for its leave-out', async () => {
        for (const answer of ['bin', 'cancel', null] as const) {
            const { live, spies } = deps(BIN, { asks: SUMMARY, answer, outcome: { status: 'declined', cause: 'incomplete-data-declined' } })
            await runDataBackup(live)
            expect(spies.startRtb, String(answer)).not.toHaveBeenCalled()
        }
    })

    test('S2-R10: a saved .bin the person continued sets the line with the kinds that were left out', async () => {
        const { live, spies } = deps(BIN, { asks: SUMMARY, answer: 'bin' })
        await runDataBackup(live)
        expect(spies.setLeftOut).toHaveBeenNthCalledWith(1, null)
        expect(spies.setLeftOut).toHaveBeenLastCalledWith(language.settingsShellDataLeftOutRepeat(`${language.settingsShellDataKindTaskPresets}, ${language.settingsShellDataKindUsage}`))
        expect(spies.setLeftOut).toHaveBeenCalledTimes(2)
    })

    test('S2-R10: no line is set for a secondary answer, a cancel, an unanswered question, an export with nothing to ask, or a failed save', async () => {
        const cases: Array<[string, Setup]> = [
            ['rtb', { asks: SUMMARY, answer: 'rtb' }],
            ['cancel', { asks: SUMMARY, answer: 'cancel' }],
            ['unanswered', { asks: SUMMARY, answer: null }],
            ['nothing to ask', { asks: null, answer: 'bin' }],
            ['bin declined', { asks: SUMMARY, answer: 'bin', outcome: { status: 'declined', cause: 'oversize-declined' } }],
        ]
        for (const [label, setup] of cases) {
            const { live, spies } = deps(BIN, setup)
            await runDataBackup(live)
            expect(spies.setLeftOut, label).toHaveBeenCalledTimes(1)
            expect(spies.setLeftOut, label).toHaveBeenCalledWith(null)
        }
    })

    test('S2-R10: a run that is cancelled at the chooser still clears the old line', async () => {
        const { live, spies } = deps(null)
        await runDataBackup(live)
        expect(spies.setLeftOut).toHaveBeenCalledWith(null)
    })
})
