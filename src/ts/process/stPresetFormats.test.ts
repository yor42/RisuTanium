/**
 * Pure tests of the SillyTavern preset converter: kind detection, the instruct
 * Jinja builder (literal embedding, macros, wrap and system rules) and the
 * one-preset conversion rules. Labels: [N] new API (red on the base because the
 * module does not exist), [G] guard (may pass before and after).
 */

import { describe, expect, test } from 'vitest'
import { Template } from '@huggingface/jinja'
import type { botPreset } from 'src/ts/storage/database.svelte'
import {
    OobaParams,
    buildInstructJinja,
    convertStFiles,
    detectStKind,
    fileBaseName,
    jinjaLiteral,
    jinjaText,
} from 'src/ts/process/stPresetFormats'

type Message = { role: 'user' | 'assistant' | 'system', content: string }

function renderSource(source: string, messages: Message[]): string {
    return new Template(source).render({
        messages,
        add_generation_prompt: true,
        risu_char: 'C_NAME',
        risu_user: 'U_NAME',
        eos_token: '',
        bos_token: '',
    })
}

/** Render that reports a failure as text, so a failing check is an assertion. */
function safeRender(source: string, messages: Message[]): string {
    try {
        return renderSource(source, messages)
    }
    catch (e) {
        return `<<throws: ${e instanceof Error ? e.message : String(e)}>>`
    }
}

// Only the fields the converter touches are meaningful; the rest of a bot preset is irrelevant here.
function baseFixture(): botPreset {
    return {
        name: 'New Preset',
        mainPrompt: 'base main',
        jailbreak: 'base jailbreak',
        globalNote: '',
        temperature: 80,
        maxContext: 4000,
        maxResponse: 300,
        frequencyPenalty: 70,
        PresensePenalty: 70,
        aiModel: 'base-model',
        subModel: 'base-sub',
        top_p: 1,
        top_k: 7,
        top_a: 0.3,
        min_p: 0.2,
        repetition_penalty: 1.3,
        reverseProxyOobaArgs: { mode: 'instruct' },
        useInstructPrompt: false,
        instructChatTemplate: 'chatml',
    } as unknown as botPreset
}

function mulberry32(seed: number): () => number {
    let a = seed
    return () => {
        a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const chatmlInstruct = {
    input_sequence: '<|im_start|>user',
    output_sequence: '<|im_start|>assistant',
    system_sequence: '<|im_start|>system',
    input_suffix: '<|im_end|>\n',
    output_suffix: '<|im_end|>\n',
    system_suffix: '<|im_end|>\n',
    wrap: true,
    system_same_as_user: false,
}

//#region fileBaseName and naming

describe('fileBaseName', () => {
    test('[N] strips one trailing .json (any case) and nothing else', () => {
        expect(fileBaseName('my.preset.v2.json')).toBe('my.preset.v2')
        expect(fileBaseName('a.JSON')).toBe('a')
        expect(fileBaseName('a.preset')).toBe('a.preset')
        expect(fileBaseName('a.json.json')).toBe('a.json')
    })
})

describe('convertStFiles naming', () => {
    const sysprompt = { name: 'Inner', content: 'c' }

    test('[N] the name comes from the first supported file in input order', () => {
        const unsupported = { name: 'junk.json', parsed: { nothing: 1 } }
        const x = { name: 'x.json', parsed: { ...sysprompt } }
        const y = { name: 'y.json', parsed: { ...chatmlInstruct } }
        const forward = convertStFiles([unsupported, x, y], baseFixture())
        const reversed = convertStFiles([unsupported, y, x], baseFixture())
        expect(forward.ok && forward.preset.name).toBe('x')
        expect(reversed.ok && reversed.preset.name).toBe('y')
    })

    test('[N] an empty base name falls back to a fixed name', () => {
        const result = convertStFiles([{ name: '.json', parsed: { ...sysprompt } }], baseFixture())
        expect(result.ok && result.preset.name).toBe('Converted from JSON')
    })
})

//#endregion

//#region detection

describe('detectStKind', () => {
    test('[N] shapes of every kind', () => {
        expect(detectStKind({ prompts: [], prompt_order: [] })).toBe('STCHAT')
        expect(detectStKind({ chat_completion_source: 'openai', prompts: [], prompt_order: [] })).toBe('STCHAT')
        expect(detectStKind({ temp: 0.7, rep_pen: 1.1, min_length: 0 })).toBe('PARAMETERS')
        expect(detectStKind({ story_string: '{{system}}', chat_start: '***' })).toBe('STCONTEXT')
        expect(detectStKind({ input_sequence: 'a', output_sequence: 'b' })).toBe('STINST')
        expect(detectStKind({ name: 'n', content: 'c' })).toBe('STSYSPROMPT')
        expect(detectStKind({ name: 'n', content: 'c', post_history: '' })).toBe('STSYSPROMPT')
        expect(detectStKind({ name: 'n', prefix: '<think>', suffix: '</think>', separator: '\n' })).toBe('STREASONING')
        expect(detectStKind({ value: 'x', show: true })).toBe('STSRW')
        expect(detectStKind({ instruct: { input_sequence: 'a', output_sequence: 'b' } })).toBe('STBUNDLE')
    })

    test('[N] tier cases: relaxed tests never take a base label', () => {
        // story_string and sequences without chat_start stays an instruct file
        expect(detectStKind({ story_string: 's', input_sequence: 'a', output_sequence: 'b' })).toBe('STINST')
        // temp, rep_pen, top_k and top_p without min_length is a parameters file
        expect(detectStKind({ temp: 1, rep_pen: 1, top_k: 40, top_p: 0.9 })).toBe('PARAMETERS')
        // sequences beside the relaxed parameters keys stay an instruct file, not a parameters file
        expect(detectStKind({ temp: 1, rep_pen: 1, top_k: 40, top_p: 0.9, input_sequence: 'a', output_sequence: 'b' })).toBe('STINST')
        // a context file without chat_start is still a context file
        expect(detectStKind({ story_string: 's' })).toBe('STCONTEXT')
        // temp and rep_pen alone are not enough
        expect(detectStKind({ temp: 1, rep_pen: 1 })).toBeNull()
    })

    test('[N] values that are not strings do not label instruct or context files', () => {
        expect(detectStKind({ input_sequence: 1, output_sequence: 'b' })).toBeNull()
        expect(detectStKind({ story_string: 1, chat_start: 'x' })).toBeNull()
    })

    test('[N] not a plain object is null', () => {
        expect(detectStKind(null)).toBeNull()
        expect(detectStKind([])).toBeNull()
        expect(detectStKind('text')).toBeNull()
        expect(detectStKind(3)).toBeNull()
    })

    test('[N] a bundle needs at least one valid section', () => {
        expect(detectStKind({ instruct: { input_sequence: 1 } })).toBeNull()
        expect(detectStKind({ instruct: [], context: null })).toBeNull()
        expect(detectStKind({ reasoning: { name: 'n', prefix: 'a', suffix: 'b', separator: 'c' } })).toBe('STBUNDLE')
        expect(detectStKind({ srw: { value: '', show: false } })).toBe('STBUNDLE')
        expect(detectStKind({ preset: { temp: 1, rep_pen: 1, top_k: 1, top_p: 1 } })).toBe('STBUNDLE')
    })

    test('[N] G4b: NAI-shaped and Risu-preset-shaped objects are null', () => {
        expect(detectStKind({ presetVersion: 3, parameters: { temperature: 1 }, name: 'nai' })).toBeNull()
        // A decoded Risu preset carries exclusion keys even when it also has ST-looking members.
        for (const key of ['mainPrompt', 'jailbreak', 'formatingOrder', 'aiModel', 'apiType']) {
            expect(detectStKind({ name: 'n', content: 'c', [key]: 'x' })).toBeNull()
            expect(detectStKind({ input_sequence: 'a', output_sequence: 'b', [key]: 'x' })).toBeNull()
            expect(detectStKind({ prompts: [], prompt_order: [], [key]: 'x' })).toBeNull()
        }
    })
})

describe('detectStKind differential against the retired detector', () => {
    function notNull(x: unknown): boolean {
        return x !== null && x !== undefined
    }
    // Copy of the retired detector's rules, applied to an already parsed object.
    function baseLabel(p: Record<string, unknown>): string {
        if (notNull(p.chat_completion_source) && Array.isArray(p.prompts) && Array.isArray(p.prompt_order)) return 'STCHAT'
        if (notNull(p.temp) && notNull(p.rep_pen) && notNull(p.min_length)) return 'PARAMETERS'
        if (notNull(p.story_string) && notNull(p.chat_start)) return 'STCONTEXT'
        if (notNull(p.input_sequence) && notNull(p.output_sequence)) return 'STINST'
        return 'NOTSUPPORTED'
    }
    const exclusionKeys = ['mainPrompt', 'jailbreak', 'formatingOrder', 'aiModel', 'apiType']
    const keys = ['chat_completion_source', 'prompts', 'prompt_order', 'temp', 'rep_pen', 'min_length',
        'story_string', 'chat_start', 'input_sequence', 'output_sequence', 'top_k', 'top_p', 'name', 'content', ...exclusionKeys]
    const values: unknown[] = [null, '', 'x', 1, [], {}, true]

    function corpus(count: number): Record<string, unknown>[] {
        const rnd = mulberry32(20261028)
        const out: Record<string, unknown>[] = []
        for (let i = 0; i < count; i++) {
            const obj: Record<string, unknown> = {}
            for (const key of keys) {
                if (rnd() < 0.3) obj[key] = values[Math.floor(rnd() * values.length)]
            }
            out.push(obj)
        }
        return out
    }

    test('[N] G5: base labels are kept in the string-typed domain, apart from the named exceptions', () => {
        let compared = 0
        let lostToStringTest = 0
        let lostToExclusionKey = 0
        for (const obj of corpus(20000)) {
            const base = baseLabel(obj)
            if (base === 'NOTSUPPORTED') continue
            const next = detectStKind(obj)
            const hasExclusion = exclusionKeys.some(k => k in obj)
            const stringTyped = ['story_string', 'input_sequence', 'output_sequence']
                .every(k => !(k in obj) || typeof obj[k] === 'string')
            if (hasExclusion) {
                // class (b): a base-labelled file with an exclusion key is a Risu preset
                expect(next).toBeNull()
                lostToExclusionKey++
                continue
            }
            if (!stringTyped) {
                // class (a): kinds decided by those members need string values now
                if (next !== base) lostToStringTest++
                continue
            }
            compared++
            const chatWidening = Array.isArray(obj.prompts) && Array.isArray(obj.prompt_order) && !notNull(obj.chat_completion_source)
            if (chatWidening) {
                expect(next).toBe('STCHAT')
                continue
            }
            expect(next).toBe(base)
        }
        // Non-vacuity: every class was actually exercised.
        expect(compared).toBeGreaterThan(50)
        expect(lostToStringTest).toBeGreaterThan(0)
        expect(lostToExclusionKey).toBeGreaterThan(0)
    })

    test('[N] the chat widening and the two losing classes, asserted on their own', () => {
        // R6 widening: arrays without chat_completion_source are a chat file now.
        expect(detectStKind({ prompts: [], prompt_order: [] })).toBe('STCHAT')
        // class (a)
        expect(detectStKind({ input_sequence: 1, output_sequence: 2 })).toBeNull()
        // class (b)
        expect(detectStKind({ temp: 1, rep_pen: 1, min_length: 1, aiModel: 'x' })).toBeNull()
    })
})

//#endregion

//#region literal embedding

function expectedSubstitution(s: string, speaker: 'user' | 'assistant' | 'system'): string {
    return s.replace(/\{\{(user|char|name)\}\}/gi, (_m, name: string) => {
        const key = name.toLowerCase()
        if (key === 'user') return 'U_NAME'
        if (key === 'char') return 'C_NAME'
        return speaker === 'user' ? 'U_NAME' : speaker === 'assistant' ? 'C_NAME' : 'System'
    })
}

function renderSpeakerText(s: string, speaker: 'user' | 'assistant' | 'system'): string {
    return renderSource(
        `{% for message in messages %}{% if message.role == '${speaker}' %}` + jinjaText(s, speaker) + '{% endif %}{% endfor %}',
        [{ role: speaker, content: '' }],
    )
}

const hazardFixtures: [string, string][] = [
    ['comment', 'a{#b#}c'],
    ['block dash', '{%-'],
    ['output dash', '{{-'],
    ['close block dash', 'p -%} q'],
    ['close output dash', 'p -}} q'],
    ['backslash', 'a\\b'],
    ['apostrophe', "it's"],
    ['newline after block close', 'a%}\nb'],
    ['newline then blanks then block', 'a\n  {%'],
    ['line separator then blanks then block', 'a\u2028  {%'],
    ['paragraph separator then blanks then block', 'a\u2029  {%'],
    ['carriage return then blanks then block', 'a\r  {%'],
    ['carriage return tab block', 'a\r\n\t{% b'],
    ['block with condition', '<{% if x %}>'],
    ['expression injection', '}}{{ 1+1 }}{%- raw -%}'],
    ['mixed', "x{# c #}y-%}{{-z \\ it's\r\n"],
]

describe('jinjaLiteral', () => {
    test.each(hazardFixtures)('[N] G14 hazard: %s renders back verbatim without throwing', (_label, s) => {
        const source = jinjaLiteral(s)
        expect(source).not.toContain('{#')
        expect(safeRender(source, [])).toBe(s)
    })

    test('[N] empty text emits nothing', () => {
        expect(jinjaLiteral('')).toBe('')
    })

    test('[N] A22 property: 5000 random strings render back exactly, never emit a comment opener and never throw', () => {
        const alphabet = ['{', '}', '#', '%', '-', ' ', '\\', "'", '"', '\n', '\r', '\t', '\u2028', '\u2029', 'a', 'n', 'e',
            '{{', '{%', '-}}', '{#', '#}', '-%}', '{{-', '{%-', '{{name}}', '{{user}}', '{{CHAR}}', '\\n', '\\\\', '``', 'ü']
        const rnd = mulberry32(777)
        let failures = 0
        let first = ''
        for (let i = 0; i < 5000; i++) {
            let s = ''
            const length = Math.floor(rnd() * 14)
            for (let k = 0; k < length; k++) s += alphabet[Math.floor(rnd() * alphabet.length)]
            const source = '{% for message in messages %}{% if message.role == \'user\' %}' + jinjaText(s, 'user')
                + '{{ message.content }}{% endif %}{% endfor %}' + jinjaText(s, 'assistant')
            const expected = expectedSubstitution(s, 'user') + expectedSubstitution(s, 'assistant')
            const actual = source.includes('{#') ? '<<comment opener in source>>' : safeRender(source, [{ role: 'user', content: '' }])
            if (actual !== expected) {
                failures++
                if (first === '') first = JSON.stringify([s, actual, expected])
            }
        }
        expect(first).toBe('')
        expect(failures).toBe(0)
    })
})

describe('jinjaText macros', () => {
    test('[N] user and char substitute in every branch; name is the speaker', () => {
        const s = '[{{user}}|{{char}}|{{name}}]'
        expect(renderSpeakerText(s, 'user')).toBe('[U_NAME|C_NAME|U_NAME]')
        expect(renderSpeakerText(s, 'assistant')).toBe('[U_NAME|C_NAME|C_NAME]')
        expect(renderSpeakerText(s, 'system')).toBe('[U_NAME|C_NAME|System]')
    })

    test('[N] matching is case-insensitive; other forms stay literal', () => {
        expect(renderSpeakerText('{{NAME}}{{User}}{{CHAR}}', 'user')).toBe('U_NAMEU_NAMEC_NAME')
        expect(renderSpeakerText('{{ NAME }}{{time}}{{[X]}}{{ user }}', 'user')).toBe('{{ NAME }}{{time}}{{[X]}}{{ user }}')
    })

    test('[N] a substituted value is never evaluated again', () => {
        const source = '{% for message in messages %}' + jinjaText('{{user}}', 'user') + '{% endfor %}'
        const out = new Template(source).render({ messages: [{ role: 'user', content: '' }], risu_user: "{% if 1 %}{{x}}'", risu_char: '' })
        expect(out).toBe("{% if 1 %}{{x}}'")
    })
})

//#endregion

//#region builder

describe('buildInstructJinja', () => {
    const conversation: Message[] = [
        { role: 'system', content: 'S' },
        { role: 'user', content: 'u' },
        { role: 'assistant', content: 'a' },
    ]

    test('[N] wrap on: sequences end in a newline, the final sequence keeps it', () => {
        const out = safeRender(buildInstructJinja(chatmlInstruct, '', ''), conversation)
        expect(out).toBe(
            '<|im_start|>system\nS<|im_end|>\n'
            + '<|im_start|>user\nu<|im_end|>\n'
            + '<|im_start|>assistant\na<|im_end|>\n'
            + '<|im_start|>assistant\n')
    })

    test('[N] wrap off with empty suffixes inserts nothing; wrap on with empty suffixes ends each message in a newline', () => {
        const plain = { input_sequence: 'U:', output_sequence: 'A:', wrap: false }
        expect(safeRender(buildInstructJinja(plain, '', ''), conversation.slice(1))).toBe('U:uA:aA:')
        const wrapped = { ...plain, wrap: true }
        expect(safeRender(buildInstructJinja(wrapped, '', ''), conversation.slice(1))).toBe('U:\nu\nA:\na\nA:\n')
    })

    test('[N] wrap that is not literally true counts as off; missing string fields count as empty', () => {
        const loose = { input_sequence: 'U:', output_sequence: 'A:', wrap: 'yes', system_suffix: 3, input_suffix: null }
        expect(safeRender(buildInstructJinja(loose, '', ''), conversation.slice(1))).toBe('U:uA:aA:')
    })

    test('[N] system_same_as_user uses the user prefix and suffix alone', () => {
        const gemma = {
            input_sequence: '<start_of_turn>user\n', input_suffix: '<end_of_turn>\n',
            output_sequence: '<start_of_turn>model\n', output_suffix: '<end_of_turn>\n',
            system_sequence: 'IGNORED', system_sequence_prefix: 'IGNORED', system_sequence_suffix: 'IGNORED',
            system_suffix: '<end_of_turn>\n', wrap: true, system_same_as_user: true,
        }
        const system = safeRender(buildInstructJinja(gemma, '', ''), [{ role: 'system', content: 'S' }])
        const user = safeRender(buildInstructJinja(gemma, '', ''), [{ role: 'user', content: 'S' }])
        expect(system).toBe(user)
        expect(system.split('<end_of_turn>').length - 1).toBe(1)
        const different = { ...gemma, system_suffix: '<DIFFERENT>' }
        expect(safeRender(buildInstructJinja(different, '', ''), [{ role: 'system', content: 'S' }])).toBe(user)
    })

    test('[N] without system_same_as_user the legacy system fields are additive', () => {
        const legacy = { input_sequence: 'U', output_sequence: 'A', system_sequence: '[', system_sequence_prefix: '<', system_sequence_suffix: '>', system_suffix: ']' }
        expect(safeRender(buildInstructJinja(legacy, '', ''), [{ role: 'system', content: 'S' }])).toBe('[<S>]A')
    })

    test('[N] story string is cleaned of macros and blocks, then embedded as plain text', () => {
        const story = 'a {% b %} {# c #} -}} {{system}} {{#if x}}gone{{/if}}{{char}}'
        const inst = { ...chatmlInstruct, system_prompt: 'SP' }
        const out = safeRender(buildInstructJinja(inst, story, '***\n'), [])
        expect(out.startsWith('a {% b %} {# c #} -}} SP ***\n')).toBe(true)
    })
})

describe('shipped-shape instruct presets', () => {
    // Synthetic copies of the sequence fields of representative shipped shapes.
    const shapes: Record<string, Record<string, unknown>> = {
        chatml: { ...chatmlInstruct },
        'chatml-names': { input_sequence: '<|im_start|>{{name}}', output_sequence: '<|im_start|>{{name}}', system_sequence: '<|im_start|>system', input_suffix: '<|im_end|>\n', output_suffix: '<|im_end|>\n', system_suffix: '<|im_end|>\n', wrap: true, macro: true },
        alpaca: { input_sequence: '### Instruction:', output_sequence: '### Response:', input_suffix: '', output_suffix: '', wrap: true },
        mistral: { input_sequence: '[INST] ', input_suffix: ' [/INST]', output_sequence: '', output_suffix: '</s>', system_sequence: '[INST] ', system_suffix: ' [/INST]', wrap: false },
        gemma: { input_sequence: '<start_of_turn>user\n', input_suffix: '<end_of_turn>\n', output_sequence: '<start_of_turn>model\n', output_suffix: '<end_of_turn>\n', system_suffix: '<end_of_turn>\n', wrap: false, system_same_as_user: true },
        'llama3-names': { input_sequence: '<|start_header_id|>{{name}}<|end_header_id|>\n\n', output_sequence: '<|start_header_id|>{{name}}<|end_header_id|>\n\n', system_sequence: '<|start_header_id|>system<|end_header_id|>\n\n', input_suffix: '<|eot_id|>', output_suffix: '<|eot_id|>', system_suffix: '<|eot_id|>', system_same_as_user: true, wrap: false },
        kobold: { input_sequence: '{{[INPUT]}}', input_suffix: '{{[INPUT_END]}}', output_sequence: '{{[OUTPUT]}}', output_suffix: '{{[OUTPUT_END]}}', system_sequence: '{{[SYSTEM]}}', system_suffix: '{{[SYSTEM_END]}}', wrap: false },
        phi: { input_sequence: '<|user|>\n', input_suffix: '<|end|>\n', output_sequence: '<|assistant|>\n', output_suffix: '<|end|>\n', wrap: false },
        wizardlm: { input_sequence: '### Instruction:', output_sequence: '### Response:', output_suffix: '</s>', wrap: true },
        'wizardlm-13b': { input_sequence: 'USER:', input_suffix: '', output_sequence: 'ASSISTANT: ', output_suffix: '</s>', wrap: true },
    }
    // Their conversions differ from the join rules only in whitespace, as documented.
    const whitespaceOnly = new Set(['wizardlm', 'wizardlm-13b'])

    const conversations: Message[][] = [
        [{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'v' }],
        [{ role: 'user', content: 'u' }, { role: 'assistant', content: 'a' }],
        [{ role: 'user', content: 'u' }, { role: 'assistant', content: 'a' }, { role: 'system', content: 'z' }],
    ]

    // Own reading of the reference join rules: per message prefix and suffix, wrap newlines,
    // the last message loses one trailing newline under wrap, the final sequence is trimmed and ends in a newline.
    function reference(inst: Record<string, unknown>, messages: Message[]): string {
        const str = (v: unknown) => typeof v === 'string' ? v : ''
        const wrap = inst.wrap === true
        const sameAsUser = inst.system_same_as_user === true
        const sub = (t: string, who: Message['role']) => t.replace(/{{user}}/gi, 'U_NAME').replace(/{{char}}/gi, 'C_NAME')
            .replace(/{{name}}/gi, who === 'user' ? 'U_NAME' : who === 'assistant' ? 'C_NAME' : 'System')
        const items = messages.map(m => {
            let pre: string
            let suf: string
            if (m.role === 'system') {
                pre = sameAsUser ? str(inst.input_sequence) : str(inst.system_sequence)
                suf = sameAsUser ? str(inst.input_suffix) : str(inst.system_suffix)
            }
            else if (m.role === 'user') {
                pre = str(inst.input_sequence)
                suf = str(inst.input_suffix)
            }
            else {
                pre = str(inst.output_sequence)
                suf = str(inst.output_suffix)
            }
            pre = sub(pre, m.role)
            suf = sub(suf, m.role)
            if (!suf && wrap) suf = '\n'
            return [pre, m.content + suf].filter(x => x).join(wrap ? '\n' : '')
        })
        if (items.length && wrap) items[items.length - 1] = items[items.length - 1].replace(/\n?$/, '')
        const closing = sub(str(inst.output_sequence), 'assistant')
        const tail = (wrap ? ('\n' + closing).trimEnd() : closing) + (wrap ? '\n' : '')
        return items.join('') + tail
    }

    test.each(Object.entries(shapes))('[N] G12 %s builds and renders cleanly', (_name, inst) => {
        const source = buildInstructJinja(inst, '', '')
        for (const messages of conversations) {
            const out = safeRender(source, messages)
            expect(out.startsWith('<<throws')).toBe(false)
            expect(out).not.toContain('[object Object]')
            expect(out).not.toMatch(/\{\{(name|user|char)\}\}/i)
        }
    })

    test.each(Object.entries(shapes))('[N] G13 %s renders as the reference join rules say', (name, inst) => {
        const source = buildInstructJinja(inst, '', '')
        for (const messages of conversations) {
            const actual = safeRender(source, messages)
            const expected = reference(inst, messages)
            if (whitespaceOnly.has(name)) {
                expect(actual.replace(/\s+/g, '')).toBe(expected.replace(/\s+/g, ''))
            }
            else {
                expect(actual).toBe(expected)
            }
        }
    })

    test('[N] G13 the whitespace-only list is exactly the cases that differ', () => {
        const differing = Object.entries(shapes)
            .filter(([, inst]) => conversations.some(messages => safeRender(buildInstructJinja(inst, '', ''), messages) !== reference(inst, messages)))
            .map(([name]) => name)
        expect(differing.sort()).toEqual([...whitespaceOnly].sort())
    })

    test('[N] the unknown-macro preset shows literal marker text, not an object', () => {
        const out = safeRender(buildInstructJinja(shapes.kobold, '', ''), [{ role: 'user', content: 'X' }, { role: 'assistant', content: 'Y' }])
        expect(out).toBe('{{[INPUT]}}X{{[INPUT_END]}}{{[OUTPUT]}}Y{{[OUTPUT_END]}}{{[OUTPUT]}}')
    })
})

//#endregion

//#region conversion rules

describe('convertStFiles', () => {
    test('[N] G9 the Ooba parameter list is the frozen 33-key list', () => {
        expect(OobaParams).toEqual([
            'tokenizer', 'min_p', 'top_k', 'repetition_penalty', 'repetition_penalty_range', 'typical_p', 'tfs', 'top_a',
            'epsilon_cutoff', 'eta_cutoff', 'guidance_scale', 'negative_prompt', 'penalty_alpha', 'mirostat_mode',
            'mirostat_tau', 'mirostat_eta', 'temperature_last', 'do_sample', 'seed', 'encoder_repetition_penalty',
            'no_repeat_ngram_size', 'min_length', 'num_beams', 'length_penalty', 'early_stopping', 'truncation_length',
            'max_tokens_second', 'custom_token_bans', 'auto_max_new_tokens', 'ban_eos_token', 'add_bos_token',
            'skip_special_tokens', 'grammar_string',
        ])
        expect(OobaParams.length).toBe(33)
    })

    test('[N] a bundle with another supported file is refused', () => {
        const result = convertStFiles([
            { name: 'b.json', parsed: { instruct: { input_sequence: 'a', output_sequence: 'b' } } },
            { name: 'c.json', parsed: { name: 'n', content: 'c' } },
        ], baseFixture())
        expect(result).toEqual({ ok: false, reason: 'bundleAlone' })
    })

    test('[N] chat files conflict with an instruct or system prompt file', () => {
        const chat = { name: 'chat.json', parsed: { prompts: [], prompt_order: [] } }
        expect(convertStFiles([chat, { name: 'i.json', parsed: { ...chatmlInstruct } }], baseFixture()))
            .toEqual({ ok: false, reason: 'conflict', withType: 'STINST' })
        expect(convertStFiles([chat, { name: 's.json', parsed: { name: 'n', content: 'c' } }], baseFixture()))
            .toEqual({ ok: false, reason: 'conflict', withType: 'STSYSPROMPT' })
    })

    test('[N] files that hold nothing are refused; context alone is not nothing', () => {
        const reasoning = { name: 'n', prefix: 'a', suffix: 'b', separator: 'c' }
        const nothing = { ok: false, reason: 'nothing' }
        expect(convertStFiles([{ name: 'r.json', parsed: reasoning }], baseFixture())).toEqual(nothing)
        expect(convertStFiles([{ name: 's.json', parsed: { value: '', show: true } }], baseFixture())).toEqual(nothing)
        expect(convertStFiles([{ name: 'b.json', parsed: { reasoning, srw: { value: '', show: true } } }], baseFixture())).toEqual(nothing)
        expect(convertStFiles([{ name: 'x.json', parsed: { unrelated: 1 } }], baseFixture())).toEqual(nothing)
        const context = convertStFiles([{ name: 'c.json', parsed: { story_string: 's', chat_start: '***' } }], baseFixture())
        expect(context.ok).toBe(true)
    })

    test('[N] two system prompt files: the first in input order wins', () => {
        const a = { name: 'a.json', parsed: { name: 'A', content: 'first' } }
        const b = { name: 'b.json', parsed: { name: 'B', content: 'second' } }
        const forward = convertStFiles([a, b], baseFixture())
        const reversed = convertStFiles([b, a], baseFixture())
        expect(forward.ok && forward.preset.mainPrompt).toBe('first')
        expect(reversed.ok && reversed.preset.mainPrompt).toBe('second')
        expect(forward.ok && forward.skipped).toEqual([])
    })

    test('[N] skipped sections follow the key order of the bundle; unknown and invalid keys are named', () => {
        const result = convertStFiles([{
            name: 'bundle.json',
            parsed: {
                reasoning: { name: 'n', prefix: 'a', suffix: 'b', separator: 'c' },
                sysprompt: { name: 'n', content: 'c' },
                instruct: { input_sequence: 1 },
                extra_thing: {},
                srw: { value: '', show: false },
            },
        }], baseFixture())
        expect(result.ok && result.skipped).toEqual(['Reasoning Formatting', 'Instruct Template', 'extra_thing', 'Start Reply With'])
    })

    test('[N] a context part without an instruct part is named and carries nothing', () => {
        const result = convertStFiles([{ name: 'c.json', parsed: { story_string: 's', chat_start: '***' } }], baseFixture())
        expect(result.ok && result.skipped).toEqual(['Context Template'])
        expect(result.ok && result.preset.JinjaTemplate).toBeUndefined()
        expect(result.ok && result.preset.aiModel).toBe('base-model')
        expect(result.ok && result.preset.useInstructPrompt).toBe(false)
    })

    test('[N] parameters are read by value; unset targets become -1000; no scale on the repetition penalty', () => {
        const result = convertStFiles([{
            name: 'p.json',
            parsed: { temp: 0.5, top_p: 0.9, top_k: 40, min_p: 0.05, rep_pen: 1.1, freq_pen: 0.2, presence_pen: 0.3, top_a: 'x', mirostat_mode: 2, seed: null },
        }], baseFixture())
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.preset.temperature).toBe(0.5 * 100)
        expect(result.preset.top_p).toBe(0.9)
        expect(result.preset.top_k).toBe(40)
        expect(result.preset.min_p).toBe(0.05)
        expect(result.preset.repetition_penalty).toBe(1.1)
        expect(result.preset.frequencyPenalty).toBe(0.2 * 100)
        expect(result.preset.PresensePenalty).toBe(0.3 * 100)
        expect(result.preset.top_a).toBe(-1000)
        // Every Ooba key that is set is copied as written (top_a here); null and absent ones are not sent.
        expect(result.preset.reverseProxyOobaArgs).toEqual({ mode: 'instruct', min_p: 0.05, top_k: 40, top_a: 'x', mirostat_mode: 2 })
        expect(result.preset.aiModel).toBe('base-model')
    })

    test('[N] presence_penalty is the fallback key for the presence penalty', () => {
        const result = convertStFiles([{ name: 'p.json', parsed: { temp: 1, rep_pen: 1, top_k: 1, top_p: 1, presence_penalty: 0.4 } }], baseFixture())
        expect(result.ok && result.preset.PresensePenalty).toBe(0.4 * 100)
    })

    test('[N] the context part is named as skipped only when there is no instruct part', () => {
        const instruct = { input_sequence: 'a', output_sequence: 'b' }
        const context = { story_string: 's', chat_start: 'c' }
        const reasoning = { name: 'n', prefix: 'a', suffix: 'b', separator: 'c' }
        const withInstruct = convertStFiles([{ name: 'b.json', parsed: { instruct, context, reasoning } }], baseFixture())
        expect(withInstruct.ok && withInstruct.skipped).toEqual(['Reasoning Formatting'])
        const withoutInstruct = convertStFiles([{ name: 'b.json', parsed: { context, reasoning } }], baseFixture())
        expect(withoutInstruct.ok && withoutInstruct.skipped).toEqual(['Context Template', 'Reasoning Formatting'])
    })

    test('[N] without a parameters part the base sampler fields are kept', () => {
        const result = convertStFiles([{ name: 's.json', parsed: { name: 'n', content: 'c' } }], baseFixture())
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.preset.temperature).toBe(80)
        expect(result.preset.top_k).toBe(7)
        expect(result.preset.reverseProxyOobaArgs).toEqual({ mode: 'instruct' })
    })
})

//#endregion
