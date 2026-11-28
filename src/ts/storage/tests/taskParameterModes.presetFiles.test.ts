// @vitest-environment happy-dom

/**
 * T-R12 (#929, S1a): a preset file (`downloadPreset` as `.json`, `.risup` and the `return` form that feeds Realm) and a bundle
 * entry (`buildPresetBundlePayload`) carry no per-task modes key, and a bundle entry still equals a single export.
 *
 * Driven against the REAL `database.svelte.ts` and `presetBundle.ts`; the module mocks cover only their other imports, as
 * in `secretFields.test.ts`. The fixture holds the key inside the working container, so `downloadPreset` saves it into the
 * preset first. Titles: `new-behaviour` fails on the pre-change base only because the fixture holds the key; `guard`
 * passes before and after.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    encryptBuffer: vi.fn(async (d: unknown) => d),
    selectSingleFile: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(async () => true),
    saveAsset: vi.fn(async () => ''),
    forageStorage: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    defaultColorScheme: { bgcolor: '#000000' },
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string, settings: unknown) => ({ name, settings })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/presets'), () => ({
    normalizeTranslatorPresetState: vi.fn(),
}) as unknown as typeof import('src/ts/translator/presets'))

vi.mock(import('src/ts/polyfill'), () => ({
    safeStructuredClone: vi.fn((v: unknown) => JSON.parse(JSON.stringify(v))),
}) as unknown as typeof import('src/ts/polyfill'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Record<string, unknown> },
    selectedCharID: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/model/modellist'), async () => {
    const types = await import('src/ts/model/types')
    return {
        LLMFlags: types.LLMFlags,
        LLMFormat: types.LLMFormat,
        LLMTokenizer: types.LLMTokenizer,
    }
})

vi.mock('src/ts/rpack/rpack_js.js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { downloadFile } from 'src/ts/globalApi.svelte'
import { downloadPreset, type botPreset } from 'src/ts/storage/database.svelte'
import { buildPresetBundlePayload } from 'src/ts/storage/presetBundle'
import { decode as decodeMsgpack } from 'msgpackr/index-no-eval'
import * as fflate from 'fflate'

type Loose = Record<string, unknown>

const MODES = { memory: 'own', emotion: 'same', translate: 'same', otherAx: 'same' }

function container(extra: Loose = {}): Loose {
    return { memory: { temperature: 11 }, emotion: {}, translate: { top_k: 3 }, otherAx: {}, overrides: {}, ...extra }
}

function workingDb(extra: Loose = {}): Loose {
    return {
        botPresets: [{ name: 'Src' }], botPresetsId: 0, NAIsettings: {},
        proxyKey: '', forceReplaceUrl: '', google: { accessToken: '' }, mancerHeader: '',
        textgenWebUIBlockingURL: '', textgenWebUIStreamURL: '', koboldURL: '', openAIKey: '',
        additionalParams: [],
        ooba: {}, ainconfig: {}, reverseProxyOobaArgs: { mode: 'instruct' }, promptSettings: { assistantPrefill: '' },
        customAPIFormat: 0, customFlags: [], seperateModels: { memory: '', emotion: '', translate: '', otherAx: '' },
        fallbackModels: { memory: [], emotion: [], translate: [], otherAx: [], model: [] },
        seperateParametersEnabled: true, seperateParameters: container({ taskModes: { ...MODES } }),
        modelTools: [], presetRegex: [], promptTemplate: null, mainPrompt: 'm', jailbreak: 'j', formatingOrder: [], aiModel: 'gpt-x',
        apiType: 'x', temperature: 80, maxContext: 4000, maxResponse: 300, frequencyPenalty: 70, PresensePenalty: 70,
        ...extra,
    }
}

function containerOf(record: unknown): Loose {
    return (record as { seperateParameters: Loose }).seperateParameters
}

async function exportAs(kind: 'json' | 'risupreset' | 'return'): Promise<Loose> {
    vi.mocked(downloadFile).mockClear()
    const result = await downloadPreset(0, kind)
    if (kind === 'return') {
        return JSON.parse(JSON.stringify(result.data)) as Loose
    }
    const bytes = vi.mocked(downloadFile).mock.calls[0][1] as Uint8Array
    if (kind === 'json') {
        return JSON.parse(Buffer.from(bytes).toString('utf-8')) as Loose
    }
    const wrapper = decodeMsgpack(fflate.decompressSync(bytes)) as { preset: Uint8Array }
    return decodeMsgpack(wrapper.preset) as Loose
}

beforeEach(() => {
    DBState.db = workingDb() as unknown as typeof DBState.db
})

describe('T-R12 preset files carry no taskModes key', () => {
    test.each(['json', 'risupreset', 'return'] as const)('new-behaviour: a %s export has no key and keeps the blocks and the flag', async (kind) => {
        const exported = await exportAs(kind)

        expect(containerOf(exported)).not.toHaveProperty('taskModes')
        expect(containerOf(exported).memory).toEqual({ temperature: 11 })
        expect(containerOf(exported).translate).toEqual({ top_k: 3 })
        expect(exported.seperateParametersEnabled).toBe(true)
    })

    test('guard: the working database and the saved slot keep the key after an export', async () => {
        await exportAs('return')

        expect(containerOf(DBState.db)).toHaveProperty('taskModes')
        expect(containerOf((DBState.db as unknown as { botPresets: Loose[] }).botPresets[0])).toHaveProperty('taskModes')
    })

    test('new-behaviour: a bundle entry has no key and equals the single export', async () => {
        const single = await exportAs('return')
        const slot = (DBState.db as unknown as { botPresets: botPreset[] }).botPresets[0]

        const payload = buildPresetBundlePayload({ presetFolders: [] }, [slot])

        expect(containerOf(payload.presets[0].preset)).not.toHaveProperty('taskModes')
        expect(payload.presets[0].preset).toEqual(single)
    })

    test('guard: a preset without the key exports its container unchanged', async () => {
        DBState.db = workingDb({ seperateParameters: container() }) as unknown as typeof DBState.db

        const exported = await exportAs('return')

        expect(containerOf(exported)).toEqual(container())
    })
})
