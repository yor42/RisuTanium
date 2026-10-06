import { BaseDirectory, exists, readDir, remove, rename, writeFile } from '@tauri-apps/plugin-fs'
import { shouldChunkWrite, writeChunked } from './tauriByteTransport'

/**
 * Atomic file replacement on the Tauri file system, for paths under the
 * AppData directory.
 *
 * `tauri-plugin-fs` `writeFile` opens its target with truncate before it writes
 * the body, so a failed or interrupted write leaves the target empty or cut.
 * `writeFileAtomic` never opens the target: it writes the body to a new file in
 * the target's own directory and renames that file over the target. The target
 * therefore holds either its complete old bytes or the complete new bytes, and
 * a rejection means the target was not replaced.
 *
 * The helper takes no lock; callers keep their own write ordering. It does not
 * flush to disk, so it protects against a failed or interrupted write, not
 * against power loss.
 *
 * A body the platform's IPC cannot carry in one call (every body on Android,
 * a body above `CHUNK_MAX` on desktop) goes as chunks into a temp file of the
 * same name pattern and a rename on the last chunk (`writeChunked` in
 * `tauriByteTransport.ts`), again without a flush.
 */

/**
 * The name of a temporary file: never starts with `.` (the file system scope
 * refuses a leading-dot name on macOS and Linux) and never contains `dbbackup-`
 * (every reader of `database/` lists backups by that name). A name matching
 * this pattern is either the temp file of a `writeFileAtomic` still in flight
 * or the leftover of an interrupted one.
 */
export const ATOMIC_TEMP_NAME_PATTERN = /^risu-write-[0-9a-f]{16}\.tmp$/

/** Waits before each retry of a rename that a competing handle blocked. */
const RENAME_RETRY_DELAYS_MS: readonly number[] = [50, 100, 200, 400]

/**
 * Windows reports a rename blocked by another handle as ERROR_ACCESS_DENIED
 * (os error 5) or ERROR_SHARING_VIOLATION (os error 32). The plugin rejects
 * with a plain string whose system message is localized, so only the
 * `(os error N)` suffix is read.
 */
const RETRYABLE_RENAME_ERROR = /\(os error (5|32)\)$/

/** The temp file already existed: it is not this call's file. ERROR_FILE_EXISTS on Windows, EEXIST elsewhere. */
const TEMP_ALREADY_EXISTS_ERROR = /\(os error (17|80)\)$/

function errorText(error: unknown): string {
    return String((error as { message?: unknown } | null | undefined)?.message ?? error)
}

function randomTempName(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    let hex = ''
    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, '0')
    }
    return `risu-write-${hex}.tmp`
}

function directoryOf(path: string): string {
    const slash = path.lastIndexOf('/')
    return slash < 0 ? '' : path.slice(0, slash)
}

function joinPath(directory: string, name: string): string {
    return directory === '' ? name : `${directory}/${name}`
}

async function removeQuietly(path: string): Promise<void> {
    try {
        await remove(path, { baseDir: BaseDirectory.AppData })
    } catch (error) {
        // A temp that cannot be removed now is removed by the boot sweep.
    }
}

async function renameOverTarget(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        try {
            await rename(from, to, {
                oldPathBaseDir: BaseDirectory.AppData,
                newPathBaseDir: BaseDirectory.AppData,
            })
            return
        } catch (error) {
            if (attempt >= RENAME_RETRY_DELAYS_MS.length || !RETRYABLE_RENAME_ERROR.test(errorText(error))) {
                throw error
            }
        }
        await new Promise<void>((resolve) => setTimeout(resolve, RENAME_RETRY_DELAYS_MS[attempt]))
    }
}

/**
 * Replaces the file at `path` (relative to AppData) with `bytes`, or creates
 * it. Rejects with the underlying error when the new bytes are not in place;
 * the rename is the last step that can fail, so a resolved call means the
 * target holds `bytes`.
 */
export async function writeFileAtomic(path: string, bytes: Uint8Array): Promise<void> {
    if (shouldChunkWrite(bytes.length)) {
        // The chunk command takes the bare key; the plugin's `./` prefix is not part of it.
        await writeChunked(path.startsWith('./') ? path.slice(2) : path, bytes, false)
        return
    }
    const temp = joinPath(directoryOf(path), randomTempName())
    try {
        await writeFile(temp, bytes, { baseDir: BaseDirectory.AppData, createNew: true })
    } catch (error) {
        if (!TEMP_ALREADY_EXISTS_ERROR.test(errorText(error))) {
            await removeQuietly(temp)
        }
        throw error
    }
    try {
        await renameOverTarget(temp, path)
    } catch (error) {
        await removeQuietly(temp)
        throw error
    }
}

/**
 * Removes the leftover temp files of interrupted `writeFileAtomic` calls from
 * `directory`. Only names matching `ATOMIC_TEMP_NAME_PATTERN` are removed. Call
 * it only where no `writeFileAtomic` and no durable write (`tauriDurableWrite.ts`)
 * into `directory` can be in flight. Never
 * rejects: a failure is logged and the files stay for the next boot.
 *
 * With `recursive`, every directory below `directory` is swept too; this is how
 * the block store's nested directories are covered, and the temp files of the
 * durable write (`tauriDurableWrite.ts`) match the same pattern. A symbolic link
 * is never entered. A directory that cannot be listed is logged and skipped.
 */
export async function sweepAtomicWriteTemps(directory: string, options: { recursive?: boolean } = {}): Promise<void> {
    try {
        const entries = await readDir(directory === '' ? '.' : directory, { baseDir: BaseDirectory.AppData })
        for (const entry of entries) {
            if (options.recursive === true && entry.isDirectory) {
                await sweepAtomicWriteTemps(joinPath(directory, entry.name), options)
                continue
            }
            if (!ATOMIC_TEMP_NAME_PATTERN.test(entry.name)) {
                continue
            }
            try {
                await remove(joinPath(directory, entry.name), { baseDir: BaseDirectory.AppData })
            } catch (error) {
                console.error(error)
            }
        }
    } catch (error) {
        console.error(error)
    }
}

/**
 * Every AppData directory a store write can put a temp file into, each swept
 * below recursively because keys under it may nest: `database/` (the main
 * file, numbered backups, the backup fingerprint, pre-conversion copies),
 * `remotes/`, `coldstorage/`, `blocks/` (generations nest) and `assets/`.
 * A key without a slash lands in the AppData root itself, which is swept
 * without descending: the other directories are listed here, and nothing else
 * under the root holds store keys.
 */
export const WRITE_TEMP_DIRECTORIES: readonly string[] = ['database', 'remotes', 'coldstorage', 'blocks', 'assets']

/**
 * Sweeps the leftover write temps of every location in `WRITE_TEMP_DIRECTORIES`
 * and of the AppData root. A directory that does not exist yet is skipped
 * quietly; the same call rules as `sweepAtomicWriteTemps` apply. Never rejects.
 */
export async function sweepAllWriteTemps(): Promise<void> {
    await sweepAtomicWriteTemps('')
    for (const directory of WRITE_TEMP_DIRECTORIES) {
        try {
            if (await exists(directory, { baseDir: BaseDirectory.AppData })) {
                await sweepAtomicWriteTemps(directory, { recursive: true })
            }
        } catch (error) {
            console.error(error)
        }
    }
}
