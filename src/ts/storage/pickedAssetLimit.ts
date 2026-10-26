import { language } from 'src/lang'
import { alertError } from '../alert'

/**
 * The size rule for a file the user picks as an asset. This module imports the alert module (it shows the refusal),
 * but no store code: the limit is passed in, read from the page's store by `pickedAssetLimitBytes` in globalApi.
 */

const BYTES_PER_MIB = 1024 * 1024

/**
 * A picked file is larger than the page's asset limit. The message is the translated notice, so an error that escapes to
 * the global rejection handler still shows the user the real text.
 */
export class AssetTooLargeError extends Error {
    readonly fileNames: readonly string[]
    readonly limitBytes: number

    constructor(fileNames: readonly string[], limitBytes: number) {
        super(assetTooLargeMessage(fileNames, limitBytes))
        this.name = 'AssetTooLargeError'
        this.fileNames = fileNames
        this.limitBytes = limitBytes
    }
}

/** The notice for files refused by the limit; the limit is shown in whole MB. */
export function assetTooLargeMessage(fileNames: readonly string[], limitBytes: number): string {
    return language.assetFilesTooLargeForLimit([...fileNames], Math.floor(limitBytes / BYTES_PER_MIB))
}

/**
 * Splits a pick into the files within the limit and the refused ones, each in pick order. A file of exactly the limit is
 * accepted, as the importers and the inlay limit do.
 */
export function splitByAssetLimit<T extends { name: string, size: number }>(files: readonly T[], limitBytes: number): { within: T[], refused: T[] } {
    const within: T[] = []
    const refused: T[] = []
    for (const file of files) {
        if (file.size > limitBytes) {
            refused.push(file)
        } else {
            within.push(file)
        }
    }
    return { within, refused }
}

/** Shows one notice naming every refused file; shows nothing when none was refused. */
export function reportRefusedAssets(refused: readonly { name: string }[], limitBytes: number): void {
    if (refused.length === 0) {
        return
    }
    alertError(assetTooLargeMessage(refused.map((file) => file.name), limitBytes))
}

/**
 * Logs the refused files when a later save of the same pick failed. The alert holds one message and the save error
 * owns it, so the refusal is recorded in the console instead; the refused files were never touched.
 */
export function warnRefusedAssets(refused: readonly { name: string }[], limitBytes: number): void {
    if (refused.length === 0) {
        return
    }
    console.warn(assetTooLargeMessage(refused.map((file) => file.name), limitBytes))
}

/** Throws `AssetTooLargeError` for a Blob above the limit, before any byte of it is read. */
export function assertBlobWithinAssetLimit(blob: Blob, displayName: string, limitBytes: number): void {
    if (blob.size > limitBytes) {
        throw new AssetTooLargeError([displayName], limitBytes)
    }
}
