/**
 * The Tauri IPC boundary itself, in memory. `installTauriWire` puts the objects
 * the Tauri shell injects on `window`, so the REAL `@tauri-apps/api` and
 * `@tauri-apps/plugin-*` JavaScript runs unmodified and every command it sends
 * reaches `invoke` below, recorded in order:
 *
 * - `window.__TAURI_INTERNALS__` (`invoke`, `transformCallback`,
 *   `convertFileSrc`) makes `platform.ts` read `isTauri` as true, so install
 *   before the code under test is imported;
 * - `window.__TAURI_OS_PLUGIN_INTERNALS__` makes `transportKind()` answer for
 *   the chosen operating system without mocking the plugin.
 *
 * `plugin:fs|*` and `plugin:path|*` are answered with the wire shapes of the
 * plugin JavaScript (`{ path, options }`, `{ paths }`, header-carried write
 * bodies) over a `createFakeTauriFs` instance; every other command is an app
 * command and goes to `createDesktopInvoke` (`write_chunk_raw`,
 * `write_durable`, the chunk commands, `read_range`, `app_fs_*`). A plugin
 * command nothing here models rejects and is still recorded, so a suite that
 * asserts on `calls` sees it either way.
 *
 * It proves which commands a page sends, not what the native shell does with
 * them.
 */
import { createDesktopInvoke } from './tauriDesktopFake'
import { createFakeTauriFs, type FakeFsOptions } from './tauriFsFake'

/** `BaseDirectory.AppData` in `@tauri-apps/api/path`. */
const APP_DATA_DIRECTORY_ID = 14

export type WireOs = 'android' | 'windows' | 'linux' | 'macos'

export interface WireCall {
    cmd: string
    args: unknown
    headers: Record<string, string> | undefined
}

export interface WireOptions {
    os: WireOs
    /** Options of the in-memory file system; strict directory behaviour is the default. */
    fs?: FakeFsOptions
    /** The absolute data directory the path commands answer with. */
    appDataRoot?: string
}

interface InvokeOptions {
    headers?: Record<string, string>
}

type PluginInternals = Window & {
    __TAURI_INTERNALS__?: unknown
    __TAURI_OS_PLUGIN_INTERNALS__?: unknown
}

function pathArg(args: unknown): string {
    const path = (args as { path?: unknown } | undefined)?.path
    if (typeof path !== 'string') {
        throw new Error('the command needs a string path')
    }
    return path
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function installTauriWire(options: WireOptions) {
    const fs = createFakeTauriFs({ strict: true, platform: options.os === 'windows' ? 'windows' : 'posix', ...options.fs })
    const root = options.appDataRoot ?? (options.os === 'windows' ? 'C:\\appdata' : '/appdata')
    fs.setAppDataRoot(root)
    const desktop = createDesktopInvoke(fs)
    const calls: WireCall[] = []
    const separator = options.os === 'windows' ? '\\' : '/'
    const fsModule = fs.module as {
        exists(path: string, options?: unknown): Promise<boolean>
        mkdir(path: string, options?: unknown): Promise<void>
        remove(path: string, options?: unknown): Promise<void>
        rename(from: string, to: string, options?: unknown): Promise<void>
        readFile(path: string, options?: unknown): Promise<Uint8Array>
        readDir(path: string, options?: unknown): Promise<unknown>
        writeFile(path: string, data: Uint8Array, options?: unknown): Promise<void>
    }

    async function pluginFs(command: string, args: unknown, invokeOptions: InvokeOptions | undefined): Promise<unknown> {
        const opts = (args as { options?: unknown } | undefined)?.options
        switch (command) {
            case 'exists':
                return await fsModule.exists(pathArg(args), opts)
            case 'mkdir':
                return await fsModule.mkdir(pathArg(args), opts)
            case 'remove':
                return await fsModule.remove(pathArg(args), opts)
            case 'read_dir':
                return await fsModule.readDir(pathArg(args), opts)
            case 'read_file':
                return toBuffer(await fsModule.readFile(pathArg(args), opts))
            case 'rename': {
                const named = args as { oldPath: string, newPath: string, options?: unknown }
                return await fsModule.rename(named.oldPath, named.newPath, named.options)
            }
            case 'write_file': {
                const headers = invokeOptions?.headers
                if (!(args instanceof Uint8Array) || typeof headers?.path !== 'string') {
                    throw new Error('write_file needs a raw body and a path header')
                }
                const writeOptions = headers.options === undefined ? undefined : JSON.parse(headers.options)
                return await fsModule.writeFile(decodeURIComponent(headers.path), args, writeOptions)
            }
            default:
                throw new Error(`the wire fake does not model plugin:fs|${command}`)
        }
    }

    async function pluginPath(command: string, args: unknown): Promise<unknown> {
        if (command === 'resolve_directory' && (args as { directory?: unknown } | undefined)?.directory === APP_DATA_DIRECTORY_ID) {
            return root
        }
        if (command === 'join') {
            const paths = (args as { paths?: unknown }).paths
            if (!Array.isArray(paths)) {
                throw new Error('join needs paths')
            }
            return paths.join(separator)
        }
        throw new Error(`the wire fake does not model plugin:path|${command}`)
    }

    async function invoke(cmd: string, args?: unknown, invokeOptions?: InvokeOptions): Promise<unknown> {
        calls.push({ cmd, args, headers: invokeOptions?.headers })
        if (cmd.startsWith('plugin:fs|')) {
            return await pluginFs(cmd.slice('plugin:fs|'.length), args, invokeOptions)
        }
        if (cmd.startsWith('plugin:path|')) {
            return await pluginPath(cmd.slice('plugin:path|'.length), args)
        }
        if (cmd.startsWith('plugin:')) {
            throw new Error(`the wire fake does not model ${cmd}`)
        }
        return await desktop.invoke(cmd, args, invokeOptions)
    }

    const target = window as PluginInternals
    const previous = {
        internals: target.__TAURI_INTERNALS__,
        os: target.__TAURI_OS_PLUGIN_INTERNALS__,
    }
    target.__TAURI_INTERNALS__ = {
        invoke,
        transformCallback: () => 0,
        convertFileSrc: (path: string) => path,
    }
    target.__TAURI_OS_PLUGIN_INTERNALS__ = {
        os_type: options.os,
        platform: options.os,
        version: '0',
        family: options.os === 'windows' ? 'windows' : 'unix',
        arch: 'x86_64',
        exe_extension: options.os === 'windows' ? 'exe' : '',
        eol: options.os === 'windows' ? '\r\n' : '\n',
    }

    return {
        fs,
        desktop,
        calls,
        /** Every `plugin:*` command, in order. */
        plugin(): string[] {
            return calls.map((call) => call.cmd).filter((cmd) => cmd.startsWith('plugin:'))
        },
        /** The calls of one command. */
        callsOf(cmd: string): WireCall[] {
            return calls.filter((call) => call.cmd === cmd)
        },
        clearCalls(): void {
            calls.length = 0
        },
        /** Removes the injected objects; the previous ones, if any, come back. */
        uninstall(): void {
            if (previous.internals === undefined) {
                delete target.__TAURI_INTERNALS__
            } else {
                target.__TAURI_INTERNALS__ = previous.internals
            }
            if (previous.os === undefined) {
                delete target.__TAURI_OS_PLUGIN_INTERNALS__
            } else {
                target.__TAURI_OS_PLUGIN_INTERNALS__ = previous.os
            }
        },
    }
}

export type TauriWire = ReturnType<typeof installTauriWire>

/** Commands whose handling on the Tauri side waits for the UI thread (synchronous plugin commands that resolve a base directory or a content URI). */
export const WAITING_PLUGIN_COMMANDS: readonly string[] = [
    'plugin:fs|exists',
    'plugin:fs|mkdir',
    'plugin:fs|remove',
    'plugin:fs|rename',
    'plugin:fs|stat',
    'plugin:fs|lstat',
    'plugin:fs|fstat',
    'plugin:fs|create',
    'plugin:fs|open',
    'plugin:fs|read_text_file_lines',
    'plugin:path|resolve_directory',
    'plugin:path|basename',
    'plugin:path|extname',
]

/** The only plugin commands an Android page may send. */
export const ANDROID_ALLOWED_PLUGIN_COMMANDS: readonly string[] = ['plugin:fs|read_dir', 'plugin:path|join']
