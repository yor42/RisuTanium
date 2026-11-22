// @vitest-environment jsdom

/**
 * `CustomModelsSettings.svelte` shows a "Manage in Connections" link at the key field of each custom model, and
 * choosing it opens the Connections page (settings index 18). Reproducer: fails on a page without the link.
 * Mounts the REAL component (without its outer accordion) over a real `$state` database with an opened model.
 *
 * MOCKED: `stores.svelte`, the highlighter, size and hotkey modules and the key list input (a stub).
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        SettingsMenuIndex: writable(-1),
        selIdState: { selId: 0 },
        disableHighlight: writable(false),
        popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/gui/guisize', () => ({
    textAreaSize: writable(0),
    textAreaTextSize: writable(1),
}))
vi.mock('src/ts/gui/highlight', () => ({
    highlighter: vi.fn(),
    getNewHighlightId: vi.fn(() => 1),
    removeHighlight: vi.fn(),
    AllCBS: ['random', 'randint'],
}))
vi.mock('src/ts/hotkey', () => ({
    hotkeyMatches: vi.fn(() => false),
}))
vi.mock('src/lib/UI/GUI/KeyListInput.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { DBState, SettingsMenuIndex } from 'src/ts/stores.svelte'
import CustomModelsSettings from './CustomModelsSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(): HTMLElement {
    DBState.db = {
        hotkeys: [],
        longPressToPopupEditor: false,
        customModels: [{ id: 'xcustom:::1', name: 'M', internalId: '', url: '', tokenizer: 0, format: 0, key: '', params: '', flags: [] }],
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(CustomModelsSettings, { target, props: { noAccordion: true } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    ;(target.querySelector('div.flex.flex-col.mt-2 > button') as HTMLButtonElement).click()
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('a custom model links to the Connections page', () => {
    test('the opened model shows one link and choosing it sets the settings index to 18', () => {
        const target = render()
        const links = Array.from(target.querySelectorAll<HTMLElement>('[data-part="settings-connections-link"]'))
        expect(links).toHaveLength(1)
        expect(links[0].textContent).toBe(language.connectionsManageLink)
        SettingsMenuIndex.set(1)
        links[0].click()
        expect(get(SettingsMenuIndex)).toBe(18)
    })
})