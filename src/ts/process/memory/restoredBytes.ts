/**
 * What this page has read back from archived units: the inflated payload length
 * of every unit installed in place of a stub (once per install) or applied to a
 * chat, kept per `chaId` so the characters that stay inline can be left out.
 * Reads that install nothing never count. Reset only by a page load.
 */

const bytesByChaId = new Map<string, number>()

/**
 * The inflated payload length of a successful unit read, kept beside the result
 * object instead of on it, so the result's shape stays what every reader and
 * stand-in of the cold-storage module already agrees on. A result that did not
 * come from the real reader has no size.
 */
const readSizes = new WeakMap<object, number>()

export function noteReadSize(result: object, bytes: number): void {
    readSizes.set(result, bytes)
}

export function readSizeOf(result: object): number | undefined {
    return readSizes.get(result)
}

/** Adds `bytes` to what `chaId` has restored; a missing id or a size that is not positive adds nothing. */
export function noteRestoredBytes(chaId: string | undefined, bytes: number | undefined): void {
    if (!chaId || typeof bytes !== 'number' || !(bytes > 0)) {
        return
    }
    bytesByChaId.set(chaId, (bytesByChaId.get(chaId) ?? 0) + bytes)
}

export function restoredBytesOf(chaId: string): number {
    return bytesByChaId.get(chaId) ?? 0
}

/** The restored bytes of every character that is not in `keepInline`. */
export function restoredBytesOutside(keepInline: ReadonlySet<string> = new Set()): number {
    let total = 0
    for (const [chaId, bytes] of bytesByChaId) {
        if (!keepInline.has(chaId)) {
            total += bytes
        }
    }
    return total
}

export function resetRestoredBytesForTest(): void {
    bytesByChaId.clear()
}
