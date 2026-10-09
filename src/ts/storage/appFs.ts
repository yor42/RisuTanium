import { invoke } from '@tauri-apps/api/core'
import { appDataDir } from '@tauri-apps/api/path'
import { BaseDirectory, exists, mkdir, remove } from '@tauri-apps/plugin-fs'
import { transportKind } from './tauriByteTransport'
import { StoreInvalidKeyError } from './store/errors'

/**
 * Existence, directory creation and removal of a file under the AppData
 * directory, and the AppData directory's absolute path.
 *
 * On Android and desktop these go through the app's own async commands
 * (`src-tauri/src/app_fs.rs`). The file plugin's `exists`, `mkdir` and
 * `remove` are synchronous commands: they run on the thread that serves the
 * web view's IPC while holding the plugin registry, and on Android resolving
 * their base directory waits for the UI thread, which can itself be waiting for
 * that registry during page load. An async command never holds the registry
 * across that wait. A page without the operating-system plugin (the web build,
 * the Node server page, the test runner) keeps the plugin calls, whose path form
 * is `./` plus the key.
 *
 * Keys are bare and relative to AppData, never prefixed with `./` or `/`; the
 * empty key is the AppData directory itself. A key that breaks this is refused
 * before any command, so the mistake is loud instead of swallowed by a
 * caller's catch. Every other rejection passes through unchanged as the string
 * the command or plugin gave, because callers read its `(os error N)` suffix.
 */

export const APP_FS_EXISTS_COMMAND = 'app_fs_exists'
export const APP_FS_MKDIR_ALL_COMMAND = 'app_fs_mkdir_all'
export const APP_FS_REMOVE_COMMAND = 'app_fs_remove'
export const APP_DATA_DIR_PATH_COMMAND = 'app_data_dir_path'

/** Built on use, not at module load: the plugin module is absent or partial in a page that never reaches the fallback. */
function appData() {
    return { baseDir: BaseDirectory.AppData }
}

/** Whether the app's own commands serve the file calls: Android and desktop, not the web, the Node page or the test runner. */
export function usesAppFs(): boolean {
    return transportKind() !== 'other'
}

function checkBare(key: string): void {
    if (key.startsWith('./') || key.startsWith('/')) {
        throw new StoreInvalidKeyError(key, 'an app file key is relative to the app data directory and has no ./ or / prefix')
    }
}

/** The path form the file plugin takes: the root is the empty path, any other key gets the `./` prefix. */
function pluginPath(key: string): string {
    return key === '' ? '' : `./${key}`
}

export async function appFsExists(key: string): Promise<boolean> {
    checkBare(key)
    if (usesAppFs()) {
        return await invoke<boolean>(APP_FS_EXISTS_COMMAND, { key })
    }
    return await exists(pluginPath(key), appData())
}

/** Creates the directory and every missing ancestor; an existing directory is not an error. */
export async function appFsMkdirAll(key: string): Promise<void> {
    checkBare(key)
    if (usesAppFs()) {
        await invoke<void>(APP_FS_MKDIR_ALL_COMMAND, { key })
        return
    }
    await mkdir(pluginPath(key), { ...appData(), recursive: true })
}

/** Removes a file, a link or an empty directory. A missing path rejects with a string that ends in `(os error 2)`. */
export async function appFsRemove(key: string): Promise<void> {
    checkBare(key)
    if (usesAppFs()) {
        await invoke<void>(APP_FS_REMOVE_COMMAND, { key })
        return
    }
    await remove(pluginPath(key), appData())
}

/** The absolute AppData directory. */
export async function appDataDirectory(): Promise<string> {
    if (usesAppFs()) {
        return await invoke<string>(APP_DATA_DIR_PATH_COMMAND)
    }
    return await appDataDir()
}
