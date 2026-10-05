import { invoke } from '@tauri-apps/api/core'
import { tauriAddressableViolation, tauriCreatableViolation } from './store/keyRules'
import { StoreInvalidKeyError } from './store/errors'
import { isAndroidTransport, writeChunked } from './tauriByteTransport'

/**
 * Durable file replacement on the Tauri file system, for keys under the AppData
 * directory.
 *
 * `writeFileDurable` hands the key and the bytes to the `write_durable` Rust
 * command (`src-tauri/src/durable_write.rs`). The command writes a temp file in
 * the key's directory, flushes it to the file system, renames it over the
 * target and flushes the directory. A resolved call means the target holds
 * `bytes` and those bytes were flushed before the rename; a rejection means the
 * target was not replaced. A failed directory flush after the rename is logged
 * by the command and does not reject.
 *
 * The key travels percent-encoded in a header and the bytes as the raw request
 * body: a JSON argument would serialise the bytes as a number array. On Android
 * the bridge cannot carry a large body, so the same write goes as base64 chunks
 * (`writeChunked` in `tauriByteTransport.ts`) with the same guarantees.
 *
 * The command repeats the key rules, so a key refused here and a key refused
 * there are the same keys. The helper takes no lock; callers keep their own
 * write ordering.
 */

export const DURABLE_WRITE_COMMAND = 'write_durable'

/** The header that carries the key; the command reads the same name. */
export const DURABLE_KEY_HEADER = 'x-risu-key'

const NUMBERED_BACKUP_KEY = /^database\/dbbackup-\d+\.bin$/

/**
 * The kinds of key written durably: block-store keys, numbered backups and
 * cold-storage units. Assets, the main file and every other key keep the plain
 * atomic write.
 */
export function isDurableKey(key: string): boolean {
    return key.startsWith('blocks/') || key.startsWith('coldstorage/') || NUMBERED_BACKUP_KEY.test(key)
}

/** The key rules of the strictest platform; the same set the command applies. */
function refusal(key: string): string | null {
    return tauriCreatableViolation(key) ?? tauriAddressableViolation(key, 'windows')
}

export async function writeFileDurable(key: string, bytes: Uint8Array): Promise<void> {
    const reason = refusal(key)
    if (reason !== null) {
        throw new StoreInvalidKeyError(key, reason)
    }
    if (isAndroidTransport()) {
        await writeChunked(key, bytes, true)
        return
    }
    await invoke<void>(DURABLE_WRITE_COMMAND, bytes, {
        headers: { [DURABLE_KEY_HEADER]: encodeURIComponent(key) },
    })
}
