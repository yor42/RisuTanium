// @vitest-environment jsdom

/**
 * #892: the key fields of `OtherBotSettings.svelte` on the image-generation tab (Stability, fal, the OpenAI-compatible
 * provider, WaveSpeed, DALL-E, Imagen, NovelAI) and the TTS OpenAI key show a masked last-four chip and never the
 * saved key. Regression reproducer: before the fix each field was bound to the stored key, so the key reached an input
 * value. Replace key and Remove key write through the connection. Mounts the REAL page over a real `$state` database.
 *
 * MOCKED: as the connections-link test (`alert`, `stores.svelte`, `globalApi.svelte`, `platform`, `util`, `characters`,
 * `process/prompt`, `tokenizer`, `process/memory/hypav3`, `TextAreaInput.svelte`); the Remove key arm delay is zero.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = { alertStore: writable({ type: 'none', msg: '' }), alertError: vi.fn() }
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
    saveAsset: vi.fn(),
    pickedAssetLimitBytes: vi.fn(async () => 1024 * 1024),
    downloadFile: vi.fn(),
    globalFetch: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    selectSingleFileObject: vi.fn(),
    readPickedFileBytes: vi.fn(),
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

vi.mock('src/lib/Nexus/pattern/patternWarning', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/lib/Nexus/pattern/patternWarning')>()),
    armDelayMs: () => 0,
}))

import { DBState } from 'src/ts/stores.svelte'
import type { ConnectionSlot } from 'src/ts/connections/connections'
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

function seedDb(extra: Record<string, unknown>) {
    DBState.db = {
        hypaV3: true,
        hypav2: false,
        hanuraiEnable: false,
        supaModelType: 'none',
        useLegacyGUI: false,
        sdProvider: 'dalle',
        sdConfig: { width: 512, height: 512, enable_hr: false },
        comfyConfig: { timeout: 30 },
        NAIImgModel: 'nai-diffusion-4-5-full',
        NAIImgConfig: { width: 832, height: 1216, sampler: 'k_euler', noise_schedule: 'native', steps: 28, scale: 5, cfg_rescale: 0, reference_mode: '', strength: 0.5, noise: 0 },
        wavespeedImage: { key: '', model: '', loras: [] },
        openaiCompatImage: { url: '', key: '', model: '', size: '', quality: '' },
        stabilityKey: '',
        stabilityModel: 'core',
        falToken: '',
        hypaV3Presets: [{ name: 'p' }],
        hypaV3PresetId: 0,
        characters: [{ chaId: 'c0', chats: [], chatPage: 0 }],
        ...extra,
    } as unknown as Database
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

interface KeyField { name: string, provider: string, slot: ConnectionSlot, connectionProvider: string }
const FIELDS: KeyField[] = [
    { name: 'Stability', provider: 'stability', slot: 'stabilityKey', connectionProvider: 'stability' },
    { name: 'fal', provider: 'fal', slot: 'falToken', connectionProvider: 'fal' },
    { name: 'OpenAI-compatible image', provider: 'openai-compat', slot: 'openaiCompatImage.key', connectionProvider: 'openai_image' },
    { name: 'WaveSpeed', provider: 'wavespeed', slot: 'wavespeedImage.key', connectionProvider: 'wavespeed' },
    { name: 'DALL-E', provider: 'dalle', slot: 'openAIKey', connectionProvider: 'openai' },
    { name: 'Imagen', provider: 'Imagen', slot: 'google.accessToken', connectionProvider: 'google' },
    { name: 'NovelAI image', provider: 'novelai', slot: 'NAIApiKey', connectionProvider: 'novelai_media' },
]

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function fieldOf(target: HTMLElement, slot: string): HTMLElement {
    return target.querySelector<HTMLElement>(`[data-slot-key="field"][data-slot="${slot}"]`)!
}

function leaks(target: HTMLElement, secret: string): boolean {
    const values = Array.from(target.querySelectorAll<HTMLInputElement>('input, textarea')).map((el) => el.value)
    const attrs = Array.from(target.querySelectorAll('*')).flatMap((el) => Array.from(el.attributes).map((attr) => attr.value))
    return [target.innerHTML, ...values, ...attrs].some((text) => text.includes(secret))
}

describe.each(FIELDS)('the $name key field', ({ provider, slot, connectionProvider }) => {
    const KEY = 'SYN-secret-key-abcdef-9876'
    const saved = () => [{ id: 'conn-1', name: 'S', provider: connectionProvider, key: KEY }]

    test('regression reproducer: shows a masked chip and the saved key is in no field or attribute', async () => {
        seedDb({ sdProvider: provider, connections: saved() })
        const target = mountImageTab()
        await settle()
        const field = fieldOf(target, slot)
        expect(field).not.toBeNull()
        // A single-secret service key shows no tail at all; the others show their last four.
        expect(field.querySelector('[data-slot-key="chip"]')?.textContent).toContain('••••')
        expect(leaks(target, KEY)).toBe(false)
        expect(leaks(target, 'secret-key')).toBe(false)
    })

    test('Replace key opens an empty masked field and Save stores the new key', async () => {
        seedDb({ sdProvider: provider, connections: saved() })
        const target = mountImageTab()
        await settle()
        const field = fieldOf(target, slot)
        field.querySelector<HTMLButtonElement>('[data-slot-key="replace"]')!.click()
        await settle()
        const input = field.querySelector<HTMLInputElement>('input')!
        expect(input.type).toBe('password')
        expect(input.value).toBe('')
        input.value = 'SYN-typed'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        field.querySelector<HTMLButtonElement>('[data-slot-key="save"]')!.click()
        await settle()
        expect(DBState.db.connections).toEqual([expect.objectContaining({ provider: connectionProvider, key: 'SYN-typed' })])
        expect(leaks(target, 'SYN-typed')).toBe(false)
    })

    test('Remove key asks first and then blanks the key', async () => {
        seedDb({ sdProvider: provider, connections: saved() })
        const target = mountImageTab()
        await settle()
        const field = fieldOf(target, slot)
        field.querySelector<HTMLButtonElement>('[data-slot-key="remove"]')!.click()
        await settle()
        expect(DBState.db.connections?.[0].key).toBe(KEY)
        Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Remove key' && b.dataset.slotKey !== 'remove')!.click()
        await settle()
        expect(DBState.db.connections?.[0].key).toBe('')
    })

    test('a field with no saved key opens the masked Replace key field directly', async () => {
        seedDb({ sdProvider: provider })
        const target = mountImageTab()
        await settle()
        const input = fieldOf(target, slot).querySelector<HTMLInputElement>('input')
        expect(input?.type).toBe('password')
    })
})

describe('the TTS OpenAI key field', () => {
    test('is masked and shows no saved key', async () => {
        seedDb({ sdProvider: 'webui', connections: [{ id: 'conn-1', name: 'O', provider: 'openai', key: 'SYN-tts-key-4321' }] })
        const target = mountImageTab()
        const tabs = target.querySelector('div.flex.w-full')!.querySelectorAll('button')
        for (const tab of Array.from(tabs)) {
            tab.click()
            await settle()
            if (fieldOf(target, 'openAIKey')) break
        }
        const field = fieldOf(target, 'openAIKey')
        expect(field).not.toBeNull()
        expect(field.querySelector('[data-slot-key="chip"]')?.textContent).toContain('4321')
        expect(leaks(target, 'SYN-tts-key-4321')).toBe(false)
    })
})
