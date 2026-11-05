import type { EnterMode } from './deviceSettings'

const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Tab', 'Escape'])

type EnterKeyEvent = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'isComposing' | 'keyCode'>
type DetectionKeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'isTrusted'>

export function createEnterKeyController() {
    let hardwareSeen = false
    let lastCompositionEnd = -Infinity
    let compositionActive = false
    let viewportHeight: number | null = null

    return {
        get hardwareSeen() { return hardwareSeen },
        touch(): void { hardwareSeen = false },
        observeKey(event: DetectionKeyEvent): void {
            if (event.isTrusted && (NAVIGATION_KEYS.has(event.key) || event.ctrlKey || event.altKey)) hardwareSeen = true
        },
        observeViewport(height: number, textFieldFocused: boolean): void {
            if (textFieldFocused && viewportHeight !== null && viewportHeight - height > 150) hardwareSeen = false
            viewportHeight = height
        },
        compositionStart(): void { compositionActive = true },
        compositionEnd(now = performance.now()): void {
            compositionActive = false
            lastCompositionEnd = now
        },
        shouldSend(event: EnterKeyEvent, mode: EnterMode, now = performance.now()): boolean {
            if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229 || compositionActive || now - lastCompositionEnd < 30) return false
            return mode === 'send' || (mode === 'auto' && hardwareSeen)
        },
    }
}
