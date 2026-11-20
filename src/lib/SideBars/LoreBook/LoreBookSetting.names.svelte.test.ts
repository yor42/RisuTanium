// @vitest-environment jsdom

/**
 * `LoreBookSetting.svelte`: the add, export, add-folder and import buttons are named with hidden glyphs, the
 * bulk-enable buttons keep their visible text with hidden glyphs, and every checkbox of the settings
 * tab is named by `aria-label`. Mounts the REAL component; the lorebook process module, the nested list and
 * the stores are mocks.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        selIdState: { selId: 0 },
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/process/lorebook.svelte', () => ({
    addLorebook: vi.fn(),
    addLorebookFolder: vi.fn(),
    exportLoreBook: vi.fn(),
    importLoreBook: vi.fn(),
}))
vi.mock('./LoreBookList.svelte', () => ({ default: () => {} }))
vi.mock('src/ts/alert', () => ({ alertMd: vi.fn() }))

import { language } from 'src/lang'
import { controlName, exposedIcons, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import LoreBookSetting from './LoreBookSetting.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function install(over: Record<string, unknown> = {}, settings: boolean = false): void {
    DBState.db = {
        bulkEnabling: false,
        useExperimental: true,
        loreBookToken: 100,
        loreBookDepth: 3,
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, globalLore: [],
            loreSettings: settings ? { recursiveScanning: false, tokenBudget: 100, scanDepth: 3, fullWordAsciiBoundary: false, cjkWordStart: false } : undefined,
            chats: [{ id: 'c0-chat-0', message: [], note: '', name: '', localLore: [] }],
        }],
        ...over,
    } as unknown as Database
}

async function show(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(LoreBookSetting, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await tick()
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

describe('LoreBookSetting accessible names', () => {
    test('regression reproducer: the toolbar buttons are named in order with hidden glyphs', async () => {
        install()
        const target = await show()
        const row = Array.from(target.querySelectorAll<HTMLElement>('div.mt-2.flex')).find((d) => d.querySelector('svg'))!
        expect(Array.from(row.querySelectorAll('button')).map(controlName)).toEqual([
            language.add, language.export, language.chatShellNewFolder, language.import,
        ])
        expect(exposedIcons(target)).toEqual([])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the bulk buttons keep their visible text and hide their glyphs', async () => {
        install({ bulkEnabling: true })
        const target = await show()
        const names = Array.from(target.querySelectorAll('div.mt-2.flex button')).map(controlName)
        expect(names).toContain(language.sidebarUi.loreScopeChar)
        expect(names).toContain(language.sidebarUi.loreScopeChat)
        expect(exposedIcons(target)).toEqual([])
    })

    test('guard: the settings tab keeps every checkbox named and glyphs hidden (passes before and after)', async () => {
        install({}, true)
        const target = await show()
        const tabs = Array.from(target.querySelectorAll<HTMLButtonElement>('div.rounded-md button'))
        tabs[2].click()
        flushSync()
        await tick()
        flushSync()
        const boxes = Array.from(target.querySelectorAll('input[type="checkbox"]'))
        expect(boxes.length).toBeGreaterThanOrEqual(6)
        expect(boxes.map(controlName).every((n) => n !== '')).toBe(true)
        expect(boxes.map(controlName)).toContain(language.lorePlus)
        expect(unnamedControls(target, { fields: true })).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })
})
