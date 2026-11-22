/**
 * The launch options. The Android host knows two things the page cannot: that the user started the app from the
 * "Start without theme pack" shortcut, and whether touch exploration (TalkBack) is on. The page asks
 * (`requestLaunchOptions`) and the host answers through `window.__risuTaniumLaunchOptions`; the shortcut's request is
 * answered once and then cleared, so a reload or a recents relaunch never repeats it. The answer comes from outside the
 * page's own code, so only an exact boolean `true` counts. Boot never waits for it: an answer that comes late enters pack
 * safe mode live, and the banner reads the touch-exploration state reactively.
 *
 * A warm shortcut launch tells the page through `window.__risuTaniumPackSafeModeReady`, and the page asks again.
 */
import { enterPackSafeMode, setBannerTouchExploration } from '../themePack/packSafeMode.svelte'
import type { KeepAliveHostObject } from './keepAliveService'

declare global {
    interface Window {
        /** Called by the host with the launch options object. */
        __risuTaniumLaunchOptions?: (options: unknown) => void
        /** Called by the host when the shortcut starts the app while it runs; the page then asks again. */
        __risuTaniumPackSafeModeReady?: () => void
    }
}

let activeHost: KeepAliveHostObject | null = null

/** The host's answer. It never throws: the host calls it through the page's script evaluation. */
function onAnswer(raw: unknown): void {
    try {
        if (typeof raw !== 'object' || raw === null) {
            return
        }
        const options = raw as Record<string, unknown>
        setBannerTouchExploration(options.touchExploration)
        if (options.packSafeMode === true) {
            enterPackSafeMode('shortcut')
        }
    } catch (error) {
        console.error(error)
    }
}

function askHost(): void {
    try {
        // Called as a method: the host bridge object needs its receiver.
        activeHost?.requestLaunchOptions?.()
    } catch (error) {
        console.error(error)
    }
}

/**
 * Installs the answer hooks and asks the host for the launch options, when the host can give them. Without
 * `requestLaunchOptions` (web, desktop, an old host) nothing is installed. A host that refuses the request is the same as
 * no host. Never throws and never waits.
 */
export function startLaunchOptions(host: KeepAliveHostObject | undefined): void {
    if (host === undefined || typeof host.requestLaunchOptions !== 'function') {
        return
    }
    activeHost = host
    window.__risuTaniumLaunchOptions = onAnswer
    window.__risuTaniumPackSafeModeReady = askHost
    askHost()
}
