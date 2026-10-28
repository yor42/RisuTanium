// @vitest-environment happy-dom

/**
 * The Settings SillyTavern chat-completion import goes through the shared
 * converter. Every test drives the REAL `importPreset` (and, for parity, the
 * real `promptConvertion`); the mocks below cover only the modules' other
 * imports. Labels: [R] reproducer, red on the previous Settings chat branch by
 * assertion. The fixture has no inner name, so the preset name can only come from the file name.
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
    downloadFile: vi.fn(async () => {}),
    saveAsset: vi.fn(async () => ''),
    forageStorage: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => {}),
    alertError: vi.fn(),
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
    safeStructuredClone: vi.fn((v: unknown) => v === undefined ? undefined : JSON.parse(JSON.stringify(v))),
}) as unknown as typeof import('src/ts/polyfill'))

vi.mock(import('src/ts/tokenizer'), () => ({
    tokenizeAccurate: vi.fn(async () => 0),
}) as unknown as typeof import('src/ts/tokenizer'))

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
import { importPreset, presetTemplate, type botPreset } from 'src/ts/storage/database.svelte'
import { detectPromptJSONType, promptConvertion } from 'src/ts/process/prompt'

function fileOf(name: string, content: unknown) {
    return { name, data: new TextEncoder().encode(JSON.stringify(content)) }
}

function pushedPresets(): botPreset[] {
    return DBState.db.botPresets
}

/** A chat-shaped file with a main prompt and the chat history, no `chat_completion_source`. */
function chatFile(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        prompts: [
            { identifier: 'main', content: 'M', role: 'system' },
            { identifier: 'chatHistory' },
        ],
        prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }],
        ...extra,
    }
}

beforeEach(() => {
    DBState.db = { botPresets: [] } as unknown as typeof DBState.db
})

describe('[R] Settings chat-completion import through the converter', () => {
    test('C1 the preset is named after the file and a file without chat_completion_source still imports', async () => {
        await importPreset(fileOf('my-chat.json', chatFile()))
        expect(pushedPresets()).toHaveLength(1)
        expect(pushedPresets()[0]?.name).toBe('my-chat')
        expect(pushedPresets()[0]?.promptTemplate?.length).toBeGreaterThan(0)
    })

    test('C2 the model is openrouter', async () => {
        expect(presetTemplate.aiModel).not.toBe('openrouter')
        await importPreset(fileOf('my-chat.json', chatFile()))
        expect(pushedPresets()[0]?.aiModel).toBe('openrouter')
        expect(pushedPresets()[0]?.subModel).toBe('openrouter')
    })

    test('C3 all 8 sampler keys are applied by value', async () => {
        const file = chatFile({
            temperature: 0.5,
            frequency_penalty: 0.2,
            presence_penalty: 0.4,
            top_p: 0.9,
            top_k: 33,
            top_a: 0.31,
            min_p: 0.07,
            repetition_penalty: 1.23,
        })
        // The file values differ from the template, or "applied" cannot be told from "kept".
        expect(presetTemplate.top_p).not.toBe(0.9)
        expect(presetTemplate.top_k).not.toBe(33)
        expect(presetTemplate.top_a).not.toBe(0.31)
        expect(presetTemplate.min_p).not.toBe(0.07)
        expect(presetTemplate.repetition_penalty).not.toBe(1.23)
        await importPreset(fileOf('my-chat.json', file))
        const preset = pushedPresets()[0]
        expect({
            temperature: preset?.temperature,
            frequencyPenalty: preset?.frequencyPenalty,
            PresensePenalty: preset?.PresensePenalty,
            top_p: preset?.top_p,
            top_k: preset?.top_k,
            top_a: preset?.top_a,
            min_p: preset?.min_p,
            repetition_penalty: preset?.repetition_penalty,
        }).toEqual({
            temperature: 50,
            frequencyPenalty: 20,
            PresensePenalty: 40,
            top_p: 0.9,
            top_k: 33,
            top_a: 0.31,
            min_p: 0.07,
            repetition_penalty: 1.23,
        })
    })

    test('C4 an absent sampler key is unset (-1000), never NaN, never a template default', async () => {
        await importPreset(fileOf('my-chat.json', chatFile()))
        const preset = pushedPresets()[0]
        expect(Number.isFinite(preset?.PresensePenalty)).toBe(true)
        expect(preset?.PresensePenalty).toBe(-1000)
        expect(preset?.temperature).toBe(-1000)
        expect(preset?.frequencyPenalty).toBe(-1000)
        expect(preset?.top_p).toBe(-1000)
    })

    test('C5 presence_penalty is scaled by 100 only', async () => {
        await importPreset(fileOf('my-chat.json', chatFile({ presence_penalty: 0.5 })))
        expect(pushedPresets()[0]?.PresensePenalty).toBe(50)
    })

    test('C6 importPreset and promptConvertion give the same preset for the same chat file', async () => {
        const file = chatFile({
            temperature: 0.5,
            frequency_penalty: 0.2,
            presence_penalty: 0.4,
            top_p: 0.9,
            top_k: 33,
            repetition_penalty: 1.23,
            assistant_prefill: 'PREFILL',
        })
        await importPreset(fileOf('file-name.json', file))
        const fromSettings = pushedPresets()[0]
        DBState.db.botPresets = []
        const content = JSON.stringify(file)
        promptConvertion([{ name: 'file-name.json', content, type: detectPromptJSONType(content) }])
        expect(pushedPresets()).toHaveLength(1)
        expect(fromSettings?.name).toBe('file-name')
        expect(pushedPresets()[0]).toEqual(fromSettings)
    })

    test('C7 a chat-shaped file that carries mainPrompt is a Risu preset, not a chat import', async () => {
        await importPreset(fileOf('risu-like.json', chatFile({ mainPrompt: 'x' })))
        expect(pushedPresets()).toHaveLength(1)
        expect(pushedPresets()[0]?.name).not.toBe('Imported ST Preset')
        expect(pushedPresets()[0]?.mainPrompt).toBe('x')
    })
})

describe('[G] guards (pass before and after)', () => {
    test('S-G3 prompt_order[0].order that is not an array stays on the raw fallback', async () => {
        const file = {
            prompts: [{ identifier: 'main', content: 'M' }],
            prompt_order: [{ character_id: 100000, order: 'not-an-array' }],
            temperature: 0.5,
        }
        await importPreset(fileOf('chat-badorder.json', file))
        expect(pushedPresets()).toHaveLength(1)
        expect(pushedPresets()[0]?.name).toBe(presetTemplate.name)
        expect(pushedPresets()[0]?.temperature).toBe(0.5)
    })

    test('S-G6 the saved chat preset carries no member beyond the template keys, promptTemplate and the four extra samplers', async () => {
        await importPreset(fileOf('my-chat.json', chatFile({ temperature: 0.5 })))
        const allowed = ['promptTemplate', 'top_k', 'top_a', 'min_p', 'repetition_penalty']
        const extra = Object.keys(pushedPresets()[0] ?? {}).filter(key => !(key in presetTemplate) && !allowed.includes(key))
        expect(extra).toEqual([])
    })
})
