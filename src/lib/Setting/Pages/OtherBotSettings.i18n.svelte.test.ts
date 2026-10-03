// @vitest-environment happy-dom

/**
 * `OtherBotSettings.svelte` image-generation labels follow the active UI language, read at
 * render time. Mounts the REAL page on its image-generation tab with the Stable Diffusion
 * WebUI provider chosen, over a real `$state` database; the language module is switched per
 * test and restored to English afterwards.
 *
 * MOCKED: `alert` (a permissive stub), `stores.svelte`, `globalApi.svelte`, `platform`
 * (a web build), `util`, `characters`, `process/prompt`, `tokenizer`, `process/memory/hypav3`
 * and `TextAreaInput.svelte`, which the page imports for tabs this test does not open.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = { alertStore: writable({ type: 'none', msg: '' }) }
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
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    saveAsset: vi.fn(),
    downloadFile: vi.fn(),
    globalFetch: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
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

import { DBState } from 'src/ts/stores.svelte'
import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
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

const spans = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('span')).map((s) => s.textContent?.trim())

beforeEach(() => {
    DBState.db = {
        hypaV3: true,
        hypav2: false,
        hanuraiEnable: false,
        supaModelType: 'none',
        useLegacyGUI: false,
        sdProvider: 'webui',
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
    changeLanguage('en')
})

describe('the image-generation tab follows the UI language', () => {
    test('guard: English shows the exact English WebUI notice and field labels', () => {
        const shown = spans(mountImageTab())
        expect(shown).toContain('You must use WebUI with --api flag')
        expect(shown).toContain('Width')
        expect(shown).toContain('Height')
        expect(languageEnglish.settingsPage.webuiApiFlag).toBe('You must use WebUI with --api flag')
    })

    test('regression reproducer: Korean shows the Korean notice and field labels', () => {
        changeLanguage('ko')
        const shown = spans(mountImageTab())
        const p = languageKorean.settingsPage
        expect(shown).toContain(p.webuiApiFlag)
        expect(shown).toContain(p.width)
        expect(shown).toContain(p.height)
        expect(shown).not.toContain('You must use WebUI with --api flag')
        expect(p.webuiApiFlag).not.toBe(languageEnglish.settingsPage.webuiApiFlag)
        expect(p.width).not.toBe(languageEnglish.settingsPage.width)
    })
})
