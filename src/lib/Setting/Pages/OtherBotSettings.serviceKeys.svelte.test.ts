// @vitest-environment happy-dom

/**
 * The image-generation key fields of `OtherBotSettings.svelte` (Stability, fal, the OpenAI-compatible provider and
 * WaveSpeed) show and write their key through the service key seam, and typing a key reaches it with the slot of that
 * field. Reproducer: fails on a page whose fields bind the database field directly (no seam call). Mounts the REAL
 * page on its image-generation tab over a real `$state` database.
 *
 * MOCKED: as the connections-link test (`alert`, `stores.svelte`, `globalApi.svelte`, `platform`, `util`, `characters`,
 * `process/prompt`, `tokenizer`, `process/memory/hypav3`, `TextAreaInput.svelte`); `setServiceKey` is a recording
 * pass-through.
 */
import { flushSync, mount, unmount } from 'svelte'
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

vi.mock(import('src/ts/connections/serviceKeys'), async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, setServiceKey: vi.fn(actual.setServiceKey) }
})

import { DBState } from 'src/ts/stores.svelte'
import { serviceEditorValue, setServiceKey, type ServiceSlot } from 'src/ts/connections/serviceKeys'
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
    vi.mocked(setServiceKey).mockClear()
})

const FIELDS: Array<{ provider: string, slot: ServiceSlot, serviceProvider: string, labelSuffix: string }> = [
    { provider: 'stability', slot: 'stabilityKey', serviceProvider: 'stability', labelSuffix: '-f6' },
    { provider: 'fal', slot: 'falToken', serviceProvider: 'fal', labelSuffix: '-f15' },
    { provider: 'openai-compat', slot: 'openaiCompatImage.key', serviceProvider: 'openai_image', labelSuffix: '-f18' },
    { provider: 'wavespeed', slot: 'wavespeedImage.key', serviceProvider: 'wavespeed', labelSuffix: '-f20' },
]
describe.each(FIELDS)('the $provider key field', ({ provider, slot, serviceProvider, labelSuffix }) => {
    test('shows the stored key', () => {
        seedDb({ sdProvider: provider, connections: [{ id: 'conn-1', name: 'S', provider: serviceProvider, key: 'SYN-shown' }] })
        const input = mountImageTab().querySelector<HTMLInputElement>(`input[aria-labelledby$="${labelSuffix}"]`)
        expect(input?.value).toBe('SYN-shown')
    })

    test('typing a key stores it and goes through the seam with the slot of the field', () => {
        seedDb({ sdProvider: provider })
        const input = mountImageTab().querySelector<HTMLInputElement>(`input[aria-labelledby$="${labelSuffix}"]`)
        expect(input).not.toBeNull()
        input!.value = 'SYN-typed'
        input!.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        expect(setServiceKey).toHaveBeenCalledWith(DBState.db, slot, 'SYN-typed')
        expect(serviceEditorValue(DBState.db, slot)).toBe('SYN-typed')
        expect(DBState.db.connections).toEqual([expect.objectContaining({ provider: serviceProvider, key: 'SYN-typed' })])
    })
})
