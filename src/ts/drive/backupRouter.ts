import { alertError } from '../alert'
import { language } from 'src/lang'
import { transportKind } from '../storage/tauriByteTransport'
import { refuseBackupLoadWhileBusy } from './backupWorkGuard'
import { LoadPickedLocalBackup } from './backuplocal'
import type { OperationOutcome } from './operationEnd'
import { classifyPrefix } from './rtb/sniff'

/**
 * The one backup entry in front of both restores (CHORE-128 S12c). It reads the first bytes of the picked file and routes by
 * content, never by extension or MIME:
 * - a RisuTanium `.rtb` (a plain or sealed `RTBX` file) goes to the `.rtb` restore;
 * - a file whose first entry header is a well-formed `.bin` entry goes to the `.bin` restore;
 * - anything else is turned away with a notice, and nothing is read further or written.
 *
 * Invariants:
 * - The `.bin` restore is reached only when `backupKindOf` says `bin`. A failed read, a short read, a rejection or an
 *   unknown result never falls through to it.
 * - The router writes nothing and opens no busy entry. Each restore opens its own.
 * - The picker opens in the caller's own turn: nothing is awaited before `click()`.
 * - Every promise returned here resolves; a rejection of a routed restore is reported as `failed`. That is honest only
 *   because the `.bin` restore never rejects and the `.rtb` restore rejects only before it replaces anything.
 */

/** The longest first entry name a `.bin` may have to be routed to the `.bin` restore. */
export const BIN_FIRST_NAME_MAX_BYTES = 4096
/** Bytes the router reads: the longest `.bin` first header; it also covers the `.rtb` sniff. */
export const BACKUP_PROBE_BYTES = 4 + BIN_FIRST_NAME_MAX_BYTES + 4

/** The two u32 fields of an entry header, the least a `.bin` entry can hold (an empty name and empty data). */
const BIN_HEADER_FLOOR_BYTES = 8

export type BackupKind = 'rtb' | 'bin' | 'not-a-backup'

/** The restores the router calls; tests replace them to observe what is routed where. */
export interface RouterDeps {
    loadBin(file: File): Promise<{ outcome: OperationOutcome }>
    loadRtb(file: File): Promise<{ outcome: OperationOutcome }>
}

function realRouterDeps(): RouterDeps {
    return {
        loadBin: (file) => LoadPickedLocalBackup(file),
        loadRtb: async (file) => {
            const { runRtbRestore, pickedRtbOf } = await import('./rtbRestoreEntry')
            return runRtbRestore(pickedRtbOf(file))
        },
    }
}

/**
 * Classifies a file from its first bytes. `prefix` is the first `min(size, BACKUP_PROBE_BYTES)` bytes and `size` the whole
 * file's length. The `.rtb` identification runs first, so a RisuTanium file never reaches the `.bin` rules.
 */
export function backupKindOf(prefix: Uint8Array, size: number): BackupKind {
    if (classifyPrefix(prefix).kind !== 'not-an-rtb') {
        return 'rtb'
    }
    if (size < BIN_HEADER_FLOOR_BYTES || prefix.length < BIN_HEADER_FLOOR_BYTES) {
        return 'not-a-backup'
    }
    const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength)
    const nameLength = view.getUint32(0, true)
    // Bounds the name to the probe and puts the name and the data-length field inside the file.
    if (BIN_HEADER_FLOOR_BYTES + nameLength > prefix.length) {
        return 'not-a-backup'
    }
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(prefix.subarray(4, 4 + nameLength))
    } catch {
        return 'not-a-backup'
    }
    const dataLength = view.getUint32(4 + nameLength, true)
    if (BIN_HEADER_FLOOR_BYTES + nameLength + dataLength > size) {
        return 'not-a-backup'
    }
    return 'bin'
}

/** Reads the probe prefix of `file` and classifies it; a failed or short read is `could-not-read`. Never rejects. */
export async function readBackupKind(file: Blob): Promise<BackupKind | 'could-not-read'> {
    try {
        const wanted = Math.min(file.size, BACKUP_PROBE_BYTES)
        const prefix = new Uint8Array(await file.slice(0, wanted).arrayBuffer())
        if (prefix.length !== wanted) {
            return 'could-not-read'
        }
        return backupKindOf(prefix, file.size)
    } catch (error) {
        console.error(error)
        return 'could-not-read'
    }
}

/** Reads the kind of an already picked file and runs its restore, with no picker. Never rejects. */
export async function routePickedBackup(file: File, deps: Partial<RouterDeps> = {}): Promise<{ outcome: OperationOutcome }> {
    const calls: RouterDeps = { ...realRouterDeps(), ...deps }
    const kind = await readBackupKind(file)
    try {
        switch (kind) {
            case 'bin':
                return await calls.loadBin(file)
            case 'rtb':
                return await calls.loadRtb(file)
            case 'not-a-backup':
                alertError(language.backupFileNotRecognized)
                return { outcome: 'nothing-replaced' }
            case 'could-not-read':
                alertError(language.backupFileUnreadable)
                return { outcome: 'nothing-replaced' }
        }
    } catch (error) {
        // Only a rejection that cannot follow a restore write reaches here: the `.bin` restore never rejects and the
        // `.rtb` restore rejects only before it replaces anything.
        console.error(error)
        alertError('Failed, Is file corrupted?')
        return { outcome: 'failed' }
    }
}

/**
 * Opens the picker and routes the picked file. Resolves once the restore ends, or at once when the person cancels. The
 * picker opens in this call's own turn, after the busy refusal; Android shows every file because its picker may grey out
 * the `.rtb` extension, and the content check makes any picked file safe.
 */
export function loadBackupFromPicker(deps: Partial<RouterDeps> = {}): Promise<{ outcome: OperationOutcome }> {
    let resolveEnd: (end: { outcome: OperationOutcome }) => void = () => { }
    const pending = new Promise<{ outcome: OperationOutcome }>((resolve) => { resolveEnd = resolve })
    const settle = (outcome: OperationOutcome): void => resolveEnd({ outcome })
    if (refuseBackupLoadWhileBusy()) {
        settle('nothing-replaced')
        return pending
    }
    try {
        const input = document.createElement('input')
        input.type = 'file'
        if (transportKind() !== 'android') {
            input.accept = '.bin,.rtb,application/vnd.risutanium.rtb'
        }
        // The handler awaits the whole route, so a caller that awaits `onchange` sees the restore finish.
        input.onchange = async () => {
            const file = input.files?.[0]
            input.remove()
            if (file === undefined) {
                settle('canceled')
                return
            }
            const end = await routePickedBackup(file, deps)
            settle(end.outcome)
        }
        input.addEventListener('cancel', () => {
            input.remove()
            settle('canceled')
        })
        input.click()
    } catch (error) {
        console.error(error)
        alertError('Failed, Is file corrupted?')
        settle('failed')
    }
    return pending
}
