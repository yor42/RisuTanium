declare global {
    interface Window {
        /**
         * Android host: sets the colour behind the status and navigation bars as integer
         * 0-255 channels. Absent elsewhere; absence or a throw means the bars keep their colour.
         */
        __risuTaniumSystemBars?: { setBackground?: (red: number, green: number, blue: number) => unknown }
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

/**
 * Tells the Android host which colour the page's background is, so the bars around the page
 * match the scheme. A no-op where the host bridge is absent (web, desktop, iOS); a failing
 * host never breaks the colour scheme change that called this.
 */
export function syncSystemBars(color: string): void {
    try {
        const bridge = window.__risuTaniumSystemBars
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
