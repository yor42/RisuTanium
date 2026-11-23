/**
 * The launch options. The Android host knows two things the page cannot: that the user started the app from the
 * "Start without theme pack" shortcut, and whether touch exploration (TalkBack) is on. The page asks
 * (`requestLaunchOptions`) and the host answers through `window.__risuTaniumLaunchOptions`; the host keeps the decision for
 * the whole process and gives it to every ask, so a reload stays pack-free. A recents relaunch after the process ended is
 * not a new request. The answer comes from outside the page's own code, so only an exact boolean counts: `true` enters pack
 * safe mode, `false` ends the hold below, and anything else changes nothing.
 *
 * On Android the page starts held: no theme pack paints before the host has decided. The first call takes the hold, and the
 * boot waits for the decision at its theme step (`settlePackDecision`) for at most `ANSWER_WAIT_MS`, counted from that step.
 * With no answer the page enters pack safe mode as `noAnswer`, which shows the existing notice when a pack is active. A boot that
 * never reaches the theme step stays held. An answer that comes after the decision enters pack safe mode live (`true`) or
 * changes nothing (`false`), and the banner reads the touch-exploration state reactively.
 *
 * A warm shortcut launch tells the page through `window.__risuTaniumPackSafeModeReady`, and the page asks again.
 */
import { enterPackSafeMode, holdPackUntilDecided, releasePackHold, setBannerTouchExploration } from '../themePack/packSafeMode.svelte'
import type { KeepAliveHostObject } from './keepAliveService'

declare global {
    interface Window {
        /** Called by the host with the launch options object. */
        __risuTaniumLaunchOptions?: (options: unknown) => void
        /** Called by the host when the shortcut starts the app while it runs; the page then asks again. */
        __risuTaniumPackSafeModeReady?: () => void
    }
}

/** The longest the boot waits for the host's decision, counted from the theme step. */
const ANSWER_WAIT_MS = 2000

type Phase = 'none' | 'waiting' | 'done'

let activeHost: KeepAliveHostObject | null = null
let phase: Phase = 'none'
let started = false
let wakeSettle: (() => void) | null = null
/** True once an exact boolean answer arrived while the hold was ours. */
let decided = false
/** Whether the last ask could be made; without it no answer can come. */
let canAsk = false

/** The host's answer. It never throws: the host calls it through the page's script evaluation. */
function onAnswer(raw: unknown): void {
    try {
        if (typeof raw !== 'object' || raw === null) {
            return
        }
        const options = raw as Record<string, unknown>
        setBannerTouchExploration(options.touchExploration)
        if (options.packSafeMode === true) {
            decided = true
            enterPackSafeMode('shortcut')
            wakeSettle?.()
        } else if (options.packSafeMode === false) {
            decided = true
            releasePackHold()
            wakeSettle?.()
        }
    } catch (error) {
        console.error(error)
        wakeSettle?.()
    }
}

function askHost(): boolean {
    try {
        // Called as a method: the host bridge object needs its receiver.
        activeHost?.requestLaunchOptions?.()
        return activeHost !== null
    } catch (error) {
        console.error(error)
        return false
    }
}

function onReady(): void {
    canAsk = askHost()
}

/**
 * Takes the hold on the first call, then installs the answer hooks and asks the host for the launch options, when the host
 * can give them. Without `requestLaunchOptions` (an old host, no host) nothing is installed and no answer is possible. A host
 * that refuses the request is the same as no host. The hold comes first, so an answer inside the ask finds it. Never throws
 * and never waits: the wait is `settlePackDecision`.
 */
export function startLaunchOptions(host: KeepAliveHostObject | undefined): void {
    if (!started) {
        started = true
        try {
            if (holdPackUntilDecided()) {
                phase = 'waiting'
            }
        } catch (error) {
            console.error(error)
        }
    }
    if (host === undefined || typeof host.requestLaunchOptions !== 'function') {
        canAsk = false
        return
    }
    activeHost = host
    window.__risuTaniumLaunchOptions = onAnswer
    window.__risuTaniumPackSafeModeReady = onReady
    canAsk = askHost()
}

function waitForAnswer(): Promise<void> {
    return new Promise<void>((resolve) => {
        const timer = setTimeout(finish, ANSWER_WAIT_MS)
        function finish(): void {
            clearTimeout(timer)
            wakeSettle = null
            resolve()
        }
        wakeSettle = finish
    })
}

/**
 * The boot's theme step. Resolves at once unless the page is held by this module. While held it waits for the host's
 * decision at most `ANSWER_WAIT_MS`, and not at all when no answer is possible; with no decision by then the page enters pack
 * safe mode as `noAnswer`. Never rejects and never waits a second time.
 */
export async function settlePackDecision(): Promise<void> {
    if (phase !== 'waiting') {
        return
    }
    try {
        if (canAsk && !decided) {
            await waitForAnswer()
        }
    } catch (error) {
        console.error(error)
    }
    phase = 'done'
    if (!decided) {
        try {
            enterPackSafeMode('noAnswer')
        } catch (error) {
            console.error(error)
        }
    }
}

export function resetLaunchOptionsForTests(): void {
    activeHost = null
    phase = 'none'
    started = false
    wakeSettle = null
    decided = false
    canAsk = false
}
