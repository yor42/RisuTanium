import { convertFileSrc } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { BaseDirectory, exists, mkdir, readDir, readFile, remove } from '@tauri-apps/plugin-fs'
import { ATOMIC_TEMP_NAME_PATTERN, writeFileAtomic } from '../tauriAtomicWrite'
import { isDurableKey, writeFileDurable } from '../tauriDurableWrite'
import type { ByteStore, DeleteEntry, ReadResult, StoreCondition, WriteResult } from './contract'
import { StoreDeleteManyError, StoreInvalidKeyError, type DeleteReportEntry } from './errors'
import { checkBytes, checkCondition, checkNoDuplicateKeys, ownBytes } from './guards'
import { tauriAddressableViolation, tauriCreatableViolation, type FilePlatform } from './keyRules'

/**
 * The byte store on the desktop app's AppData directory: one file per key, at
 * the path the key names.
 *
 * Every path handed to the plugin is `./` plus the key. The plugin parses a
 * path string as a URL first, and an absolute path that comes out of a `file:`
 * URL replaces the base directory, so a bare key such as `file:/home/u/x` would
 * leave AppData. With the `./` prefix no key parses as a URL.
 *
 * Writes go through `writeFileAtomic`, so a failed write keeps the old file.
 * Block-store keys (`blocks/`), numbered backups and cold-storage units go
 * through `writeFileDurable` instead, which also flushes the bytes to the file
 * system before it resolves. The granted file system surface has no `stat` and no exclusive rename, so
 * this store cannot enforce `ifVersion` and reports `conditionalWrites: false`.
 *
 * It is the one store that offers `urlFor`: the web view loads a file from the
 * asset protocol by its absolute path, so the URL comes from the key alone and
 * no byte is read.
 */

const APP_DATA = { baseDir: BaseDirectory.AppData }

/**
 * The plugin reports a missing file as `(os error 2)` and, on Windows, a file in
 * a directory that does not exist as `(os error 3)`. The message before the
 * code is localized, so only the suffix is read. Android words its errors
 * differently and is not covered.
 */
const MISSING_FILE_ERROR = /\(os error (2|3)\)\s*$/

export interface TauriFilesStoreOptions {
    /** The platform decides which characters separate path segments and which keys are addressable. */
    platform: FilePlatform
}

function pluginPath(key: string): string {
    return `./${key}`
}

function parentDirectory(key: string): string {
    const slash = key.lastIndexOf('/')
    return slash < 0 ? '' : key.slice(0, slash)
}

function errorText(error: unknown): string {
    return String((error as { message?: unknown } | null | undefined)?.message ?? error)
}

/**
 * A path is absent only when the plugin says so AND `exists` agrees. `exists`
 * is false for any error that stops the metadata lookup, so it alone cannot
 * tell an absent file from a denied one, and the error code alone would turn a
 * mislabelled failure into "no value". Any other error is a failure.
 */
async function isAbsent(error: unknown, path: string): Promise<boolean> {
    if (!MISSING_FILE_ERROR.test(errorText(error))) {
        return false
    }
    try {
        return !(await exists(path, APP_DATA))
    } catch {
        return false
    }
}

export function createTauriFilesStore(options: TauriFilesStoreOptions): ByteStore {
    const { platform } = options

    function checkAddressable(key: string): void {
        const reason = tauriAddressableViolation(key, platform)
        if (reason !== null) {
            throw new StoreInvalidKeyError(key, reason)
        }
    }

    function checkCreatable(key: string): void {
        const reason = tauriAddressableViolation(key, platform) ?? tauriCreatableViolation(key)
        if (reason !== null) {
            throw new StoreInvalidKeyError(key, reason)
        }
    }

    /** Removes one file; an absent file counts as removed. */
    async function removeFile(key: string): Promise<void> {
        const path = pluginPath(key)
        try {
            await remove(path, APP_DATA)
        } catch (error) {
            if (!(await isAbsent(error, path))) {
                throw error
            }
        }
    }

    let appDataPath: string | undefined
    const urls = new Map<string, string>()

    /**
     * Appends the keys under `directory` whose first name starts with `namePrefix`;
     * deeper names are not filtered. A symbolic link is a key only while it
     * resolves (`exists` follows links), and is never entered: the plugin
     * reports it as neither a file nor a directory, and a link to a directory
     * must not pull in files that live outside the key space.
     */
    async function collect(directory: string, namePrefix: string, keys: string[]): Promise<void> {
        const path = directory === '' ? '.' : pluginPath(directory)
        let entries: Awaited<ReturnType<typeof readDir>>
        try {
            entries = await readDir(path, APP_DATA)
        } catch (error) {
            if (await isAbsent(error, path)) {
                return
            }
            throw error
        }
        for (const entry of entries) {
            if (!entry.name.startsWith(namePrefix)) {
                continue
            }
            const key = directory === '' ? entry.name : `${directory}/${entry.name}`
            if (entry.isDirectory) {
                await collect(key, '', keys)
            } else if (ATOMIC_TEMP_NAME_PATTERN.test(entry.name)) {
                continue
            } else if (entry.isFile) {
                keys.push(key)
            } else if (entry.isSymlink && await exists(pluginPath(key), APP_DATA)) {
                keys.push(key)
            }
        }
    }

    return {
        capabilities: { conditionalWrites: false },

        async read(key: string): Promise<ReadResult> {
            checkAddressable(key)
            const path = pluginPath(key)
            try {
                return { bytes: ownBytes(await readFile(path, APP_DATA)), version: null }
            } catch (error) {
                if (await isAbsent(error, path)) {
                    return { bytes: null, version: null }
                }
                throw error
            }
        },

        async write(key: string, bytes: Uint8Array, condition: StoreCondition): Promise<WriteResult> {
            checkCreatable(key)
            checkCondition(condition, false)
            checkBytes(bytes)
            if (isDurableKey(key)) {
                // The command creates the directories itself.
                await writeFileDurable(key, bytes)
                return { version: null }
            }
            const directory = parentDirectory(key)
            if (directory !== '') {
                await mkdir(pluginPath(directory), { ...APP_DATA, recursive: true })
            }
            await writeFileAtomic(pluginPath(key), bytes)
            return { version: null }
        },

        async delete(key: string, condition: StoreCondition): Promise<void> {
            checkAddressable(key)
            checkCondition(condition, false)
            await removeFile(key)
        },

        async deleteMany(entries: readonly DeleteEntry[]): Promise<void> {
            for (const entry of entries) {
                checkAddressable(entry.key)
                checkCondition(entry.condition, false)
            }
            checkNoDuplicateKeys(entries)
            const report: DeleteReportEntry[] = []
            for (const entry of entries) {
                try {
                    await removeFile(entry.key)
                    report.push({ key: entry.key, outcome: 'removed' })
                } catch (error) {
                    report.push({ key: entry.key, outcome: 'failed', error })
                }
            }
            if (report.some((entry) => entry.outcome !== 'removed')) {
                throw new StoreDeleteManyError(report)
            }
        },

        async list(prefix: string): Promise<string[]> {
            const reason = tauriAddressableViolation(prefix, platform, true)
            if (reason !== null) {
                throw new StoreInvalidKeyError(prefix, reason)
            }
            const slash = prefix.lastIndexOf('/')
            const keys: string[] = []
            await collect(slash < 0 ? '' : prefix.slice(0, slash), prefix.slice(slash + 1), keys)
            return keys
        },

        async has(key: string): Promise<boolean> {
            checkAddressable(key)
            const path = pluginPath(key)
            if (!(await exists(path, APP_DATA))) {
                return false
            }
            // `exists` is also true for a directory, which holds no value. Only
            // a directory can be listed.
            try {
                await readDir(path, APP_DATA)
                return false
            } catch {
                return true
            }
        },

        async urlFor(key: string): Promise<string> {
            checkAddressable(key)
            const known = urls.get(key)
            if (known !== undefined) {
                return known
            }
            appDataPath ??= await appDataDir()
            const url = convertFileSrc(await join(appDataPath, key))
            urls.set(key, url)
            return url
        },
    }
}
