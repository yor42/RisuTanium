// @vitest-environment happy-dom

/**
 * #929 S1b (N4, MC-5095): a preset file (`downloadPreset` as `.json`, `.risup` and the `return` form that feeds Realm) and a
 * bundle entry (`buildPresetBundlePayload`) use the same translation as a `.bin`: with the flag on, a task that reads as
 * `same` gets a block that is a copy of the preset's main values, the key is absent, and a flag-off preset is untouched.
 *
 * Driven against the REAL `database.svelte.ts` and `presetBundle.ts`; the module mocks cover only their other imports, as
 * in `taskParameterModes.presetFiles.test.ts`. No pre-export warning is asserted for a preset file: no confirm path exists
 * for one, and the entries a future confirm would show are the ones `translateTaskParameters` returns.
 *
 * Titles: `reproducer` fails on the pre-change base (it keeps the dormant blocks); `guard` passes before and after.
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
import * as taskModes from 'src/ts/storage/taskParameterModes'
import { decode as decodeMsgpack } from 'msgpackr/index-no-eval'
import * as fflate from 'fflate'

type Loose = Record<string, unknown>

const MIX = { memory: 'own', emotion: 'same', translate: 'same', otherAx: 'same' }
const ALL_SAME = { memory: 'same', emotion: 'same', translate: 'same', otherAx: 'same' }
const COPY = { temperature: 80, top_k: 40, repetition_penalty: 1.1, min_p: 0.1, top_a: 0.2, top_p: 0.9, frequency_penalty: 30, presence_penalty: 30, reasoning_effort: 2, thinking_tokens: 2048, verbosity: 2 }

function container(extra: Loose = {}): Loose {
    return { memory: { temperature: 11 }, emotion: { temperature: 12 }, translate: {}, otherAx: { top_k: 3 }, overrides: {}, ...extra }
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
        seperateParametersEnabled: true, seperateParameters: container({ taskModes: { ...MIX } }),
        modelTools: [], presetRegex: [], promptTemplate: null, mainPrompt: 'm', jailbreak: 'j', formatingOrder: [], aiModel: 'gpt-x',
        apiType: 'x', maxContext: 4000, maxResponse: 300,
        temperature: 80, top_k: 40, repetition_penalty: 1.1, min_p: 0.1, top_a: 0.2, top_p: 0.9, frequencyPenalty: 30, PresensePenalty: 30,
        reasoningEffort: 2, thinkingTokens: 2048, verbosity: 2,
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

describe('T-R14 a flag-on preset file carries copies for the same tasks', () => {
    test.each(['json', 'risupreset', 'return'] as const)('reproducer: a %s export copies the main values into the same tasks, keeps the own task, has no key', async (kind) => {
        const exported = await exportAs(kind)

        expect(containerOf(exported)).toEqual({ memory: { temperature: 11 }, emotion: COPY, translate: COPY, otherAx: COPY, overrides: {} })
        expect(exported.seperateParametersEnabled).toBe(true)
    })

    test('reproducer: a bundle entry equals the single export', async () => {
        const single = await exportAs('return')
        const slot = (DBState.db as unknown as { botPresets: botPreset[] }).botPresets[0]

        const payload = buildPresetBundlePayload({ presetFolders: [] }, [slot])

        expect(containerOf(payload.presets[0].preset).emotion).toEqual(COPY)
        expect(payload.presets[0].preset).toEqual(single)
    })

    test('guard: the working database and the saved slot keep their own blocks and the key after an export', async () => {
        await exportAs('return')

        expect(containerOf(DBState.db)).toEqual(container({ taskModes: { ...MIX } }))
        expect(containerOf((DBState.db as unknown as { botPresets: Loose[] }).botPresets[0])).toEqual(container({ taskModes: { ...MIX } }))
    })
})

describe('T-R15 a flag-off preset file is never translated', () => {
    test.each(['json', 'risupreset', 'return'] as const)('guard: a %s export keeps every block byte for byte and has no key', async (kind) => {
        DBState.db = workingDb({ seperateParametersEnabled: false, seperateParameters: container({ taskModes: { ...ALL_SAME } }) }) as unknown as typeof DBState.db

        const exported = await exportAs(kind)

        expect(containerOf(exported)).toEqual(container())
        expect(exported.seperateParametersEnabled).toBe(false)
    })

    test('guard: a flag-on preset that reads all own is not translated', async () => {
        DBState.db = workingDb({ seperateParameters: container({ taskModes: { ...ALL_SAME } }) }) as unknown as typeof DBState.db

        expect(containerOf(await exportAs('return'))).toEqual(container())
    })
})

describe('T-R16 the entries a preset-file export would name', () => {
    test('unit: the pure translation of a slot returns the unrepresentable main value and the differing blocks', async () => {
        DBState.db = workingDb({ thinkingTokens: null }) as unknown as typeof DBState.db
        await exportAs('return')
        const slot = (DBState.db as unknown as { botPresets: botPreset[] }).botPresets[0]

        const { leftOut } = taskModes.translateTaskParameters(slot, 'slot')

        expect(leftOut).toEqual([
            { task: 'emotion', parameter: 'thinking_tokens' },
            { task: 'emotion', parameter: 'replacedBlock' },
            { task: 'translate', parameter: 'thinking_tokens' },
            { task: 'otherAx', parameter: 'thinking_tokens' },
            { task: 'otherAx', parameter: 'replacedBlock' },
        ])
    })

    test('unit: a block equal to the copy gives no replaced-block entry', async () => {
        DBState.db = workingDb({ seperateParameters: container({ emotion: { ...COPY }, otherAx: { ...COPY }, taskModes: { ...MIX } }) }) as unknown as typeof DBState.db
        await exportAs('return')
        const slot = (DBState.db as unknown as { botPresets: botPreset[] }).botPresets[0]

        expect(taskModes.translateTaskParameters(slot, 'slot').leftOut).toEqual([])
    })
})
