import { alertWait } from '../alert'
import { language } from 'src/lang'
import { importSourceOfFile, type ImportSource } from '../importSource'
import { beginBusy, type BusyHandle } from '../process/memory/busyActions'
import { assetDeletionSettled } from '../storage/assetDeleteHold'
import type { OperationOutcome } from './operationEnd'
import { finishRtbRestore } from './rtbRestoreFinish'
import { installRtbRestore, type RtbInstallCause, type RtbInstallEnd } from './rtbRestoreInstall'
import { acquireRestoreHold } from './rtbRestoreHold'
import { prepareRtbRestore, type PickedRtb, type RtbPrepareCause, type RtbPrepareDeps, type RtbPrepareEnd } from './rtbRestorePlan'
import { askRtbPassword } from './rtbSealedOpen'
import { applySettingsRestore } from './rtbSettingsRestore'
import type { VerifiedSettings } from './rtb/rtbVerify'
import { cardRestoreProgress, rtbCardDef, type RestoreProgress } from './restoreProgress'
import { saveFirst } from './storeRestore'

/**
 * The shell of a `.rtb` restore (CHORE-128 S12b): the busy entry, the wait for a pending asset deletion, the preparation,
 * the install and the finish. It is a library with no caller of its own; the backup router routes a picked or an opened file here.
 *
 * Invariants:
 * - The `backupLoad` busy entry is taken before anything else and ended on every exit.
 * - A pending asset deletion settles before the preparation lists the page's assets, so the listing never counts an asset
 *   that is about to be deleted as present (CHORE-830).
 * - Once `installRtbRestore` was called this function never rejects: an install rejection ends `unknown` (the shell cannot
 *   know whether the commit started), a finish rejection ends `committed` (the commit landed). A rejection before that
 *   (the settle or the preparation) propagates; nothing was replaced.
 */

export type RtbRestoreCause = RtbPrepareCause | RtbInstallCause

/** The file as the restore reads it, whatever its name or extension. */
export function pickedRtbOf(file: File): PickedRtb {
    return { name: file.name, size: file.size, lastModified: file.lastModified, source: importSourceOfFile(file) }
}

/** A file another app opened, as the restore reads it: the caller's open source, its display name and modification time (0 when unknown). */
export function pickedRtbOfSource(opened: { source: ImportSource, name: string, lastModified: number }): PickedRtb {
    return { name: opened.name, size: opened.source.size, lastModified: opened.lastModified, source: opened.source }
}

/** How a restore was started; the Welcome restore sets `firstRun`. */
export interface RtbRunOptions {
    firstRun?: boolean
    /** Show the running phases on the task card, with Cancel until the copy begins; the start-up restore and a direct call do not. */
    card?: true
}

/** The calls the shell makes; tests replace them to observe order and to keep the page out of it. */
export interface RtbRestoreDeps {
    beginBusy(): BusyHandle
    settled(): Promise<void>
    prepare(picked: PickedRtb, busy: BusyHandle, run: RtbRunOptions): Promise<RtbPrepareEnd>
    install(plan: Extract<RtbPrepareEnd, { kind: 'ready' }>['plan'], hold: Extract<RtbPrepareEnd, { kind: 'ready' }>['hold']): Promise<RtbInstallEnd>
    finish(plan: Extract<RtbPrepareEnd, { kind: 'ready' }>['plan'], hold: Extract<RtbPrepareEnd, { kind: 'ready' }>['hold'], landed: Extract<RtbInstallEnd, { kind: 'landed' }>): Promise<void>
    wait(text: string): void
    /** The apply of a settings-only file; the only step that follows a `settings` preparation. */
    applySettings(settings: VerifiedSettings, run: RtbRunOptions): Promise<{ outcome: OperationOutcome }>
}

/** The preparation's calls on the card: named steps instead of wait dialogs, and the password prompt stands the card aside. */
function cardPrepareDeps(progress: RestoreProgress): Partial<RtbPrepareDeps> {
    return {
        saveFirst: (ms) => saveFirst(ms, { quiet: true }),
        acquireHold: (busy, options) => acquireRestoreHold(busy, { ...options, checking: () => progress.phase('tabs', null) }),
        // The verify progress and the sealed file's key derivation both report through this one dep.
        wait: () => progress.phase('check', null),
        password: (reason) => progress.aside(() => askRtbPassword(reason)),
    }
}

/** `progress` is null on every route without the card, which then runs exactly the stages' own calls. */
function realRestoreDeps(progress: RestoreProgress | null): RtbRestoreDeps {
    return {
        beginBusy: () => beginBusy('backupLoad'),
        settled: assetDeletionSettled,
        prepare: (picked, busy, run) => prepareRtbRestore(picked, busy, progress === null
            ? { firstRun: run.firstRun === true }
            : { firstRun: run.firstRun === true, deps: cardPrepareDeps(progress), cancel: progress }),
        install: (plan, hold) => progress === null
            ? installRtbRestore(plan, hold)
            : installRtbRestore(plan, hold, {
                installing: () => progress.phase('load', null),
                copyDeps: { bytes: (done, total) => progress.bytes('copy', done, total, null) },
            }),
        finish: (plan, hold, landed) => progress === null
            ? finishRtbRestore(plan, hold, landed)
            : finishRtbRestore(plan, hold, landed, { leave: () => progress.leave() }),
        wait: alertWait,
        applySettings: (settings, run) => applySettingsRestore(settings, run),
    }
}

export async function runRtbRestore(picked: PickedRtb, options: Partial<RtbRestoreDeps> = {}, run: RtbRunOptions = {}): Promise<{ outcome: OperationOutcome, cause: RtbRestoreCause | null }> {
    // The card is opened inside the `try` whose `finally` leaves it, with no await before `beginBusy`: a throwing
    // `beginBusy` can never leave a card with Cancel and no run behind it.
    let progress: RestoreProgress | null = null
    // A failure of the card never changes how the restore ends.
    const leaveCard = (): void => {
        try {
            progress?.leave()
        } catch (error) {
            console.error(error)
        }
    }
    try {
        progress = run.card === true ? cardRestoreProgress(rtbCardDef()) : null
        const deps: RtbRestoreDeps = { ...realRestoreDeps(progress), ...options }
        const busy = deps.beginBusy()
        try {
            await deps.settled()
            if (progress?.cancelRequested === true) {
                progress.cancelled()
                return { outcome: 'canceled', cause: 'cancelled' }
            }
            const prep = await deps.prepare(picked, busy, run)
            if (prep.kind === 'ended') {
                if (prep.cause === 'cancelled') {
                    progress?.cancelled()
                }
                return { outcome: prep.outcome, cause: prep.cause }
            }
            if (prep.kind === 'settings') {
                // A settings-only file installs and finishes nothing: it goes to its own apply, which asks its own confirmation.
                leaveCard()
                // The card is gone by now, so the apply shows its own waits (`card` is not passed on).
                const applied = await deps.applySettings(prep.settings, { firstRun: run.firstRun })
                return { outcome: applied.outcome, cause: null }
            }
            // The preparation has locked Cancel: the copy is the first write.
            progress?.phase('copy', null)
            let end: RtbInstallEnd
            try {
                end = await deps.install(prep.plan, prep.hold)
            } catch (error) {
                console.error(error)
                try {
                    deps.wait(language.store2ImportUnconfirmed)
                } catch (alertError) {
                    console.error(alertError)
                }
                leaveCard()
                return { outcome: 'unknown', cause: null }
            }
            if (end.kind === 'stopped') {
                leaveCard()
                return { outcome: end.outcome, cause: end.cause }
            }
            if (end.kind === 'unconfirmed') {
                leaveCard()
                return { outcome: 'unknown', cause: end.cause }
            }
            progress?.phase('finish', null)
            try {
                await deps.finish(prep.plan, prep.hold, end)
            } catch (error) {
                console.error(error)
                try {
                    deps.wait(language.restoreSavedReloadOrRestart)
                } catch (alertError) {
                    console.error(alertError)
                }
                leaveCard()
            }
            return { outcome: 'committed', cause: null }
        } finally {
            try {
                busy.end()
            } catch (error) {
                console.error(error)
            }
        }
    } finally {
        // The backstop for every exit above; `leave` is idempotent.
        leaveCard()
    }
}
