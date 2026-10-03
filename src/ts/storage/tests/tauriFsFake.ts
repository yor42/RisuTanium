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
 * - Paths are taken relative to AppData with a leading `./` removed (the byte
 *   store addresses every key that way); every path a call was given is
 *   recorded in `calls`.
 *
 * Strict mode (`createFakeTauriFs({ strict: true })`) adds the directory
 * behaviour of the real file system. A suite that does not ask for it keeps
 * the lenient behaviour above, where directories are implied by file paths:
 *
 * - `writeFile` and `rename` into a directory that does not exist reject,
 *   `mkdir` rejects on an existing path and on a missing parent unless it is
 *   `recursive`, and a recursive `mkdir` creates every ancestor.
 * - `readFile`, `remove` and `readDir` of a path whose directory is missing
 *   reject with the error of the selected platform: Windows `(os error 3)`,
 *   POSIX `(os error 2)`. `exists` is false for such a path.
 * - `readDir` lists one level, directories included, with `isDirectory`.
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

export type FakeFsPlatform = 'windows' | 'posix'

export interface FakeFsOptions {
    /** Directory behaviour of the real file system; see the file comment. */
    strict?: boolean
    /** The shape of missing-path errors in strict mode. */
    platform?: FakeFsPlatform
}

export type FakeFsOperation = 'writeFile' | 'readFile' | 'readDir' | 'remove' | 'exists' | 'mkdir' | 'rename'

/** One path a call was given, exactly as given. A rename records its source and its target. */
export interface FakeFsCall {
    op: FakeFsOperation
    path: string
}

export const OS_ERROR_FILE_NOT_FOUND = 'The system cannot find the file specified. (os error 2)'
export const OS_ERROR_ACCESS_DENIED = 'Access is denied. (os error 5)'
export const OS_ERROR_DISK_FULL = 'There is not enough space on the disk. (os error 112)'
/** A file in a directory that does not exist, on Windows. */
export const OS_ERROR_PATH_NOT_FOUND = 'The system cannot find the path specified. (os error 3)'
/** A missing file or directory on POSIX. */
export const OS_ERROR_NO_SUCH_FILE = 'No such file or directory (os error 2)'

function partialOf(data: Uint8Array): Uint8Array {
    return data.slice(0, Math.max(1, Math.floor(data.length / 2)))
}

export function createFakeTauriFs(options: FakeFsOptions = {}) {
    const strict = options.strict === true
    const initialPlatform: FakeFsPlatform = options.platform ?? 'posix'
    let platform: FakeFsPlatform = initialPlatform

    const files = new Map<string, Uint8Array>()
    const directories = new Set<string>()
    const writeLog: FakeFsWrite[] = []
    const renameLog: FakeFsRename[] = []
    const removeLog: string[] = []
    const readDirLog: string[] = []
    const calls: FakeFsCall[] = []

    let writeFault: { matches: (data: Uint8Array) => boolean, remaining: number, skip: number, handle: FakeFsFault } | undefined
    let renameFault: { error: string, remaining: number, handle: FakeFsFault } | undefined
    let removeFault: { error: string, matches: ((path: string) => boolean) | undefined, handle: FakeFsFault } | undefined
    let readDirFault: { error: string, handle: FakeFsFault } | undefined
    let readFileFault: { error: string, matches: ((path: string) => boolean) | undefined, handle: FakeFsFault } | undefined
    let existsOverride: boolean | undefined

    /** The path a call was given, relative to AppData: a leading `./` is dropped, and in strict mode `.` is the root. */
    function resolved(path: string): string {
        const bare = path.startsWith('./') ? path.slice(2) : path
        if (!strict) {
            return bare
        }
        return bare === '.' ? '' : bare
    }

    function parentOf(path: string): string {
        const slash = path.lastIndexOf('/')
        return slash < 0 ? '' : path.slice(0, slash)
    }

    function hasDescendant(directory: string): boolean {
        const prefix = `${directory}/`
        return Array.from(files.keys()).some((key) => key.startsWith(prefix))
            || Array.from(directories).some((known) => known.startsWith(prefix))
    }

    /** Strict mode: a directory exists when it was created, or a file lies under it. */
    function directoryExists(directory: string): boolean {
        return directory === '' || directories.has(directory) || hasDescendant(directory)
    }

    function registerAncestors(directory: string): void {
        for (let current = directory; current !== ''; current = parentOf(current)) {
            directories.add(current)
        }
    }

    /** The error for a path whose own name or whose directory is missing. */
    function missingError(directoryMissing: boolean): string {
        if (platform === 'windows') {
            return directoryMissing ? OS_ERROR_PATH_NOT_FOUND : OS_ERROR_FILE_NOT_FOUND
        }
        return OS_ERROR_NO_SUCH_FILE
    }

    function isDirectoryError(): string {
        return platform === 'windows' ? OS_ERROR_ACCESS_DENIED : 'Is a directory (os error 21)'
    }

    async function writeFile(path: string, data: Uint8Array, options?: FakeFsWrite['options']): Promise<void> {
        writeLog.push({ path, data, options })
        calls.push({ op: 'writeFile', path })
        const target = resolved(path)
        if (strict) {
            if (!directoryExists(parentOf(target))) {
                throw `failed to open file at path: ${path} with error: ${missingError(true)}`
            }
            if (directoryExists(target) && !files.has(target)) {
                throw `failed to open file at path: ${path} with error: ${isDirectoryError()}`
            }
        }
        if (options?.createNew && files.has(target)) {
            throw `failed to open file at path: ${path} with error: The file exists. (os error 80)`
        }
        if (writeFault && writeFault.remaining > 0 && writeFault.matches(data)) {
            if (writeFault.skip > 0) {
                writeFault.skip--
            } else {
                writeFault.remaining--
                writeFault.handle.fired++
                files.set(target, partialOf(data))
                throw `failed to write bytes to file at path: ${path} with error: ${OS_ERROR_DISK_FULL}`
            }
        }
        files.set(target, data.slice())
    }

    async function rename(from: string, to: string, options?: FakeFsRename['options']): Promise<void> {
        renameLog.push({ from, to, options })
        calls.push({ op: 'rename', path: from }, { op: 'rename', path: to })
        if (options?.oldPathBaseDir === undefined || options?.newPathBaseDir === undefined) {
            throw `forbidden path: ${options?.oldPathBaseDir === undefined ? from : to}`
        }
        if (renameFault && renameFault.remaining > 0) {
            renameFault.remaining--
            renameFault.handle.fired++
            throw `failed to rename old path: ${from} to new path: ${to} with error: ${renameFault.error}`
        }
        const source = resolved(from)
        const target = resolved(to)
        const found = files.get(source)
        if (!found) {
            throw `failed to rename old path: ${from} to new path: ${to} with error: ${OS_ERROR_FILE_NOT_FOUND}`
        }
        if (strict && !directoryExists(parentOf(target))) {
            throw `failed to rename old path: ${from} to new path: ${to} with error: ${missingError(true)}`
        }
        files.set(target, found)
        files.delete(source)
    }

    async function remove(path: string): Promise<void> {
        removeLog.push(path)
        calls.push({ op: 'remove', path })
        const target = resolved(path)
        if (removeFault && (removeFault.matches === undefined || removeFault.matches(target))) {
            removeFault.handle.fired++
            throw `failed to remove file at path: ${path} with error: ${removeFault.error}`
        }
        if (strict && !files.has(target)) {
            if (directoryExists(target) && target !== '') {
                if (hasDescendant(target)) {
                    throw `failed to remove directory at path: ${path} with error: ${platform === 'windows' ? 'The directory is not empty. (os error 145)' : 'Directory not empty (os error 39)'}`
                }
                directories.delete(target)
                return
            }
            throw `failed to get metadata of path: ${path} with error: ${missingError(!directoryExists(parentOf(target)))}`
        }
        if (!files.delete(target)) {
            throw `failed to get metadata of path: ${path} with error: ${OS_ERROR_FILE_NOT_FOUND}`
        }
    }

    async function readFile(path: string): Promise<Uint8Array> {
        calls.push({ op: 'readFile', path })
        const target = resolved(path)
        if (readFileFault && (readFileFault.matches === undefined || readFileFault.matches(target))) {
            readFileFault.handle.fired++
            throw `failed to open file at path: ${path} with error: ${readFileFault.error}`
        }
        const found = files.get(target)
        if (!found) {
            if (strict) {
                if (directoryExists(target)) {
                    throw `failed to open file at path: ${path} with error: ${isDirectoryError()}`
                }
                throw `failed to open file at path: ${path} with error: ${missingError(!directoryExists(parentOf(target)))}`
            }
            throw `failed to open file at path: ${path} with error: ${OS_ERROR_FILE_NOT_FOUND}`
        }
        return found.slice()
    }

    async function exists(path: string): Promise<boolean> {
        calls.push({ op: 'exists', path })
        if (existsOverride !== undefined) {
            return existsOverride
        }
        const target = resolved(path)
        if (strict) {
            return files.has(target) || directoryExists(target)
        }
        const prefix = `${target}/`
        return target === '' || files.has(target) || directories.has(target) || Array.from(files.keys()).some((key) => key.startsWith(prefix))
    }

    async function mkdir(path: string, options?: { recursive?: boolean, baseDir?: number }): Promise<void> {
        calls.push({ op: 'mkdir', path })
        const target = resolved(path)
        if (!strict) {
            directories.add(target)
            return
        }
        if (files.has(target) || (!options?.recursive && directoryExists(target))) {
            throw `failed to create directory at path: ${path} with error: ${platform === 'windows' ? 'Cannot create a file when that file already exists. (os error 183)' : 'File exists (os error 17)'}`
        }
        if (!options?.recursive && !directoryExists(parentOf(target))) {
            throw `failed to create directory at path: ${path} with error: ${missingError(true)}`
        }
        registerAncestors(target)
    }

    async function readDir(directory: string): Promise<FakeFsDirEntry[]> {
        readDirLog.push(directory)
        calls.push({ op: 'readDir', path: directory })
        if (readDirFault) {
            readDirFault.handle.fired++
            throw `failed to read directory at path: ${directory} with error: ${readDirFault.error}`
        }
        const target = resolved(directory)
        if (strict) {
            if (files.has(target)) {
                throw `failed to read directory at path: ${directory} with error: ${platform === 'windows' ? 'The directory name is invalid. (os error 267)' : 'Not a directory (os error 20)'}`
            }
            if (!directoryExists(target)) {
                throw `failed to read directory at path: ${directory} with error: ${missingError(!directoryExists(parentOf(target)))}`
            }
            const prefix = target === '' ? '' : `${target}/`
            const entries = new Map<string, FakeFsDirEntry>()
            for (const key of files.keys()) {
                if (!key.startsWith(prefix)) {
                    continue
                }
                const rest = key.slice(prefix.length)
                const slash = rest.indexOf('/')
                const name = slash < 0 ? rest : rest.slice(0, slash)
                entries.set(name, { name, isFile: slash < 0, isDirectory: slash >= 0, isSymlink: false })
            }
            for (const known of directories) {
                if (!known.startsWith(prefix) || known === target) {
                    continue
                }
                const rest = known.slice(prefix.length)
                const name = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest
                entries.set(name, { name, isFile: false, isDirectory: true, isSymlink: false })
            }
            return Array.from(entries.values())
        }
        const prefix = `${target}/`
        return Array.from(files.keys())
            .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
            .map((key): FakeFsDirEntry => ({ name: key.slice(prefix.length), isFile: true, isDirectory: false, isSymlink: false }))
    }

    return {
        files,
        directories,
        writeLog,
        renameLog,
        removeLog,
        readDirLog,
        /** Every path any call was given, in order, exactly as given. */
        calls,

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

        /** Puts a file in place the way a previous run left it, creating the directories above it. */
        plant(path: string, data: Uint8Array): void {
            files.set(path, data.slice())
            registerAncestors(parentOf(path))
        },

        /** Selects the shape of missing-path errors in strict mode. */
        setPlatform(next: FakeFsPlatform): void {
            platform = next
        },

        /** Every `exists` answers `value`, whatever the file system holds; `undefined` restores the real answer. */
        forceExists(value: boolean | undefined): void {
            existsOverride = value
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

        /** Every remove (or, with `matches`, every remove of a path it accepts) rejects with `error` and removes nothing. */
        failRemoves(error: string, matches?: (path: string) => boolean): FakeFsFault {
            const handle: FakeFsFault = { fired: 0 }
            removeFault = { error, matches, handle }
            return handle
        },

        /** Every readFile (or, with `matches`, every read of a path it accepts) rejects with `error`. */
        failReadFiles(error: string, matches?: (path: string) => boolean): FakeFsFault {
            const handle: FakeFsFault = { fired: 0 }
            readFileFault = { error, matches, handle }
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
            readFileFault = undefined
            existsOverride = undefined
        },

        reset(): void {
            files.clear()
            directories.clear()
            writeLog.length = 0
            renameLog.length = 0
            removeLog.length = 0
            readDirLog.length = 0
            calls.length = 0
            writeFault = undefined
            renameFault = undefined
            removeFault = undefined
            readDirFault = undefined
            readFileFault = undefined
            existsOverride = undefined
            platform = initialPlatform
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
