// Device-local seasonal logo preferences. Both keys are plain localStorage values, never part of the saved database or
// a .bin: losing them costs one replay or one toggle. Every storage access can throw (private mode, quota, disabled
// storage); failure means "enabled" and "not played yet", and a toggle still takes effect for the session.

export const SEASONAL_LOGO_KEY = 'risutanium.seasonalLogo'
export const SEASONAL_LAST_PLAYED_KEY = 'risutanium.seasonalLogo.lastPlayed'

const OFF = '0'

function readEnabled(): boolean {
    try {
        return localStorage.getItem(SEASONAL_LOGO_KEY) !== OFF
    } catch {
        return true
    }
}

const state = $state({ enabled: readEnabled() })

/** Whether the top-bar logo may celebrate. Reactive. Absent key means on. */
export function seasonalLogoEnabled(): boolean {
    return state.enabled
}

export function setSeasonalLogoEnabled(enabled: boolean): void {
    state.enabled = enabled
    try {
        if (enabled) localStorage.removeItem(SEASONAL_LOGO_KEY)
        else localStorage.setItem(SEASONAL_LOGO_KEY, OFF)
    } catch {
        // The choice holds for this session only.
    }
}

/** Re-reads the stored toggle; tests call it after changing storage behind the module's back. */
export function reloadSeasonalPrefs(): void {
    state.enabled = readEnabled()
}

/** The device-local calendar day as YYYY-MM-DD. */
export function localYmd(date: Date): string {
    const pad = (n: number): string => (n < 10 ? '0' : '') + n
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/** True when the full animation already played on this device on that day. Unreadable storage counts as not played. */
export function playedToday(ymd: string): boolean {
    try {
        return localStorage.getItem(SEASONAL_LAST_PLAYED_KEY) === ymd
    } catch {
        return false
    }
}

export function markPlayed(ymd: string): void {
    try {
        localStorage.setItem(SEASONAL_LAST_PLAYED_KEY, ymd)
    } catch {
        // Not remembered: the animation may play again on the next view.
    }
}
