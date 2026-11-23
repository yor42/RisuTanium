// @vitest-environment jsdom
/**
 * The target a classic toggle field's "Edit in Studio" link leads to, and the order in which a link from Settings
 * closes Settings and opens Studio. New behaviour (class G): the evidence is the mutant each row kills.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable } from 'svelte/store'
import { resetStudioScreenForTests, studioScreen } from './studioScreen.svelte'
import { setStudioEnabled } from './studioSwitch.svelte'
import { studioOpen } from './studioOpen'
import { openToggleDefinitionInStudio, toggleLinkTarget } from './studioToggleLinks'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from '../storage/moduleStub'

interface TestCharacter {
    chaId: string
    type: string
    coldstorage?: string
    chatPage: number
    chats: { id: string }[]
}

const db = { db: { theme: '', characters: [] as TestCharacter[], modules: [] as Record<string, unknown>[] | undefined, botPresets: [] as { id: string }[] | undefined, botPresetsId: 0 } }
const selection = { selId: -1 }
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const SettingsMenuIndex = writable(-1)

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('../stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get MobileGUI() { return MobileGUI },
    get settingsOpen() { return settingsOpen },
    get SettingsMenuIndex() { return SettingsMenuIndex },
}))

function character(overrides: Partial<TestCharacter> = {}): TestCharacter {
    return { chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'chat' }], ...overrides }
}

let stopSurface: (() => void) | null = null

beforeEach(() => {
    localStorage.clear()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    SettingsMenuIndex.set(-1)
    MobileGUI.set(false)
    db.db.characters = [character(), character({ chaId: 'grp', type: 'group' }), character({ chaId: '§playground' })]
    db.db.modules = [{ id: 'm-one', name: 'One' }, { id: 'm-dup', name: 'A' }, { id: 'm-dup', name: 'B' }, { id: 'm-stub', [MODULE_STUB_KEY]: MODULE_STUB_VALUE }]
    db.db.botPresets = [{ id: 'p-a' }, { id: 'p-b' }]
    db.db.botPresetsId = 1
    selection.selId = 0
    setStudioEnabled(true)
})

afterEach(() => {
    stopSurface?.()
    stopSurface = null
    resetStudioScreenForTests()
    setStudioEnabled(false)
    localStorage.clear()
})

// Settings' own surface resets the page index when it goes, which is why a link reads the index first.
function surfaceResetsIndexOnClose(): void {
    stopSurface = settingsOpen.subscribe((open) => {
        if (!open) SettingsMenuIndex.set(-1)
    })
}

const characterOwner = { type: 'character' } as const
const moduleOwner = (moduleId: string) => ({ type: 'module', moduleId }) as const

describe('GL-1 toggleLinkTarget', () => {
    test('a character target opens its toggles from the chat', () => {
        expect(toggleLinkTarget(characterOwner)).toEqual({ owner: { type: 'character', id: 'char' }, kind: 'toggles', from: 'chat' })
    })

    test('a loaded module with a unique id targets its toggles from Settings', () => {
        expect(toggleLinkTarget(moduleOwner('m-one'))).toEqual({ owner: { type: 'module', id: 'm-one' }, kind: 'toggles', from: 'settings' })
    })

    test('no link while Studio is switched off, under the Beta Mobile GUI, without a selection, for a group or the playground', () => {
        setStudioEnabled(false)
        expect(toggleLinkTarget(characterOwner)).toBeNull()
        expect(toggleLinkTarget(moduleOwner('m-one'))).toBeNull()
        setStudioEnabled(true)
        MobileGUI.set(true)
        expect(toggleLinkTarget(characterOwner)).toBeNull()
        MobileGUI.set(false)
        selection.selId = -1
        expect(toggleLinkTarget(characterOwner)).toBeNull()
        selection.selId = 1
        expect(toggleLinkTarget(characterOwner)).toBeNull()
        expect(toggleLinkTarget(moduleOwner('m-one'))).toBeNull()
        selection.selId = 2
        expect(toggleLinkTarget(characterOwner)).toBeNull()
    })

    test('no link for a module whose id is held twice, a stub, a missing id or an absent module list', () => {
        expect(toggleLinkTarget(moduleOwner('m-dup'))).toBeNull()
        expect(toggleLinkTarget(moduleOwner('m-stub'))).toBeNull()
        expect(toggleLinkTarget(moduleOwner('m-none'))).toBeNull()
        db.db.modules = undefined
        expect(toggleLinkTarget(moduleOwner('m-one'))).toBeNull()
    })
})

describe('GL-4 the Settings leg of openToggleDefinitionInStudio', () => {
    test('from the chat it opens Studio and records no Settings return', () => {
        expect(openToggleDefinitionInStudio(characterOwner, null)).toBe(true)
        expect(get(studioOpen)).toBe(true)
        expect(studioScreen.settingsReturn).toBeNull()
        expect(studioScreen.target).toEqual({ owner: { type: 'character', id: 'char' }, kind: 'toggles', from: 'chat' })
    })

    test('from Settings it records the page index it read before Settings closed, and closes Settings', () => {
        surfaceResetsIndexOnClose()
        settingsOpen.set(true)
        SettingsMenuIndex.set(3)
        const opener = { element: null, selector: '[data-part="studio-toggle-link"]' }
        expect(openToggleDefinitionInStudio(moduleOwner('m-one'), opener)).toBe(true)
        expect(get(settingsOpen)).toBe(false)
        expect(get(studioOpen)).toBe(true)
        expect(studioScreen.settingsReturn).toBe(3)
        expect(studioScreen.opener).toEqual(opener)
        expect(studioScreen.target).toEqual({ owner: { type: 'module', id: 'm-one' }, kind: 'toggles', from: 'settings' })
    })

    test('an invalid target never closes Settings', () => {
        settingsOpen.set(true)
        SettingsMenuIndex.set(3)
        expect(openToggleDefinitionInStudio(moduleOwner('m-dup'), null)).toBe(false)
        expect(get(settingsOpen)).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(3)
        expect(get(studioOpen)).toBe(false)
    })

    test('a refused open puts Settings back at the page it left', () => {
        surfaceResetsIndexOnClose()
        // Studio becomes ineligible as Settings closes, so the open that follows is refused.
        let wasOpen = false
        const stopSwitch = settingsOpen.subscribe((open) => {
            if (wasOpen && !open) setStudioEnabled(false)
            wasOpen = open
        })
        settingsOpen.set(true)
        SettingsMenuIndex.set(3)
        expect(openToggleDefinitionInStudio(moduleOwner('m-one'), null)).toBe(false)
        stopSwitch()
        expect(get(settingsOpen)).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(3)
        expect(get(studioOpen)).toBe(false)
        expect(studioScreen.settingsReturn).toBeNull()
    })
})

describe('GL-5 the preset link', () => {
    test('it targets the active preset toggles from Settings', () => {
        expect(toggleLinkTarget({ type: 'preset' })).toEqual({ owner: { type: 'preset', id: '1' }, kind: 'toggles', from: 'settings' })
        db.db.botPresetsId = 0
        expect(toggleLinkTarget({ type: 'preset' })).toEqual({ owner: { type: 'preset', id: '0' }, kind: 'toggles', from: 'settings' })
    })

    test('no link without an active preset row, a preset list, or an eligible Studio', () => {
        db.db.botPresetsId = 5
        expect(toggleLinkTarget({ type: 'preset' })).toBeNull()
        db.db.botPresetsId = -1
        expect(toggleLinkTarget({ type: 'preset' })).toBeNull()
        db.db.botPresets = undefined
        expect(toggleLinkTarget({ type: 'preset' })).toBeNull()
        db.db.botPresets = [{ id: 'p-a' }, { id: 'p-b' }]
        setStudioEnabled(false)
        expect(toggleLinkTarget({ type: 'preset' })).toBeNull()
    })

    test('from Settings it closes Settings and records the return page', () => {
        surfaceResetsIndexOnClose()
        settingsOpen.set(true)
        SettingsMenuIndex.set(4)
        expect(openToggleDefinitionInStudio({ type: 'preset' }, null)).toBe(true)
        expect(get(settingsOpen)).toBe(false)
        expect(studioScreen.settingsReturn).toBe(4)
        expect(studioScreen.target).toEqual({ owner: { type: 'preset', id: '1' }, kind: 'toggles', from: 'settings' })
    })
})
