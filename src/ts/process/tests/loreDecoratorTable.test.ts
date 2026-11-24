import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { CCardLib } from '@risuai/ccardlib'
import { LORE_SCAN_DECORATORS } from '../loreScanDecorators'
import { INERT_DECORATORS } from '../memory/chroMemory/loreRecall'
import {
    LORE_DECORATORS,
    decoratorBody,
    decoratorResult,
    decoratorRow,
    parseDecoratorBlock,
    runBlock,
    staticRun,
} from '../loreDecoratorTable'

describe('decorator table (T60)', () => {
    test('the rows are exactly the names the scan handles', () => {
        expect(new Set(Object.keys(LORE_DECORATORS))).toEqual(new Set(LORE_SCAN_DECORATORS))
        expect(Object.keys(LORE_DECORATORS)).toHaveLength(33)
    })

    test('the rows without effect are the inert set of the lore recall', () => {
        const none = Object.entries(LORE_DECORATORS).filter(([, r]) => r.effect === 'none').map(([n]) => n)
        expect(new Set(none)).toEqual(new Set(INERT_DECORATORS))
    })

    test('required holds exactly for the int and choice rows', () => {
        for (const [name, row] of Object.entries(LORE_DECORATORS)) {
            expect(row.required, name).toBe(row.arg.kind === 'int' || row.arg.kind === 'choice')
        }
    })

    test('a name that is not an own row has no row', () => {
        for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'unknown_one', '']) {
            expect(decoratorRow(name), name).toBeNull()
        }
        expect(decoratorRow('depth')).toBe(LORE_DECORATORS.depth)
    })

    test('every row without effect also returns false', () => {
        for (const [name, row] of Object.entries(LORE_DECORATORS)) {
            if (row.effect === 'none') expect(row.returnsIgnored, name).toBe(true)
        }
    })

    test('examples and bad examples agree with the result model', () => {
        for (const [name, row] of Object.entries(LORE_DECORATORS)) {
            const args = row.example === '' ? [] : row.example.split(',').map((s) => s.trim())
            if (!row.returnsIgnored) expect(decoratorResult(name, args), name).toBe('continue')
            if (row.badExample !== null) expect(decoratorResult(name, [row.badExample]), name).toBe('ignored')
        }
    })
})

describe('block parser (T61)', () => {
    test('leading blank lines do not end the block', () => {
        const b = parseDecoratorBlock('\n\n  @@depth 1\nbody')
        expect(b.lines.map((l) => [l.line, l.name])).toEqual([[2, 'depth']])
        expect(b.bodyLine).toBe(3)
        expect(decoratorBody('\n\n  @@depth 1\nbody')).toBe('body')
    })

    test('a whitespace-only line ends the block', () => {
        const c = '@@depth 1\n  \n@@probability 50\nbody'
        const b = parseDecoratorBlock(c)
        expect(b.lines).toHaveLength(1)
        expect(b.bodyLine).toBe(1)
        expect(b.bodyStart).toBe(c.indexOf('  \n'))
        expect(decoratorBody(c)).toBe('@@probability 50\nbody')
    })

    test('CRLF lines keep the carriage return out of the trimmed span', () => {
        const c = '  @@depth 1  \r\n@@role user\r\nbody'
        const b = parseDecoratorBlock(c)
        const first = b.lines[0]
        expect(first.text).toBe('@@depth 1')
        expect(c.slice(first.textStart, first.textEnd)).toBe('@@depth 1')
        expect(c[first.end]).toBe('\n')
        expect(first.start).toBe(0)
        expect(b.lines[1].args).toEqual(['user'])
        expect(b.lines[1].textEnd).toBe(c.indexOf('\r\nbody'))
    })

    test('@@@end is the always-running deprecated end, @@@end 5 is a fallback named end', () => {
        const a = parseDecoratorBlock('@@@end\nbody').lines[0]
        expect([a.name, a.fallback, a.text]).toEqual(['end', false, '@@@end'])
        const b = parseDecoratorBlock('@@@end 5\nbody').lines[0]
        expect([b.name, b.fallback, b.args]).toEqual(['end', true, ['5']])
    })

    test('@@ and @@ x are reset lines; the name ends only at a space', () => {
        expect(parseDecoratorBlock('@@\nb').lines[0].name).toBe('')
        expect(parseDecoratorBlock('@@ x\nb').lines[0].name).toBe('')
        const t = parseDecoratorBlock('@@probability\t50\nb').lines[0]
        expect(t.name).toBe('probability\t50')
        expect(t.args).toEqual([])
        expect(parseDecoratorBlock('@@@@x\nb').lines[0]).toMatchObject({ fallback: true, name: '@x' })
    })

    test('arguments split on commas, trimmed, empties dropped', () => {
        expect(parseDecoratorBlock('@@depth 1, 2 ,, 3').lines[0].args).toEqual(['1', '2', '3'])
    })

    test('all-blank content and a block reaching the end have no body line', () => {
        expect(parseDecoratorBlock(' \n\t\n')).toEqual({ lines: [], bodyLine: null, bodyStart: null })
        const end = parseDecoratorBlock('@@depth 1\n@@role user')
        expect(end.lines).toHaveLength(2)
        expect(end.bodyLine).toBeNull()
        const blankTail = parseDecoratorBlock('@@depth 1\n  \n\n')
        expect(blankTail.bodyLine).toBeNull()
        expect(decoratorBody('@@depth 1\n  \n\n')).toBe('')
    })

    test('runBlock: a skipped fallback leaves the state, a reset clears it, a throw stops later lines', () => {
        const skipped = runBlock(parseDecoratorBlock('@@depth 1\n@@@depth 2\n@@@probability 20\nbody'))
        expect(skipped.runs).toEqual([true, false, false])
        const kept = runBlock(parseDecoratorBlock('@@keep_activate_after_match\n@@@dont_activate_after_match\n@@@probability 20\nbody'))
        expect(kept.runs).toEqual([true, true, true])
        const afterIgnored = runBlock(parseDecoratorBlock('@@keep_activate_after_match\n@@\n@@@depth 2\nbody'))
        expect(afterIgnored.runs).toEqual([true, true, false])
        const threw = runBlock(parseDecoratorBlock('@@depth 1\n@@position\n@@role user\nbody'))
        expect(threw).toEqual({ runs: [true, true, false], threw: 1 })
    })

    test('staticRun: a throwing position keeps its entry and drops the body', () => {
        const run = staticRun('@@position\nbody')
        expect(run.threw).toBe(true)
        expect(run.body).toBeNull()
        expect(run.executed.map((e) => [e.name, e.result])).toEqual([['position', 'throws']])
    })

    test('staticRun leaves out skipped fallbacks and reset lines', () => {
        const run = staticRun('@@depth 1\n@@@role user\n@@\n@@probability 5\nbody')
        expect(run.executed.map((e) => e.name)).toEqual(['depth', 'probability'])
        expect(run.executed.map((e) => e.line)).toEqual([0, 3])
        expect(run.body).toBe('body')
        expect(run.threw).toBe(false)
    })
})

describe('parser against ccardlib 0.4.2 (T61p)', () => {
    const MARK = new Error('position without argument')

    const argArb = fc.constantFrom('', ' 1', ' x', ' -1', ' user', ' bot', ' pt_x', ' nowhere', ' 50', ' a, b', ' 1, 2', ' system_prompt', '\t5')
    const nameArb = fc.constantFrom(
        ...LORE_SCAN_DECORATORS,
        'position', 'position', 'depth', 'scan_depth', 'role', 'probability', 'probabilty', 'constructor', 'x',
    )
    const lineArb = fc.oneof(
        { weight: 6, arbitrary: fc.tuple(nameArb, argArb).map(([n, a]) => `@@${n}${a}`) },
        { weight: 4, arbitrary: fc.tuple(nameArb, argArb).map(([n, a]) => `@@@${n}${a}`) },
        { weight: 2, arbitrary: fc.constantFrom('@@@end', '@@@end 5', '@@end', '@@', '@@ x', '@@@', '@@@@x', ' @@depth 1 ', '\t@@@role user') },
        { weight: 3, arbitrary: fc.constantFrom('text', 'body @@depth 1', '', '  ', '\t', ' ', '@x') },
    )
    const contentArb = fc.tuple(
        fc.array(lineArb, { minLength: 0, maxLength: 8 }),
        fc.constantFrom('\n', '\r\n'),
        fc.constantFrom('', '\n', '  \n', '\r\n\r\n'),
        fc.constantFrom('', '\n', ' ', '\n\n'),
    ).map(([lines, eol, lead, trail]) => lead + lines.join(eol) + trail)

    function realRun(content: string) {
        const seen: { name: string; args: string[] }[] = []
        let threw = false
        let body: string | null = null
        try {
            body = CCardLib.decorator.parse(content, (name, args) => {
                seen.push({ name, args: [...args] })
                const r = decoratorResult(name, args)
                if (r === 'throws') throw MARK
                return r === 'ignored' ? false : undefined
            })
        } catch (e) {
            if (e !== MARK) throw e
            threw = true
        }
        return { seen, threw, body }
    }

    test('callback sequence, throw and body equal the real parser, and decoratorBody equals its return', () => {
        fc.assert(
            fc.property(contentArb, (content) => {
                const real = realRun(content)
                const mine = staticRun(content)
                expect(mine.executed.map((e) => ({ name: e.name, args: [...e.args] }))).toEqual(real.seen)
                expect(mine.threw).toBe(real.threw)
                if (!real.threw) expect(mine.body).toBe(real.body)
                expect(decoratorBody(content)).toBe(CCardLib.decorator.parse(content, () => undefined))
            }),
            { seed: 61, numRuns: 500 },
        )
    })
})
