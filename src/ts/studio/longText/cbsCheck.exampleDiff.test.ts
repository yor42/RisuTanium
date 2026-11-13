// @vitest-environment node
import fc from 'fast-check'
import { describe, expect, test, vi } from 'vitest'

// The first step of the CBS parse is the role-tag rewrite; the rest of the parse does not decide
// which line starts a speaker turn, so this stand-in is enough to compare the turns.
vi.mock(import('src/ts/process/scripts'), () => ({
    risuChatParser: vi.fn((text: string) => text.replace(/<(user|char|bot)>/gi, '{{$1}}')),
}) as unknown as typeof import('src/ts/process/scripts'))

import { exampleMessage } from 'src/ts/process/exampleMessages'
import { checkCbs, type CbsFix } from './cbsCheck'
import {
    HAND_MADE_EXAMPLES,
    V2_CRLF_EXAMPLE,
    byafExampleText,
    characterWithExample,
} from './exampleFixtures.test-helpers'
import { createMacroIndex } from './macroIndex'

// Only the role-tag fixes are under test; no registry entry is needed.
const index = createMacroIndex([])

function fixesOf(text: string): CbsFix[] {
    const result = checkCbs(text, index, { mode: 'cbs', slotAllowed: true })
    return result.problems.flatMap((problem) => problem.fix ? [problem.fix] : [])
}

function applyFixes(text: string, fixes: readonly CbsFix[]): string {
    let out = text
    for(const fix of [...fixes].sort((a, b) => b.start - a.start)){
        out = out.slice(0, fix.start) + fix.text + out.slice(fix.end)
    }
    return out
}

const turns = (text: string) => exampleMessage(characterWithExample(text))

// Applying every fix must leave the example turns as they were.
const unchanged = (text: string) => expect(turns(applyFixes(text, fixesOf(text))), JSON.stringify(text)).toEqual(turns(text))

const LINES = [
    '<bot>: hi', '<char>: hi', '<user>: hi', '{{user}}: hi', '{{char}}: hi', '  <char>:x', '\t<BOT>: x', '<USER>:y',
    'x <bot>: y', 'a <char>', '<char> b', '<bot> : z', '<START>', 'plain', '', 'bot: q', '<user>',
]
const textArb = fc.array(fc.constantFrom(...LINES), { minLength: 1, maxLength: 8 })
    .chain((lines) => fc.constantFrom('\n', '\r\n').map((eol) => lines.join(eol)))

describe('fixes keep the example dialogue turns', () => {
    test('generated speaker lines, with line-start tags before a colon among them', () => {
        let withFix = 0
        let withWithheld = 0
        fc.assert(
            fc.property(textArb, (text) => {
                const fixes = fixesOf(text)
                if(fixes.length > 0){
                    withFix++
                }
                if(/(^|\n)\s*<(user|char|bot)>:/i.test(text)){
                    withWithheld++
                }
                unchanged(text)
            }),
            { seed: 20261113, numRuns: 500 },
        )
        // The comparison informs only while fixes are applied and the withheld case occurs.
        expect(withFix).toBeGreaterThan(150)
        expect(withWithheld).toBeGreaterThan(100)
    })

    test('a line-start tag before a colon keeps its tag, so its role does not change', () => {
        expect(fixesOf('<char>: hi')).toEqual([])
        expect(fixesOf('{{user}}: a\n  <bot>: b')).toEqual([])
        expect(turns('<char>: hi')).toEqual([])
        expect(turns('<bot>: hi')).toHaveLength(1)
    })

    test.each([
        '<char>: a\n<user>: b',
        '{{user}}: a\n<bot>: b\nmore <char> text',
        'a\r\n<user>: x <char> y\r\n<char>: z',
        ...HAND_MADE_EXAMPLES.map((text) => `${text}\n<char>: tail\nx <user>: y`),
        V2_CRLF_EXAMPLE.replace('{{char}}: hi there', '<bot>: hi there <char>'),
        byafExampleText(['<user>: a', '{{char}}: b <char>']),
    ])('fixture %j', (text) => {
        unchanged(text)
    })
})
