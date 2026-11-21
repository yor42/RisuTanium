/**
 * Data Sheets
 *
 * The state the Data page's sheets and action rows share. The page mounts one host that registers here; a flow asks
 * for a sheet through this module and waits for the answer. A request that cannot be shown, or whose host goes
 * away while it waits, resolves `null`, never a decline, so the caller can tell "nobody answered" from "no".
 *
 * Component-free and engine-free: it imports no component and no export or restore module.
 */

import type { PatternWarningDef } from '../../lib/Nexus/pattern/patternWarning';
import type { BinLeaveOutEntry } from '../drive/binLeaveOut';
import { leaveOutSheetDef } from './dataLeaveOutSheet';

export type BackupFormat = 'rtb' | 'bin';
/** A `.rtb` is whole or settings only; a `.bin` is whole or without character assets. */
export type RtbScope = 'full' | 'settings';
export type BinScope = 'full' | 'partial';
export type BackupScope = RtbScope | BinScope;

/**
 * What the chooser answers. Only a `.rtb` can carry a password, whatever its scope; a `.bin` never encrypts, so its
 * answer has none. The password is the text exactly as typed and lives only in this answer, never in the sheet state.
 */
export type BackupChoice =
    | { format: 'rtb'; scope: RtbScope; password?: string }
    | { format: 'bin'; scope: BinScope; password?: never };

/** What a person chose on the leave-out sheet: continue with the `.bin`, make an `.rtb` instead, or stop. */
export type LeaveOutAnswer = 'bin' | 'rtb' | 'cancel';

/** The chooser request the host shows. `answer` settles the promise handed to the asker. */
export interface PendingBackupChoice {
    trigger: HTMLElement | null;
    answer: (choice: BackupChoice | null) => void;
}

/** The leave-out request the host shows. The definition is built before the request is published. */
export interface PendingLeaveOut {
    def: PatternWarningDef;
    trigger: HTMLElement | null;
    answer: (answer: LeaveOutAnswer | null) => void;
}

interface DataSheetState {
    /** The chooser the host shows, or null. */
    pending: PendingBackupChoice | null;
    /** The leave-out sheet the host shows, or null. */
    pendingLeaveOut: PendingLeaveOut | null;
    /** True while a Data action runs: every action row ignores taps and reports itself disabled. */
    running: boolean;
    /** What the last saved `.bin` left out, as one line for the backup row; null until a run that had a sheet answer. */
    lastBinLeftOut: string | null;
}

/** One state object whose properties change; a module cannot export reassigned state. */
export const dataSheetState: DataSheetState = $state({ pending: null, pendingLeaveOut: null, running: false, lastBinLeftOut: null });

let hosts = 0;

/** A host announces itself while it is mounted. The returned function withdraws it and settles pending requests `null`. */
export function registerDataSheetHost(): () => void {
    hosts += 1;
    let registered = true;
    return () => {
        if (!registered) return;
        registered = false;
        hosts -= 1;
        if (hosts === 0) {
            settlePending(null);
            settleLeaveOut(null);
        }
    };
}

function settlePending(choice: BackupChoice | null): void {
    const request = dataSheetState.pending;
    if (request === null) return;
    dataSheetState.pending = null;
    request.answer(choice);
}

function settleLeaveOut(answer: LeaveOutAnswer | null): void {
    const request = dataSheetState.pendingLeaveOut;
    if (request === null) return;
    dataSheetState.pendingLeaveOut = null;
    request.answer(answer);
}

/**
 * Asks which backup to make. Resolves `null` when no host is registered, when a request is already pending, when
 * the person cancels, or when the host goes away while the sheet is open; nothing is started in any of those cases.
 */
export function askBackupChoice(trigger: HTMLElement | null = null): Promise<BackupChoice | null> {
    if (hosts === 0 || dataSheetState.pending !== null || dataSheetState.pendingLeaveOut !== null) return Promise.resolve(null);
    return new Promise<BackupChoice | null>((resolve) => {
        dataSheetState.pending = { trigger, answer: resolve };
    });
}

/** The host's answer to the pending chooser; `null` is Cancel, Escape or Back. */
export function answerBackupChoice(choice: BackupChoice | null): void {
    settlePending(choice);
}

/**
 * Asks what to do about the data a `.bin` leaves out. Resolves `null` when no host is registered, when a request is
 * already pending, or when the host goes away while the sheet is open: nobody answered, so the export asks its per-kind
 * questions instead. Only a button, Escape or Back gives `'cancel'`. The sheet's definition is built first, so a
 * definition that cannot be built rejects here, before any request is published.
 */
export function askLeaveOutAnswer(summary: readonly BinLeaveOutEntry[], trigger: HTMLElement | null = null): Promise<LeaveOutAnswer | null> {
    const def = leaveOutSheetDef(summary);
    if (hosts === 0 || dataSheetState.pending !== null || dataSheetState.pendingLeaveOut !== null) return Promise.resolve(null);
    return new Promise<LeaveOutAnswer | null>((resolve) => {
        dataSheetState.pendingLeaveOut = { def, trigger, answer: resolve };
    });
}

/** The host's answer to the pending leave-out sheet. */
export function answerLeaveOut(answer: LeaveOutAnswer): void {
    settleLeaveOut(answer);
}

/**
 * Runs one Data action and holds `running` for its duration, clearing it however the action ends, including a
 * restore that may reload the page. A call while another action runs does nothing and resolves `undefined`.
 */
export async function runDataAction<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (dataSheetState.running) return undefined;
    dataSheetState.running = true;
    try {
        return await action();
    } finally {
        dataSheetState.running = false;
    }
}
