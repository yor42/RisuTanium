import { describe, expect, test } from 'vitest'
import { INERT_DECORATORS } from '../../process/memory/chroMemory/loreRecall'
import {
    decoratorPicks,
    decoratorTrigger,
    loreDecoratorNotes,
    loreDecoratorPickSource,
    loreDecoratorProblems,
    loreDecoratorWarnings,
    probabilityClearKeeps,
    readProbabilityLine,
    writeProbabilityLine,
    type LoreDecoratorCopy,
} from './loreDecorators'
import { filterPicks } from './macroPick'

function summary(text: string): [string, string, string, number][] {
    return loreDecoratorWarnings(text).map((w) => [w.code, w.kind, w.severity, w.line])
}

describe('decorator warnings (T28)', () => {
    test('(1) a line after a blank line is W2 only', () => {
        expect(summary('@@depth 1\n\n@@probability 50\nbody')).toEqual([['W2', 'afterText', 'warning', 3]])
    })

    test('(2) a decorator after plain text is W2', () => {
        expect(summary('body\n@@depth 1')).toEqual([['W2', 'afterText', 'warning', 2]])
    })

    test('(3) leading blank lines do not end the block', () => {
        expect(summary('\n\n@@depth 1\nbody')).toEqual([])
    })

    test('(4) a position without an argument is an error, also on a skipped fallback', () => {
        expect(summary('@@position')).toEqual([['W3', 'argMissing', 'error', 1]])
        expect(summary('@@keep_activate_after_match\n@@@position')).toEqual([['W3', 'argMissing', 'error', 2], ['W5', 'fallback', 'info', 2]])
        expect(summary('@@position pt_x')).toEqual([])
        expect(summary('@@position nowhere')).toEqual([['W3', 'badArg', 'warning', 1]])
    })

    test('(5) a priority that is not a number', () => {
        expect(summary('@@priority high')).toEqual([['W3', 'priorityNaN', 'warning', 1]])
    })

    test('(6) a probability that is not a number', () => {
        expect(summary('@@probability x')).toEqual([['W3', 'probabilityNaN', 'warning', 1]])
        expect(summary('@@probability')).toEqual([['W3', 'probabilityNaN', 'warning', 1]])
    })

    test('(7) refused arguments', () => {
        for (const text of ['@@depth x', '@@scan_depth -1', '@@role bot', '@@disable_ui_prompt foo']) {
            expect(summary(text), text).toEqual([['W3', 'badArg', 'warning', 1]])
        }
    })

    test('(8) unknown names, a tab inside the name included', () => {
        for (const text of ['@@probabilty 50', '@@probability\t50', '@@constructor']) {
            expect(summary(text), text).toEqual([['W1', 'unknown', 'warning', 1]])
        }
    })

    test('(9) a decorator without effect', () => {
        expect(summary('@@is_user_icon')).toEqual([['W4', 'ignored', 'warning', 1]])
    })

    test('(10) fallback and deprecated forms', () => {
        expect(summary('@@@depth 2')).toEqual([['W5', 'fallback', 'info', 1]])
        expect(summary('@@@end')).toEqual([['D', 'deprecated', 'info', 1]])
        expect(summary('@@end')).toEqual([['D', 'deprecated', 'info', 1]])
    })

    test('(11) two executed probability lines are both marked', () => {
        expect(summary('@@probability 10\n@@probability 20')).toEqual([
            ['W6', 'probabilityMany', 'info', 1],
            ['W6', 'probabilityMany', 'info', 2],
        ])
    })

    test('(12) a skipped fallback probability line is not counted', () => {
        const codes = summary('@@depth 1\n@@@depth 2\n@@@probability 20\n@@probability 30').map((w) => w[0])
        expect(codes).not.toContain('W6')
    })

    test('(13) a fallback that runs is counted', () => {
        const w6 = summary('@@keep_activate_after_match\n@@@probability 20\n@@probability 30').filter((w) => w[0] === 'W6')
        expect(w6.map((w) => w[3])).toEqual([2, 3])
    })

    test('(14) every span is the trimmed line, also with CRLF', () => {
        const text = '  @@position  \r\n@@depth x\r\n  @@probabilty 5\r\n\r\n  @@depth 1\r\nbody'
        const warnings = loreDecoratorWarnings(text)
        expect(warnings.map((w) => text.slice(w.start, w.end))).toEqual(['@@position', '@@depth x', '@@probabilty 5', '@@depth 1'])
    })

    test('(15) lines after the block carry W2 only', () => {
        expect(loreDecoratorWarnings('body\n@@probabilty 5\n@@position').map((w) => [w.code, w.kind, w.line])).toEqual([
            ['W2', 'afterText', 2],
            ['W2', 'afterText', 3],
        ])
    })

    test('(16) a W2 span is the trimmed raw line after the block', () => {
        const text = 'a\r\n  @@depth 1  \r\nb'
        const [w] = loreDecoratorWarnings(text)
        expect(text.slice(w.start, w.end)).toBe('@@depth 1')
    })
})

describe('probability read is read-only for several, fallback and unreadable (T34)', () => {
    const cases: [string, string][] = [
        ['several', '@@probability 30\n@@probability 60\nbody'],
        ['fallback', '@@depth 1\n@@@probability 30\nbody'],
        ['fallback on a running line', '@@keep_activate_after_match\n@@@probability 30\nbody'],
        ['unreadable', '@@probability x\nbody'],
        ['unreadable, no argument', '@@probability\nbody'],
    ]
    for (const [name, content] of cases) {
        test(`${name}: nothing is written`, () => {
            expect(writeProbabilityLine(content, 40)).toBe(content)
            expect(writeProbabilityLine(content, null)).toBe(content)
            expect(probabilityClearKeeps(content)).toBe(false)
        })
    }

    test('the read result names the reason', () => {
        expect(readProbabilityLine('@@probability 30\n@@probability 60')).toEqual({ kind: 'many', reason: 'several' })
        expect(readProbabilityLine('@@depth 1\n@@@probability 30')).toEqual({ kind: 'many', reason: 'fallback' })
        expect(readProbabilityLine('@@probability x')).toEqual({ kind: 'unreadable', line: 0 })
        expect(readProbabilityLine('@@probability 50%\nbody')).toEqual({ kind: 'one', value: 50, line: 0 })
        expect(readProbabilityLine('@@depth 1\n\n@@probability 30\nbody')).toEqual({ kind: 'none' })
        expect(readProbabilityLine('\n\n@@probability 30\nbody')).toEqual({ kind: 'one', value: 30, line: 2 })
    })
})

const echo: LoreDecoratorCopy = {
    unknown: (n) => `unknown:${n}`,
    afterText: () => 'afterText',
    badArg: (n) => `badArg:${n}`,
    argMissing: (n) => `argMissing:${n}`,
    probabilityNaN: () => 'probabilityNaN',
    priorityNaN: () => 'priorityNaN',
    probabilityMany: () => 'probabilityMany',
    ignored: (n) => `ignored:${n}`,
    fallback: () => 'fallback',
    deprecated: () => 'deprecated',
    help: (n) => `help:${n}`,
    matches: (n) => `matches:${n}`,
    listLabel: () => 'list',
}

describe('problems and notes (T62)', () => {
    test('each kind maps to its copy function with the name', () => {
        const text = '@@probabilty 5\n@@depth x\n@@priority y\n@@is_user_icon\n@@@role user\n@@end\n@@probability 1\n@@probability 2\n@@position\nbody\n@@z'
        const problems = loreDecoratorProblems(text, echo)
        expect(problems.map((p) => [p.kind, p.message])).toEqual([
            ['x-deco-unknown', 'unknown:probabilty'],
            ['x-deco-badArg', 'badArg:depth'],
            ['x-deco-priorityNaN', 'priorityNaN'],
            ['x-deco-ignored', 'ignored:is_user_icon'],
            ['x-deco-fallback', 'fallback'],
            ['x-deco-deprecated', 'deprecated'],
            ['x-deco-probabilityMany', 'probabilityMany'],
            ['x-deco-probabilityMany', 'probabilityMany'],
            ['x-deco-argMissing', 'argMissing:position'],
            ['x-deco-afterText', 'afterText'],
        ])
        expect(problems[0]).toMatchObject({ severity: 'warning', start: 0, end: 14 })
        expect(problems[8].severity).toBe('error')
    })

    test('one decorator note per block line and none after the block', () => {
        const text = '@@depth 1\n  @@@role user  \n\n@@x\nbody'
        const notes = loreDecoratorNotes(text)
        expect(notes.map((n) => [n.note, text.slice(n.start, n.end)])).toEqual([
            ['decorator', '@@depth 1'],
            ['decorator', '@@@role user'],
        ])
    })
})

describe('autocomplete (T63)', () => {
    test('the trigger sits on the two @ of the name being typed inside the block', () => {
        expect(decoratorTrigger('@@pro')).toEqual({ start: 0, query: 'pro' })
        expect(decoratorTrigger('@@depth 1\n  @@')).toEqual({ start: 12, query: '' })
        expect(decoratorTrigger('@@@pro')).toEqual({ start: 1, query: 'pro' })
        expect(decoratorTrigger('\n\n@@depth 1\n@@x')).toEqual({ start: 12, query: 'x' })
    })

    test('no trigger after text, after a blank line, for a macro or once a space is typed', () => {
        expect(decoratorTrigger('text\n@@pro')).toBeNull()
        expect(decoratorTrigger('@@depth 1\n\n@@pro')).toBeNull()
        expect(decoratorTrigger('@@depth 1\n{{')).toBeNull()
        expect(decoratorTrigger('@@probability 5')).toBeNull()
    })

    test('the picks leave out end and the decorators without effect', () => {
        const picks = decoratorPicks(echo)
        expect(picks).toHaveLength(28)
        expect(picks.map((p) => p.name)).not.toContain('end')
        for (const name of INERT_DECORATORS) expect(picks.map((p) => p.name)).not.toContain(name)
        const probability = picks.find((p) => p.name === 'probability')
        expect(probability).toMatchObject({ key: 'deco:probability', label: 'help:probability', usage: '@@probability N', insertion: { text: '@@probability ', caret: 14 }, group: null })
        expect(picks.find((p) => p.name === 'activate')?.usage).toBe('@@activate')
        expect(filterPicks(picks, 'prob')[0].name).toBe('probability')
    })

    test('the pick source carries the count and the list label from the copy', () => {
        const source = loreDecoratorPickSource(echo)
        expect(source.matches?.(3)).toBe('matches:3')
        expect(source.label?.()).toBe('list')
        expect(source.items()).toHaveLength(28)
        expect(source.trigger('@@x')).toEqual({ start: 0, query: 'x' })
    })
})
