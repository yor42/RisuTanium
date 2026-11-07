// @vitest-environment jsdom
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../stores.svelte', async () => {
    const { writable: makeWritable } = await import('svelte/store')
    return { SettingsMenuIndex: makeWritable(-1), settingsOpen: makeWritable(false) }
})

import { SettingsMenuIndex, settingsOpen } from '../stores.svelte'
import { fixPending, openSettingsForFix, resetSettingsRouteForTests } from '../../lib/Setting/settingsRoute'
import {
    isPhoneWidth, PHONE_MAX_WIDTH, readLastPage, resolveOpenIndex, setShellBackHandler, settingsShellBackStep,
    settingsShellEscape, writeLastPage,
} from './settingsNavigation'

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

beforeEach(() => {
    localStorage.clear()
    SettingsMenuIndex.set(-1)
    settingsOpen.set(false)
    resetSettingsRouteForTests()
})

afterEach(() => {
    setShellBackHandler(null)
    vi.restoreAllMocks()
    resetSettingsRouteForTests()
})

describe('phone width', () => {
    test('599 is a phone and 600 is not', () => {
        expect(PHONE_MAX_WIDTH).toBe(599)
        expect(isPhoneWidth(599)).toBe(true)
        expect(isPhoneWidth(600)).toBe(false)
        expect(isPhoneWidth(412)).toBe(true)
    })
})

describe('resolveOpenIndex', () => {
    test.each([412, 600, 1280])('a requested page is kept at width %i', (width) => {
        expect(resolveOpenIndex({ index: 2, width, stored: 'display' })).toBe(2)
    })

    test('a phone width keeps -1 even with a stored page', () => {
        expect(resolveOpenIndex({ index: -1, width: 412, stored: 'display' })).toBe(-1)
        expect(resolveOpenIndex({ index: -1, width: 599, stored: 'display' })).toBe(-1)
    })

    test.each([600, 1280])('the wide layout turns -1 into the stored page at width %i', (width) => {
        expect(resolveOpenIndex({ index: -1, width, stored: 'display' })).toBe(3)
        expect(resolveOpenIndex({ index: -1, width, stored: 'extensions' })).toBe(4)
    })

    test('a missing or unknown stored page falls back to Chat bot', () => {
        expect(resolveOpenIndex({ index: -1, width: 1280, stored: null })).toBe(1)
        expect(resolveOpenIndex({ index: -1, width: 1280, stored: 'garbage' })).toBe(1)
    })
})

describe('last page storage', () => {
    test('a written page reads back', () => {
        writeLastPage('display')
        expect(localStorage.getItem('risuSettings.lastPage')).toBe('display')
        expect(readLastPage()).toBe('display')
    })

    test('an absent value reads null', () => {
        expect(readLastPage()).toBeNull()
    })

    test('an unknown stored id reads null instead of passing through', () => {
        localStorage.setItem('risuSettings.lastPage', 'retired-page')
        expect(readLastPage()).toBeNull()
    })

    test('a throwing read gives null and a throwing write does not throw', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
        expect(readLastPage()).toBeNull()
        expect(() => writeLastPage('models')).not.toThrow()
    })
})

describe('settingsShellBackStep', () => {
    test('a phone page goes up to the index and stays open', () => {
        setWidth(412)
        settingsOpen.set(true)
        SettingsMenuIndex.set(3)
        settingsShellBackStep()
        expect(get(SettingsMenuIndex)).toBe(-1)
        expect(get(settingsOpen)).toBe(true)
    })

    test('the phone index closes Settings', () => {
        setWidth(412)
        settingsOpen.set(true)
        settingsShellBackStep()
        expect(get(settingsOpen)).toBe(false)
    })

    test('a width of 650 closes from a page instead of going up', () => {
        setWidth(650)
        settingsOpen.set(true)
        SettingsMenuIndex.set(3)
        settingsShellBackStep()
        expect(get(settingsOpen)).toBe(false)
        expect(get(SettingsMenuIndex), 'the reset belongs to the surface teardown').toBe(3)
    })

    test('after the Fix route a phone page closes outright and the failed-send card is told', () => {
        setWidth(412)
        openSettingsForFix('botSettings')
        expect(get(settingsOpen)).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(1)
        settingsShellBackStep()
        expect(get(settingsOpen)).toBe(false)
        expect(get(fixPending)).toBe(true)
    })
})

describe('settingsShellEscape', () => {
    test('no registered shell handler answers false without doing anything', () => {
        settingsOpen.set(true)
        expect(settingsShellEscape()).toBe(false)
        expect(get(settingsOpen)).toBe(true)
    })

    test('a registered handler is the one that runs, and the press counts as handled whatever it answered', () => {
        const handler = vi.fn(() => false)
        setShellBackHandler(handler)
        expect(settingsShellEscape()).toBe(true)
        expect(handler).toHaveBeenCalledTimes(1)
    })

    test('clearing the handler returns to the unmounted answer', () => {
        setShellBackHandler(() => true)
        setShellBackHandler(null)
        expect(settingsShellEscape()).toBe(false)
    })
})
