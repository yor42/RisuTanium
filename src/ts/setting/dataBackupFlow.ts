/**
 * Data Backup Flow
 *
 * What "Make a backup" does with the chooser's answer. The engines arrive as injected functions so the choice
 * logic stays testable without them; the row supplies the live ones by dynamic import at click time.
 *
 * Component-free and engine-free: the engines are type imports only.
 */

import type { BackupExportOptions } from '../drive/backuplocal';
import type { ExportOutcome } from '../drive/operationEnd';
import type { RtbExportResult } from '../drive/rtbExport';
import type { BinLeaveOutEntry } from '../drive/binLeaveOut';
import { language } from '../../lang';
import { leftOutKindLabels } from './dataLeaveOutSheet';
import type { BackupChoice, LeaveOutAnswer } from './dataSheets.svelte';

/** Entry facts for a partial `.bin`: the chooser already told the person what a partial backup leaves out. */
export interface PartialBinEntry {
    assetsExplained: boolean;
}

export interface DataBackupDeps {
    chooseBackup: () => Promise<BackupChoice | null>;
    saveBin: (options: BackupExportOptions) => Promise<ExportOutcome>;
    savePartialBin: (options: BackupExportOptions, entry: PartialBinEntry) => Promise<ExportOutcome>;
    /** `password` is set only for a sealed `.rtb`; the leave-out "Make .rtb instead" path calls this with no argument. */
    startRtb: (password?: string) => Promise<RtbExportResult | null>;
    /** Shows the leave-out sheet; `null` means nobody answered it. */
    askLeaveOut: (summary: readonly BinLeaveOutEntry[]) => Promise<LeaveOutAnswer | null>;
    /** Sets, or with `null` clears, the line under the backup row that repeats what the last `.bin` left out. */
    setLeftOut: (text: string | null) => void;
}

/**
 * Asks which backup to make and runs it. A cancelled or unanswered chooser runs nothing. A `.bin` hands the export a
 * leave-out question; the `.rtb` runs only when the person chose "Make .rtb instead" and the export declined for that
 * reason, never after a saved file or any other decline. The line of what was left out is set only for a saved `.bin`
 * the person answered, and a new run clears it.
 */
export async function runDataBackup(deps: DataBackupDeps): Promise<void> {
    deps.setLeftOut(null);
    const choice = await deps.chooseBackup();
    if (choice === null) return;
    if (choice.format === 'rtb') {
        await deps.startRtb(choice.password);
        return;
    }
    const seen: { answer: LeaveOutAnswer | null, summary: readonly BinLeaveOutEntry[] } = { answer: null, summary: [] };
    const options: BackupExportOptions = {
        askLeaveOut: async (summary) => {
            seen.summary = summary;
            seen.answer = await deps.askLeaveOut(summary);
            return seen.answer === null ? null : seen.answer === 'bin';
        },
    };
    const outcome = choice.scope === 'partial'
        ? await deps.savePartialBin(options, { assetsExplained: true })
        : await deps.saveBin(options);
    if (seen.answer === 'rtb' && outcome.status === 'declined' && outcome.cause === 'incomplete-data-declined') {
        await deps.startRtb();
        return;
    }
    if (seen.answer === 'bin' && outcome.status === 'saved') {
        deps.setLeftOut(language.settingsShellDataLeftOutRepeat(leftOutKindLabels(seen.summary).join(', ')));
    }
}
