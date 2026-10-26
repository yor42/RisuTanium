// @vitest-environment happy-dom

/**
 * The Type dropdown of `OtherBotSettings.svelte` shows the memory system the request path runs
 * when several flags are set: Hanurai, then HypaMemory V2, then V3, then SupaMemory.
 *
 * Mounts the REAL component over a real `$state` database and reads the selected value of the
 * dropdown that lists the HypaMemory V3 option. Titles beginning "guard:" pin behaviour that is
 * the same before and after the change.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => true),
        alertStore: writable({ type: 'none', msg: '' }),
    }
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
    pickedAssetLimitBytes: vi.fn(),
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

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import OtherBotSettings from './OtherBotSettings.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function installDb(flags: Partial<Record<'hypaV3' | 'hypav2' | 'hanuraiEnable', boolean>> & { supaModelType?: string }): void {
    DBState.db = {
        hypaV3: false,
        hypav2: false,
        hanuraiEnable: false,
        supaModelType: 'none',
        useLegacyGUI: false,
        wavespeedImage: {},
        hypaV3Presets: [{ name: 'A' }],
        hypaV3PresetId: 0,
        characters: [{ chaId: 'c0', chats: [], chatPage: 0 }],
        ...flags,
    } as unknown as Database
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

async function selectedType(): Promise<string> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OtherBotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await sleep(20)
    flushSync()
    const select = Array.from(target.querySelectorAll('select')).find((el) =>
        Array.from(el.options).some((option) => option.value === 'hypaV3'))
    if (!select) throw new Error('the memory type dropdown is not shown')
    return select.value
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('the memory Type dropdown follows the request path precedence', () => {
    // regression reproducer: CHORE-10 UI-1 (dropdown part), MC-712 8
    test('Hanurai together with V3 shows Hanurai', async () => {
        installDb({ hanuraiEnable: true, hypaV3: true })
        expect(await selectedType()).toBe('hanuraiMemory')
    })

    test('Hanurai together with V2 shows Hanurai', async () => {
        installDb({ hanuraiEnable: true, hypav2: true })
        expect(await selectedType()).toBe('hanuraiMemory')
    })

    test('V2 together with V3 shows V2', async () => {
        installDb({ hypav2: true, hypaV3: true })
        expect(await selectedType()).toBe('hypaV2')
    })

    test('Hanurai together with SupaMemory shows Hanurai', async () => {
        installDb({ hanuraiEnable: true, supaModelType: 'distilbart' })
        expect(await selectedType()).toBe('hanuraiMemory')
    })

    test('guard: V3 together with SupaMemory shows V3', async () => {
        installDb({ hypaV3: true, supaModelType: 'distilbart' })
        expect(await selectedType()).toBe('hypaV3')
    })

    test('guard: SupaMemory alone shows SupaMemory', async () => {
        installDb({ supaModelType: 'distilbart' })
        expect(await selectedType()).toBe('supaMemory')
    })

    test('guard: no memory system shows none', async () => {
        installDb({})
        expect(await selectedType()).toBe('none')
    })
})
