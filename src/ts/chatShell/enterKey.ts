import type { EnterMode } from './deviceSettings'
import { isImeComposing } from '../ime/compositionGuard'

const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Tab', 'Escape'])

type EnterKeyEvent = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'isComposing' | 'keyCode'>
type DetectionKeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'isTrusted'>

export function createEnterKeyController() {
    let hardwareSeen = false
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
        shouldSend(event: EnterKeyEvent, mode: EnterMode): boolean {
            if (event.key !== 'Enter' || event.shiftKey || isImeComposing(event)) return false
            return mode === 'send' || (mode === 'auto' && hardwareSeen)
        },
    }
}
