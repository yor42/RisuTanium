import { isTauri } from './platform'
import { openURL } from './globalApi.svelte'
import { installLinkRouter } from './linkRouter'

/** Routes external link clicks through the app's scoped opener on Tauri; the web and the node host install nothing. */
export function installTauriLinkRouter(): void {
    if (!isTauri) {
        return
    }
    installLinkRouter(openURL)
}
