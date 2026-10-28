// @vitest-environment happy-dom

/**
 * Step-0 baseline of the Playground conversion `promptConvertion`: the full
 * preset it pushes, and for each instruct case the rendering of its Jinja
 * template with the chat-template context on a fixed message list. Every
 * assertion is [G] (green on the unchanged base); the baseline is edited only
 * where the stage's intended-diff table lists a difference.
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
    safeStructuredClone: vi.fn((v: unknown) => JSON.parse(JSON.stringify(v))),
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
import { presetTemplate, type botPreset } from 'src/ts/storage/database.svelte'
import { detectPromptJSONType, promptConvertion } from 'src/ts/process/prompt'

type Message = { role: 'user' | 'assistant' | 'system', content: string }

function convert(files: { name: string, json: object }[]): void {
    promptConvertion(files.map((file) => {
        const content = JSON.stringify(file.json)
        return { name: file.name, content, type: detectPromptJSONType(content) }
    }))
}

function pushedPresets(): botPreset[] {
    return DBState.db.botPresets
}

/** Same context `applyChatTemplate` passes to the engine. */
function renderLikeChatTemplate(source: string, messages: Message[]): string {
    return new Template(source).render({
        messages,
        add_generation_prompt: true,
        risu_char: 'C_NAME',
        risu_user: 'U_NAME',
        eos_token: '',
        bos_token: '',
    })
}

/** The pushed preset is the template plus exactly these overrides. */
function expectedPreset(overrides: Partial<botPreset>): botPreset {
    return { ...JSON.parse(JSON.stringify(presetTemplate)), ...overrides }
}

const conversation: Message[] = [
    { role: 'system', content: 'S1' },
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello' },
    { role: 'user', content: 'Q' },
]

const legacyInstruct = {
    name: 'LegacyInst',
    system_prompt: 'SYS PROMPT',
    input_sequence: '### User:',
    output_sequence: '### Assistant:',
    last_output_sequence: '',
    system_sequence: '### System:',
    stop_sequence: '',
    system_sequence_prefix: '[[',
    system_sequence_suffix: ']]',
    first_output_sequence: '',
    output_suffix: '</s>\n',
    input_suffix: '\n',
    system_suffix: '\n',
    user_alignment_message: '',
    system_same_as_user: false,
    last_system_sequence: '',
    first_input_sequence: '',
    last_input_sequence: '',
}

const legacyContext = {
    story_string: '{{system}}\n{{#if persona}}{{persona}}\n{{/if}}{{description}}\nUser is {{user}}.\n',
    chat_start: '***\n',
}

// The samplers list names exactly the keys present in this file.
const legacyParameters = {
    temp: 0.75,
    top_p: 0.9,
    top_k: 40,
    top_a: 0,
    min_p: 0.05,
    rep_pen: 1.1,
    freq_pen: 0.5,
    presence_penalty: 0.25,
    typical_p: 0.95,
    min_length: 0,
    samplers: ['temp', 'top_p', 'top_k', 'top_a', 'min_p', 'rep_pen', 'freq_pen', 'presence_penalty', 'typical_p', 'min_length'],
}

const chatFile = {
    chat_completion_source: 'openai',
    prompts: [
        { identifier: 'main', content: 'Main text', role: 'system' },
        { identifier: 'charDescription' },
        { identifier: 'chatHistory' },
        { identifier: 'jailbreak', content: 'JB', role: 'user' },
    ],
    prompt_order: [{
        character_id: 100000,
        order: [
            { identifier: 'main', enabled: true },
            { identifier: 'charDescription', enabled: true },
            { identifier: 'chatHistory', enabled: true },
            { identifier: 'jailbreak', enabled: true },
        ],
    }],
    temperature: 0.8,
    top_p: 0.9,
    top_k: 40,
    top_a: 0.1,
    min_p: 0.05,
    repetition_penalty: 1.1,
    frequency_penalty: 0.5,
    presence_penalty: 0.25,
}

const instructPromptTemplate: botPreset['promptTemplate'] = [
    { type: 'plain', type2: 'main', text: '', role: 'system' },
    { type: 'description' },
    { type: 'persona' },
    { type: 'lorebook' },
    { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
    { type: 'authornote' },
    { type: 'plain', type2: 'globalNote', text: '', role: 'system' },
]

const legacyJinja =
    'SYS PROMPT\n\nUser is .\n***\n'
    + '{% for message in messages %}'
    + '{% if message.role == \'user\' %}### User:{{ message.content }}\n{% endif %}'
    + '{% if message.role == \'assistant\' %}### Assistant:{{ message.content }}</s>\n{% endif %}'
    + '{% if message.role == \'system\' %}### System:[[{{ message.content }}]]\n{% endif %}'
    + '{% endfor %}### Assistant:'

const legacyRender =
    'SYS PROMPT\n\nUser is .\n***\n'
    + '### System:[[S1]]\n'
    + '### User:Hi\n'
    + '### Assistant:Hello</s>\n'
    + '### User:Q\n'
    + '### Assistant:'

const chatPromptTemplate: botPreset['promptTemplate'] = [
    { type: 'plain', type2: 'main', text: 'Main text', role: 'system' },
    { type: 'description' },
    { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
    { type: 'jailbreak', type2: 'normal', text: 'JB', role: 'user' },
]

beforeEach(() => {
    DBState.db.botPresets = []
    vi.mocked(alertNormal).mockClear()
    vi.mocked(alertError).mockClear()
})

describe('promptConvertion base output', () => {
    test('[G] (i) legacy instruct + context + parameters: full preset and rendering', () => {
        convert([
            { name: 'a.json', json: legacyInstruct },
            { name: 'b.json', json: legacyContext },
            { name: 'c.json', json: legacyParameters },
        ])
        expect(pushedPresets()).toEqual([expectedPreset({
            name: 'LegacyInst',
            promptTemplate: instructPromptTemplate,
            reverseProxyOobaArgs: { mode: 'instruct', min_p: 0.05, top_k: 40, top_a: 0, min_length: 0, typical_p: 0.95 },
            temperature: 75,
            top_p: 0.9,
            top_k: 40,
            top_a: 0,
            min_p: 0.05,
            repetition_penalty: 1.1,
            frequencyPenalty: 50,
            PresensePenalty: 25,
            instructChatTemplate: 'jinja',
            JinjaTemplate: legacyJinja,
            aiModel: 'openrouter',
            subModel: 'openrouter',
            useInstructPrompt: true,
        })])
        expect(renderLikeChatTemplate(pushedPresets()[0].JinjaTemplate, conversation)).toBe(legacyRender)
        expect(alertNormal).toHaveBeenCalledTimes(1)
        expect(alertNormal).toHaveBeenCalledWith(language.alerts.presetConverted)
        expect(alertError).not.toHaveBeenCalled()
    })

    test('[G] (i) the result does not depend on the order of the files', () => {
        convert([
            { name: 'c.json', json: legacyParameters },
            { name: 'b.json', json: legacyContext },
            { name: 'a.json', json: legacyInstruct },
        ])
        const reversed = pushedPresets()[0]
        DBState.db.botPresets = []
        convert([
            { name: 'a.json', json: legacyInstruct },
            { name: 'b.json', json: legacyContext },
            { name: 'c.json', json: legacyParameters },
        ])
        expect(reversed).toEqual(pushedPresets()[0])
    })

    test('[G] (ii) legacy instruct + context without parameters keeps the template samplers', () => {
        convert([
            { name: 'a.json', json: legacyInstruct },
            { name: 'b.json', json: legacyContext },
        ])
        expect(pushedPresets()).toEqual([expectedPreset({
            name: 'LegacyInst',
            promptTemplate: instructPromptTemplate,
            reverseProxyOobaArgs: { mode: 'instruct' },
            instructChatTemplate: 'jinja',
            JinjaTemplate: legacyJinja,
            aiModel: 'openrouter',
            subModel: 'openrouter',
            useInstructPrompt: true,
        })])
        expect(renderLikeChatTemplate(pushedPresets()[0].JinjaTemplate, conversation)).toBe(legacyRender)
        expect(alertNormal).toHaveBeenCalledTimes(1)
    })

    test('[G] (iii) chat file alone: unnamed, all eight samplers unset', () => {
        convert([{ name: 'my-chat.json', json: chatFile }])
        expect(pushedPresets()).toEqual([expectedPreset({
            name: '',
            promptTemplate: chatPromptTemplate,
            temperature: -1000,
            top_p: -1000,
            top_k: -1000,
            top_a: -1000,
            min_p: -1000,
            repetition_penalty: -1000,
            frequencyPenalty: -1000,
            PresensePenalty: -1000,
            aiModel: 'openrouter',
            subModel: 'openrouter',
        })])
        expect(alertNormal).toHaveBeenCalledTimes(1)
        expect(alertNormal).toHaveBeenCalledWith(language.alerts.presetConverted)
    })

    test('[G] (iv) chat file + parameters: the chat file leaves every sampler unset', () => {
        convert([
            { name: 'c.json', json: legacyParameters },
            { name: 'my-chat.json', json: chatFile },
        ])
        expect(pushedPresets()).toEqual([expectedPreset({
            name: '',
            promptTemplate: chatPromptTemplate,
            temperature: -1000,
            top_p: -1000,
            top_k: -1000,
            top_a: -1000,
            min_p: -1000,
            repetition_penalty: -1000,
            frequencyPenalty: -1000,
            PresensePenalty: -1000,
            aiModel: 'openrouter',
            subModel: 'openrouter',
        })])
    })

    test('[G] (v) instruct + chat file conflict: alertError, nothing pushed', () => {
        convert([
            { name: 'a.json', json: legacyInstruct },
            { name: 'my-chat.json', json: chatFile },
        ])
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(alertError).toHaveBeenCalledWith(fillLang(language.errors.promptTypeConflict, { type: 'STINST' }))
        expect(pushedPresets()).toEqual([])
        expect(alertNormal).not.toHaveBeenCalled()
    })
})
