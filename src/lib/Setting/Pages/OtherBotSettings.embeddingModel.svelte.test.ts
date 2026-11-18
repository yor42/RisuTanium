// @vitest-environment happy-dom

/**
 * The embedding model dropdown of `OtherBotSettings.svelte` offers the multilingual E5 option, writes the choice to
 * `DBState.db.hypaModel`, and offers only values that the embedding model lists classify (upstream or fork-only).
 *
 * Mounts the REAL component over a real `$state` database. The comment above each case marks it: a regression
 * reproducer fails while the option is absent; a compatibility guard pins behaviour that holds regardless.
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

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import OtherBotSettings from './OtherBotSettings.svelte'


//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function installDb(hypaModel: string): void {
    DBState.db = {
        hypaModel,
        hypaV3: false,
        hypav2: false,
        hanuraiEnable: false,
        supaModelType: 'none',
        useLegacyGUI: false,
        wavespeedImage: {},
        hypaV3Presets: [{ name: 'A' }],
        hypaV3PresetId: 0,
        characters: [{ chaId: 'c0', chats: [], chatPage: 0 }],
        memoryAlgorithmType: 'none',
    } as unknown as Database
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

async function embeddingSelect(): Promise<HTMLSelectElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OtherBotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await sleep(20)
    flushSync()
    const select = Array.from(target.querySelectorAll('select')).find((el) =>
        Array.from(el.options).some((option) => option.value === 'bgeM3Ko'))
    if (!select) throw new Error('the embedding dropdown is not shown')
    return select
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
    select.value = value
    // happy-dom does not match `:checked` on an option, which Svelte's select binding queries to read the choice;
    // answer that one query from the selected index.
    const query = select.querySelector.bind(select)
    select.querySelector = ((selector: string) =>
        selector === ':checked' ? select.options[select.selectedIndex] : query(selector)) as typeof select.querySelector
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await sleep(20)
    flushSync()
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    Reflect.deleteProperty(navigator, 'gpu')
})

//#endregion

describe('the embedding model dropdown', () => {
    // regression reproducer: T10
    test('offers the multilingual E5 option, shows it for a database holding it and writes a choice', async () => {
        installDb('multiE5Small')
        const select = await embeddingSelect()
        expect(Array.from(select.options).map((o) => o.value)).toContain('multiE5Small')
        expect(select.value).toBe('multiE5Small')

        await choose(select, 'bgeM3Ko')
        expect(DBState.db.hypaModel).toBe('bgeM3Ko')

        await choose(select, 'multiE5Small')
        expect(DBState.db.hypaModel).toBe('multiE5Small')
    })

    // compatibility guard (post-fix only: the lists do not exist before): T10b
    test.each([false, true])('every option value is classified (GPU block shown: %s)', async (gpu) => {
        if (gpu) {
            Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true })
        }
        installDb('MiniLM')
        const select = await embeddingSelect()
        const { UPSTREAM_HYPA_MODELS, FORK_ONLY_HYPA_MODELS } = await import('src/ts/process/memory/embeddingModels')
        const classified: readonly string[] = [...UPSTREAM_HYPA_MODELS, ...FORK_ONLY_HYPA_MODELS]
        const values = Array.from(select.options).map((o) => o.value)
        expect(values.includes('MiniLMGPU')).toBe(gpu)
        for (const value of values) {
            expect(classified, `option ${value}`).toContain(value)
        }
    })
})
