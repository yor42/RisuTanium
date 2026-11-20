// @vitest-environment jsdom

/**
 * `ModuleChatMenu.svelte` (the chat's module picker): every control has an accessible name,
 * every Lucide glyph is hidden from assistive technology, the toggles expose their state and the
 * screen uses scheme tokens instead of Tailwind default palette classes. Mounts the REAL
 * `ModuleChatMenu.svelte` over a real `$state` database, once as the picker and once in alert mode.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'
import { language } from 'src/lang'
import { controlDescription, controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
        SettingsMenuIndex: writable(0),
        settingsOpen: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import ModuleChatMenu from './ModuleChatMenu.svelte'

//#region helpers

const ALLOWED = [/^bg-black\/50$/, /^text-violet-500$/]

function makeModule(name: string, extra: Partial<RisuModule> = {}): RisuModule {
    return { name, description: '', id: 'id-' + name, ...extra } as RisuModule
}

function installDb(): void {
    DBState.db = {
        modules: [
            makeModule('A'),
            makeModule('B'),
            makeModule('C'),
            makeModule('D', { mcp: { url: 'https://mcp.invalid' } }),
        ],
        enabledModules: ['id-C'],
        characters: [{ modules: ['id-B'], chatPage: 0, chats: [{ modules: ['id-A'] }] }],
    } as unknown as Database
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function mountMenu(alertMode = false): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModuleChatMenu, { target, props: { alertMode } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function rowOf(target: HTMLElement, title: string): HTMLElement {
    const row = Array.from(target.querySelectorAll('div.pl-3.py-3')).find((r) => r.querySelector('span')?.textContent?.trim() === title)
    if (!row) throw new Error('row not found: ' + title)
    return row as HTMLElement
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('ModuleChatMenu accessible names', () => {
    test('regression reproducer: the close button and every toggle are named and every glyph is hidden', () => {
        installDb()
        const target = mountMenu()
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
        const close = target.querySelector('div.flex.items-center.text-textcolor button') as HTMLButtonElement
        expect(controlName(close)).toBe(language.uiCommon.close)
        for (const title of ['A', 'B', 'D']) {
            const toggle = rowOf(target, title).querySelector('button') as HTMLButtonElement
            expect(controlName(toggle)).toBe(language.moduleUseInChat)
        }
    })

    test('regression reproducer: a globally enabled module renders no focusable placeholder button', () => {
        installDb()
        const target = mountMenu()
        expect(rowOf(target, 'C').querySelectorAll('button').length).toBe(0)
    })

    test('regression reproducer: alert mode names the close and select buttons', () => {
        installDb()
        const target = mountMenu(true)
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
        const select = rowOf(target, 'A').querySelector('button') as HTMLButtonElement
        expect(controlName(select)).toBe(language.select)
    })
})

describe('ModuleChatMenu state and colour', () => {
    test('regression reproducer: the toggle exposes the chat state and the character state has a ring cue and a description', () => {
        installDb()
        const target = mountMenu()
        const chatOn = rowOf(target, 'A').querySelector('button') as HTMLButtonElement
        expect(chatOn.getAttribute('aria-pressed')).toBe('true')
        for (const cls of ['bg-selected', 'ring-1', 'ring-borderc']) {
            expect(chatOn.classList.contains(cls)).toBe(true)
        }
        const characterOn = rowOf(target, 'B').querySelector('button') as HTMLButtonElement
        expect(characterOn.getAttribute('aria-pressed')).toBe('false')
        expect(characterOn.classList.contains('text-violet-500')).toBe(true)
        expect(characterOn.classList.contains('ring-current')).toBe(true)
        expect(controlDescription(characterOn)).toBe(language.moduleOnForCharacter)
        const off = rowOf(target, 'D').querySelector('button') as HTMLButtonElement
        expect(off.getAttribute('aria-pressed')).toBe('false')
        expect(controlDescription(off)).toBe('')
        expect(off.classList.contains('hover:text-textcolor')).toBe(true)
    })

    test('regression reproducer: no Tailwind default palette class remains outside the documented exceptions', () => {
        installDb()
        expect(paletteClasses(mountMenu(), { allow: ALLOWED })).toEqual([])
        expect(paletteClasses(mountMenu(true), { allow: ALLOWED })).toEqual([])
    })
})
