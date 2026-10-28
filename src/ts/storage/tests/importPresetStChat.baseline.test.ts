// @vitest-environment happy-dom

/**
 * Baseline for the Settings SillyTavern chat-completion import: the REAL
 * `importPreset` in `database.svelte.ts` (the mocks below cover only the
 * module's other imports), reading a chat-shaped file (arrays `prompts` and
 * `prompt_order`). Every test is a compatibility guard: it pins the whole pushed
 * preset of today's chat branch, built as `presetTemplate` plus named overrides,
 * so a later behaviour change edits only the overrides it changes. Pinned
 * values are today's behaviour, not a statement that they are correct.
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
import {
    importPreset,
    presetTemplate,
    type botPreset,
} from 'src/ts/storage/database.svelte'

function fileOf(name: string, content: unknown) {
    return { name, data: new TextEncoder().encode(JSON.stringify(content)) }
}

function pushedPresets(): botPreset[] {
    return DBState.db.botPresets
}

/**
 * The pushed preset is the template plus exactly these overrides. Extra keys
 * are allowed for the raw fallback, which spreads the file over the template.
 */
function expectedPreset(overrides: Partial<botPreset> & Record<string, unknown>): botPreset {
    return { ...JSON.parse(JSON.stringify(presetTemplate)), ...overrides }
}

const IMPORTED_NAME = 'Imported ST Preset'

/**
 * The file is merged over `presetTemplate` before the branch runs, and the
 * template carries a temperature (80) but no frequency_penalty. An absent
 * temperature therefore becomes 80 x 100, while an absent frequency_penalty
 * takes the branch's own 0.7 fallback. Pinned as today's behaviour, not as
 * correct.
 */
const DEFAULT_TEMPERATURE = presetTemplate.temperature * 100
const DEFAULT_FREQUENCY = 0.7 * 100

/** A chat-shaped file whose order enables the given identifiers, in order. */
function chatFile(
    prompts: Record<string, unknown>[],
    enabledOrder: string[],
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        chat_completion_source: 'openai',
        prompts,
        prompt_order: [{ character_id: 100000, order: enabledOrder.map(identifier => ({ identifier, enabled: true })) }],
        ...extra,
    }
}

beforeEach(() => {
    DBState.db = { botPresets: [] } as unknown as typeof DBState.db
})

describe('[G] Settings chat-completion import today', () => {
    test('(i) every enabled prompt kind, role spellings and assistant_prefill', async () => {
        const prompts = [
            { identifier: 'main', content: 'MAIN', role: 'system' },
            { identifier: 'jailbreak', content: 'JB', role: 'assistant' },
            { identifier: 'nsfw', content: 'NSFW', role: 'char' },
            { identifier: 'dialogueExamples', content: 'ignored-1', role: 'system' },
            { identifier: 'charPersonality', content: 'ignored-2', role: 'system' },
            { identifier: 'scenario', content: 'ignored-3', role: 'system' },
            { identifier: 'worldInfoAfter', content: 'ignored-4', role: 'system' },
            { identifier: 'chatHistory' },
            { identifier: 'worldInfoBefore' },
            { identifier: 'charDescription' },
            { identifier: 'personaDescription' },
            { identifier: 'custom-a', content: 'CUSTOM A', role: 'user' },
            { identifier: 'custom-b', content: 'CUSTOM B' },
            { identifier: 'custom-c', content: 'CUSTOM C', role: 'junk' },
            { identifier: 'custom-d' },
        ]
        const order = prompts.map(p => String(p.identifier))
        await importPreset(fileOf('chat-all.json', chatFile(prompts, order, { assistant_prefill: 'PREFILL' })))
        expect(pushedPresets()).toEqual([expectedPreset({
            name: IMPORTED_NAME,
            temperature: DEFAULT_TEMPERATURE,
            frequencyPenalty: DEFAULT_FREQUENCY,
            promptTemplate: [
                { type: 'plain', type2: 'main', text: 'MAIN', role: 'system' },
                { type: 'jailbreak', type2: 'normal', text: 'JB', role: 'bot' },
                { type: 'jailbreak', type2: 'normal', text: 'NSFW', role: 'bot' },
                { type: 'chat', rangeEnd: 'end', rangeStart: 0 },
                { type: 'lorebook' },
                { type: 'description' },
                { type: 'persona' },
                { type: 'plain', type2: 'normal', text: 'CUSTOM A', role: 'user' },
                { type: 'plain', type2: 'normal', text: 'CUSTOM B', role: 'system' },
                { type: 'plain', type2: 'normal', text: 'CUSTOM C', role: 'system' },
                { type: 'plain', type2: 'normal', text: '', role: 'system' },
                { type: 'postEverything' },
                { type: 'plain', type2: 'main', text: '{{#if {{prefill_supported}}}}PREFILL{{/if}}', role: 'bot' },
            ],
        })])
    })

    test('(ii) all 8 sampler keys: only temperature, frequency, presence (x0.7) and top_p are read', async () => {
        const file = chatFile([{ identifier: 'main', content: 'M' }], ['main'], {
            temperature: 0.5,
            frequency_penalty: 0.2,
            presence_penalty: 0.5,
            top_p: 0.9,
            top_k: 33,
            top_a: 0.31,
            min_p: 0.07,
            repetition_penalty: 1.23,
        })
        // The four unread keys must differ from the template, or the test cannot tell "kept" from "applied".
        expect(presetTemplate.top_k).not.toBe(33)
        expect(presetTemplate.top_a).not.toBe(0.31)
        expect(presetTemplate.min_p).not.toBe(0.07)
        expect(presetTemplate.repetition_penalty).not.toBe(1.23)
        await importPreset(fileOf('chat-samplers.json', file))
        expect(pushedPresets()).toEqual([expectedPreset({
            name: IMPORTED_NAME,
            temperature: 50,
            frequencyPenalty: 20,
            // 0.5 * 0.7 * 100: the 0.7 presence factor is part of today's output.
            PresensePenalty: 0.5 * 0.7 * 100,
            top_p: 0.9,
            promptTemplate: [{ type: 'plain', type2: 'main', text: 'M', role: 'system' }],
        })])
    })

    test('(iii) no presence_penalty keeps the template value; absent temperature, frequency and top_p take their defaults', async () => {
        await importPreset(fileOf('chat-nopresence.json', chatFile([{ identifier: 'main', content: 'M' }], ['main'])))
        const [preset] = pushedPresets()
        // Pinned as today's behaviour, not as correct: the template value (70) survives,
        // and the result must stay finite (never NaN).
        expect(Number.isNaN(preset.PresensePenalty)).toBe(false)
        expect(preset.PresensePenalty).toBe(presetTemplate.PresensePenalty)
        expect(pushedPresets()).toEqual([expectedPreset({
            name: IMPORTED_NAME,
            temperature: DEFAULT_TEMPERATURE,
            frequencyPenalty: DEFAULT_FREQUENCY,
            promptTemplate: [{ type: 'plain', type2: 'main', text: 'M', role: 'system' }],
        })])
    })

    test('(iv) a chat file without chat_completion_source still imports as a chat preset', async () => {
        const file = chatFile([{ identifier: 'main', content: 'M' }], ['main'])
        delete file.chat_completion_source
        await importPreset(fileOf('chat-nosource.json', file))
        expect(pushedPresets()).toEqual([expectedPreset({
            name: IMPORTED_NAME,
            temperature: DEFAULT_TEMPERATURE,
            frequencyPenalty: DEFAULT_FREQUENCY,
            promptTemplate: [{ type: 'plain', type2: 'main', text: 'M', role: 'system' }],
        })])
    })

    test('(v) prompt_order[0].order not an array falls to the raw fallback: file keys over the template, template name', async () => {
        const file = {
            chat_completion_source: 'openai',
            prompts: [{ identifier: 'main', content: 'M' }],
            prompt_order: [{ character_id: 100000, order: 'not-an-array' }],
            temperature: 0.5,
        }
        await importPreset(fileOf('chat-badorder.json', file))
        expect(pushedPresets()).toEqual([expectedPreset({
            ...file,
            // The template already names the preset, so the fallback's "Imported" default never applies.
            name: presetTemplate.name,
        })])
    })

    test('(vi) a disabled prompt is skipped', async () => {
        const file = chatFile([
            { identifier: 'main', content: 'M' },
            { identifier: 'custom-off', content: 'OFF' },
        ], ['main'])
        const order = (file.prompt_order as { order: { identifier: string, enabled: boolean }[] }[])[0].order
        order.push({ identifier: 'custom-off', enabled: false })
        await importPreset(fileOf('chat-disabled.json', file))
        expect(pushedPresets()).toEqual([expectedPreset({
            name: IMPORTED_NAME,
            temperature: DEFAULT_TEMPERATURE,
            frequencyPenalty: DEFAULT_FREQUENCY,
            promptTemplate: [{ type: 'plain', type2: 'main', text: 'M', role: 'system' }],
        })])
    })

    test('(vii) a chat-shaped file that also carries mainPrompt is still imported by the chat branch; mainPrompt is dropped', async () => {
        const file = chatFile([{ identifier: 'main', content: 'M' }], ['main'], { mainPrompt: 'RISU MAIN' })
        expect(presetTemplate.mainPrompt).not.toBe('RISU MAIN')
        await importPreset(fileOf('chat-with-mainprompt.json', file))
        expect(pushedPresets()).toEqual([expectedPreset({
            name: IMPORTED_NAME,
            temperature: DEFAULT_TEMPERATURE,
            frequencyPenalty: DEFAULT_FREQUENCY,
            promptTemplate: [{ type: 'plain', type2: 'main', text: 'M', role: 'system' }],
        })])
    })
})
