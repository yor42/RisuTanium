// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const MobileGUI = writable(false)
const isLite = writable(false)
vi.mock('../stores.svelte', () => ({ MobileGUI }))
vi.mock('../lite', () => ({ isLite }))

async function load() {
    vi.resetModules()
    return import('./settingsShellSwitch.svelte')
}

beforeEach(() => {
    localStorage.clear()
    MobileGUI.set(false)
    isLite.set(false)
})

describe('Settings shell switch', () => {
    test('an absent value defaults off without writing', async () => {
        const write = vi.spyOn(Storage.prototype, 'setItem')
        const { settingsShellSwitch } = await load()
        expect(settingsShellSwitch.enabled).toBe(false)
        expect(write).not.toHaveBeenCalled()
        write.mockRestore()
    })

    test('only the stored 1 reads on, and an unknown value is left in place', async () => {
        localStorage.setItem('risuSettings.enabled', '1')
        expect((await load()).settingsShellSwitch.enabled).toBe(true)
        for (const stored of ['0', 'yes', 'true', '']) {
            localStorage.setItem('risuSettings.enabled', stored)
            expect((await load()).settingsShellSwitch.enabled, `stored ${JSON.stringify(stored)}`).toBe(false)
            expect(localStorage.getItem('risuSettings.enabled')).toBe(stored)
        }
    })

    test('unreadable storage defaults off without writing', async () => {
        const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
        const write = vi.spyOn(Storage.prototype, 'setItem')
        expect((await load()).settingsShellSwitch.enabled).toBe(false)
        expect(write).not.toHaveBeenCalled()
        read.mockRestore()
        write.mockRestore()
    })

    test('the setter persists the choice and does not touch the chat shell key', async () => {
        const switcher = await load()
        switcher.setSettingsShellEnabled(true)
        expect(switcher.settingsShellSwitch.enabled).toBe(true)
        expect(localStorage.getItem('risuSettings.enabled')).toBe('1')
        expect(localStorage.getItem('risuChatShell.enabled')).toBeNull()
        switcher.setSettingsShellEnabled(false)
        expect(localStorage.getItem('risuSettings.enabled')).toBe('0')
        expect((await load()).settingsShellSwitch.enabled).toBe(false)
    })

    test('a throwing write keeps the in-memory choice', async () => {
        const switcher = await load()
        const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
        switcher.setSettingsShellEnabled(true)
        expect(switcher.settingsShellSwitch.enabled).toBe(true)
        write.mockRestore()
    })

    test('eligibility needs the switch on, no Beta Mobile GUI and no Lite build', async () => {
        const switcher = await load()
        expect(switcher.settingsShellEligible()).toBe(false)
        switcher.setSettingsShellEnabled(true)
        expect(switcher.settingsShellEligible()).toBe(true)
        MobileGUI.set(true)
        expect(switcher.settingsShellEligible(), 'Beta Mobile GUI').toBe(false)
        MobileGUI.set(false)
        isLite.set(true)
        expect(switcher.settingsShellEligible(), 'Lite build').toBe(false)
        isLite.set(false)
        expect(switcher.settingsShellEligible()).toBe(true)
    })
})
