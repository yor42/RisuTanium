/**
 * The page control that was focused when an alert that covers the page opened. The alert's own box takes focus and the
 * page goes inert, so by the time the alert closes (or a picker or task card opens from inside it) the control has lost
 * focus; this module keeps it until `alertFocusReturn` hands focus back. It imports nothing, so any layer can use it.
 */

let pending: HTMLElement | null = null

/** Remembers the control to return focus to; `null` forgets it. */
export function noteAlertOpener(element: HTMLElement | null): void {
    pending = element
}

/** The remembered control, or `null`. It is not consumed. */
export function pendingAlertOpener(): HTMLElement | null {
    return pending
}

/** Forgets the remembered control. */
export function clearAlertOpener(): void {
    pending = null
}

/**
 * The control a picker or card should treat as the one that opened it. `active` counts when it is a real element on the
 * page, not the body and not inside the alert (an alert control is removed with the alert). Otherwise the control the
 * covering alert remembered counts, while it is still in the page; otherwise there is none.
 */
export function pageOpener(active: Element | null): HTMLElement | null {
    if (
        typeof HTMLElement !== 'undefined' &&
        active instanceof HTMLElement &&
        active !== active.ownerDocument.body &&
        active.closest('[data-alert-root]') === null
    ) {
        return active
    }
    return pending !== null && pending.isConnected ? pending : null
}
