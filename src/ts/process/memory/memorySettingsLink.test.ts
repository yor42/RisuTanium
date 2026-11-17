import { get, writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../stores.svelte', () => ({
    SettingsMenuIndex: writable(0),
    settingsOpen: writable(false),
}))

import { SettingsMenuIndex, settingsOpen } from '../../stores.svelte'
import { openMemorySettings } from './memorySettingsLink'

describe('openMemorySettings', () => {
    beforeEach(() => {
        SettingsMenuIndex.set(5)
        settingsOpen.set(false)
    })

    test('opens the settings on the Other bots page (index 2)', () => {
        openMemorySettings()

        expect(get(SettingsMenuIndex)).toBe(2)
        expect(get(settingsOpen)).toBe(true)
    })

    test('guard: opening again leaves the same page open', () => {
        openMemorySettings()
        openMemorySettings()

        expect(get(SettingsMenuIndex)).toBe(2)
        expect(get(settingsOpen)).toBe(true)
    })
})
