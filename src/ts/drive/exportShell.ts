/**
 * The export shell shared by the .bin export and the later .rtb export: the session a run carries, the
 * confirm and gesture steps that keep a cancel and the progress dialog consistent, and the runner that
 * reports every failure to the person together with what became of the output file (kept, deleted or
 * untouched).
 */
import { alertError, alertNormal, alertNormalWait } from "../alert";
import { remove } from "@tauri-apps/plugin-fs";
import { cancelledFileState, webWriterNeedsGesture, type ExportByteWriter } from "../exportWriters";
import { ExportCancelledError, ExportCancelToken, createExportWaitGate, type ExportWaitGate } from "../exportCancel";
import { LocalWriter, TauriWriter } from "../globalApi.svelte";
import { isTauri } from "src/ts/platform"
import type { BusyHandle } from "../process/memory/busyActions";
import { ExportModuleUnreadableError } from "./exportModules";
import { ExportReadError } from "./inlayBackupExport";
import { language } from "src/lang";
import type { ExportFile, ExportOutcome } from "./operationEnd";

/**
 * An asset of a full or partial export could not be read to its end after its
 * entry header was written, so the entry cannot be completed and the file
 * being written is unusable.
 */
export class BackupAssetChangedError extends Error {
    constructor(public readonly key: string, cause: unknown) {
        super(`The asset ${key} changed or could not be read while it was being saved`, { cause })
        this.name = 'BackupAssetChangedError'
    }
}

/**
 * An asset is larger than a backup entry can hold: the container stores an
 * entry's length in 32 bits, and a larger length would wrap into an entry no
 * reader can parse. Running the export again fails the same way.
 */
export class BackupAssetTooLargeError extends Error {
    constructor(public readonly key: string, public readonly size: number) {
        super(`The asset ${key} is ${size} bytes, more than a backup entry can hold`)
        this.name = 'BackupAssetTooLargeError'
    }
}

/** What a failed export needs to say: the file being written, and a way to name an asset. */
export interface ExportSession {
    writer: LocalWriter | null
    describeAsset: (key: string) => string
    /** The run's cancel switch; a cancel reaches the body at its next checkpoint and every pending write at once. */
    cancel: ExportCancelToken
    /** The run's progress dialog: cancellable on the web, silent once cancelled. */
    gate: ExportWaitGate
    /** The run's busy entry, when the caller registered one; `openOutsideBusy` marks it while a save dialog is open. */
    busy?: BusyHandle
}

/** The shared save-dialog helper lives in a leaf module so that callers outside the shell need not load its graph. */
export { openOutsideBusy } from "./exportDialogBusy";

/**
 * Asks `confirm` only if the export has not been cancelled. When `asks` says the confirm will really show a prompt, the
 * export's own wait comes off the screen first, so the prompt is not hidden under a cancellable wait; when it will not,
 * the wait (and its Cancel) stays. A cancel seen once the answer is in ends the export.
 */
export async function confirmDuringExport(session: ExportSession, asks: boolean, confirm: () => Promise<boolean>): Promise<boolean> {
    session.cancel.throwIfCancelled()
    if (asks) {
        session.gate.clear()
    }
    const answer = await confirm()
    session.cancel.throwIfCancelled()
    return answer
}

/**
 * Called as the last step before the writer opens. Where opening the browser writer needs a fresh user gesture (the
 * popup helper of a plain-HTTP page) and the size passes and prompts before it have let the last one lapse, asks for a
 * click whose handler is the open itself. `needsGesture` is for a caller whose writer needs a fresh click at a different
 * moment than the browser writer's open (the streamed export asks right before its download starts).
 */
export async function ensureGestureForWriter(session: ExportSession, needsGesture: boolean = webWriterNeedsGesture()): Promise<void> {
    if (needsGesture && globalThis.navigator?.userActivation?.isActive === false) {
        session.cancel.throwIfCancelled()
        session.gate.clear()
        await alertNormalWait(language.backupReadyToSave())
        session.cancel.throwIfCancelled()
    }
}

/**
 * Runs a full or partial export so that no failure of it ends unreported: the
 * person is told that the backup failed, whether the output file is gone, and
 * that it must not be used if it is not. The output file is removed only when
 * this export wrote to a desktop file; a desktop file this export did not
 * touch is left as it was. A web or Node stream is aborted, not removed.
 * A web export offers a Cancel on its progress dialog (a desktop export does not). A cancel is the person's choice, not a
 * failure: it reports nothing as failed, and says so when a download stream had opened, because the browser may
 * already hold an incomplete file. The notice is on screen before this resolves, so the caller's next prompt waits for it.
 * Returns how the export ended; a caller that does not care may ignore it.
 */
export async function runExport(body: (session: ExportSession) => Promise<ExportOutcome>, busy?: BusyHandle): Promise<ExportOutcome> {
    const cancel = new ExportCancelToken()
    const session: ExportSession = { writer: null, describeAsset: (key) => `'${key}'`, cancel, gate: createExportWaitGate(cancel, !isTauri), busy }
    try {
        return await body(session)
    } catch (error) {
        if (cancel.cancelled || error instanceof ExportCancelledError) {
            const file = cancelledFileState(session.writer?.writer)
            if (file === 'kept') {
                alertNormal(language.backupCancelledFileIncomplete)
            }
            return { status: 'declined', cause: 'export-cancelled', file }
        }
        console.error(error)
        const file = await reportFailedExport(session, error)
        return { status: 'failed', cause: error, file }
    }
}

/**
 * Gives up the file of a failed export and says what is left of it: `untouched`
 * when no file was produced (a desktop file the export never wrote to, or a web
 * writer that holds everything in memory), `deleted` when the incomplete desktop
 * file was removed, and `kept` when an incomplete file may remain: a desktop
 * file that could not be removed, or a download stream that may already have
 * reached the browser.
 */
export async function discardFailedExportFile(target: ExportByteWriter | undefined, error: unknown): Promise<'untouched' | 'deleted' | 'kept'> {
    if (target === undefined) {
        return 'untouched'
    }
    if (target instanceof TauriWriter) {
        if (!target.touchedFile) {
            return 'untouched'
        }
        try {
            await remove(target.path)
        } catch (removeError) {
            console.error(removeError)
            return 'kept'
        }
        return 'deleted'
    }
    const heldInMemory = target.heldInMemory === true
    try {
        await target.abort?.(error)
    } catch (abortError) {
        console.error(abortError)
    }
    return heldInMemory ? 'untouched' : 'kept'
}

export async function reportFailedExport(session: ExportSession, error: unknown): Promise<ExportFile> {
    const file = await discardFailedExportFile(session.writer?.writer, error)
    if (error instanceof BackupAssetTooLargeError) {
        alertError(language.backupFailedAssetTooLarge(session.describeAsset(error.key), file))
        return file
    }
    if (error instanceof ExportModuleUnreadableError) {
        alertError(language.backupFailedModuleUnreadable(error.moduleName, error.reason))
        return file
    }
    const asset = error instanceof BackupAssetChangedError || error instanceof ExportReadError ? session.describeAsset(error.key) : null
    if (file === 'untouched') {
        alertError(language.backupFailedNothingWritten())
    } else if (file === 'deleted') {
        alertError(language.backupFailedFileDeleted(asset))
    } else {
        alertError(language.backupFailedFileKept(asset))
    }
    return file
}
