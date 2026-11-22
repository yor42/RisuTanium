// @vitest-environment happy-dom

/**
 * `OtherBotSettings.svelte` shows a "Manage in Connections" link at its image-generation key block (the OpenAI key
 * of the DALL-E provider), and choosing it opens the Connections page (settings index 18). Reproducer: fails on a
 * page without the link. Mounts the REAL page on its image-generation tab over a real `$state` database.
 *
 * MOCKED: `alert` (a permissive stub), `stores.svelte`, `globalApi.svelte`, `platform` (a web build), `util`,
 * `characters`, `process/prompt`, `tokenizer`, `process/memory/hypav3` and `TextAreaInput.svelte`, which the page
 * imports for tabs this test does not open.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
const h = vi.hoisted(() => ({
    alertError: vi.fn(),
    saveAsset: vi.fn(),
    pickedAssetLimitBytes: vi.fn(async () => 1024 * 1024),
    selectSingleFileObject: vi.fn(),
    readPickedFileBytes: vi.fn(),
}))

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = { alertStore: writable({ type: 'none', msg: '' }), alertError: h.alertError }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        SettingsMenuIndex: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    saveAsset: h.saveAsset,
    pickedAssetLimitBytes: h.pickedAssetLimitBytes,
    downloadFile: vi.fn(),
    globalFetch: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    selectSingleFileObject: h.selectSingleFileObject,
    readPickedFileBytes: h.readPickedFileBytes,
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/process/prompt'), () => ({
    tokenizePreset: vi.fn(async () => 0),
}) as unknown as typeof import('src/ts/process/prompt'))

vi.mock(import('src/ts/tokenizer'), () => ({
    getCharToken: vi.fn(async () => ({ persistant: 0, dynamic: 0 })),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string) => ({ name })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

import { DBState, SettingsMenuIndex } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import OtherBotSettings from './OtherBotSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountImageTab(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OtherBotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    const tabs = target.querySelector('div.flex.w-full')?.querySelectorAll('button')
    if (!tabs || tabs.length < 4) throw new Error('the tab bar is not shown')
    tabs[3].click()
    flushSync()
    return target
}

beforeEach(() => {
    DBState.db = {
        hypaV3: true,
        hypav2: false,
        hanuraiEnable: false,
        supaModelType: 'none',
        useLegacyGUI: false,
        sdProvider: 'dalle',
        sdConfig: { width: 512, height: 512, enable_hr: false },
        wavespeedImage: {},
        hypaV3Presets: [{ name: 'p' }],
        hypaV3PresetId: 0,
        characters: [{ chaId: 'c0', chats: [], chatPage: 0 }],
    } as unknown as Database
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('the image-generation key block links to the Connections page', () => {
    test('the DALL-E key block shows one link and choosing it sets the settings index to 18', () => {
        const target = mountImageTab()
        const links = Array.from(target.querySelectorAll<HTMLElement>('[data-part="settings-connections-link"]'))
        expect(links).toHaveLength(1)
        expect(links[0].textContent).toBe(language.connectionsManageLink)
        SettingsMenuIndex.set(1)
        links[0].click()
        expect(get(SettingsMenuIndex)).toBe(18)
    })

    test('a provider without the OpenAI key block shows no link', () => {
        DBState.db.sdProvider = 'webui'
        const target = mountImageTab()
        expect(target.querySelectorAll('[data-part="settings-connections-link"]')).toHaveLength(0)
    })
})
