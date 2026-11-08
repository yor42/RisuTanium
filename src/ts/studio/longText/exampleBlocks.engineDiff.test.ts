// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import fc from 'fast-check'

vi.mock(import('src/ts/process/scripts'), () => ({
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('src/ts/process/scripts'))

import { exampleMessage } from 'src/ts/process/exampleMessages'
import { isExampleMarkerLine, splitExampleText } from './exampleBlocks'
import {
    HAND_MADE_EXAMPLES,
    V2_CRLF_EXAMPLE,
    characterWithExample,
    engineParts,
} from './exampleFixtures.test-helpers'

const NEW_CHAT_ENTRY = { role: 'system', content: '[Start a new chat]', memo: 'NewChatExample' }

const ALPHABET = [
    '<START>', '<start>', ' ', '\t', ' ', '　', '﻿', '\r', '\n', ':', '{{user}}', '<bot>:', 'a',
]
const textArb = fc.array(fc.constantFrom(...ALPHABET), { maxLength: 40 }).map((tokens) => tokens.join(''))

const engine = (text: string) => exampleMessage(characterWithExample(text))

/** `E(x)` of the plan: the engine run over one part's engine text. */
const partOutput = (engineText: string) => engine(engineText)

/** The engine output the split must reproduce: E(opening), then per block a new-chat entry and E(body). */
function expectedFromParts(text: string) {
    const t = splitExampleText(text)
    const [openingText, ...bodyTexts] = engineParts(t)
    const out = [...partOutput(openingText)]
    bodyTexts.forEach((bodyText) => {
        out.push(NEW_CHAT_ENTRY as ReturnType<typeof engine>[number], ...partOutput(bodyText))
    })
    return out
}

describe('A1-d1 split parts reproduce the engine output (INV4)', () => {
    test('generated texts', () => {
        fc.assert(
            fc.property(textArb, (text) => {
                expect(engine(text)).toEqual(expectedFromParts(text))
            }),
            { seed: 20261108, numRuns: 600 },
        )
    })

    const literals = [
        '<START>\n{{user}}: hi\n',
        '{{user}}: a\n<START>\n',
        '<START>\n<START>',
        'x\n<START>',
        '{{user}}: a\n\n<START>',
    ]
    test.each([...literals, ...literals.map((text) => text.replace(/\n/g, '\r\n')), V2_CRLF_EXAMPLE, ...HAND_MADE_EXAMPLES])(
        'literal %j',
        (text) => {
            expect(engine(text)).toEqual(expectedFromParts(text))
        },
    )

    test('the last part is used raw, so a trailing newline survives in its message', () => {
        const out = engine('<START>\n{{user}}: hi\n')
        expect(out).toHaveLength(2)
        expect(out[1].content).toBe('hi\n')
    })

    test('R3: a line is a marker exactly when the engine yields one new-chat entry for it', () => {
        const lineArb = fc.array(fc.constantFrom(...ALPHABET.filter((token) => token !== '\n')), { maxLength: 8 })
            .map((tokens) => tokens.join(''))
        fc.assert(
            fc.property(lineArb, (line) => {
                const entries = engine(line).filter((entry) => entry.memo === 'NewChatExample')
                expect(entries.length).toBe(isExampleMarkerLine(line) ? 1 : 0)
            }),
            { seed: 20261108, numRuns: 600 },
        )
        for (const line of ['<START>', ' <start> ', '<START>x', 'x<START>', '<START>{{user}}: hi', ' <Start>　']) {
            const entries = engine(line).filter((entry) => entry.memo === 'NewChatExample')
            expect(entries.length).toBe(isExampleMarkerLine(line) ? 1 : 0)
        }
    })
})
