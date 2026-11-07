/**
 * Where focus goes when the sidebar overlay ends. A switch made from the keyboard in the overlay
 * names the element that should hold focus afterwards; a pointer switch names nothing and focus
 * returns to the opener. The name is a function so the element is looked up when the overlay has
 * finished closing, not when the switch started.
 */

export type OverlayFocusResolver = () => HTMLElement | null

let resolver: OverlayFocusResolver | null = null

/** Names where focus lands when the current overlay ends; null clears it. */
export function setOverlayReturnFocus(resolve: OverlayFocusResolver | null): void {
    resolver = resolve
}

/** The resolver set for the overlay that is ending, cleared so it serves one close only. */
export function takeOverlayReturnFocus(): OverlayFocusResolver | null {
    const taken = resolver
    resolver = null
    return taken
}

/**
 * The element a keyboard switch should end on: the retry control when the switch failed, the
 * switch frame while the character is still loading, else the transcript of the opened chat.
 */
export function resolveSwitchFocus(phase: 'idle' | 'loading' | 'failed'): HTMLElement | null {
    if (phase === 'failed') {
        return document.querySelector<HTMLElement>('[data-part="chat-switch-retry"]')
    }
    if (phase === 'loading') {
        return document.querySelector<HTMLElement>('[data-part="chat-switch-frame"]')
    }
    return document.querySelector<HTMLElement>('[data-part="chat-transcript"]')
}
