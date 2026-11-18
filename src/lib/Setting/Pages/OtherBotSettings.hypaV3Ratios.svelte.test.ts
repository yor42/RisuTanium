// @vitest-environment happy-dom

/**
 * `OtherBotSettings.svelte` keeps the HypaV3 ratios valid while the user edits them: a negative
 * ratio becomes 0, extra summarization follows the memory tokens ratio down, and when recent plus
 * similar would exceed 1 the ratio that was NOT edited yields.
 *
 * Mounts the REAL page on its long-term-memory tab with HypaV3 chosen, over a real `$state`
 * database and the real clamp. Writing a ratio through `DBState` is what a slider's bind does.
 * Titles beginning "guard:" pin behaviour that is the same before and after the change.
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
import { createHypaV3Preset, type HypaV3Settings } from 'src/ts/process/memory/hypaV3Presets'
import OtherBotSettings from './OtherBotSettings.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    flushSync()
    await sleep(20)
    flushSync()
}

function installDb(settings: Partial<HypaV3Settings>): void {
    DBState.db = {
        hypaV3: true,
        hypav2: false,
        hanuraiEnable: false,
        supaModelType: 'none',
        useLegacyGUI: false,
        wavespeedImage: {},
        hypaV3Presets: [createHypaV3Preset('A', settings)],
        hypaV3PresetId: 0,
        characters: [{ chaId: 'c0', chats: [], chatPage: 0 }],
    } as unknown as Database
}

const active = () => DBState.db.hypaV3Presets[0].settings

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

async function mountSettings(): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OtherBotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    await settle()
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('the HypaV3 ratios on the settings page', () => {
    // regression reproducer: the old effects returned early on a falsy value and never clamped below 0
    test('a negative similar ratio becomes 0', async () => {
        installDb({ similarMemoryRatio: -0.2 })
        await mountSettings()
        expect(active().similarMemoryRatio).toBe(0)
    })

    // regression reproducer: extra was never capped by the memory tokens ratio
    test('extra summarization follows the memory tokens ratio down', async () => {
        installDb({ memoryTokensRatio: 0.2, extraSummarizationRatio: 0.3 })
        await mountSettings()
        expect(active().extraSummarizationRatio).toBeCloseTo(0.3)

        active().memoryTokensRatio = 0.9
        await settle()

        expect(active().memoryTokensRatio).toBe(0.9)
        expect(active().extraSummarizationRatio).toBeCloseTo(0.1)
    })

    // compatibility guard: the two old effects already made the other ratio yield
    test('guard: editing recent makes similar yield', async () => {
        installDb({ recentMemoryRatio: 0.4, similarMemoryRatio: 0.4 })
        await mountSettings()

        active().recentMemoryRatio = 0.8
        await settle()

        expect(active().recentMemoryRatio).toBeCloseTo(0.8)
        expect(active().similarMemoryRatio).toBeCloseTo(0.2)
    })

    // compatibility guard: the mirror case
    test('guard: editing similar makes recent yield', async () => {
        installDb({ recentMemoryRatio: 0.4, similarMemoryRatio: 0.4 })
        await mountSettings()

        active().similarMemoryRatio = 0.8
        await settle()

        expect(active().similarMemoryRatio).toBeCloseTo(0.8)
        expect(active().recentMemoryRatio).toBeCloseTo(0.2)
    })

    test('recent can be edited down to 0 and similar is left alone', async () => {
        installDb({ recentMemoryRatio: 0.4, similarMemoryRatio: 0.4 })
        await mountSettings()

        active().recentMemoryRatio = 0
        await settle()

        expect(active().recentMemoryRatio).toBe(0)
        expect(active().similarMemoryRatio).toBeCloseTo(0.4)
    })
})
