/**
 * An in-memory stand-in for `@tauri-apps/plugin-fs`, keyed by the AppData
 * relative path, shaped like the real plugin where the atomic write depends on
 * it:
 *
 * - `writeFile` truncates: a failing write first stores a PARTIAL body at the
 *   path it was given and then rejects, so a write that opens the real target
 *   leaves the target cut. A fault is chosen by the BODY being written, never
 *   by the path, so it fires whichever path a caller writes to.
 * - `writeFile` with `createNew` rejects when the file exists.
 * - `rename` needs a base directory for both paths and replaces an existing
 *   target; a missing source rejects.
 * - Rejections are plain strings that end in `(os error N)`, as the plugin's.
 *
 * Use it from a mock factory loaded with a dynamic import inside `vi.hoisted`.
 */

export interface FakeFsDirEntry {
    name: string
    isFile: boolean
    isDirectory: boolean
    isSymlink: boolean
}

export interface FakeFsWrite {
    path: string
    data: Uint8Array
    options: { createNew?: boolean, baseDir?: number } | undefined
}

export interface FakeFsRename {
    from: string
    to: string
    options: { oldPathBaseDir?: number, newPathBaseDir?: number } | undefined
}

/** How many times an injected fault has fired. */
export interface FakeFsFault {
    fired: number
}

export const OS_ERROR_FILE_NOT_FOUND = 'The system cannot find the file specified. (os error 2)'
export const OS_ERROR_ACCESS_DENIED = 'Access is denied. (os error 5)'
export const OS_ERROR_DISK_FULL = 'There is not enough space on the disk. (os error 112)'

function partialOf(data: Uint8Array): Uint8Array {
    return data.slice(0, Math.max(1, Math.floor(data.length / 2)))
}

export function createFakeTauriFs() {
    const files = new Map<string, Uint8Array>()
    const directories = new Set<string>()
    const writeLog: FakeFsWrite[] = []
    const renameLog: FakeFsRename[] = []
    const removeLog: string[] = []
    const readDirLog: string[] = []

    let writeFault: { matches: (data: Uint8Array) => boolean, remaining: number, skip: number, handle: FakeFsFault } | undefined
    let renameFault: { error: string, remaining: number, handle: FakeFsFault } | undefined
    let removeFault: { error: string, handle: FakeFsFault } | undefined
    let readDirFault: { error: string, handle: FakeFsFault } | undefined

    async function writeFile(path: string, data: Uint8Array, options?: FakeFsWrite['options']): Promise<void> {
        writeLog.push({ path, data, options })
        if (options?.createNew && files.has(path)) {
            throw `failed to open file at path: ${path} with error: The file exists. (os error 80)`
        }
        if (writeFault && writeFault.remaining > 0 && writeFault.matches(data)) {
            if (writeFault.skip > 0) {
                writeFault.skip--
            } else {
                writeFault.remaining--
                writeFault.handle.fired++
                files.set(path, partialOf(data))
                throw `failed to write bytes to file at path: ${path} with error: ${OS_ERROR_DISK_FULL}`
            }
        }
        files.set(path, data.slice())
    }

    async function rename(from: string, to: string, options?: FakeFsRename['options']): Promise<void> {
        renameLog.push({ from, to, options })
        if (options?.oldPathBaseDir === undefined || options?.newPathBaseDir === undefined) {
            throw `forbidden path: ${options?.oldPathBaseDir === undefined ? from : to}`
        }
        if (renameFault && renameFault.remaining > 0) {
            renameFault.remaining--
            renameFault.handle.fired++
            throw `failed to rename old path: ${from} to new path: ${to} with error: ${renameFault.error}`
        }
        const found = files.get(from)
        if (!found) {
            throw `failed to rename old path: ${from} to new path: ${to} with error: ${OS_ERROR_FILE_NOT_FOUND}`
        }
        files.set(to, found)
        files.delete(from)
    }

    async function remove(path: string): Promise<void> {
        removeLog.push(path)
        if (removeFault) {
            removeFault.handle.fired++
            throw `failed to remove file at path: ${path} with error: ${removeFault.error}`
        }
        if (!files.delete(path)) {
            throw `failed to get metadata of path: ${path} with error: ${OS_ERROR_FILE_NOT_FOUND}`
        }
    }

    async function readFile(path: string): Promise<Uint8Array> {
        const found = files.get(path)
        if (!found) {
            throw `failed to open file at path: ${path} with error: ${OS_ERROR_FILE_NOT_FOUND}`
        }
        return found.slice()
    }

    async function exists(path: string): Promise<boolean> {
        const prefix = `${path}/`
        return path === '' || files.has(path) || directories.has(path) || Array.from(files.keys()).some((key) => key.startsWith(prefix))
    }

    async function mkdir(path: string): Promise<void> {
        directories.add(path)
    }

    async function readDir(directory: string): Promise<FakeFsDirEntry[]> {
        readDirLog.push(directory)
        if (readDirFault) {
            readDirFault.handle.fired++
            throw `failed to read directory at path: ${directory} with error: ${readDirFault.error}`
        }
        const prefix = `${directory}/`
        return Array.from(files.keys())
            .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
            .map((key): FakeFsDirEntry => ({ name: key.slice(prefix.length), isFile: true, isDirectory: false, isSymlink: false }))
    }

    return {
        files,
        writeLog,
        renameLog,
        removeLog,
        readDirLog,

        /** Every body written to `path` itself, in order, whatever the options. */
        writesTo(path: string): FakeFsWrite[] {
            return writeLog.filter((entry) => entry.path === path)
        },

        /** Names of the files directly inside `directory`. */
        listing(directory: string): string[] {
            const prefix = `${directory}/`
            return Array.from(files.keys())
                .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
                .map((key) => key.slice(prefix.length))
                .sort()
        },

        /**
         * After `skip` writes whose body satisfies `matches` have succeeded, the
         * next `times` such writes store a partial body at their path and reject.
         */
        failWritesOf(matches: (data: Uint8Array) => boolean, times = Infinity, skip = 0): FakeFsFault {
            const handle: FakeFsFault = { fired: 0 }
            writeFault = { matches, remaining: times, skip, handle }
            return handle
        },

        /** The next `times` renames reject with `error` and change nothing. */
        failRenames(error: string, times = Infinity): FakeFsFault {
            const handle: FakeFsFault = { fired: 0 }
            renameFault = { error, remaining: times, handle }
            return handle
        },

        /** Every remove rejects with `error` and removes nothing. */
        failRemoves(error: string): FakeFsFault {
            const handle: FakeFsFault = { fired: 0 }
            removeFault = { error, handle }
            return handle
        },

        /** Every readDir rejects with `error`. */
        failReadDirs(error: string): FakeFsFault {
            const handle: FakeFsFault = { fired: 0 }
            readDirFault = { error, handle }
            return handle
        },

        clearFaults(): void {
            writeFault = undefined
            renameFault = undefined
            removeFault = undefined
            readDirFault = undefined
        },

        reset(): void {
            files.clear()
            directories.clear()
            writeLog.length = 0
            renameLog.length = 0
            removeLog.length = 0
            readDirLog.length = 0
            writeFault = undefined
            renameFault = undefined
            removeFault = undefined
            readDirFault = undefined
        },

        /** The module shape a `vi.mock('@tauri-apps/plugin-fs', ...)` factory returns. */
        module: {
            BaseDirectory: { AppData: 0, Download: 1 },
            writeFile,
            rename,
            remove,
            readFile,
            exists,
            mkdir,
            readDir,
        },
    }
}

export type FakeTauriFs = ReturnType<typeof createFakeTauriFs>
