// @vitest-environment happy-dom

/**
 * The chat sidebar's toggle list after a module body is loaded into its stub's slot. The slot keeps its id, so nothing
 * the list reads changes identity; the loader bumps `ReloadGUIPointer` and the list must re-derive from the loaded
 * module's toggle text. Mounts the REAL `Toggles.svelte`; the module toggle source is a stub whose text the test changes,
 * which stands for the loaded module's `customModuleToggle` arriving.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { character } from 'src/ts/storage/database.svelte'

const state = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    moduleToggleText: '',
}))

const pointer = vi.hoisted(() => ({ store: undefined as undefined | import('svelte/store').Writable<number> }))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable: make } = await import('svelte/store')
    pointer.store = make(0)
    return {
        DBState: {
            get db() { return state.db },
        },
        selIdState: { selId: -1 },
        MobileGUI: { subscribe: (run: (value: boolean) => void) => { run(false); return () => {} } },
        selectedCharID: writable(0),
        ReloadGUIPointer: pointer.store,
    }
})
vi.mock('src/ts/storage/database.svelte', () => ({
    getCurrentCharacter: () => undefined,
    getCurrentChat: () => undefined,
}))
vi.mock('src/ts/process/modules', () => ({ getModuleToggles: () => state.moduleToggleText }))
vi.mock('src/ts/parser/chatVar.svelte', () => ({
    getGlobalChatVar: () => 'null',
    isLocallyHandledGlobalChatVar: () => false,
    removeLocallyHandledGlobalChatVar: vi.fn(),
    setGlobalChatVar: vi.fn(),
}))
// Every line that starts with `cap-` is a caption toggle of that text.
vi.mock('src/ts/util', () => ({
    parseToggleSyntax: (text: string) => text.split('\n').filter(line => line.startsWith('cap-')).map(value => ({ value, type: 'caption' })),
}))
vi.mock('@lucide/svelte', () => ({ PinIcon: () => {} }))
vi.mock('src/lang', () => ({ language: new Proxy({}, { get: (_target, key) => String(key) }) }))
vi.mock('./CustomSidebar.svelte', () => ({ default: () => {} }))

import Toggles from './Toggles.svelte'

let mounted: ReturnType<typeof mount> | undefined

function mountList(): void {
    state.db = { supaModelType: 'none', hypaV3: false, hanuraiEnable: false, hypaMemory: false, hypav2: false }
    const chara = { supaMemory: false } as character
    mounted = mount(Toggles, { target: document.body, props: { chara } })
    flushSync()
}

afterEach(() => {
    if (mounted) unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
    state.moduleToggleText = ''
})

describe('the toggle list follows a module that was loaded into its stub\'s slot', () => {
    test('the toggles of a loaded module appear when the pointer is bumped', () => {
        state.moduleToggleText = ''
        mountList()
        expect(document.body.textContent).not.toContain('cap-loaded')
        // The load installs the body (its toggle text is now readable) and bumps the pointer.
        state.moduleToggleText = 'cap-loaded'
        pointer.store?.update(value => value + 1)
        flushSync()
        expect(document.body.textContent).toContain('cap-loaded')
    })

    test('guard: nothing re-derives without a bump', () => {
        state.moduleToggleText = 'cap-before'
        mountList()
        expect(document.body.textContent).toContain('cap-before')
        state.moduleToggleText = 'cap-after'
        flushSync()
        expect(document.body.textContent).toContain('cap-before')
        expect(document.body.textContent).not.toContain('cap-after')
    })
})
