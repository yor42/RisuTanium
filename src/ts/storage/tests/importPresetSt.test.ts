// @vitest-environment happy-dom

/**
 * `importPreset` with SillyTavern files, driven against the REAL
 * `database.svelte.ts` and the real converter (the mocks below cover only the
 * module's other imports). Labels: [R] reproducer, red on the base by
 * assertion (the base files take the raw fallback); [G] guard, may pass before
 * and after. File names differ from inner names so a wrong name source shows.
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
import { alertNormalWait } from 'src/ts/alert'
import { language } from 'src/lang'
import {
    getDatabase,
    importPreset,
    presetFromWorkingSettings,
    presetTemplate,
    setDatabase,
    type Database,
    type botPreset,
} from 'src/ts/storage/database.svelte'

type Message = { role: 'user' | 'assistant' | 'system', content: string }

function fileOf(name: string, content: unknown) {
    return { name, data: new TextEncoder().encode(JSON.stringify(content)) }
}

function lastPreset(): botPreset | undefined {
    return DBState.db.botPresets[DBState.db.botPresets.length - 1]
}

/**
 * Renders the stored Jinja template like the request path does. A missing or
 * failing template comes back as marker text, so a base that never produces a
 * template fails the assertion instead of throwing a TypeError.
 */
function renderStored(preset: botPreset | undefined, messages: Message[]): string {
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

const chatml = {
    input_sequence: '<|im_start|>user',
    output_sequence: '<|im_start|>assistant',
    system_sequence: '<|im_start|>system',
    input_suffix: '<|im_end|>\n',
    output_suffix: '<|im_end|>\n',
    system_suffix: '<|im_end|>\n',
    wrap: true,
    system_same_as_user: false,
    macro: true,
    names_behavior: 'none',
}

const textCompletion = {
    temp: 0.7,
    top_p: 0.9,
    top_k: 40,
    min_p: 0.05,
    rep_pen: 1.1,
    freq_pen: 0.2,
    presence_pen: 0.3,
    mirostat_mode: 2,
    samplers: ['top_k', 'top_p', 'temperature'],
}

const stChat = {
    chat_completion_source: 'openai',
    prompts: [
        { identifier: 'main', content: 'M', role: 'system' },
        { identifier: 'chatHistory' },
    ],
    prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }],
}

beforeEach(() => {
    DBState.db = { botPresets: [] } as unknown as typeof DBState.db
    vi.mocked(alertNormalWait).mockReset()
    vi.mocked(alertNormalWait).mockImplementation(async () => {})
})

//#region system prompt files

describe('[R] system prompt files', () => {
    test('A1 a system prompt becomes the main item of a plain preset named after the file', async () => {
        await importPreset(fileOf('my-roleplay.json', { name: 'Roleplay - Simple', content: 'You are a storyteller.', post_history: '' }))
        const preset = lastPreset()
        expect(preset?.name).toBe('my-roleplay')
        expect(preset?.promptTemplate?.map(i => i.type)).toEqual(['plain', 'description', 'persona', 'lorebook', 'chat', 'authornote', 'plain'])
        const main = preset?.promptTemplate?.[0]
        expect(main && main.type === 'plain' ? main.text : undefined).toBe('You are a storyteller.')
        expect(preset?.mainPrompt).toBe('You are a storyteller.')
        expect(preset?.jailbreak).toBe('')
        expect(preset?.aiModel).toBe(presetTemplate.aiModel)
        expect(preset?.useInstructPrompt).toBe(false)
    })

    test('A2 a non-empty post_history becomes a system item directly after the chat', async () => {
        await importPreset(fileOf('post.json', { name: 'P', content: 'Main', post_history: 'After the chat.' }))
        const items = lastPreset()?.promptTemplate ?? []
        expect(items.map(i => i.type)).toEqual(['plain', 'description', 'persona', 'lorebook', 'chat', 'plain', 'authornote', 'plain'])
        expect(items[5]).toEqual({ type: 'plain', type2: 'normal', role: 'system', text: 'After the chat.' })
        expect(items.some(i => i.type === 'jailbreak')).toBe(false)
    })
})

//#endregion

//#region bundles

describe('[R] bundles', () => {
    test('A3 one preset with the instruct and context parts, the skipped sections announced after the push', async () => {
        let presetsAtNotice = -1
        vi.mocked(alertNormalWait).mockImplementation(async () => {
            presetsAtNotice = DBState.db.botPresets.length
        })
        await importPreset(fileOf('bundle-file.json', {
            instruct: { ...chatml },
            context: { story_string: 'Story.', chat_start: '***\n' },
            sysprompt: { name: 'S', content: 'sys text' },
            reasoning: { name: 'R', prefix: '<think>', suffix: '</think>', separator: '\n' },
            srw: { value: '', show: false },
        }))
        expect(DBState.db.botPresets.length).toBe(1)
        const preset = lastPreset()
        expect(preset?.name).toBe('bundle-file')
        expect(preset?.aiModel).toBe('openrouter')
        expect(preset?.JinjaTemplate).not.toContain('undefined')
        expect(renderStored(preset, [{ role: 'system', content: 'sys text' }, { role: 'user', content: 'hi' }])).toBe(
            'Story.***\n<|im_start|>system\nsys text<|im_end|>\n<|im_start|>user\nhi<|im_end|>\n<|im_start|>assistant\n')
        expect(alertNormalWait).toHaveBeenCalledTimes(1)
        const notice = vi.mocked(alertNormalWait).mock.calls[0]?.[0] ?? ''
        expect(notice).toContain('Reasoning Formatting')
        expect(notice).toContain('Start Reply With')
        // The context part is used with the instruct part, so only the two unused sections are named, in file order.
        expect(notice).toContain('skipped: Reasoning Formatting, Start Reply With.')
        expect(notice).not.toContain('Context Template')
        expect(presetsAtNotice).toBe(1)
    })

    test('A3b the import stays open until the skipped-sections notice is dismissed', async () => {
        let dismiss: () => void = () => {}
        vi.mocked(alertNormalWait).mockImplementation(() => new Promise<void>((resolve) => { dismiss = resolve }))
        let settled = false
        const pending = importPreset(fileOf('notice.json', {
            sysprompt: { name: 'S', content: 'sys' },
            srw: { value: '', show: false },
        })).then(() => { settled = true })
        await new Promise(resolve => setTimeout(resolve, 20))
        expect(vi.mocked(alertNormalWait)).toHaveBeenCalledTimes(1)
        expect(settled).toBe(false)
        dismiss()
        await pending
        expect(settled).toBe(true)
    })

    test('A4 a system prompt with a text-completion preset sets the eight sampler fields from values', async () => {
        const modern = { temp: 0.7, top_p: 0.9, top_k: 40, min_p: 0.05, rep_pen: 1.1, freq_pen: 0.2, presence_pen: 0.3, samplers: ['top_k'] }
        // Precondition: the file differs from the template, so an untouched template value is visible.
        expect(modern.temp * 100).not.toBe(presetTemplate.temperature)
        expect(modern.top_p).not.toBe(presetTemplate.top_p)
        expect(presetTemplate.min_p).toBeUndefined()
        await importPreset(fileOf('bundle.json', { sysprompt: { name: 'S', content: 'sys' }, preset: modern }))
        const preset = lastPreset()
        expect(preset?.temperature).toBe(0.7 * 100)
        expect(preset?.top_p).toBe(0.9)
        expect(preset?.top_k).toBe(40)
        expect(preset?.min_p).toBe(0.05)
        expect(preset?.repetition_penalty).toBe(1.1)
        expect(preset?.frequencyPenalty).toBe(0.2 * 100)
        expect(preset?.PresensePenalty).toBe(0.3 * 100)
        expect(preset?.top_a).toBe(-1000)
        expect(preset?.aiModel).toBe(presetTemplate.aiModel)
        expect(preset?.JinjaTemplate).toBeUndefined()
        expect(preset?.promptTemplate?.[0]).toMatchObject({ type: 'plain', text: 'sys' })
    })

    test('A8 a context part alone makes a plain preset and is named as skipped', async () => {
        await importPreset(fileOf('ctx.json', { story_string: 'S', chat_start: '***' }))
        let preset = lastPreset()
        expect(preset?.name).toBe('ctx')
        expect(preset?.aiModel).toBe(presetTemplate.aiModel)
        expect(preset?.JinjaTemplate).toBeUndefined()
        expect(preset?.promptTemplate?.map(i => i.type)).toEqual(['plain', 'description', 'persona', 'lorebook', 'chat', 'authornote', 'plain'])
        expect(vi.mocked(alertNormalWait).mock.calls[0]?.[0]).toContain('Context Template')

        vi.mocked(alertNormalWait).mockClear()
        await importPreset(fileOf('ctx2.json', {
            context: { story_string: 'S', chat_start: '***' },
            reasoning: { name: 'R', prefix: 'a', suffix: 'b', separator: 'c' },
        }))
        preset = lastPreset()
        expect(preset?.name).toBe('ctx2')
        expect(preset?.JinjaTemplate).toBeUndefined()
        const notice = vi.mocked(alertNormalWait).mock.calls[0]?.[0] ?? ''
        expect(notice).toContain('Context Template')
        expect(notice).toContain('Reasoning Formatting')
    })

    test('A21 story string, chat start and the system prompt of a context part render as plain text', async () => {
        await importPreset(fileOf('with-context.json', {
            instruct: { input_sequence: 'U:', output_sequence: 'A:', wrap: false, system_prompt: 'SP' },
            context: { story_string: 'a {% b %} {# c #} -}} {{system}}', chat_start: '***\n' },
        }))
        expect(renderStored(lastPreset(), [])).toBe('a {% b %} {# c #} -}} SP***\nA:')
    })
})

//#endregion

//#region refusals

describe('[R] files that hold nothing', () => {
    const reasoning = { name: 'R', prefix: '<think>', suffix: '</think>', separator: '\n' }
    const srw = { value: 'Sure', show: true }

    test.each([
        ['a bundle of reasoning and start-reply sections', { reasoning, srw }],
        ['a lone reasoning file', reasoning],
        ['a lone start-reply file', srw],
    ])('A5 %s is refused and nothing is added', async (_label, content) => {
        await expect(importPreset(fileOf('only.json', content))).rejects.toThrow(language.errors.stNothingToImport)
        expect(DBState.db.botPresets.length).toBe(0)
    })
})

//#endregion

//#region instruct files

describe('[R] instruct files', () => {
    test('A6 a lone instruct file renders each message as role header, content and end token; the closing header keeps its newline', async () => {
        await importPreset(fileOf('chatml-x.json', chatml))
        const preset = lastPreset()
        expect(preset?.name).toBe('chatml-x')
        expect(preset?.aiModel).toBe('openrouter')
        expect(preset?.subModel).toBe('openrouter')
        expect(preset?.useInstructPrompt).toBe(true)
        expect(preset?.instructChatTemplate).toBe('jinja')
        expect(renderStored(preset, [
            { role: 'system', content: 'S' }, { role: 'user', content: 'u' }, { role: 'assistant', content: 'a' },
        ])).toBe(
            '<|im_start|>system\nS<|im_end|>\n<|im_start|>user\nu<|im_end|>\n<|im_start|>assistant\na<|im_end|>\n<|im_start|>assistant\n')
    })

    test('A7 wrap off inserts no newline; wrap on ends each message in one', async () => {
        const plain = { input_sequence: 'U:', output_sequence: 'A:', input_suffix: '', output_suffix: '', system_suffix: '' }
        const messages: Message[] = [{ role: 'user', content: 'u' }, { role: 'assistant', content: 'a' }]
        await importPreset(fileOf('off.json', { ...plain, wrap: false }))
        expect(renderStored(lastPreset(), messages)).toBe('U:uA:aA:')
        await importPreset(fileOf('on.json', { ...plain, wrap: true }))
        expect(renderStored(lastPreset(), messages)).toBe('U:\nu\nA:\na\nA:\n')
    })

    test('A12 system_same_as_user renders the system message like a user message with one end token', async () => {
        const gemma = {
            input_sequence: '<start_of_turn>user\n', input_suffix: '<end_of_turn>\n',
            output_sequence: '<start_of_turn>model\n', output_suffix: '<end_of_turn>\n',
            system_sequence: '', system_suffix: '<end_of_turn>\n', wrap: true, system_same_as_user: true,
        }
        await importPreset(fileOf('gemma.json', gemma))
        const system = renderStored(lastPreset(), [{ role: 'system', content: 'S' }])
        const user = renderStored(lastPreset(), [{ role: 'user', content: 'S' }])
        expect(system).toBe(user)
        expect(system.split('<end_of_turn>').length - 1).toBe(1)

        await importPreset(fileOf('gemma2.json', { ...gemma, system_suffix: '<OTHER>' }))
        expect(renderStored(lastPreset(), [{ role: 'system', content: 'S' }])).toBe(user)
    })

    test('A14 a {{name}} header becomes the speaker names', async () => {
        await importPreset(fileOf('names.json', {
            ...chatml, input_sequence: '<|im_start|>{{name}}', output_sequence: '<|im_start|>{{name}}',
        }))
        expect(renderStored(lastPreset(), [
            { role: 'user', content: 'X' }, { role: 'assistant', content: 'Y' }, { role: 'system', content: 'Z' },
        ])).toBe(
            '<|im_start|>U_NAME\nX<|im_end|>\n<|im_start|>C_NAME\nY<|im_end|>\n<|im_start|>system\nZ<|im_end|>\n<|im_start|>C_NAME\n')
    })

    test('A15 a system message under system_same_as_user is named System and ends once', async () => {
        await importPreset(fileOf('llama.json', {
            input_sequence: '<|start_header_id|>{{name}}<|end_header_id|>\n\n',
            output_sequence: '<|start_header_id|>{{name}}<|end_header_id|>\n\n',
            system_sequence: '<|start_header_id|>system<|end_header_id|>\n\n',
            input_suffix: '<|eot_id|>', output_suffix: '<|eot_id|>', system_suffix: '<|eot_id|>',
            system_same_as_user: true, wrap: false,
        }))
        const out = renderStored(lastPreset(), [{ role: 'system', content: 'X' }])
        expect(out).toBe('<|start_header_id|>System<|end_header_id|>\n\nX<|eot_id|><|start_header_id|>C_NAME<|end_header_id|>\n\n')
        expect(out.split('<|eot_id|>').length - 1).toBe(1)
    })

    test('A16 unknown macros stay literal and nothing renders as an object', async () => {
        await importPreset(fileOf('kobold.json', {
            input_sequence: '{{[INPUT]}}', input_suffix: '{{[INPUT_END]}}',
            output_sequence: '{{[OUTPUT]}}', output_suffix: '{{[OUTPUT_END]}}',
            system_sequence: '{{[SYSTEM]}}', system_suffix: '{{[SYSTEM_END]}}', wrap: false,
        }))
        const preset = lastPreset()
        expect(() => new Template(preset?.JinjaTemplate ?? '')).not.toThrow()
        const out = renderStored(preset, [{ role: 'user', content: 'X' }, { role: 'assistant', content: 'Y' }])
        expect(out).not.toContain('[object Object]')
        expect(out).toBe('{{[INPUT]}}X{{[INPUT_END]}}{{[OUTPUT]}}Y{{[OUTPUT_END]}}{{[OUTPUT]}}')
    })

    test('A17 template syntax inside sequences is text, not template source', async () => {
        await importPreset(fileOf('syntax.json', { input_sequence: '<{% if x %}>', output_sequence: '}}{{ 1+1 }}{%- raw -%}', wrap: false }))
        const preset = lastPreset()
        expect(preset?.JinjaTemplate).toBeTypeOf('string')
        expect(() => new Template(preset?.JinjaTemplate ?? '')).not.toThrow()
        expect(renderStored(preset, [{ role: 'user', content: 'X' }])).toBe('<{% if x %}>X}}{{ 1+1 }}{%- raw -%}')
    })

    test.each([
        ['comment, dashes and escapes', "{# c #}-%}-}}{{-{%- \\ it's\r\n"],
        ['newline after block close', 'a%}\nb'],
        ['line separator then blanks then block', 'a\u2028  {%'],
        ['carriage return then blanks then block', 'a\r  {%'],
    ])('A18 %s survive verbatim', async (_label, hazard) => {
        await importPreset(fileOf('hazard.json', { input_sequence: hazard, output_sequence: 'A:', wrap: false }))
        expect(renderStored(lastPreset(), [{ role: 'user', content: 'X' }])).toBe(`${hazard}XA:`)
    })

    test('A19 only exact user, char and name macros are substituted', async () => {
        await importPreset(fileOf('macros.json', {
            input_sequence: '[{{ NAME }}|{{time}}|{{[X]}}|{{NAME}}|{{User}}]', output_sequence: 'A:', wrap: false,
        }))
        expect(renderStored(lastPreset(), [{ role: 'user', content: 'X' }])).toBe('[{{ NAME }}|{{time}}|{{[X]}}|U_NAME|U_NAME]XA:')
    })

    test('A20 user and char work in every branch and name follows the speaker', async () => {
        await importPreset(fileOf('branches.json', {
            input_sequence: 'I', input_suffix: '({{user}}/{{char}}/{{name}})',
            output_sequence: 'O', output_suffix: '({{user}}/{{char}}/{{name}})',
            system_sequence: 'S', system_suffix: '({{user}}/{{char}}/{{name}})', wrap: false,
        }))
        expect(renderStored(lastPreset(), [
            { role: 'user', content: '1' }, { role: 'assistant', content: '2' }, { role: 'system', content: '3' },
        ])).toBe('I1(U_NAME/C_NAME/U_NAME)O2(U_NAME/C_NAME/C_NAME)S3(U_NAME/C_NAME/System)O')
        // the closing output sequence is the assistant branch
        await importPreset(fileOf('closing.json', { input_sequence: 'I', output_sequence: 'O{{name}}', wrap: false }))
        expect(renderStored(lastPreset(), [])).toBe('OC_NAME')
    })
})

//#endregion

//#region text-completion presets and naming

describe('[R] text-completion presets and naming', () => {
    test('A9 a lone text-completion preset sets the values and keeps the plain model', async () => {
        // Precondition: values differ from the template.
        expect(textCompletion.temp * 100).not.toBe(presetTemplate.temperature)
        await importPreset(fileOf('textgen.json', textCompletion))
        const preset = lastPreset()
        expect(preset?.name).toBe('textgen')
        expect(preset?.temperature).toBe(0.7 * 100)
        expect(preset?.top_p).toBe(0.9)
        expect(preset?.top_k).toBe(40)
        expect(preset?.min_p).toBe(0.05)
        expect(preset?.repetition_penalty).toBe(1.1)
        expect(preset?.reverseProxyOobaArgs).toMatchObject({ mode: 'instruct', min_p: 0.05, top_k: 40, mirostat_mode: 2 })
        expect(preset?.aiModel).toBe(presetTemplate.aiModel)
        expect(preset?.JinjaTemplate).toBeUndefined()
    })

    test.each([
        ['my.preset.v2.json', 'my.preset.v2'],
        ['a.JSON', 'a'],
        ['a.preset', 'a.preset'],
    ])('A11 the preset name for %s is %s', async (fileName, expected) => {
        await importPreset(fileOf(fileName, { name: 'Inner', content: 'c' }))
        expect(lastPreset()?.name).toBe(expected)
    })

    test('A10 an ST chat file without presence_penalty stores the unset value, never NaN', async () => {
        await importPreset(fileOf('chat.json', stChat))
        expect(Number.isFinite(lastPreset()?.PresensePenalty)).toBe(true)
        expect(lastPreset()?.PresensePenalty).toBe(-1000)
    })

    // Red on the S2b base since S2c, which retired the Settings 0.7 factor.
    test('G7 [R] presence_penalty 0.5 is scaled by 100 only (MC-823)', async () => {
        await importPreset(fileOf('chat.json', { ...stChat, presence_penalty: 0.5 }))
        expect(lastPreset()?.PresensePenalty).toBe(50)
    })
})

//#endregion

//#region guards

describe('[G] compatibility guards (pass before and after)', () => {
    test('G1 a Risu preset JSON takes the raw fallback', async () => {
        await importPreset(fileOf('risu.json', { name: 'Saved', mainPrompt: 'mine', aiModel: 'foo', promptTemplate: [{ type: 'chat', rangeStart: 0, rangeEnd: 'end' }] }))
        const preset = lastPreset()
        expect(preset?.name).toBe('Saved')
        expect(preset?.mainPrompt).toBe('mine')
        expect(preset?.aiModel).toBe('foo')
        expect(preset?.JinjaTemplate).toBeUndefined()
        expect(vi.mocked(alertNormalWait)).not.toHaveBeenCalled()
    })

    test.each(['mainPrompt', 'jailbreak', 'formatingOrder', 'aiModel', 'apiType'])(
        'G2 name and content with the exclusion key %s is not a system prompt', async (key) => {
            await importPreset(fileOf('file-name.json', { name: 'InnerName', content: 'c', [key]: key === 'formatingOrder' ? [] : 'x' }))
            expect(lastPreset()?.name).toBe('InnerName')
        })

    test('G3 a preset exported from working settings imports through the raw fallback unchanged', async () => {
        setDatabase({ pluginCustomStorage: {} } as unknown as Database)
        const saved = presetFromWorkingSettings(getDatabase(), 'Saved', '')
        DBState.db = { botPresets: [] } as unknown as typeof DBState.db
        await importPreset(fileOf('whatever.json', saved))
        const preset = lastPreset()
        expect(preset?.name).toBe('Saved')
        expect(preset?.JinjaTemplate).toBe(saved.JinjaTemplate)
        expect(preset?.instructChatTemplate).toBe(saved.instructChatTemplate)
        expect(preset?.useInstructPrompt).toBe(saved.useInstructPrompt)
        expect(preset?.temperature).toBe(saved.temperature)
        expect(vi.mocked(alertNormalWait)).not.toHaveBeenCalled()
    })

    // Red on the S2b base since S2c: the chat half pins the converter's name and model (MC-822 P6).
    test('G4 an ST chat-completion file imports through the converter and an NAI file as before', async () => {
        await importPreset(fileOf('chat.json', { ...stChat, temperature: 0.5, frequency_penalty: 0.2, top_p: 0.8 }))
        let preset = lastPreset()
        // MC-822 P5/P6 and MC-820 Q-H: named after the file, model openrouter.
        expect(preset?.name).toBe('chat')
        expect(preset?.aiModel).toBe('openrouter')
        expect(preset?.temperature).toBe(0.5 * 100)
        expect(preset?.frequencyPenalty).toBe(0.2 * 100)
        expect(preset?.top_p).toBe(0.8)
        expect(preset?.promptTemplate?.map(i => i.type)).toEqual(['plain', 'chat'])

        await importPreset(fileOf('nai.json', {
            presetVersion: 3, name: 'NAI one',
            parameters: { temperature: 1.2, max_length: 100, top_k: 3, top_p: 0.9, top_a: 0.1, repetition_penalty_presence: 0.5 },
        }))
        preset = lastPreset()
        expect(preset?.name).toBe('NAI one')
        expect(preset?.temperature).toBe(1.2 * 100)
        expect(preset?.PresensePenalty).toBe(0.5 * 100)
        expect(preset?.JinjaTemplate).toBeUndefined()
    })

    // Red on the base: its raw fallback stores the bundle's own members (instruct, context, ...) on the preset.
    test('G6 [R] the saved preset carries no member beyond the known preset members', async () => {
        setDatabase({ pluginCustomStorage: {} } as unknown as Database)
        const known = new Set([
            ...Object.keys(presetFromWorkingSettings(getDatabase(), 'x', '')),
            ...Object.keys(presetTemplate),
            'promptTemplate', 'instructChatTemplate', 'JinjaTemplate', 'reverseProxyOobaArgs',
            'top_k', 'top_a', 'min_p', 'repetition_penalty', 'useInstructPrompt',
        ])
        DBState.db = { botPresets: [] } as unknown as typeof DBState.db
        await importPreset(fileOf('all.json', {
            instruct: { ...chatml }, context: { story_string: 's', chat_start: 'c' },
            sysprompt: { name: 'S', content: 'sys', post_history: 'post' }, preset: { ...textCompletion },
        }))
        const keys = Object.keys(lastPreset() ?? {})
        expect(keys.length).toBeGreaterThan(10)
        expect(keys.filter(k => !known.has(k))).toEqual([])
        expect(keys).not.toContain('content')
        expect(keys).not.toContain('post_history')
        expect(keys).not.toContain('sysprompt')
    })

    test('G15 [G] a chat-shaped file without an order array stays on the raw fallback', async () => {
        await importPreset(fileOf('chatish.json', { name: 'Chatish', prompts: [], prompt_order: [] }))
        expect(lastPreset()?.name).toBe('Chatish')
        await importPreset(fileOf('chatish2.json', { name: 'Chatish2', prompts: [], prompt_order: [{}] }))
        expect(lastPreset()?.name).toBe('Chatish2')
        expect(DBState.db.botPresets.length).toBe(2)
        expect(lastPreset()?.JinjaTemplate).toBeUndefined()
        expect(vi.mocked(alertNormalWait)).not.toHaveBeenCalled()
    })

    test('G11 a non-ST JSON with a value/show pair and an exclusion key stays on the raw fallback', async () => {
        await importPreset(fileOf('odd.json', { value: 'x', show: true, mainPrompt: 'm' }))
        expect(lastPreset()?.name).toBe(presetTemplate.name)
        expect(lastPreset()?.mainPrompt).toBe('m')
        expect(vi.mocked(alertNormalWait)).not.toHaveBeenCalled()
    })
})

//#endregion
