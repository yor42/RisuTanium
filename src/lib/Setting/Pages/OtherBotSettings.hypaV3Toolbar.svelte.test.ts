// @vitest-environment happy-dom

/**
 * The preset toolbar of `OtherBotSettings.svelte`: New asks a name and refuses a blank one;
 * Duplicate asks a name and appends an independent copy after the last preset, selected; Rename
 * addresses the preset by id.
 *
 * Mounts the REAL page on its long-term-memory tab with HypaV3 chosen, over a real `$state`
 * database and the real preset helpers. The name prompt is a mock the test holds open and
 * answers. The toolbar buttons are, in order: add, rename, delete, export, import, duplicate.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const prompts = vi.hoisted(() => {
    const pending: Array<{ message: string, defaultValue: string | undefined, settle: (answer: string) => void }> = []
    return {
        pending,
        error: vi.fn(),
        ask: (message: string, _datalist?: unknown, defaultValue?: string) =>
            new Promise<string>((settle) => { pending.push({ message, defaultValue, settle }) }),
    }
})

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertInput: prompts.ask,
        alertError: prompts.error,
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

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { createHypaV3Preset } from 'src/ts/process/memory/hypaV3Presets'
import OtherBotSettings from './OtherBotSettings.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

function installDb(names: string[], selected: number): void {
    DBState.db = {
        hypaV3: true,
        hypav2: false,
        hanuraiEnable: false,
        supaModelType: 'none',
        useLegacyGUI: false,
        wavespeedImage: {},
        hypaV3Presets: names.map((name) => createHypaV3Preset(name)),
        hypaV3PresetId: selected,
        characters: [{ chaId: 'c0', chats: [], chatPage: 0 }],
    } as unknown as Database
}

const names = () => DBState.db.hypaV3Presets.map((p) => p.name)

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function mountSettings(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OtherBotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

const BUTTONS = { add: 0, rename: 1, duplicate: 5 } as const

async function click(target: HTMLElement, which: keyof typeof BUTTONS): Promise<void> {
    const toolbar = target.querySelector('div.flex.items-center.mb-8')
    if (!toolbar) throw new Error('the HypaV3 preset toolbar is not shown')
    ;(toolbar.querySelectorAll('button')[BUTTONS[which]] as HTMLButtonElement).click()
    await settle()
}

async function answer(value: string): Promise<{ message: string, defaultValue: string | undefined }> {
    const next = prompts.pending.shift()
    if (!next) throw new Error('no name prompt is open')
    next.settle(value)
    await settle()
    return next
}

beforeEach(() => {
    prompts.pending.length = 0
    prompts.error.mockClear()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('the HypaV3 preset toolbar', () => {
    test('New asks a name, appends a default preset with that name and selects it', async () => {
        installDb(['A', 'B'], 0)
        const target = mountSettings()
        await click(target, 'add')
        expect(prompts.pending).toHaveLength(1)
        await answer('Fresh')
        expect(names()).toEqual(['A', 'B', 'Fresh'])
        expect(DBState.db.hypaV3PresetId).toBe(2)
        expect(new Set(DBState.db.hypaV3Presets.map((p) => p.id)).size).toBe(3)
    })

    test('New with a blank name adds nothing and says why', async () => {
        installDb(['A'], 0)
        const target = mountSettings()
        await click(target, 'add')
        await answer('   ')
        expect(names()).toEqual(['A'])
        expect(prompts.error).toHaveBeenCalledWith(language.hypaV3Settings.blankPresetNameError)
    })

    test('New with the prompt dismissed adds nothing and shows no error', async () => {
        installDb(['A'], 0)
        const target = mountSettings()
        await click(target, 'add')
        await answer('')
        expect(names()).toEqual(['A'])
        expect(prompts.error).not.toHaveBeenCalled()
    })

    test('Duplicate asks a name, appends an independent copy after the last preset and selects it', async () => {
        installDb(['A', 'B', 'C'], 0)
        DBState.db.hypaV3Presets[0].settings.maxChatsPerSummary = 11
        const target = mountSettings()
        await click(target, 'duplicate')
        const asked = await answer('A twin')
        expect(asked.defaultValue).toBe('A copy')
        expect(names()).toEqual(['A', 'B', 'C', 'A twin'])
        expect(DBState.db.hypaV3PresetId).toBe(3)

        const [source, copy] = [DBState.db.hypaV3Presets[0], DBState.db.hypaV3Presets[3]]
        expect(copy.id).not.toBe(source.id)
        expect(copy.settings.maxChatsPerSummary).toBe(11)

        copy.settings.maxChatsPerSummary = 2
        expect(source.settings.maxChatsPerSummary).toBe(11)
    })

    test('Duplicate follows the preset that was selected when it was pressed, not the one selected when the name arrives', async () => {
        installDb(['A', 'B'], 0)
        DBState.db.hypaV3Presets[0].settings.maxChatsPerSummary = 11
        DBState.db.hypaV3Presets[1].settings.maxChatsPerSummary = 4
        const target = mountSettings()
        await click(target, 'duplicate')
        DBState.db.hypaV3PresetId = 1
        flushSync()
        await answer('Twin')
        expect(names()).toEqual(['A', 'B', 'Twin'])
        expect(DBState.db.hypaV3Presets[2].settings.maxChatsPerSummary).toBe(11)
    })

    test('Rename follows the preset that was selected when it was pressed, even if the list shifts while the prompt is open', async () => {
        installDb(['A', 'B', 'C'], 1)
        const target = mountSettings()
        await click(target, 'rename')
        DBState.db.hypaV3Presets.unshift(createHypaV3Preset('new'))
        flushSync()
        await answer('Renamed')
        expect(names()).toEqual(['new', 'A', 'Renamed', 'C'])
    })
})
