// This device's UI-sound switch, stored like the haptics switch (MC-2312): absent or unknown means "on where supported".
export const UI_SOUNDS_KEY = 'risutanium.uiSounds'

type AudioContextCtor = typeof AudioContext

function audioContextCtor(): AudioContextCtor | undefined {
    const scope = globalThis as typeof globalThis & { webkitAudioContext?: AudioContextCtor }
    return scope.AudioContext ?? scope.webkitAudioContext
}

/** Read per call, never cached: a page without Web Audio simply has no UI sounds. */
export function uiSoundsSupported(): boolean {
    return typeof audioContextCtor() === 'function'
}

/** The constructor the player builds its context from, or undefined where the page has no Web Audio. */
export function uiSoundContextCtor(): AudioContextCtor | undefined {
    return audioContextCtor()
}

export function readUiSounds(supported = uiSoundsSupported()): boolean {
    try {
        const stored = localStorage.getItem(UI_SOUNDS_KEY)
        return stored === '1' ? supported : stored === '0' ? false : supported
    } catch {
        return supported
    }
}

export function writeUiSounds(enabled: boolean): void {
    try {
        localStorage.setItem(UI_SOUNDS_KEY, enabled ? '1' : '0')
    } catch {
        // Device storage may be unavailable without affecting the rest of the app.
    }
}
