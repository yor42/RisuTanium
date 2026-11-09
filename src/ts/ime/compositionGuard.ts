// The keydown that follows compositionend is the user's own press; only a key sent while a composition is live is held.
export function isImeComposing(event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean {
    return event.isComposing || event.keyCode === 229
}
