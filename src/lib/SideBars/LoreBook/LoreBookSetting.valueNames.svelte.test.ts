// @vitest-environment jsdom

/**
 * `LoreBookSetting.svelte` value controls: the scan depth and token budget numbers of the settings tab
 * are named by their visible label text through `aria-labelledby`, with that label first in
 * `aria-describedby`; with the global settings in use the tab has no value control. Mounts the REAL
 * component with the real shared inputs; mocks follow `LoreBookSetting.names.svelte.test.ts`.
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
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import LoreBookSetting from './LoreBookSetting.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function install(settings: boolean): void {
    DBState.db = {
        bulkEnabling: false,
        useExperimental: false,
        loreBookToken: 100,
        loreBookDepth: 3,
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, globalLore: [],
            loreSettings: settings ? { recursiveScanning: false, tokenBudget: 100, scanDepth: 3, fullWordAsciiBoundary: false, cjkWordStart: false } : undefined,
            chats: [{ id: 'c0-chat-0', message: [], note: '', name: '', localLore: [] }],
        }],
    } as unknown as Database
}

async function showSettingsTab(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(LoreBookSetting, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await tick()
    flushSync()
    Array.from(target.querySelectorAll<HTMLButtonElement>('div.rounded-md button'))[2].click()
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

const names = (...list: string[]): FieldExpectation[] => list.map((name) => ({ name }))

/** Out-of-scope unnamed controls on this page: none. */
const KNOWN_UNNAMED: string[] = []

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
}

describe('LoreBookSetting value controls are named', () => {
    test('own settings: scan depth and token budget', async () => {
        install(true)
        check(await showSettingsTab(), names(language.loreBookDepth, language.loreBookToken))
    })

    test('global settings in use: no value control', async () => {
        install(false)
        check(await showSettingsTab(), [])
    })
})
