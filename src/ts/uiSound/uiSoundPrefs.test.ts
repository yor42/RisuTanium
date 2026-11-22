// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UI_SOUNDS_KEY, readUiSounds, uiSoundsSupported, writeUiSounds } from './uiSoundPrefs'
import { installFakeAudio } from './uiSound.testKit'

beforeEach(() => localStorage.clear())

// Compatibility guard on a new module (an import failure before the change does not count as a reproducer).
describe('UI sound prefs', () => {
    it('defaults to the capability, keeps an unknown stored value and reads it as the default', () => {
        expect(readUiSounds(true)).toBe(true)
        expect(readUiSounds(false)).toBe(false)
        localStorage.setItem(UI_SOUNDS_KEY, 'future')
        expect(readUiSounds(true)).toBe(true)
        expect(localStorage.getItem(UI_SOUNDS_KEY)).toBe('future')
    })

    it('stores the choice under risutanium.uiSounds and a stored off wins over support', () => {
        expect(UI_SOUNDS_KEY).toBe('risutanium.uiSounds')
        writeUiSounds(false)
        expect(localStorage.getItem('risutanium.uiSounds')).toBe('0')
        expect(readUiSounds(true)).toBe(false)
        writeUiSounds(true)
        expect(localStorage.getItem('risutanium.uiSounds')).toBe('1')
        expect(readUiSounds(true)).toBe(true)
        // A stored on cannot enable sounds on a page without Web Audio.
        expect(readUiSounds(false)).toBe(false)
    })

    it('follows an AudioContext installed after import, because support is read per call', () => {
        expect(uiSoundsSupported()).toBe(false)
        const audio = installFakeAudio()
        try {
            expect(uiSoundsSupported()).toBe(true)
        } finally {
            audio.uninstall()
        }
        expect(uiSoundsSupported()).toBe(false)
    })

    it('accepts the webkit-prefixed constructor', () => {
        const scope = globalThis as Record<string, unknown>
        scope.webkitAudioContext = class {}
        try {
            expect(uiSoundsSupported()).toBe(true)
        } finally {
            delete scope.webkitAudioContext
        }
    })
})

afterEach(() => localStorage.clear())
