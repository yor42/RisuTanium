import { invoke } from '@tauri-apps/api/core'
import { tauriAddressableViolation, tauriCreatableViolation } from './store/keyRules'
import { StoreInvalidKeyError } from './store/errors'
import { isPreBlocksKey } from './mainFileFingerprint'
import { readFlushed, shouldChunkWrite, writeChunked } from './tauriByteTransport'

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
 * by the command and does not reject; it is reported as `flushed: false` in the
 * resolved value (see `writeFileDurable`).
 *
 * The key travels percent-encoded in a header and the bytes as the raw request
 * body: a JSON argument would serialise the bytes as a number array. A body the
 * platform's IPC cannot carry in one call (every body on Android, a body above
 * `CHUNK_MAX` on desktop) goes as chunks instead (`writeChunked` in
 * `tauriByteTransport.ts`) with the same guarantees.
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
 * The kinds of key written durably: block-store keys, numbered backups,
 * cold-storage units, the A-lite unit, commit and fence keys (`store2/`,
 * `store2-commit`, `store2-fence`) and the pre-conversion copies of the main
 * file (the main file is deleted once such a copy holds its bytes, so the copy
 * must be on disk first). Assets, the main file, `store2-sweep` and every other
 * key keep the plain atomic write.
 */
export function isDurableKey(key: string): boolean {
    return key.startsWith('blocks/') || key.startsWith('coldstorage/') || NUMBERED_BACKUP_KEY.test(key) || isPreBlocksKey(key)
        || key.startsWith('store2/') || key === 'store2-commit' || key === 'store2-fence'
}

/** The key rules of the strictest platform; the same set the command applies. */
function refusal(key: string): string | null {
    return tauriCreatableViolation(key) ?? tauriAddressableViolation(key, 'windows')
}

/**
 * Resolves with whether every directory flush after the rename succeeded:
 * `false` means the bytes are written but the directory entry may not survive
 * power loss (the write did not reject). `undefined` when the command answered
 * no status (an older shape); never `true` without an answer.
 */
export async function writeFileDurable(key: string, bytes: Uint8Array): Promise<boolean | undefined> {
    const reason = refusal(key)
    if (reason !== null) {
        throw new StoreInvalidKeyError(key, reason)
    }
    if (shouldChunkWrite(bytes.length)) {
        return await writeChunked(key, bytes, true)
    }
    const answer = await invoke<unknown>(DURABLE_WRITE_COMMAND, bytes, {
        headers: { [DURABLE_KEY_HEADER]: encodeURIComponent(key) },
    })
    return readFlushed(answer)
}
