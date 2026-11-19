// @vitest-environment jsdom
/**
 * Back from a visit that a Settings link opened reopens Settings at the page it left, on real stores and the real
 * Settings surface (whose own teardown resets the page index). New behaviour (class G): the evidence is the mutant
 * each row kills. The chat-entered rows are compatibility guards (they pass before and after).
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const db = { db: { theme: '', characters: [] as { chaId: string, type: string, chatPage: number, chats: { id: string }[] }[], modules: [] as { id: string, name: string }[] } }
const selection = { selId: 0 }
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const SettingsMenuIndex = writable(-1)

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('../../ts/stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get MobileGUI() { return MobileGUI },
    get settingsOpen() { return settingsOpen },
    get SettingsMenuIndex() { return SettingsMenuIndex },
}))
vi.mock('../../ts/settingsShell/settingsShellSwitch.svelte', () => ({ settingsShellEligible: () => true }))
vi.mock('../Setting/Settings.svelte', () => ({ default: () => {} }))
vi.mock('../SettingsShell/SettingsShell.svelte', () => ({ default: () => {} }))

import { afterFlush } from '../../ts/afterFlush'
import { leaveStudio } from '../../ts/studio/studioBack.svelte'
import { openStudio, resetStudioScreenForTests, studioScreen } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { openToggleDefinitionInStudio } from '../../ts/studio/studioToggleLinks'
import { studioOpen } from '../../ts/studio/studioOpen'
import SettingsSurface from '../SettingsShell/SettingsSurface.svelte'

let surface: ReturnType<typeof mount> | null = null
let surfaceHost: HTMLElement | null = null
let stopFollowing: (() => void) | null = null
let transcript: HTMLElement | null = null
let transcriptFocus: ReturnType<typeof vi.fn>

// The app shows the Settings surface exactly while the flag is set, and drops it, with its teardown, when it clears.
function followSettingsFlag(): void {
    stopFollowing = settingsOpen.subscribe((open) => {
        if (open && surface === null) {
            surfaceHost = document.createElement('div')
            document.body.appendChild(surfaceHost)
            surface = mount(SettingsSurface, { target: surfaceHost })
            flushSync()
        } else if (!open && surface !== null) {
            void unmount(surface)
            surface = null
            surfaceHost?.remove()
            surfaceHost = null
        }
    })
}

async function settleFocus(): Promise<void> {
    await afterFlush()
    await afterFlush()
    await afterFlush()
}

beforeEach(() => {
    localStorage.clear()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    SettingsMenuIndex.set(-1)
    MobileGUI.set(false)
    db.db.characters = [{ chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'chat' }] }]
    db.db.modules = [{ id: 'm-one', name: 'One' }]
    selection.selId = 0
    setStudioEnabled(true)
    transcript = document.createElement('div')
    transcript.setAttribute('data-part', 'chat-transcript')
    transcript.tabIndex = -1
    transcriptFocus = vi.fn()
    transcript.focus = transcriptFocus as unknown as () => void
    document.body.appendChild(transcript)
    followSettingsFlag()
})

afterEach(() => {
    stopFollowing?.()
    stopFollowing = null
    if (surface !== null) void unmount(surface)
    surface = null
    surfaceHost?.remove()
    surfaceHost = null
    transcript?.remove()
    transcript = null
    resetStudioScreenForTests()
    setStudioEnabled(false)
    localStorage.clear()
})

const moduleOwner = { type: 'module', moduleId: 'm-one' } as const

function openFromSettingsAt(index: number): void {
    settingsOpen.set(true)
    SettingsMenuIndex.set(index)
    expect(openToggleDefinitionInStudio(moduleOwner, null)).toBe(true)
}

describe('GL-7 Back from a Settings link', () => {
    test('reopens Settings at the page the link left, with Studio closed', () => {
        openFromSettingsAt(3)
        expect(get(settingsOpen)).toBe(false)
        expect(studioScreen.settingsReturn).toBe(3)
        leaveStudio()
        flushSync()
        expect(get(studioOpen)).toBe(false)
        expect(get(settingsOpen)).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(3)
        expect(surface).not.toBeNull()
    })

    test('does not hand focus to the chat transcript the Settings page replaced', async () => {
        openFromSettingsAt(3)
        leaveStudio()
        await settleFocus()
        expect(transcriptFocus).not.toHaveBeenCalled()
    })

    test('a visit entered from the chat leaves for the chat and never opens Settings', async () => {
        expect(openStudio({ owner: { type: 'character', id: 'char' }, from: 'chat' }, null)).toBe(true)
        leaveStudio()
        await settleFocus()
        expect(get(settingsOpen)).toBe(false)
        expect(get(studioOpen)).toBe(false)
        // The transcript focus is the chat path's own return; its absence above is therefore not a vacuous pass.
        expect(transcriptFocus).toHaveBeenCalled()
    })

    test('a Settings visit followed by a chat-entered visit does not reopen Settings', () => {
        openFromSettingsAt(3)
        expect(openStudio({ owner: { type: 'character', id: 'char' }, from: 'chat' }, null)).toBe(true)
        expect(studioScreen.settingsReturn).toBeNull()
        leaveStudio()
        flushSync()
        expect(get(settingsOpen)).toBe(false)
    })

    test('a second Back path of the same visit has no Settings left to reopen', () => {
        openFromSettingsAt(3)
        leaveStudio()
        flushSync()
        expect(get(settingsOpen)).toBe(true)
        settingsOpen.set(false)
        flushSync()
        leaveStudio()
        flushSync()
        expect(get(settingsOpen)).toBe(false)
    })
})
