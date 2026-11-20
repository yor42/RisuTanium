// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { readSettingsShellStoredChoice, SETTINGS_SHELL_STORAGE_KEY } from './settingsShellStoredChoice'

function stubStorage(value: string | null) {
    vi.stubGlobal('localStorage', { getItem: (key: string) => (key === SETTINGS_SHELL_STORAGE_KEY ? value : null) })
}

// unstubAllGlobals would also drop the global the vitest setup stubs, so only localStorage is put back.
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

afterEach(() => {
    if (originalLocalStorage) {
        Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
    } else {
        Reflect.deleteProperty(globalThis, 'localStorage')
    }
})

describe('readSettingsShellStoredChoice', () => {
    test('the key is the one the switch has always used', () => {
        expect(SETTINGS_SHELL_STORAGE_KEY).toBe('risuSettings.enabled')
    })

    test('only a stored 1 reads as on', () => {
        stubStorage('1')
        expect(readSettingsShellStoredChoice()).toBe(true)
        stubStorage('0')
        expect(readSettingsShellStoredChoice()).toBe(false)
        stubStorage('true')
        expect(readSettingsShellStoredChoice()).toBe(false)
    })

    test('a missing value reads as off', () => {
        stubStorage(null)
        expect(readSettingsShellStoredChoice()).toBe(false)
    })

    test('no storage at all reads as off', () => {
        vi.stubGlobal('localStorage', undefined)
        expect(readSettingsShellStoredChoice()).toBe(false)
    })

    test('storage that throws reads as off', () => {
        vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') } })
        expect(readSettingsShellStoredChoice()).toBe(false)
    })
})
