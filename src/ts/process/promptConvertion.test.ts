// @vitest-environment happy-dom

/**
 * The Playground conversion `promptConvertion` against the REAL converter and
 * the real `importPreset` (the mocks below cover only the modules' other
 * imports). Labels: [R] reproducer, red on the base by assertion; [G] guard,
 * may pass before and after. File names differ from inner names so a wrong
 * name source shows. Renders report a failure as text, so a failing check is an
 * assertion and not a thrown error.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Template } from '@huggingface/jinja'

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
    DBState: { db: { botPresets: [] } as unknown as Record<string, unknown> },
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

import { alertError, alertNormal } from 'src/ts/alert'
import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { DBState } from 'src/ts/stores.svelte'
import { importPreset, presetTemplate, type botPreset } from 'src/ts/storage/database.svelte'
import { OobaParams, detectPromptJSONType, promptConvertion } from 'src/ts/process/prompt'

type Message = { role: 'user' | 'assistant' | 'system', content: string }
type NamedJson = { name: string, json: object }

function run(files: NamedJson[]): string | null {
    try {
        promptConvertion(files.map((file) => {
            const content = JSON.stringify(file.json)
            return { name: file.name, content, type: detectPromptJSONType(content) }
        }))
        return null
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e)
    }
}

function pushed(): botPreset[] {
    return DBState.db.botPresets
}

function only(): botPreset {
    return pushed()[0]
}

function render(preset: botPreset | undefined, messages: Message[]): string {
    const template = preset?.JinjaTemplate
    if (typeof template !== 'string') {
        return '<<no JinjaTemplate>>'
    }
    try {
        return new Template(template).render({
            messages,
            add_generation_prompt: true,
            risu_char: 'C_NAME',
            risu_user: 'U_NAME',
            eos_token: '',
            bos_token: '',
        })
    }
    catch (e) {
        return `<<throws: ${e instanceof Error ? e.message : String(e)}>>`
    }
}

function samplersOf(preset: botPreset | undefined) {
    return {
        temperature: preset?.temperature,
        top_p: preset?.top_p,
        top_k: preset?.top_k,
        top_a: preset?.top_a,
        min_p: preset?.min_p,
        repetition_penalty: preset?.repetition_penalty,
        frequencyPenalty: preset?.frequencyPenalty,
        PresensePenalty: preset?.PresensePenalty,
    }
}

const conversation: Message[] = [
    { role: 'system', content: 'S1' },
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello' },
    { role: 'user', content: 'Q' },
]

const chatml = {
    input_sequence: '<|im_start|>user',
    output_sequence: '<|im_start|>assistant',
    system_sequence: '<|im_start|>system',
    input_suffix: '<|im_end|>\n',
    output_suffix: '<|im_end|>\n',
    system_suffix: '<|im_end|>\n',
    wrap: true,
    system_same_as_user: false,
}

const emptyContext = { story_string: '', chat_start: '' }

// A current text-completion file: its `samplers` list uses other names than the keys it carries.
const textgenDefault = {
    temp: 0.7,
    top_p: 0.9,
    top_k: 40,
    min_p: 0.05,
    rep_pen: 1.1,
    freq_pen: 0.2,
    presence_pen: 0.3,
    min_length: 0,
    samplers: ['dry', 'xtc'],
}

const chatFile = {
    prompts: [
        { identifier: 'main', content: 'Main text', role: 'system' },
        { identifier: 'chatHistory' },
    ],
    prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }],
    temperature: 0.8,
    top_p: 0.85,
    top_k: 30,
    top_a: 0.1,
    min_p: 0.07,
    repetition_penalty: 1.2,
    frequency_penalty: 0.5,
    presence_penalty: 0.25,
}

const sysprompt = { name: 'Inner', content: 'You are terse.', post_history: 'Stay terse.' }

beforeEach(() => {
    DBState.db.botPresets = []
    vi.mocked(alertNormal).mockClear()
    vi.mocked(alertError).mockClear()
})

describe('samplers', () => {
    test('[R] B1 a text-completion file is read by value, whatever its samplers list names', () => {
        expect(detectPromptJSONType(JSON.stringify(textgenDefault))).toBe('PARAMETERS')
        run([{ name: 'p.json', json: textgenDefault }])
        expect(samplersOf(only())).toEqual({
            temperature: 70,
            top_p: 0.9,
            top_k: 40,
            top_a: -1000,
            min_p: 0.05,
            repetition_penalty: 1.1,
            frequencyPenalty: 0.2 * 100,
            PresensePenalty: 0.3 * 100,
        })
    })

    test('[R] B2 a text-completion file without a samplers list converts', () => {
        const { samplers: _omitted, ...withoutList } = textgenDefault
        expect(run([{ name: 'p.json', json: withoutList }])).toBeNull()
        expect(pushed()).toHaveLength(1)
    })

    test('[R] B5 a chat file applies its eight samplers', () => {
        run([{ name: 'my-chat.json', json: chatFile }])
        expect(samplersOf(only())).toEqual({
            temperature: 80,
            top_p: 0.85,
            top_k: 30,
            top_a: 0.1,
            min_p: 0.07,
            repetition_penalty: 1.2,
            frequencyPenalty: 50,
            PresensePenalty: 25,
        })
    })

    test('[R] B5 a chat file without a key leaves that sampler unset, never zero', () => {
        const { top_k: _omitted, ...withoutTopK } = chatFile
        run([{ name: 'my-chat.json', json: withoutTopK }])
        expect(samplersOf(only()).top_k).toBe(-1000)
        expect(samplersOf(only()).top_p).toBe(0.85)
    })

    test.each([['parameters first', 0], ['chat first', 1]])('[R] B6 %s: a key the chat file lacks keeps the parameters value', (_label, swap) => {
        const { top_k: _omitted, ...withoutTopK } = chatFile
        const files: NamedJson[] = [{ name: 'p.json', json: textgenDefault }, { name: 'my-chat.json', json: withoutTopK }]
        run(swap ? files.reverse() : files)
        expect(samplersOf(only())).toMatchObject({ top_k: 40, temperature: 80, top_p: 0.85 })
    })
})

describe('names and kinds', () => {
    test('[R] B3 a chat file is named after its file', () => {
        run([{ name: 'my-chat.json', json: chatFile }])
        expect(only()?.name).toBe('my-chat')
    })

    test('[R] B10 the detector delegates to the shared kinds', () => {
        const kindOf = (json: object) => detectPromptJSONType(JSON.stringify(json))
        expect(kindOf(sysprompt)).toBe('STSYSPROMPT')
        expect(kindOf({ instruct: { input_sequence: 'a', output_sequence: 'b' } })).toBe('STBUNDLE')
        expect(kindOf({ name: 'n', prefix: 'a', suffix: 'b', separator: 'c' })).toBe('STREASONING')
        expect(kindOf({ value: '', show: true })).toBe('STSRW')
        expect(kindOf(chatFile)).toBe('STCHAT')
        expect(kindOf({ unrelated: 1 })).toBe('NOTSUPPORTED')
        expect(detectPromptJSONType('not json')).toBe('NOTSUPPORTED')
    })

    test('[G] the order of the files changes only the name', () => {
        const instruct = { name: 'a.json', json: chatml }
        const context = { name: 'b.json', json: { story_string: 'Story\n', chat_start: '***\n' } }
        const params = { name: 'c.json', json: textgenDefault }
        const orders = [
            [instruct, context, params], [instruct, params, context], [context, instruct, params],
            [context, params, instruct], [params, instruct, context], [params, context, instruct],
        ]
        const results = orders.map((files) => {
            DBState.db.botPresets = []
            run(files)
            return { ...only(), name: files[0].name }
        })
        for (const result of results) {
            expect(result).toEqual({ ...results[0], name: result.name })
        }
        expect(results[0].JinjaTemplate).toBeTypeOf('string')
    })
})

describe('plain presets', () => {
    test('[R] B7 a system prompt file alone makes a plain preset', () => {
        run([{ name: 'sys.json', json: sysprompt }])
        const preset = only()
        expect(preset?.aiModel).toBe(presetTemplate.aiModel)
        expect(preset?.useInstructPrompt).toBe(false)
        expect(preset?.JinjaTemplate).toBeUndefined()
        expect(preset?.promptTemplate?.map(item => item.type)).toEqual(
            ['plain', 'description', 'persona', 'lorebook', 'chat', 'plain', 'authornote', 'plain'])
        expect(preset?.promptTemplate?.[0]).toEqual({ type: 'plain', type2: 'main', text: 'You are terse.', role: 'system' })
        expect(preset?.promptTemplate?.[5]).toEqual({ type: 'plain', type2: 'normal', text: 'Stay terse.', role: 'system' })
    })

    test('[R] B8 a text-completion file alone and a context file alone stay plain', () => {
        run([{ name: 'p.json', json: textgenDefault }])
        expect(only()?.aiModel).toBe(presetTemplate.aiModel)
        expect(only()?.useInstructPrompt).toBe(false)
        expect(only()?.JinjaTemplate).toBeUndefined()
        DBState.db.botPresets = []
        run([{ name: 'c.json', json: { story_string: 'Story\n', chat_start: '***\n' } }])
        expect(only()?.aiModel).toBe(presetTemplate.aiModel)
        expect(only()?.useInstructPrompt).toBe(false)
        expect(only()?.JinjaTemplate).toBeUndefined()
    })
})

describe('conflicts and refusals', () => {
    test('[R] B9 a system prompt file with a chat file is refused before anything is pushed', () => {
        run([{ name: 'sys.json', json: sysprompt }, { name: 'my-chat.json', json: chatFile }])
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(alertError).toHaveBeenCalledWith(fillLang(language.errors.promptTypeConflict, { type: 'STSYSPROMPT' }))
        expect(pushed()).toEqual([])
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test.each([['forward', false], ['reversed', true]])('[R] B9 two system prompt files, %s: the first wins', (_label, reverse) => {
        const files: NamedJson[] = [
            { name: 'a.json', json: { name: 'A', content: 'first' } },
            { name: 'b.json', json: { name: 'B', content: 'second' } },
        ]
        run(reverse ? files.reverse() : files)
        expect(only()?.mainPrompt).toBe(reverse ? 'second' : 'first')
        expect(only()?.promptTemplate?.[0]).toMatchObject({ text: reverse ? 'second' : 'first' })
    })

    test('[R] B11 a bundle with another file is refused', () => {
        run([{ name: 'b.json', json: { sysprompt } }, { name: 'sys.json', json: sysprompt }])
        expect(alertError).toHaveBeenCalledWith(language.errors.stBundleAlone)
        expect(pushed()).toEqual([])
    })

    test('[R] B11 files that hold nothing are refused', () => {
        const reasoning = { name: 'n', prefix: 'a', suffix: 'b', separator: 'c' }
        const srw = { value: '', show: true }
        run([{ name: 'r.json', json: reasoning }])
        run([{ name: 'b.json', json: { reasoning, srw } }])
        expect(alertError).toHaveBeenCalledTimes(2)
        expect(alertError).toHaveBeenCalledWith(language.errors.stNothingToImport)
        expect(pushed()).toEqual([])
    })

    test('[R] B12 skipped sections are named in the one success notice', () => {
        const reasoning = { name: 'n', prefix: 'a', suffix: 'b', separator: 'c' }
        run([{ name: 'b.json', json: { sysprompt, reasoning } }])
        expect(alertNormal).toHaveBeenCalledTimes(1)
        const notice = vi.mocked(alertNormal).mock.calls[0][0]
        expect(notice.startsWith(language.alerts.presetConverted)).toBe(true)
        expect(notice).toContain('Reasoning Formatting')
        expect(pushed()).toHaveLength(1)
    })
})

describe('instruct rendering', () => {
    test('[R] B4 an instruct file with a context file renders its wrapped sequences, no undefined', () => {
        run([{ name: 'i.json', json: chatml }, { name: 'c.json', json: emptyContext }])
        expect(render(only(), conversation)).toBe(
            '<|im_start|>system\nS1<|im_end|>\n<|im_start|>user\nHi<|im_end|>\n'
            + '<|im_start|>assistant\nHello<|im_end|>\n<|im_start|>user\nQ<|im_end|>\n<|im_start|>assistant\n')
    })

    test('[R] B13 system_same_as_user takes the user sequence and suffix alone', () => {
        const gemma = {
            input_sequence: '<start_of_turn>user\n',
            output_sequence: '<start_of_turn>model\n',
            system_sequence: '',
            input_suffix: '<end_of_turn>\n',
            output_suffix: '<end_of_turn>\n',
            system_suffix: '<end_of_turn>\n',
            wrap: false,
            system_same_as_user: true,
        }
        run([{ name: 'g.json', json: gemma }])
        expect(render(only(), [{ role: 'system', content: 'S1' }, { role: 'user', content: 'Hi' }])).toBe(
            '<start_of_turn>user\nS1<end_of_turn>\n<start_of_turn>user\nHi<end_of_turn>\n<start_of_turn>model\n')
    })

    test('[R] B14 {{name}} becomes the speaker in each role branch', () => {
        const named = {
            input_sequence: '<|im_start|>{{name}}\n',
            output_sequence: '<|im_start|>{{name}}\n',
            system_sequence: '<|im_start|>{{name}}\n',
            input_suffix: '<|im_end|>\n',
            output_suffix: '<|im_end|>\n',
            system_suffix: '<|im_end|>\n',
        }
        run([{ name: 'n.json', json: named }])
        expect(render(only(), conversation)).toBe(
            '<|im_start|>System\nS1<|im_end|>\n<|im_start|>U_NAME\nHi<|im_end|>\n'
            + '<|im_start|>C_NAME\nHello<|im_end|>\n<|im_start|>U_NAME\nQ<|im_end|>\n<|im_start|>C_NAME\n')
    })

    test('[R] B14 unknown macros stay visible text instead of [object Object]', () => {
        const kobold = {
            input_sequence: '{{[INPUT]}}',
            output_sequence: '{{[OUTPUT]}}',
            input_suffix: '{{[INPUT_END]}}',
            output_suffix: '{{[OUTPUT_END]}}',
        }
        run([{ name: 'k.json', json: kobold }])
        expect(render(only(), [{ role: 'user', content: 'X' }, { role: 'assistant', content: 'Y' }]))
            .toBe('{{[INPUT]}}X{{[INPUT_END]}}{{[OUTPUT]}}Y{{[OUTPUT_END]}}{{[OUTPUT]}}')
    })

    test('[R] B14 a sequence holding {% is text, not template syntax', () => {
        const braces = { input_sequence: 'A{% if x %}B', output_sequence: 'R', input_suffix: '', output_suffix: '' }
        run([{ name: 'b.json', json: braces }])
        expect(render(only(), [{ role: 'user', content: 'Hi' }])).toBe('A{% if x %}BHiR')
    })

    test('[R] B15 {{user}} and {{char}} are substituted in any case', () => {
        const macros = { input_sequence: '{{User}}: ', output_sequence: '{{CHAR}}: ', input_suffix: '', output_suffix: '' }
        run([{ name: 'm.json', json: macros }])
        expect(render(only(), [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Yo' }]))
            .toBe('U_NAME: HiC_NAME: YoC_NAME: ')
    })

    test('[R] G1 documenting: real newlines of imported sequences are kept', () => {
        const newlines = { input_sequence: '\nUSER: ', output_sequence: 'ASSISTANT:\n', input_suffix: '', output_suffix: '' }
        run([{ name: 'nl.json', json: newlines }])
        expect(render(only(), [{ role: 'user', content: 'Hi' }])).toBe('\nUSER: HiASSISTANT:\n')
    })
})

describe('parity with the Settings import', () => {
    const instruct = { ...chatml, name: 'Inner instruct' }
    const context = { story_string: 'Story\n{{#if x}}drop{{/if}}', chat_start: '***\n' }
    const bundle = { instruct, context, sysprompt, preset: textgenDefault }
    const cases: [string, object][] = [
        ['system prompt', sysprompt],
        ['text completion', textgenDefault],
        ['context', context],
        ['instruct', instruct],
        ['bundle of instruct, context, system prompt and parameters', bundle],
    ]

    test.each(cases)('[R] B16 %s: the Playground and importPreset push the same preset', async (_label, json) => {
        await importPreset({ name: 'file-name.json', data: new TextEncoder().encode(JSON.stringify(json)) })
        const fromSettings = only()
        DBState.db.botPresets = []
        expect(run([{ name: 'file-name.json', json }])).toBeNull()
        expect(only()).toEqual(fromSettings)
        expect(only()?.name).toBe('file-name')
    })
})

describe('chat file converter behaviour', () => {
    test('[G] a chat file with a context file names Context Template as skipped', () => {
        run([{ name: 'my-chat.json', json: chatFile }, { name: 'c.json', json: emptyContext }])
        expect(pushed()).toHaveLength(1)
        expect(alertNormal).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertNormal).mock.calls[0][0]).toContain('Context Template')
    })

    test('[G] assistant_prefill adds postEverything followed by the bot prefill item', () => {
        run([{ name: 'my-chat.json', json: { ...chatFile, assistant_prefill: 'PRE' } }])
        const template = only()?.promptTemplate ?? []
        expect(template.slice(-2)).toEqual([
            { type: 'postEverything' },
            { type: 'plain', type2: 'main', text: '{{#if {{prefill_supported}}}}PRE{{/if}}', role: 'bot' },
        ])
    })

    test('[G] non-string chat content becomes an empty text', () => {
        const json = {
            ...chatFile,
            prompts: [{ identifier: 'main', content: 42, role: 'system' }, { identifier: 'chatHistory' }],
        }
        run([{ name: 'my-chat.json', json }])
        expect(only()?.promptTemplate?.[0]).toMatchObject({ type: 'plain', text: '' })
    })
})

describe('exports', () => {
    test('[G] G5 OobaParams is still exported from prompt.ts', () => {
        expect(OobaParams).toHaveLength(33)
    })
})
