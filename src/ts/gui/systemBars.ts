import { systemBarsHost } from '../android/hostBridge'

declare global {
    interface Window {
        /**
         * Android host: sets the colour behind the status and navigation bars as integer
         * 0-255 channels. Absent elsewhere; absence or a throw means the bars keep their colour.
         */
        __risuTaniumSystemBars?: { setBackground?: (red: number, green: number, blue: number) => unknown }
        /** Android host, separate-object path: the keyboard state. Absent elsewhere. */
        __risuTaniumIme?: { visible?: () => unknown; height?: () => unknown }
    }
}

/** The default dark scheme's background, used for any colour the browser cannot reduce to RGB. */
export const FALLBACK_BAR_COLOR = '#282a36'

export interface Rgb {
    red: number
    green: number
    blue: number
}

const FALLBACK_RGB: Rgb = { red: 0x28, green: 0x2a, blue: 0x36 }

// What `getComputedStyle` returns for a colour it could reduce to sRGB: comma or space
// separated channels, with or without alpha. Anything else (oklch, color-mix, color()) is not
// this shape.
const COMPUTED_RGB = /^rgba?\(\s*(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i

const channel = (text: string): number => Math.min(255, Math.max(0, Math.round(Number(text))))

/**
 * A CSS colour string reduced to opaque RGB by the browser's own parser. Alpha is ignored: the
 * bars are painted opaque. A string the browser rejects, and a computed value that is not
 * `rgb()`/`rgba()`, give the default dark scheme's background. The probe is attached to the
 * document while it is read, because a detached element has no computed style.
 */
export function cssColorToRgb(value: string): Rgb {
    if (typeof document === 'undefined' || !document.body) {
        return FALLBACK_RGB
    }
    const probe = document.createElement('div')
    probe.style.display = 'none'
    probe.style.backgroundColor = value
    // An invalid colour is dropped by the assignment and reads back empty; it would otherwise
    // compute to transparent, which is black here.
    if (probe.style.backgroundColor === '') {
        return FALLBACK_RGB
    }
    document.body.appendChild(probe)
    try {
        const match = COMPUTED_RGB.exec(getComputedStyle(probe).backgroundColor.trim())
        return match ? { red: channel(match[1]), green: channel(match[2]), blue: channel(match[3]) } : FALLBACK_RGB
    } finally {
        probe.remove()
    }
}

// From page load until the boot screen hands over, the host keeps its own boot colour on the bars,
// so a colour the page applies meanwhile is only remembered; the last one wins. The release sends
// it once, after the frame that paints the app has gone out, so the bars never change while the
// boot screen is still visible. The wait is approximate and only ever later than that frame,
// never earlier. Afterwards every colour goes straight to the host.
let released = false
let held: string | null = null
let releaseScheduled = false

function sendToHost(color: string): void {
    try {
        const bridge = systemBarsHost()
        if (!bridge || typeof bridge.setBackground !== 'function') {
            return
        }
        const { red, green, blue } = cssColorToRgb(color)
        // Called as a method: the host bridge object needs its receiver.
        bridge.setBackground(red, green, blue)
    } catch {
        // The bars keep their previous colour.
    }
}

/**
 * Tells the Android host which colour the page's background is, so the bars around the page
 * match the scheme. Before the boot hand-over the colour is only held (see `releaseSystemBars`).
 * A no-op where the host bridge is absent (web, desktop, iOS); a failing host never breaks the
 * colour scheme change that called this.
 */
export function syncSystemBars(color: string): void {
    if (!released) {
        held = color
        return
    }
    sendToHost(color)
}

/** Ends the hold: sends the last held colour once, if any; later calls do nothing. */
export function releaseSystemBars(): void {
    if (released) {
        return
    }
    released = true
    const color = held
    held = null
    if (color !== null) {
        sendToHost(color)
    }
}

/** Releases the hold after the frame that follows this call has painted; only the first call schedules. */
export function releaseSystemBarsAfterPaint(): void {
    if (releaseScheduled) {
        return
    }
    releaseScheduled = true
    // Resolved at call time so a missing or replaced requestAnimationFrame is honoured.
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => { setTimeout(releaseSystemBars, 0) })
    } else {
        setTimeout(releaseSystemBars, 0)
    }
}

/** Returns the hold to its page-load state. */
export function resetSystemBarsForTests(): void {
    released = false
    held = null
    releaseScheduled = false
}
