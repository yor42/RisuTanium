// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import fc from 'fast-check'

vi.mock(import('src/ts/process/scripts'), () => ({
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('src/ts/process/scripts'))

import { exampleMessage } from 'src/ts/process/exampleMessages'
import { characterWithExample } from './exampleFixtures.test-helpers'
import { turnLines, turnMarks } from './exampleTurns'

const SEED = 20261114

const engine = (text: string, name: string) => exampleMessage(characterWithExample(text, name))
    .filter((entry) => entry.memo !== 'NewChatExample')

const NAMES = ['bot', 'Bot', 'A:B', 'ALICE', '']
const LINE_TOKENS = ['{{char}}:', '{{CHAR}}:', '<bot>:', '<user>:', '{{user}}:', 'bot:', 'Bot:', 'A:B:', 'ALICE:', 'alice:', ':', ' ', '\t', ' hi', 'x', '{{char}}', '<START>']
const lineArb = fc.array(fc.constantFrom(...LINE_TOKENS), { maxLength: 6 }).map((tokens) => tokens.join(''))

describe('T-U1 exampleTurns matches the engine speaker and used-text rule', () => {
    test('property: a single line gives the same speaker and used text', () => {
        fc.assert(
            fc.property(lineArb, fc.constantFrom(...NAMES), (line, name) => {
                if (line.trim().toLocaleLowerCase() === '<start>') {
                    return
                }
                const turns = turnLines(line, name)
                const entries = engine(line, name)
                expect(turns.length).toBe(entries.length)
                if (turns.length === 1) {
                    expect(turns[0].speaker).toBe(entries[0].role)
                    expect(turns[0].used).toBe(entries[0].content)
                }
            }),
            { seed: SEED, numRuns: 1500 },
        )
    })

    test('property: several lines give the engine turn count and roles', () => {
        fc.assert(
            fc.property(fc.array(lineArb, { maxLength: 6 }), fc.constantFrom(...NAMES), (lines, name) => {
                const text = lines.join('\n')
                const turns = turnLines(text, name)
                const entries = engine(text, name)
                expect(turns.map((t) => t.speaker)).toEqual(entries.map((entry) => entry.role))
            }),
            { seed: SEED, numRuns: 1000 },
        )
    })

    test('the character name is compared without lower-casing it (the engine quirk)', () => {
        expect(turnLines('ALICE: hi', 'ALICE')).toHaveLength(0)
        expect(engine('ALICE: hi', 'ALICE')).toHaveLength(0)
        expect(turnLines('alice: hi', 'alice')).toHaveLength(1)
        expect(engine('alice: hi', 'alice')).toHaveLength(1)
        expect(turnLines('alice: hi', 'Alice')).toHaveLength(0)
        expect(engine('alice: hi', 'Alice')).toHaveLength(0)
    })

    test('a name holding a colon splits at the first colon as the engine does', () => {
        const turns = turnLines('a:b: hi', 'a:b')
        const entries = engine('a:b: hi', 'a:b')
        expect(turns).toHaveLength(1)
        expect(turns[0].used).toBe(entries[0].content)
        expect(turns[0].used).toBe('b')
        expect(turns[0].notUsedStart).toBe(3)
    })

    test('notUsed starts at the second colon of the trimmed line and ends at its trimmed end', () => {
        const text = '  {{char}}: hi: there  '
        const [turn] = turnLines(text, 'bot')
        expect(turn.used).toBe('hi')
        expect(engine(text, 'bot')[0].content).toBe('hi')
        expect(turn.notUsedStart).not.toBeNull()
        expect(text.slice(turn.notUsedStart ?? 0, turn.end)).toBe(': there')
        expect(text.slice(turn.start, turn.speakerEnd)).toBe('{{char}}:')
    })

    test('no second colon means no notUsed; marker lines and continuation lines are no turn', () => {
        expect(turnLines('{{char}}: hi', 'bot')[0].notUsedStart).toBeNull()
        expect(turnLines('<START>\n{{user}}: a\nmore', 'bot')).toHaveLength(1)
    })

    test('offsets are in the LF text, per line', () => {
        const text = '{{user}}: a\n{{char}}: b: c'
        const marks = turnMarks(text, 'bot')
        expect(marks.map((m) => [m.note, text.slice(m.start, m.end)])).toEqual([
            ['speaker', '{{user}}:'],
            ['speaker', '{{char}}:'],
            ['notUsed', ': c'],
        ])
    })
})
