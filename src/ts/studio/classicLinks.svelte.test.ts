import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable } from 'svelte/store'

const CharConfigSubMenu = writable(0)
const SettingsMenuIndex = writable(-1)
const settingsOpen = writable(false)
const botMakerMode = writable(false)
const sideBarStore = writable(false)
const QuickSettings = $state({ open: true })
const shell = { eligible: false }

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('../stores.svelte', () => ({
    get CharConfigSubMenu() { return CharConfigSubMenu },
    get SettingsMenuIndex() { return SettingsMenuIndex },
    get settingsOpen() { return settingsOpen },
    get botMakerMode() { return botMakerMode },
    get sideBarStore() { return sideBarStore },
    get QuickSettings() { return QuickSettings },
}))
vi.mock('../chatShell/shellSwitch.svelte', () => ({ shellEligible: () => shell.eligible }))

import { classicDestinationOf, classicLinks, clearClassicLinkRequest, openInClassicEditor, routeOf, studioClosingToCharacterEditor } from './classicLinks.svelte'
import { studioOpen } from './studioOpen'
import type { StudioKind } from './ownerModel'
import type { StudioOwnerType } from './studioTarget'

// What the stores held at the moment each one was written, to prove Studio was already closed.
let studioWasOpenAt: Record<string, boolean>
const stops: (() => void)[] = []

function watchOrder(): void {
    studioWasOpenAt = {}
    let first = true
    const note = (name: string) => () => {
        if (first) return
        studioWasOpenAt[name] = get(studioOpen)
    }
    stops.push(CharConfigSubMenu.subscribe(note('tab')))
    stops.push(SettingsMenuIndex.subscribe(note('settingsIndex')))
    stops.push(settingsOpen.subscribe(note('settingsOpen')))
    stops.push(botMakerMode.subscribe(note('botMakerMode')))
    stops.push(sideBarStore.subscribe(note('sideBar')))
    first = false
}

beforeEach(() => {
    shell.eligible = false
    CharConfigSubMenu.set(0)
    SettingsMenuIndex.set(-1)
    settingsOpen.set(false)
    botMakerMode.set(false)
    sideBarStore.set(false)
    QuickSettings.open = true
    clearClassicLinkRequest()
    studioOpen.set(true)
    watchOrder()
})

afterEach(() => {
    for (const stop of stops.splice(0)) stop()
    studioOpen.set(false)
    clearClassicLinkRequest()
})

describe('4e destinations', () => {
    const characterTabs: [StudioKind, number][] = [
        ['basic', 0], ['display', 1], ['advanced', 2], ['toggles', 2], ['lore', 3], ['scripts', 4], ['regex', 4], ['html', 4],
    ]

    test.each(characterTabs)('character %s opens character settings tab %i', (kind, tab) => {
        expect(classicDestinationOf('character', kind)).toEqual({ where: 'character', tab })
    })

    test('the chat lore opens the lorebook tab, whatever the kind asked', () => {
        expect(classicDestinationOf('chat', 'lore')).toEqual({ where: 'character', tab: 3 })
        expect(classicDestinationOf('chat', null)).toEqual({ where: 'character', tab: 3 })
    })

    test('the owner as a whole opens the first tab of a character', () => {
        expect(classicDestinationOf('character', null)).toEqual({ where: 'character', tab: 0 })
    })

    const settingsPages: [StudioOwnerType, StudioKind | null, number][] = [
        ['module', 'lore', 14], ['module', null, 14], ['preset', 'regex', 1], ['preset', 'toggles', 1],
        ['preset', 'advanced', 13], ['plugin', 'plugin', 4], ['plugin', null, 4],
    ]

    test.each(settingsPages)('%s %s opens Settings page %i', (owner, kind, index) => {
        expect(classicDestinationOf(owner, kind)).toEqual({ where: 'settings', index })
    })
})

describe('4e Studio closes first', () => {
    test('a character link closes Studio before any store is written', () => {
        openInClassicEditor('character', 'lore')
        expect(get(studioOpen)).toBe(false)
        expect(get(CharConfigSubMenu)).toBe(3)
        expect(studioWasOpenAt).toEqual({ tab: false, botMakerMode: false, sideBar: false })
    })

    test('a Settings link closes Studio before Settings is shown', () => {
        expect(openInClassicEditor('module', 'lore')).toBe(true)
        expect(get(studioOpen)).toBe(false)
        expect(get(SettingsMenuIndex)).toBe(14)
        expect(get(settingsOpen)).toBe(true)
        expect(studioWasOpenAt).toEqual({ settingsIndex: false, settingsOpen: false })
    })
})

describe('the character link-out flag', () => {
    // What a studioOpen subscriber sees at the moment Studio closes.
    function flagAtClose(): boolean[] {
        const seen: boolean[] = []
        stops.push(studioOpen.subscribe((open) => {
            if (!open) seen.push(studioClosingToCharacterEditor())
        }))
        return seen
    }

    test('F: it is true while Studio closes for a character destination, and false before and after', () => {
        const seen = flagAtClose()
        expect(studioClosingToCharacterEditor()).toBe(false)

        openInClassicEditor('character', 'lore')

        expect(seen).toEqual([true])
        expect(studioClosingToCharacterEditor()).toBe(false)
    })

    test('G: a Settings destination never sets it', () => {
        const seen = flagAtClose()

        openInClassicEditor('module', 'lore')

        expect(seen).toEqual([false])
        expect(studioClosingToCharacterEditor()).toBe(false)
    })

    test('G: a close not made by a link-out does not set it', () => {
        const seen = flagAtClose()

        studioOpen.set(false)

        expect(seen).toEqual([false])
    })

    test('G: it is reset when a subscriber of the close throws', () => {
        stops.push(studioOpen.subscribe((open) => {
            if (!open) throw new Error('subscriber failed')
        }))

        expect(() => openInClassicEditor('character', null)).toThrow('subscriber failed')

        expect(studioClosingToCharacterEditor()).toBe(false)
    })

    test('G: a destination with no classic editor closes nothing and sets nothing', () => {
        const seen = flagAtClose()

        expect(openInClassicEditor('widget' as StudioOwnerType, null)).toBe(false)

        expect(get(studioOpen)).toBe(true)
        expect(seen).toEqual([])
    })
})

describe('4f route selection', () => {
    test('without the new shell the classic buttons are pressed and no request is stored', () => {
        expect(routeOf()).toBe('classic')
        openInClassicEditor('character', 'scripts')
        expect(get(CharConfigSubMenu)).toBe(4)
        expect(get(botMakerMode)).toBe(true)
        expect(QuickSettings.open).toBe(false)
        expect(get(sideBarStore)).toBe(true)
        expect(classicLinks.request).toBeNull()
    })

    test('with the new shell a single-shot request is stored and the classic buttons are left alone', () => {
        shell.eligible = true
        expect(routeOf()).toBe('shell')
        openInClassicEditor('character', 'lore')
        expect(get(CharConfigSubMenu)).toBe(3)
        expect(classicLinks.request).toEqual({ view: 'characterSettings' })
        expect(get(sideBarStore)).toBe(true)
        expect(get(botMakerMode)).toBe(false)
        expect(QuickSettings.open).toBe(true)
    })

    test('a Settings link stores no request on either route', () => {
        for (const eligible of [false, true]) {
            shell.eligible = eligible
            studioOpen.set(true)
            openInClassicEditor('preset', 'regex')
            expect(get(SettingsMenuIndex)).toBe(1)
            expect(classicLinks.request).toBeNull()
            settingsOpen.set(false)
        }
    })
})
