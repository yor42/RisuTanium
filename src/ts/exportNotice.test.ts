/**
 * `downloadNotice` and `backupNoticeHeader` (`src/ts/exportNotice.ts`): the web build says a download
 * started, Tauri keeps the saved wording byte for byte. Only the platform flag is mocked; the language is real.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const platformBox = vi.hoisted(() => ({ isTauri: false }))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
}) as unknown as typeof import('src/ts/platform'))

import { language } from 'src/lang'
import { backupNoticeHeader, downloadNotice, type BackupNoticeKind, type BackupNoticeReason } from './exportNotice'

beforeEach(() => {
    platformBox.isTauri = false
})

describe('downloadNotice', () => {
    test('on the web it returns the download-started text, not the saved text', () => {
        expect(downloadNotice(language.successExport)).toBe(language.exportDownloadStarted)
        expect(downloadNotice('Success')).toBe(language.exportDownloadStarted)
    })

    test('on desktop it returns the saved text unchanged', () => {
        platformBox.isTauri = true
        expect(downloadNotice(language.successExport)).toBe(language.successExport)
        expect(downloadNotice('Success')).toBe('Success')
    })

    test('an explicit web text replaces the default and the desktop keeps the saved text', () => {
        expect(downloadNotice(language.settingsExported, language.settingsReportDownloadStarted)).toBe(language.settingsReportDownloadStarted)
        platformBox.isTauri = true
        expect(downloadNotice(language.settingsExported, language.settingsReportDownloadStarted)).toBe(language.settingsExported)
    })
})

describe('backupNoticeHeader', () => {
    const TAURI_LITERALS: [BackupNoticeKind, BackupNoticeReason, string][] = [
        ['full', 'missing', 'Backup Successful, but the following assets were missing and skipped:\n\n'],
        ['full', 'leftOut', 'Backup Successful, but some data could not be included:\n\n'],
        ['full', 'none', 'Backup Successful.\n\n'],
        ['partial', 'missing', 'Partial backup successful, but the following profile images were missing and skipped:\n\n'],
        ['partial', 'leftOut', 'Partial backup successful, but some data could not be included:\n\n'],
        ['partial', 'none', 'Partial backup successful.\n\n'],
    ]

    test.each(TAURI_LITERALS)('desktop %s/%s keeps the old literal byte for byte', (kind, reason, literal) => {
        platformBox.isTauri = true
        expect(backupNoticeHeader(kind, reason)).toBe(literal)
    })

    test('on the web every header starts with the download-started text and ends with a blank line', () => {
        for (const [kind, reason] of TAURI_LITERALS) {
            const header = backupNoticeHeader(kind, reason)
            expect(header.startsWith(language.exportDownloadStarted)).toBe(true)
            expect(header.endsWith('\n\n')).toBe(true)
            expect(header).not.toMatch(/Successful|successful/)
        }
    })

    test('on the web the reason text follows the started text', () => {
        expect(backupNoticeHeader('full', 'none')).toBe(`${language.exportDownloadStarted}\n\n`)
        expect(backupNoticeHeader('full', 'missing')).toBe(`${language.exportDownloadStarted}\n\n${language.backupAssetsMissingSkipped}\n\n`)
        expect(backupNoticeHeader('full', 'leftOut')).toBe(`${language.exportDownloadStarted}\n\n${language.backupDataLeftOut}\n\n`)
        expect(backupNoticeHeader('partial', 'missing')).toBe(`${language.exportDownloadStarted}\n\n${language.partialBackupImagesMissingSkipped}\n\n`)
        expect(backupNoticeHeader('partial', 'leftOut')).toBe(`${language.exportDownloadStarted}\n\n${language.backupDataLeftOut}\n\n`)
        expect(backupNoticeHeader('partial', 'none')).toBe(`${language.exportDownloadStarted}\n\n`)
    })
})
