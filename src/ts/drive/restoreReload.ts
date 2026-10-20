import { relaunch } from "@tauri-apps/plugin-process"
import { isTauri } from "src/ts/platform"
import { isAndroidTransport } from "../storage/tauriByteTransport"

/**
 * The reload every restore and import ends with, once the restored state has
 * landed and the reload has been marked app-initiated. Desktop Tauri restarts
 * the process. The Android app cannot: Tauri's restart spawns the current
 * executable, which on Android is the app launcher and cannot be spawned, so a
 * relaunch there only kills the app. Android and the web reload the page.
 */
export async function reloadAfterRestore(): Promise<void> {
    if (isTauri && !isAndroidTransport()) {
        await relaunch()
        return
    }
    // replaceState drops any query string and keeps the fragment;
    // location.reload() always performs a full reload.
    history.replaceState(null, '', location.pathname + location.hash)
    location.reload()
}
