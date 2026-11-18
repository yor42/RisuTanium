import { alertWait } from '../alert'
import { language } from 'src/lang'
import { importSourceOfFile, type ImportSource } from '../importSource'
import { beginBusy, type BusyHandle } from '../process/memory/busyActions'
import { assetDeletionSettled } from '../storage/assetDeleteHold'
import type { OperationOutcome } from './operationEnd'
import { finishRtbRestore } from './rtbRestoreFinish'
import { installRtbRestore, type RtbInstallCause, type RtbInstallEnd } from './rtbRestoreInstall'
import { prepareRtbRestore, type PickedRtb, type RtbPrepareCause, type RtbPrepareEnd } from './rtbRestorePlan'

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
}

/** The calls the shell makes; tests replace them to observe order and to keep the page out of it. */
export interface RtbRestoreDeps {
    beginBusy(): BusyHandle
    settled(): Promise<void>
    prepare(picked: PickedRtb, busy: BusyHandle, run: RtbRunOptions): Promise<RtbPrepareEnd>
    install(plan: Extract<RtbPrepareEnd, { kind: 'ready' }>['plan'], hold: Extract<RtbPrepareEnd, { kind: 'ready' }>['hold']): Promise<RtbInstallEnd>
    finish(plan: Extract<RtbPrepareEnd, { kind: 'ready' }>['plan'], hold: Extract<RtbPrepareEnd, { kind: 'ready' }>['hold'], landed: Extract<RtbInstallEnd, { kind: 'landed' }>): Promise<void>
    wait(text: string): void
}

function realRestoreDeps(): RtbRestoreDeps {
    return {
        beginBusy: () => beginBusy('backupLoad'),
        settled: assetDeletionSettled,
        prepare: (picked, busy, run) => prepareRtbRestore(picked, busy, { firstRun: run.firstRun === true }),
        install: (plan, hold) => installRtbRestore(plan, hold),
        finish: (plan, hold, landed) => finishRtbRestore(plan, hold, landed),
        wait: alertWait,
    }
}

export async function runRtbRestore(picked: PickedRtb, options: Partial<RtbRestoreDeps> = {}, run: RtbRunOptions = {}): Promise<{ outcome: OperationOutcome, cause: RtbRestoreCause | null }> {
    const deps: RtbRestoreDeps = { ...realRestoreDeps(), ...options }
    const busy = deps.beginBusy()
    try {
        await deps.settled()
        const prep = await deps.prepare(picked, busy, run)
        if (prep.kind === 'ended') {
            return { outcome: prep.outcome, cause: prep.cause }
        }
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
            return { outcome: 'unknown', cause: null }
        }
        if (end.kind === 'stopped') {
            return { outcome: end.outcome, cause: end.cause }
        }
        if (end.kind === 'unconfirmed') {
            return { outcome: 'unknown', cause: end.cause }
        }
        try {
            await deps.finish(prep.plan, prep.hold, end)
        } catch (error) {
            console.error(error)
            try {
                deps.wait(language.restoreSavedReloadOrRestart)
            } catch (alertError) {
                console.error(alertError)
            }
        }
        return { outcome: 'committed', cause: null }
    } finally {
        try {
            busy.end()
        } catch (error) {
            console.error(error)
        }
    }
}
