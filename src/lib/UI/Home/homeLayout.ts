// Home's own width bands. They are local to Home and not published as a global attribute; the chat
// shell keeps its own bands.

export type HomeBand = 'phone' | 'mid' | 'wide'

/** First width, in CSS pixels, of the mid band. */
export const HOME_MID_MIN = 768

/** First width, in CSS pixels, of the wide band. */
export const HOME_WIDE_MIN = 1280

/**
 * First width, in CSS pixels, of the top bar itself at which the wide band keeps its one-row layout. It is a
 * header width, not a viewport width: a docked sidebar makes the bar narrower than the window. Below it a
 * wide band's bar takes the mid layout (two rows), because the one-row layout needs this much room for the
 * wordmark, the switcher and the chip cluster. The landing, the drawer and the lattice keep reading the band.
 */
export const WIDE_BAR_MIN = 1248

/** The band of a viewport width: phone below 768, mid from 768 to 1279, wide from 1280. */
export function homeBand(width: number): HomeBand {
    if (width >= HOME_WIDE_MIN) {
        return 'wide'
    }
    if (width >= HOME_MID_MIN) {
        return 'mid'
    }
    return 'phone'
}
