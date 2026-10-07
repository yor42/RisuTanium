/**
 * Whether a key event began while the app's keys were blocked (a prompt is waiting, or an alert
 * covers the page). Decided once per event, by a capture listener that runs before any other
 * listener of the event can change the alert. The app's page-wide key listeners read this
 * snapshot; the hotkey listener itself reads the live state.
 *
 * This module imports nothing, so a component can use it without loading the alert machinery.
 * `initHotkey()` registers the live reader.
 */

/** Present for an event the recorder saw, true or false; absent for one it never saw. */
const recorded = new WeakMap<KeyboardEvent, boolean>()

let liveReader: (() => boolean) | null = null

export function setLiveKeysBlockedReader(reader: () => boolean): void {
    liveReader = reader
}

export function recordKeyEventBlocked(ev: KeyboardEvent, blocked: boolean): void {
    recorded.set(ev, blocked)
}

/** The current blocked state, for a handler that has no key event (a context menu opened from the keyboard or the mouse). False with no reader. */
export function keysBlockedNow(): boolean {
    return liveReader ? liveReader() : false
}

/** The value recorded for `ev`; for an event never recorded, the live reader's answer, or false with no reader. */
export function keyEventBlocked(ev: KeyboardEvent): boolean {
    const value = recorded.get(ev)
    if (value !== undefined) {
        return value
    }
    return liveReader ? liveReader() : false
}
