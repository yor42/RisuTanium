const KEY = 'risuChatShell.haptics'
export type HapticEvent = 'commit' | 'arm' | 'scroll'

export function hapticsSupported(vibrate: ((duration: number) => boolean) | undefined = typeof navigator === 'undefined' ? undefined : navigator.vibrate?.bind(navigator)): boolean {
    return typeof vibrate === 'function'
}

export function readHaptics(supported = hapticsSupported()): boolean {
    try {
        const stored = localStorage.getItem(KEY)
        return stored === '1' ? supported : stored === '0' ? false : supported
    } catch {
        return supported
    }
}

export function writeHaptics(enabled: boolean): void {
    try {
        localStorage.setItem(KEY, enabled ? '1' : '0')
    } catch {
        // Device storage may be unavailable without affecting gesture handling.
    }
}

// SLICE1_SPEC §2: only touch commits and arm transitions get a 10 ms tick.
export function tickHaptic(event: HapticEvent, pointerType: string, enabled: boolean, vibrate: ((duration: number) => boolean) | undefined = typeof navigator === 'undefined' ? undefined : navigator.vibrate?.bind(navigator)): boolean {
    if (!enabled || pointerType !== 'touch' || event === 'scroll' || !hapticsSupported(vibrate)) return false
    return vibrate!(10)
}
