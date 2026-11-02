import { language } from "../lang";
import { isTauri } from "./platform";

/**
 * The success notice that follows a file export. A browser only starts the download and may still ask the
 * user to confirm or keep it, so the web build never claims the file was saved; Tauri writes the file itself
 * and keeps the saved wording. Both texts are read at call time so a language switch applies.
 */
export function downloadNotice(savedText: string, startedText: string = language.exportDownloadStarted): string {
    return isTauri ? savedText : startedText
}

export type BackupNoticeKind = 'full' | 'partial'
export type BackupNoticeReason = 'missing' | 'leftOut' | 'none'

const TAURI_BACKUP_HEADERS: Record<BackupNoticeKind, Record<BackupNoticeReason, string>> = {
    full: {
        missing: 'Backup Successful, but the following assets were missing and skipped:\n\n',
        leftOut: 'Backup Successful, but some data could not be included:\n\n',
        none: 'Backup Successful.\n\n',
    },
    partial: {
        missing: 'Partial backup successful, but the following profile images were missing and skipped:\n\n',
        leftOut: 'Partial backup successful, but some data could not be included:\n\n',
        none: 'Partial backup successful.\n\n',
    },
}

/** The first lines of a backup notice that lists what was left out; Tauri keeps its literal text byte for byte. */
export function backupNoticeHeader(kind: BackupNoticeKind, reason: BackupNoticeReason): string {
    if (isTauri) {
        return TAURI_BACKUP_HEADERS[kind][reason]
    }
    if (reason === 'none') {
        return `${language.exportDownloadStarted}\n\n`
    }
    const reasonText = reason === 'missing'
        ? (kind === 'full' ? language.backupAssetsMissingSkipped : language.partialBackupImagesMissingSkipped)
        : language.backupDataLeftOut
    return `${language.exportDownloadStarted}\n\n${reasonText}\n\n`
}
