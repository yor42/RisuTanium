// @vitest-environment jsdom
/**
 * The surface gate (T3G-1), all GUARD: no gate code exists at the base, so a red run would only be a missing module.
 * REAL: surfaceGate.svelte.ts. The probe elements are plain `style` elements; the cover is a rune object the test drives.
 */
import { flushSync } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, describe, expect, test } from 'vitest'
import { packBaseTone } from '../gui/surfaceTone'
import {
    declareSurface,
    installThemePackGate,
    registerThemePackElement,
    resetThemePackGateForTests,
    setThemePackElementBase,
    shownSurface,
    syncThemePackMedia,
} from './surfaceGate.svelte'

const cover = $state({ on: false })

function probe(area: string): HTMLStyleElement {
    const element = document.createElement('style')
    element.setAttribute('data-theme-pack', area)
    element.setAttribute('media', 'not all')
    document.head.appendChild(element)
    registerThemePackElement(element, area)
    return element
}

afterEach(() => {
    resetThemePackGateForTests()
    cover.on = false
    document.head.innerHTML = ''
})

describe('shownSurface', () => {
    test('is null while no gate is installed, even with a declaration', () => {
        declareSurface('chat')
        flushSync()
        expect(shownSurface()).toBeNull()
    })

    test('is null with the gate installed and nothing declared', () => {
        installThemePackGate(() => cover.on)
        flushSync()
        expect(shownSurface()).toBeNull()
    })

    test('is chat when declared and not covered', () => {
        installThemePackGate(() => cover.on)
        declareSurface('chat')
        flushSync()
        expect(shownSurface()).toBe('chat')
    })

    test('is null while covered and chat again after the cover lifts', () => {
        installThemePackGate(() => cover.on)
        declareSurface('chat')
        cover.on = true
        flushSync()
        expect(shownSurface()).toBeNull()
        cover.on = false
        flushSync()
        expect(shownSurface()).toBe('chat')
    })

    test('is null after the release', () => {
        installThemePackGate(() => cover.on)
        const release = declareSurface('chat')
        flushSync()
        release()
        flushSync()
        expect(shownSurface()).toBeNull()
    })

    test('two declarations then one release stay chat', () => {
        installThemePackGate(() => cover.on)
        const first = declareSurface('chat')
        declareSurface('chat')
        flushSync()
        first()
        flushSync()
        expect(shownSurface()).toBe('chat')
    })

    test('a double release is a no-op', () => {
        installThemePackGate(() => cover.on)
        const first = declareSurface('chat')
        declareSurface('chat')
        first()
        first()
        flushSync()
        expect(shownSurface()).toBe('chat')
    })

    test('a second install keeps the first cover', () => {
        installThemePackGate(() => cover.on)
        installThemePackGate(() => false)
        declareSurface('chat')
        cover.on = true
        flushSync()
        expect(shownSurface()).toBeNull()
    })

    test('a release that outlives a reset does not touch the new count', () => {
        installThemePackGate(() => cover.on)
        const stale = declareSurface('chat')
        resetThemePackGateForTests()
        installThemePackGate(() => cover.on)
        declareSurface('chat')
        stale()
        flushSync()
        expect(shownSurface()).toBe('chat')
    })
})

describe('the registered elements follow the gate after each flush', () => {
    test('a registered chat element is on exactly while the shell is shown', () => {
        installThemePackGate(() => cover.on)
        const element = probe('chat')
        flushSync()
        expect(element.getAttribute('media')).toBe('not all')
        const release = declareSurface('chat')
        flushSync()
        expect(element.getAttribute('media')).toBe('all')
        cover.on = true
        flushSync()
        expect(element.getAttribute('media')).toBe('not all')
        cover.on = false
        flushSync()
        expect(element.getAttribute('media')).toBe('all')
        release()
        flushSync()
        expect(element.getAttribute('media')).toBe('not all')
    })

    test('a registered studio or unknown element is always not all', () => {
        installThemePackGate(() => cover.on)
        const studio = probe('studio')
        const unknown = probe('home')
        const chat = probe('chat')
        declareSurface('chat')
        flushSync()
        expect(chat.getAttribute('media')).toBe('all')
        expect(studio.getAttribute('media')).toBe('not all')
        expect(unknown.getAttribute('media')).toBe('not all')
        syncThemePackMedia()
        expect(studio.getAttribute('media')).toBe('not all')
        expect(unknown.getAttribute('media')).toBe('not all')
    })

    test('unregistering stops the gate from writing the element', () => {
        installThemePackGate(() => cover.on)
        declareSurface('chat')
        const element = document.createElement('style')
        element.setAttribute('data-theme-pack', 'chat')
        document.head.appendChild(element)
        const unregister = registerThemePackElement(element, 'chat')
        flushSync()
        syncThemePackMedia()
        expect(element.getAttribute('media')).toBe('all')
        unregister()
        cover.on = true
        flushSync()
        syncThemePackMedia()
        expect(element.getAttribute('media')).toBe('all')
    })

    test('foreign row: an unregistered style[data-theme-pack] keeps its media through every sync', () => {
        installThemePackGate(() => cover.on)
        const absent = document.createElement('style')
        absent.setAttribute('data-theme-pack', 'chat')
        const set = document.createElement('style')
        set.setAttribute('data-theme-pack', 'chat')
        set.setAttribute('media', 'print')
        document.head.append(absent, set)
        const release = declareSurface('chat')
        flushSync()
        syncThemePackMedia()
        expect(absent.hasAttribute('media')).toBe(false)
        expect(set.getAttribute('media')).toBe('print')
        cover.on = true
        flushSync()
        release()
        flushSync()
        syncThemePackMedia()
        expect(absent.hasAttribute('media')).toBe(false)
        expect(set.getAttribute('media')).toBe('print')
    })

    test('a sync call outside the effect writes the same state the effect does', () => {
        installThemePackGate(() => cover.on)
        const element = probe('chat')
        declareSurface('chat')
        syncThemePackMedia()
        expect(element.getAttribute('media')).toBe('all')
        cover.on = true
        syncThemePackMedia()
        expect(element.getAttribute('media')).toBe('not all')
    })

    test('reset drops the registry: a later sync leaves a formerly registered element alone', () => {
        installThemePackGate(() => cover.on)
        const element = probe('chat')
        resetThemePackGateForTests()
        installThemePackGate(() => cover.on)
        declareSurface('chat')
        flushSync()
        syncThemePackMedia()
        expect(element.getAttribute('media')).toBe('not all')
    })
})

describe('the pack base: the root attribute and the base tone follow the sheet that is on', () => {
    // New behaviour: before the base existed neither was written. Every assertion runs synchronously after a sync, so a
    // deferred write would fail.
    const ATTRIBUTE = 'data-theme-pack-base'

    function expectBase(on: boolean): void {
        expect(document.documentElement.hasAttribute(ATTRIBUTE)).toBe(on)
        expect(document.body.hasAttribute(ATTRIBUTE)).toBe(false)
        expect(get(packBaseTone)).toBe(on ? 'dark' : null)
    }

    test('present while a registered chat element is on, absent when released', () => {
        installThemePackGate(() => cover.on)
        probe('chat')
        const release = declareSurface('chat')
        syncThemePackMedia()
        expectBase(true)
        release()
        syncThemePackMedia()
        expectBase(false)
    })

    test('absent while the cover is up and present again when it lifts', () => {
        installThemePackGate(() => cover.on)
        probe('chat')
        declareSurface('chat')
        syncThemePackMedia()
        expectBase(true)
        cover.on = true
        syncThemePackMedia()
        expectBase(false)
        cover.on = false
        syncThemePackMedia()
        expectBase(true)
    })

    test('the gate effect writes them too, without a direct sync', () => {
        installThemePackGate(() => cover.on)
        probe('chat')
        declareSurface('chat')
        flushSync()
        expectBase(true)
        cover.on = true
        flushSync()
        expectBase(false)
    })

    test('absent with chat shown and nothing registered', () => {
        installThemePackGate(() => cover.on)
        declareSurface('chat')
        syncThemePackMedia()
        expectBase(false)
    })

    test('unregistering the element clears them at the next sync', () => {
        installThemePackGate(() => cover.on)
        const element = probe('chat')
        const registered = registerThemePackElement(element, 'chat')
        declareSurface('chat')
        syncThemePackMedia()
        expectBase(true)
        registered()
        syncThemePackMedia()
        expectBase(false)
    })

    test('a studio-only registration with chat shown leaves them absent', () => {
        installThemePackGate(() => cover.on)
        probe('studio')
        declareSurface('chat')
        syncThemePackMedia()
        expectBase(false)
    })

    test('a foreign unregistered style[data-theme-pack] that is on never sets them', () => {
        installThemePackGate(() => cover.on)
        const foreign = document.createElement('style')
        foreign.setAttribute('data-theme-pack', 'chat')
        foreign.setAttribute('media', 'all')
        document.head.appendChild(foreign)
        declareSurface('chat')
        syncThemePackMedia()
        expectBase(false)
    })

    test('reset clears the attribute and the tone', () => {
        installThemePackGate(() => cover.on)
        probe('chat')
        declareSurface('chat')
        syncThemePackMedia()
        expectBase(true)
        resetThemePackGateForTests()
        expectBase(false)
    })
})

describe('the light base: the attribute value and the tone follow the base the element was registered with', () => {
    // TD13. The light cases are regression reproducers: before the third argument the gate wrote an empty value and the
    // dark tone for every element. The dark, cover and reset cases are compatibility guards.
    const ATTRIBUTE = 'data-theme-pack-base'

    function probeWith(base: 'dark' | 'light'): { element: HTMLStyleElement, unregister: () => void } {
        const element = document.createElement('style')
        element.setAttribute('data-theme-pack', 'chat')
        element.setAttribute('media', 'not all')
        document.head.appendChild(element)
        return { element, unregister: registerThemePackElement(element, 'chat', base) }
    }

    const value = (): string | null => document.documentElement.getAttribute(ATTRIBUTE)

    test('a light element writes the value light and the light tone; a dark one writes an empty value and the dark tone', () => {
        installThemePackGate(() => cover.on)
        declareSurface('chat')
        const dark = probeWith('dark')
        syncThemePackMedia()
        expect(value()).toBe('')
        expect(get(packBaseTone)).toBe('dark')
        dark.unregister()
        probeWith('light')
        syncThemePackMedia()
        expect(value()).toBe('light')
        expect(get(packBaseTone)).toBe('light')
    })

    test('a replacement with the other base rewrites the value while the attribute stays present', () => {
        installThemePackGate(() => cover.on)
        declareSurface('chat')
        const light = probeWith('light')
        syncThemePackMedia()
        expect(value()).toBe('light')
        light.unregister()
        light.element.remove()
        probeWith('dark')
        syncThemePackMedia()
        expect(value()).toBe('')
        expect(get(packBaseTone)).toBe('dark')
    })

    test('a cover removes the attribute and the tone, and lifting it restores the light base', () => {
        installThemePackGate(() => cover.on)
        declareSurface('chat')
        probeWith('light')
        syncThemePackMedia()
        cover.on = true
        syncThemePackMedia()
        expect(value()).toBeNull()
        expect(get(packBaseTone)).toBeNull()
        cover.on = false
        syncThemePackMedia()
        expect(value()).toBe('light')
        expect(get(packBaseTone)).toBe('light')
    })

    test('reset clears a light base', () => {
        installThemePackGate(() => cover.on)
        declareSurface('chat')
        probeWith('light')
        syncThemePackMedia()
        resetThemePackGateForTests()
        expect(value()).toBeNull()
        expect(get(packBaseTone)).toBeNull()
    })

    test('an element registered without a base is dark', () => {
        installThemePackGate(() => cover.on)
        declareSurface('chat')
        probe('chat')
        syncThemePackMedia()
        expect(value()).toBe('')
        expect(get(packBaseTone)).toBe('dark')
    })
})

describe('T16 a null base is shape mode: the element is on, but no base applies', () => {
    // New behaviour: before the null base every registered element that was on set the attribute and the tone.
    const ATTRIBUTE = 'data-theme-pack-base'

    function shapeProbe(): HTMLStyleElement {
        const element = document.createElement('style')
        element.setAttribute('data-theme-pack', 'chat')
        element.setAttribute('media', 'not all')
        document.head.appendChild(element)
        registerThemePackElement(element, 'chat', null)
        return element
    }

    test('a chat element with a null base is on, and sets no attribute and no tone', () => {
        installThemePackGate(() => cover.on)
        declareSurface('chat')
        const element = shapeProbe()
        syncThemePackMedia()
        expect(element.getAttribute('media')).toBe('all')
        expect(document.documentElement.hasAttribute(ATTRIBUTE)).toBe(false)
        expect(get(packBaseTone)).toBeNull()
    })

    test('re-registering the same element under a base turns the attribute on, and back to null turns it off', () => {
        installThemePackGate(() => cover.on)
        declareSurface('chat')
        const element = shapeProbe()
        syncThemePackMedia()
        setThemePackElementBase(element, 'light')
        syncThemePackMedia()
        expect(document.documentElement.getAttribute(ATTRIBUTE)).toBe('light')
        expect(get(packBaseTone)).toBe('light')
        setThemePackElementBase(element, null)
        syncThemePackMedia()
        expect(document.documentElement.hasAttribute(ATTRIBUTE)).toBe(false)
        expect(get(packBaseTone)).toBeNull()
        expect(element.getAttribute('media')).toBe('all')
    })

    test('setting the base of an element that is not registered does nothing', () => {
        installThemePackGate(() => cover.on)
        declareSurface('chat')
        const element = document.createElement('style')
        element.setAttribute('media', 'not all')
        document.head.appendChild(element)
        setThemePackElementBase(element, 'dark')
        syncThemePackMedia()
        expect(element.getAttribute('media')).toBe('not all')
        expect(document.documentElement.hasAttribute(ATTRIBUTE)).toBe(false)
    })
})