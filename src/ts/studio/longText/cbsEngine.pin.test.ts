import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'

//#region module mocks (the parser harness of src/ts/parser/tests/cbs/conditionals.test.ts)

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => ({}),
    getCurrentChat: () => ({}),
    getDatabase: () => ({}),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

const varStorage = vi.hoisted(() => new Proxy({}, {
    get(_, prop) {
        return typeof prop === 'string' ? (prop.startsWith('$') ? prop.slice(1) : prop) : 'null'
    },
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: {
        db: {
            characters: [{ chatPage: 0, chats: [{ scriptstate: varStorage }], defaultVariables: '' }],
            globalChatVariables: varStorage,
            templateDefaultVariables: '',
        },
    },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
    CurrentTriggerIdStore: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

//#endregion

import { risuChatParser } from 'src/ts/parser/parser.svelte'

// The parser keeps `callStack` on its options object, so every call gets a fresh one.
const parse = (text: string) => risuChatParser(text, {})

// These rows pin the engine behaviour the checker's scan copies. They hold on the engine before and
// after the checker exists; if one fails, the engine changed and the checker's mirror must follow.
describe('engine scan behaviour the checker mirrors', () => {
    test.each<[string, string]>([
        // `}}` closes only a top frame opened by `{{` or `{#`; everywhere else it is text.
        ['}}}', '}}}'],
        ['}{{blank}}}', '}}'],
        // `#}` closes a top type-1 frame: `{{#}}` is a legacy frame followed by a lone `}`.
        ['{{#}}', '{##}}'],
        ['a{{#}}b', 'a{##}}b'],
        ['{#trim::a}}', 'a'],
        ['{#trim::a#}', '{#trim::a#}'],
        ['{#trim::a', '{{trim::a'],
        ['{{trim::a', '{{trim::a'],
    ])('pairing: %j gives %j', (text, expected) => {
        expect(parse(text)).toBe(expected)
    })

    test.each<[string, string]>([
        // `return` aborts the whole parse, wherever the macro is evaluated.
        ['{{return::x}}y', 'x'],
        ['{{#when 0}}{{return::x}}{{/when}}y', 'x'],
        ['{{#when 0}}x{{/when}}{{return::x}}y', 'x'],
        // A pure body only keeps the text.
        ['{{#pure}}{{return::x}}{{/pure}}y', '{{return::x}}y'],
    ])('return: %j gives %j', (text, expected) => {
        expect(parse(text)).toBe(expected)
    })

    test.each<[string, string]>([
        // Macro pairing inside a pure or dropped body is the same as at the root.
        ['{{#pure}}a}}b{{/pure}}', 'a}}b'],
        ['{{#if 0}}a}}b{{/if}}c', 'c'],
        ['{{#pure}}a#}b{{/pure}}', 'a#}b'],
        ['{{#pure}}{{x{{/pure}}', '<{{x{{/pure}}'],
        ['{{#if 0}}{{x{{/if}}', '<{{x{{/if}}'],
    ])('bodies: %j gives %j', (text, expected) => {
        expect(parse(text)).toBe(expected)
    })

    test('the frame limit: 510 open frames pair normally, the 511th cannot be recorded', () => {
        const nested = (depth: number) => '{{'.repeat(depth) + 'x' + '}}'.repeat(depth)
        expect(parse(nested(510))).toBe(nested(510))
        const over = parse(nested(511))
        expect(over).not.toBe(nested(511))
        expect(over).toContain('<')
    })
})
