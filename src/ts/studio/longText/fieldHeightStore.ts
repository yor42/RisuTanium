import type { LongTextKind } from './fieldWrite'

/**
 * The height cap of a long-text field, kept per field kind on this device only. It is never part of the
 * database or a backup, and a storage that is missing, full or throwing just means "no stored cap".
 */

export const CAP_MIN_PX = 72
export const CAP_MAX_PX = 4000

const KEY_PREFIX = 'risuStudio.ltCap.'

function validCap(px: number): boolean {
    return Number.isFinite(px) && px >= CAP_MIN_PX && px <= CAP_MAX_PX
}

export function readCap(kind: LongTextKind): number | null {
    try {
        const raw = globalThis.localStorage.getItem(KEY_PREFIX + kind)
        if (raw === null || raw.trim() === '') return null
        const px = Number(raw)
        return validCap(px) ? px : null
    } catch {
        return null
    }
}

export function writeCap(kind: LongTextKind, px: number): void {
    if (!validCap(px)) return
    try {
        globalThis.localStorage.setItem(KEY_PREFIX + kind, String(Math.round(px)))
    } catch {
        // The cap is a convenience; a storage that refuses it changes nothing else.
    }
}
