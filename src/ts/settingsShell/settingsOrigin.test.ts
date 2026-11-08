// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        settingsOpen: writable(false),
        SettingsMenuIndex: writable(-1),
        DBState: { db: { characters: [] } },
        selIdState: { selId: -1 },
        MobileGUI: writable(false),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({}),
    }
})

import { DBState, SettingsMenuIndex, selIdState, settingsOpen } from '../stores.svelte'
import { tick } from 'svelte'
import { installChatSurface, resetChatSurfaceForTests } from '../../lib/ChatScreens/chatSurface.svelte'

const db = DBState as unknown as { db: { characters: Array<{ name: string }> } }
const selection = selIdState

import { openSettingsForFix, resetSettingsRouteForTests } from '../../lib/Setting/settingsRoute'
import {
    installSettingsOrigin, resetSettingsOriginForTests, restoreOpenerFocus, settingsOrigin,
} from './settingsOrigin'

function button(options: { part?: string, parent?: HTMLElement } = {}): HTMLButtonElement {
    const element = document.createElement('button')
    if (options.part) element.setAttribute('data-part', options.part)
    ;(options.parent ?? document.body).append(element)
    return element
}

beforeEach(() => {
    db.db.characters = []
    selection.selId = -1
    settingsOpen.set(false)
    SettingsMenuIndex.set(-1)
    resetSettingsRouteForTests()
    resetSettingsOriginForTests()
    installSettingsOrigin()
})

afterEach(() => {
    document.body.replaceChildren()
    resetSettingsRouteForTests()
    resetSettingsOriginForTests()
    resetChatSurfaceForTests()
})

describe('settings origin', () => {
    test('a chat on screen is the origin, captured at the closed to open change', () => {
        db.db.characters = [{ name: 'Seraphina' }]
        selection.selId = 0
        settingsOpen.set(true)
        selection.selId = -1
        expect(settingsOrigin()).toEqual({ kind: 'chat', name: 'Seraphina' })
    })

    test('no selected chat is the none origin', () => {
        db.db.characters = [{ name: 'Seraphina' }]
        settingsOpen.set(true)
        expect(settingsOrigin()).toEqual({ kind: 'none' })
    })

    test('installing twice records one open once', () => {
        installSettingsOrigin()
        db.db.characters = [{ name: 'A' }, { name: 'B' }]
        selection.selId = 0
        settingsOpen.set(true)
        selection.selId = 1
        settingsOpen.set(true)
        expect(settingsOrigin()).toEqual({ kind: 'chat', name: 'A' })
    })
})

describe('restoreOpenerFocus', () => {
    test('the captured opener gets focus again after the close', () => {
        const opener = button()
        opener.focus()
        settingsOpen.set(true)
        opener.blur()
        settingsOpen.set(false)
        restoreOpenerFocus()
        expect(document.activeElement).toBe(opener)
    })

    test('an opener that was unmounted and mounted again is found by its data-part', () => {
        const opener = button({ part: 'sidebar-settings' })
        opener.focus()
        settingsOpen.set(true)
        opener.remove()
        const remounted = button({ part: 'sidebar-settings' })
        settingsOpen.set(false)
        restoreOpenerFocus()
        expect(document.activeElement).toBe(remounted)
    })

    test('an opener without data-part that is gone throws nothing and leaves no detached node focused', () => {
        const opener = button()
        opener.focus()
        settingsOpen.set(true)
        opener.remove()
        const other = button()
        settingsOpen.set(false)
        expect(() => restoreOpenerFocus()).not.toThrow()
        expect(document.activeElement).not.toBe(opener)
        expect(document.activeElement).not.toBe(other)
        expect(document.body.contains(document.activeElement)).toBe(true)
    })

    test('an opener inside a still inert element is not focused', () => {
        const region = document.createElement('div')
        document.body.append(region)
        const opener = button({ parent: region })
        opener.focus()
        settingsOpen.set(true)
        region.setAttribute('inert', '')
        opener.blur()
        settingsOpen.set(false)
        restoreOpenerFocus()
        expect(document.activeElement).not.toBe(opener)
    })

    test('a data-part match inside an inert element is skipped for a live one', () => {
        const opener = button({ part: 'sidebar-settings' })
        opener.focus()
        settingsOpen.set(true)
        opener.remove()
        const inertRegion = document.createElement('div')
        inertRegion.setAttribute('inert', '')
        document.body.append(inertRegion)
        button({ part: 'sidebar-settings', parent: inertRegion })
        const live = button({ part: 'sidebar-settings' })
        settingsOpen.set(false)
        restoreOpenerFocus()
        expect(document.activeElement).toBe(live)
    })

    test('after the Fix route the opener is left alone for the failed-send card', () => {
        const opener = button()
        opener.focus()
        openSettingsForFix('botSettings')
        opener.blur()
        settingsOpen.set(false)
        restoreOpenerFocus()
        expect(document.activeElement).not.toBe(opener)
    })
})

function surfaceWithHeaderButton(): { surface: HTMLDivElement, header: HTMLButtonElement } {
    const surface = document.createElement('div')
    surface.setAttribute('data-chat-surface', '')
    const header = document.createElement('button')
    header.setAttribute('data-part', 'chat-header-menu')
    surface.append(header)
    document.body.append(surface)
    return { surface, header }
}

/** Opens and closes Settings the way App does: the surface goes inert while open and is released on close. */
async function openAndCloseLikeApp(surface: HTMLElement): Promise<void> {
    settingsOpen.set(true)
    surface.setAttribute('inert', '')
    settingsOpen.set(false)
    surface.removeAttribute('inert')
    await tick()
    restoreOpenerFocus()
}

describe('an opener blurred by the chat surface when Settings opens', () => {
    test('with the chat surface subscribed first, the This chat button gets focus back (T1)', async () => {
        resetSettingsOriginForTests()
        installChatSurface()
        installSettingsOrigin()
        const { surface, header } = surfaceWithHeaderButton()
        header.focus()
        settingsOpen.set(true)
        surface.setAttribute('inert', '')
        expect(document.activeElement).toBe(document.body)
        settingsOpen.set(false)
        surface.removeAttribute('inert')
        await tick()
        restoreOpenerFocus()
        expect(document.activeElement).toBe(header)
    })

    test('with the origin recorder subscribed first the result is the same (T5)', async () => {
        resetSettingsOriginForTests()
        installSettingsOrigin()
        installChatSurface()
        const { surface, header } = surfaceWithHeaderButton()
        header.focus()
        await openAndCloseLikeApp(surface)
        expect(document.activeElement).toBe(header)
    })

    test('an element that lost focus in an earlier turn is not the opener (T3)', async () => {
        resetSettingsOriginForTests()
        installChatSurface()
        installSettingsOrigin()
        const { surface, header } = surfaceWithHeaderButton()
        header.focus()
        header.blur()
        await Promise.resolve()
        await openAndCloseLikeApp(surface)
        expect(document.activeElement).toBe(document.body)
    })

    test('a focused element wins over one that lost focus in the same turn (T4)', async () => {
        const first = button()
        const second = button()
        first.focus()
        second.focus()
        settingsOpen.set(true)
        first.focus()
        settingsOpen.set(false)
        await tick()
        restoreOpenerFocus()
        expect(document.activeElement).toBe(second)
    })
})
