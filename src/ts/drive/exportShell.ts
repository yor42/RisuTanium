/**
 * The export shell shared by the .bin export and the later .rtb export: the session a run carries, the
 * confirm and gesture steps that keep a cancel and the progress dialog consistent, and the runner that
 * reports every failure to the person together with what became of the output file (kept, deleted or
 * untouched).
 */
import { alertError, alertMd, alertNormal, alertNormalWait } from "../alert";
import { remove } from "@tauri-apps/plugin-fs";
import { cancelledFileState, webWriterNeedsGesture, type ExportByteWriter } from "../exportWriters";
import { ExportCancelledError, ExportCancelToken, createExportWaitGate, type ExportWaitGate } from "../exportCancel";
import { LocalWriter, TauriWriter } from "../globalApi.svelte";
import { isTauri } from "src/ts/platform"
import type { BusyHandle } from "../process/memory/busyActions";
import { ExportModuleUnreadableError } from "./exportModules";
import { ExportReadError } from "./inlayBackupExport";
import { openOutsideBusy } from "./exportDialogBusy";
import { language } from "src/lang";
import type { ExportFile, ExportOutcome } from "./operationEnd";
import { createExportTask, type ExportTask, type ExportTaskDef, type ExportTaskStepDef } from "../exportTask";

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

/** What a run reports while it works; a card-less run shows it as the export's wait dialog. */
export interface ExportProgress {
    /** The run moves to `step`; the wait dialog shows `text`, or nothing new when `text` is null. */
    phase(step: string, text: string | null): void
    /** The count line of `step`; the wait dialog shows `text`, or nothing new when `text` is null. */
    count(step: string, done: number, total: number, text: string | null): void
    /** The byte line of `step`; the wait dialog shows `text`, or nothing new when `text` is null. */
    bytes(step: string, done: number, total: number, text: string | null): void
    /** A covering alert prompt that will show: the wait dialog comes off first. */
    prompt<T>(ask: () => Promise<T>): Promise<T>
    /** A prompt drawn inside the page: the wait dialog comes off first. */
    sheet<T>(ask: () => Promise<T>): Promise<T>
    /** A native save dialog: the wait dialog stays. */
    dialog<T>(open: () => Promise<T>): Promise<T>
    /** The person dismissed the save dialog: the wait dialog comes off and nothing is reported. */
    dismissed(): void
    /** A clean save: `summary` joined by blank lines, as a plain notice. */
    done(summary: readonly string[]): void
    /** A save whose result is a report, posted as a notice of the given kind. */
    notice(kind: 'markdown' | 'normal', text: string): void
}

/** The progress of a card-less run: every report is today's wait dialog or prompt on `gate`. */
export function gateProgress(gate: ExportWaitGate): ExportProgress {
    return {
        phase(_step, text) {
            if (text !== null) {
                gate.wait(text)
            }
        },
        count(_step, _done, _total, text) {
            if (text !== null) {
                gate.wait(text)
            }
        },
        bytes(_step, _done, _total, text) {
            if (text !== null) {
                gate.wait(text)
            }
        },
        prompt(ask) {
            gate.clear()
            return ask()
        },
        sheet(ask) {
            gate.clear()
            return ask()
        },
        dialog(open) {
            return open()
        },
        dismissed() {
            gate.clear()
        },
        done(summary) {
            alertNormal(summary.join('\n\n'))
        },
        notice(kind, text) {
            if (kind === 'markdown') {
                alertMd(text)
            } else {
                alertNormal(text)
            }
        },
    }
}

/**
 * The progress of a run with a task card: reports move the card, and no wait dialog is ever posted. A plain alert prompt
 * leaves the card in the slot (the task host hides it while the alert is up); the leave-out sheet and a native save dialog
 * take it out of the slot until the run's next report. `first` is the card's first step, which a prompt re-reports until
 * another step was reached.
 */
export function cardProgress(task: ExportTask<string>, first: string): ExportProgress {
    let last = first
    const reach = (step: string): void => {
        last = step
        task.step(step)
    }
    return {
        phase(step) {
            reach(step)
        },
        count(step, done, total) {
            reach(step)
            task.count(done, total)
        },
        bytes(step, done, total) {
            reach(step)
            task.bytes(done, total)
        },
        prompt(ask) {
            // A card held aside by an earlier sheet comes back here, before the alert covers it.
            task.step(last)
            return ask()
        },
        sheet(ask) {
            return task.holdAside(ask)
        },
        dialog(open) {
            return isTauri ? task.holdAside(open) : open()
        },
        dismissed() {
            // The run's decline: `runExport` closes the card, and nothing is posted.
        },
        done(summary) {
            task.done(summary)
        },
        notice(kind, text) {
            // The card is gone before the report shows, and the report is posted even when a newer task replaced the card.
            task.close()
            if (kind === 'markdown') {
                alertMd(text)
            } else {
                alertNormal(text)
            }
        },
    }
}

/** The card of a run: its def, with the steps the run reports by id. */
export interface ExportShellCard {
    readonly def: ExportTaskDef<string> & { readonly steps: readonly ExportTaskStepDef<string>[] }
}

/** What a failed export needs to say: the file being written, and a way to name an asset. */
export interface ExportSession {
    writer: LocalWriter | null
    describeAsset: (key: string) => string
    /** The run's cancel switch; a cancel reaches the body at its next checkpoint and every pending write at once. */
    cancel: ExportCancelToken
    /** What the run reports while it works: the wait dialog of `gateProgress` for a card-less run (cancellable on the web, silent once cancelled), or the task card of `cardProgress`. */
    progress: ExportProgress
    /** The run's busy entry, when the caller registered one; `openOutsideBusy` marks it while a save dialog is open. */
    busy?: BusyHandle
}

/** The shared save-dialog helper lives in a leaf module so that callers outside the shell need not load its graph. */
export { openOutsideBusy };

/**
 * Asks `confirm` only if the export has not been cancelled. When `asks` says the confirm will really show a prompt, a
 * card-less run's wait dialog comes off the screen first, so the prompt is not hidden under a cancellable wait; a card
 * stays in the slot and the alert covers it through the task host's yield, and the leave-out sheet holds the card aside.
 * When the confirm will not prompt, the wait or card (and its Cancel) stays. A cancel seen once the answer is in ends the export.
 */
export async function confirmDuringExport(session: ExportSession, asks: boolean, confirm: () => Promise<boolean>, cover: 'alert' | 'sheet' = 'alert'): Promise<boolean> {
    session.cancel.throwIfCancelled()
    const answer = asks ? await (cover === 'sheet' ? session.progress.sheet(confirm) : session.progress.prompt(confirm)) : await confirm()
    session.cancel.throwIfCancelled()
    return answer
}

/**
 * Called as the last step before the writer opens. Where opening the writer needs a fresh user gesture (no browser
 * writer does now, since a plain-HTTP page holds the export in memory instead of opening a popup helper) and the size
 * passes and prompts before it have let the last one lapse, asks for a click whose handler is the open itself.
 * `needsGesture` is for a caller whose writer needs a fresh click at a different moment than the browser writer's open
 * (the streamed export asks right before its download starts).
 */
export async function ensureGestureForWriter(session: ExportSession, needsGesture: boolean = webWriterNeedsGesture()): Promise<void> {
    if (needsGesture && globalThis.navigator?.userActivation?.isActive === false) {
        session.cancel.throwIfCancelled()
        await session.progress.prompt(() => alertNormalWait(language.backupReadyToSave()))
        session.cancel.throwIfCancelled()
    }
}

/**
 * Runs a full or partial export so that no failure of it ends unreported: the
 * person is told that the backup failed, whether the output file is gone, and
 * that it must not be used if it is not. The output file is removed only when
 * this export wrote to a desktop file; a desktop file this export did not
 * touch is left as it was. A web or Node stream is aborted, not removed.
 * A run reports on the task card when `card` is given, otherwise on a wait dialog. The card ends on done, cancelled or
 * failed, or is closed without an ending when the run declines; `finally` closes it, which is a no-op after an ending.
 * A web export offers a Cancel on its card or wait dialog (a desktop export does not). A cancel is the person's choice, not a
 * failure: it reports nothing as failed, and says so when a download stream had opened, because the browser may
 * already hold an incomplete file. The notice is on screen before this resolves, so the caller's next prompt waits for it.
 * Returns how the export ended; a caller that does not care may ignore it.
 */
export async function runExport(body: (session: ExportSession) => Promise<ExportOutcome>, busy?: BusyHandle, card: ExportShellCard | null = null): Promise<ExportOutcome> {
    const cancel = new ExportCancelToken()
    const task = card === null ? null : createExportTask({ ...card.def, cancelledFileKeptNotice: language.backupCancelledFileIncomplete })
    const progress = card === null || task === null ? gateProgress(createExportWaitGate(cancel, !isTauri)) : cardProgress(task, card.def.steps[0].id)
    if (task !== null) {
        // Cancel is offered on the web only, as the wait dialog's was.
        task.useToken(isTauri ? null : cancel)
        task.open()
    }
    const session: ExportSession = { writer: null, describeAsset: (key) => `'${key}'`, cancel, progress, busy }
    try {
        return await body(session)
    } catch (error) {
        if (cancel.cancelled || error instanceof ExportCancelledError) {
            const file = cancelledFileState(session.writer?.writer)
            if (task !== null) {
                task.cancelled(file === 'kept')
            } else if (file === 'kept') {
                alertNormal(language.backupCancelledFileIncomplete)
            }
            return { status: 'declined', cause: 'export-cancelled', file }
        }
        console.error(error)
        const file = await discardFailedExportFile(session.writer?.writer, error)
        const text = failedExportText(session, error, file)
        if (task !== null) {
            task.failedWith(text, file === 'kept')
        } else {
            alertError(text)
        }
        return { status: 'failed', cause: error, file }
    } finally {
        // A no-op after an ending; removes the card of a declined run.
        task?.close()
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

/** The text of a failed export's report, from the error and what became of the output file. */
export function failedExportText(session: ExportSession, error: unknown, file: ExportFile): string {
    if (error instanceof BackupAssetTooLargeError) {
        return language.backupFailedAssetTooLarge(session.describeAsset(error.key), file)
    }
    if (error instanceof ExportModuleUnreadableError) {
        return language.backupFailedModuleUnreadable(error.moduleName, error.reason)
    }
    const asset = error instanceof BackupAssetChangedError || error instanceof ExportReadError ? session.describeAsset(error.key) : null
    if (file === 'untouched') {
        return language.backupFailedNothingWritten()
    }
    if (file === 'deleted') {
        return language.backupFailedFileDeleted(asset)
    }
    return language.backupFailedFileKept(asset)
}

export async function reportFailedExport(session: ExportSession, error: unknown): Promise<ExportFile> {
    const file = await discardFailedExportFile(session.writer?.writer, error)
    alertError(failedExportText(session, error, file))
    return file
}

/** Opens the writer, with the busy entry marked while a save dialog may be open and the dialog reported to the run's progress. */
export function openWriterOutsideBusy<T>(session: ExportSession, open: () => Promise<T>): Promise<T> {
    return openOutsideBusy(session.busy, () => session.progress.dialog(open))
}
