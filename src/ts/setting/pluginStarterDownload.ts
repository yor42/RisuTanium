/**
 * Downloads the plugin starter template through the app's file hand-off. A bare anchor `download` does
 * nothing on Tauri or Android, where the hand-off opens the save picker instead.
 */

export interface StarterDownloadDeps {
    fetcher: (url: string) => Promise<Pick<Response, 'ok' | 'arrayBuffer'>>
    /** Resolves false when the user dismissed the save picker; a failed write rejects. */
    download: (fileName: string, data: Uint8Array) => Promise<boolean>
    fail: () => void
}

export const PLUGIN_STARTER_URL = '/plugin_start.7z'
export const PLUGIN_STARTER_FILE = 'plugin_starter.7z'

export async function downloadPluginStarter(deps: StarterDownloadDeps): Promise<void> {
    try {
        const response = await deps.fetcher(PLUGIN_STARTER_URL)
        if (!response.ok) {
            deps.fail()
            return
        }
        const bytes = new Uint8Array(await response.arrayBuffer())
        // A dismissed picker is the user's choice, not a failure.
        await deps.download(PLUGIN_STARTER_FILE, bytes)
    } catch {
        deps.fail()
    }
}
