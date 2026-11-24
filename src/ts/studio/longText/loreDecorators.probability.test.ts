import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { CCardLib } from '@risuai/ccardlib'
import { LORE_SCAN_DECORATORS } from '../../process/loreScanDecorators'
import { decoratorResult, parseDecoratorBlock } from '../../process/loreDecoratorTable'
import {
    clampProbability,
    probabilityClearKeeps,
    readProbabilityLine,
    writeProbabilityLine,
} from './loreDecorators'

const MARK = new Error('position without argument')

/** What the real ccardlib parser hands the scan for one content, with the table deciding each callback's return. */
function realView(content: string) {
    const seen: { name: string; args: string[]; result: string }[] = []
    let threw = false
    let body: string | null = null
    try {
        body = CCardLib.decorator.parse(content, (name, args) => {
            const result = decoratorResult(name, args)
            seen.push({ name, args: [...args], result })
            if (result === 'throws') throw MARK
            return result === 'ignored' ? false : undefined
        })
    } catch (e) {
        if (e !== MARK) throw e
        threw = true
    }
    return { seen, threw, body: threw ? null : body }
}

function withoutProbability(view: ReturnType<typeof realView>) {
    return { ...view, seen: view.seen.filter((s) => s.name !== 'probability') }
}

describe('probability write bytes (T33)', () => {
    test('Set without a block prepends the migration form in the content\'s own line break', () => {
        expect(writeProbabilityLine('body', 40)).toBe('@@probability 40\nbody')
        expect(writeProbabilityLine('', 40)).toBe('@@probability 40\n')
        expect(writeProbabilityLine('body\r\nmore', 40)).toBe('@@probability 40\r\nbody\r\nmore')
    })

    test('Set with a block inserts after its last line', () => {
        expect(writeProbabilityLine('@@depth 2\n@@@role user\nbody', 40)).toBe('@@depth 2\n@@@role user\n@@probability 40\nbody')
        expect(writeProbabilityLine('@@depth 2', 40)).toBe('@@depth 2\n@@probability 40')
        expect(writeProbabilityLine('@@depth 2\r\nbody', 40)).toBe('@@depth 2\r\n@@probability 40\r\nbody')
        expect(writeProbabilityLine('@@depth 1\r\n@@depth 2', 40)).toBe('@@depth 1\r\n@@depth 2\r\n@@probability 40')
    })

    test('a block followed by a blank line and a decorator still takes the new line inside the block', () => {
        expect(readProbabilityLine('@@depth 1\n\n@@probability 30\nbody')).toEqual({ kind: 'none' })
        expect(writeProbabilityLine('@@depth 1\n\n@@probability 30\nbody', 40)).toBe('@@depth 1\n@@probability 40\n\n@@probability 30\nbody')
    })

    test('Change replaces the trimmed span only', () => {
        expect(writeProbabilityLine('  @@probability 30  \r\nbody', 40)).toBe('  @@probability 40  \r\nbody')
        expect(writeProbabilityLine('@@probability 30', 40)).toBe('@@probability 40')
    })

    test('Change to the value already read returns the identical string', () => {
        const same = '@@probability 30\nbody'
        expect(writeProbabilityLine(same, 30)).toBe(same)
        const percent = '@@probability 30%\nbody'
        expect(writeProbabilityLine(percent, 30)).toBe(percent)
    })

    test('Clear removes the line and its own break and never keeps where nothing changes', () => {
        const cases: [string, string][] = [
            ['@@depth 1\n@@probability 30\nbody', '@@depth 1\nbody'],
            ['@@depth 1\r\n@@probability 30', '@@depth 1'],
            ['@@probability 30', ''],
            ['@@probability 30\n@@@end\nbody', '@@@end\nbody'],
            ['@@depth 1\r\n@@probability 30\r\nbody', '@@depth 1\r\nbody'],
        ]
        for (const [content, expected] of cases) {
            expect(writeProbabilityLine(content, null), content).toBe(expected)
            expect(probabilityClearKeeps(content), content).toBe(false)
        }
        expect(writeProbabilityLine('body', null)).toBe('body')
    })

    test('clamping rounds and bounds, and a non-finite value writes nothing', () => {
        expect(clampProbability(140)).toBe(100)
        expect(clampProbability(-3)).toBe(0)
        expect(clampProbability(33.6)).toBe(34)
        expect(clampProbability(NaN)).toBeNull()
        expect(clampProbability(Infinity)).toBeNull()
        expect(writeProbabilityLine('body', 140)).toBe('@@probability 100\nbody')
        expect(writeProbabilityLine('body', 33.6)).toBe('@@probability 34\nbody')
        expect(writeProbabilityLine('body', NaN)).toBe('body')
        expect(writeProbabilityLine('body', Infinity)).toBe('body')
    })

    test('every byte outside the line survives a 25 000 character two-byte body', () => {
        const body = '\u{1F600}éあ'.repeat(6250)
        const content = '@@depth 1\n' + body
        const set = writeProbabilityLine(content, 40)
        expect(set).toBe('@@depth 1\n@@probability 40\n' + body)
        expect(writeProbabilityLine(set, null)).toBe(content)
        expect(writeProbabilityLine(set, 70)).toBe('@@depth 1\n@@probability 70\n' + body)
    })
})

describe('Clear keeps the scan\'s view (T47, T47c to T47f)', () => {
    test('T47: a fallback chain keeps the line as 100', () => {
        const content = '@@keep_activate_after_match\n@@probability 50\n@@@depth 0\nbody'
        expect(probabilityClearKeeps(content)).toBe(true)
        expect(writeProbabilityLine(content, null)).toBe('@@keep_activate_after_match\n@@probability 100\n@@@depth 0\nbody')
    })

    test('T47: without a following fallback the line is removed', () => {
        const content = '@@keep_activate_after_match\n@@probability 50\nbody'
        expect(probabilityClearKeeps(content)).toBe(false)
        expect(writeProbabilityLine(content, null)).toBe('@@keep_activate_after_match\nbody')
    })

    test('T47c: a fallback that follows keeps the line even where removal would change nothing', () => {
        const content = '@@probability 50\n@@@depth 0\nbody'
        expect(probabilityClearKeeps(content)).toBe(true)
        expect(writeProbabilityLine(content, null)).toBe('@@probability 100\n@@@depth 0\nbody')
    })

    test('T47d: removal where the view cannot change', () => {
        expect(writeProbabilityLine('@@probability 30\n\nbody', null)).toBe('\nbody')
        expect(writeProbabilityLine('@@depth 1\n@@probability 30\n\n@@depth 5\nbody', null)).toBe('@@depth 1\n\n@@depth 5\nbody')
        expect(probabilityClearKeeps('@@probability 30\n\nbody')).toBe(false)
        expect(probabilityClearKeeps('@@depth 1\n@@probability 30\n\n@@depth 5\nbody')).toBe(false)
    })

    test('T47e: the only block line before a blank line and a decorator is kept', () => {
        const cases: [string, string][] = [
            ['@@probability 30\n\n@@depth 5\nbody', '@@probability 100\n\n@@depth 5\nbody'],
            ['@@probability 30\n\n@@position\nbody', '@@probability 100\n\n@@position\nbody'],
            ['\n@@probability 30\r\n  \r\n@@depth 5\r\nbody', '\n@@probability 100\r\n  \r\n@@depth 5\r\nbody'],
            ['@@probability 100\n\n@@depth 5\nbody', '@@probability 100\n\n@@depth 5\nbody'],
        ]
        for (const [content, expected] of cases) {
            expect(probabilityClearKeeps(content), content).toBe(true)
            expect(writeProbabilityLine(content, null), content).toBe(expected)
        }
    })

    test('T47f: only the body would change, and the real parser agrees', () => {
        const content = '@@probability 30\n\n@@@depth 5\nbody'
        expect(probabilityClearKeeps(content)).toBe(true)
        const result = writeProbabilityLine(content, null)
        expect(result).toBe('@@probability 100\n\n@@@depth 5\nbody')
        expect(realView(content).body).toBe('@@@depth 5\nbody')
        expect(realView(result).body).toBe('@@@depth 5\nbody')
    })
})

describe('write keeps the scan\'s view for any content (T33p)', () => {
    const argArb = fc.constantFrom('', ' 1', ' x', ' -1', ' user', ' bot', ' pt_x', ' nowhere', ' 50', ' a, b', ' system_prompt')
    const nameArb = fc.constantFrom(...LORE_SCAN_DECORATORS, 'position', 'depth', 'scan_depth', 'role', 'probabilty', 'x')
    const lineArb = fc.oneof(
        { weight: 4, arbitrary: fc.tuple(nameArb, argArb).map(([n, a]) => `@@${n}${a}`) },
        { weight: 3, arbitrary: fc.tuple(nameArb, argArb).map(([n, a]) => `@@@${n}${a}`) },
        { weight: 5, arbitrary: fc.constantFrom('@@probability 30', '@@probability 100', '@@probability 50%', '@@probability x', '@@probability', '  @@probability 7  ', '@@@probability 20') },
        { weight: 3, arbitrary: fc.constantFrom('@@depth 5', '@@position', '@@@depth 5', '@@@end', '@@end', '@@', '@@@role user') },
        { weight: 5, arbitrary: fc.constantFrom('', '  ', '\t', 'text', 'body @@depth 1') },
    )
    const contentArb = fc.tuple(
        fc.array(lineArb, { minLength: 0, maxLength: 7 }),
        fc.constantFrom('\n', '\r\n'),
        fc.constantFrom('', '\n', '  \n'),
        fc.constantFrom('', '\n', ' '),
    ).map(([lines, eol, lead, trail]) => lead + lines.join(eol) + trail)
    const valueArb = fc.oneof(
        fc.constant<number | null>(null),
        fc.integer({ min: -10, max: 110 }),
        fc.constantFrom(33.5, NaN, Infinity),
    )

    // The removal the module is checked against, written independently: the raw line and its own break, or the break before a last line.
    function removeRawLine(content: string, index: number): string {
        const lines = content.split('\n')
        if (index < lines.length - 1) return [...lines.slice(0, index), ...lines.slice(index + 1)].join('\n')
        if (index === 0) return ''
        const kept = lines.slice(0, index)
        kept[kept.length - 1] = kept[kept.length - 1].replace(/\r$/, '')
        return kept.join('\n')
    }

    test('bytes, engine view and the keep decision', () => {
        fc.assert(
            fc.property(contentArb, valueArb, (content, value) => {
                const read = readProbabilityLine(content)
                const result = writeProbabilityLine(content, value)
                const clamped = value === null ? null : clampProbability(value)

                // C3: nothing is written when the read is not editable or the write is a no-op.
                const editable = read.kind === 'none' || read.kind === 'one'
                if (value === null && read.kind !== 'one') expect(result).toBe(content)
                if (value !== null && (!editable || clamped === null || (read.kind === 'one' && read.value === clamped))) expect(result).toBe(content)

                // C1: one contiguous edit.
                let p = 0
                while (p < content.length && p < result.length && content[p] === result[p]) p++
                let s = 0
                while (s < content.length - p && s < result.length - p && content[content.length - 1 - s] === result[result.length - 1 - s]) s++
                const removed = content.slice(p, content.length - s)
                const added = result.slice(p, result.length - s)
                expect(removed.split('\n').length).toBeLessThanOrEqual(3)
                expect(added.split('\n').length).toBeLessThanOrEqual(3)

                // C1: the edited range holds only the new line, the kept text or the removal.
                const rawLines = content.split('\n')
                const nl = content.indexOf('\n')
                const ownEol = nl > 0 && content[nl - 1] === '\r' ? '\r\n' : '\n'
                const spanOf = (index: number) => {
                    const raw = rawLines[index]
                    const start = rawLines.slice(0, index).reduce((n, l) => n + l.length + 1, 0) + raw.length - raw.trimStart().length
                    return { start, end: start + raw.trim().length }
                }
                if (result !== content) {
                    if (read.kind === 'none' && value !== null && clamped !== null) {
                        const newLine = `@@probability ${clamped}`
                        const blockLines = parseDecoratorBlock(content).lines
                        if (blockLines.length === 0) {
                            expect(result).toBe(newLine + ownEol + content)
                        } else {
                            const lastIndex = blockLines[blockLines.length - 1].line
                            if (lastIndex === rawLines.length - 1) {
                                expect(result).toBe(content + ownEol + newLine)
                            } else {
                                const at = rawLines.slice(0, lastIndex + 1).reduce((n, l) => n + l.length + 1, 0)
                                expect(result).toBe(content.slice(0, at) + newLine + ownEol + content.slice(at))
                            }
                        }
                    } else if (read.kind === 'one') {
                        const span = spanOf(read.line)
                        if (value !== null) {
                            expect(result).toBe(content.slice(0, span.start) + `@@probability ${clamped}` + content.slice(span.end))
                        } else if (probabilityClearKeeps(content)) {
                            expect(result).toBe(content.slice(0, span.start) + '@@probability 100' + content.slice(span.end))
                        }
                    }
                }

                // C2: body, throw and the non-probability decorator sequence do not change.
                const before = withoutProbability(realView(content))
                const after = withoutProbability(realView(result))
                expect(after.threw).toBe(before.threw)
                expect(after.body).toBe(before.body)
                expect(after.seen).toEqual(before.seen)

                if (value !== null && clamped !== null && editable) {
                    expect(readProbabilityLine(result)).toMatchObject({ kind: 'one', value: clamped })
                }
                if (value === null && read.kind === 'one') {
                    const keeps = probabilityClearKeeps(content)
                    const after = readProbabilityLine(result)
                    if (keeps) expect(after).toMatchObject({ kind: 'one', value: 100 })
                    else expect(after).toEqual({ kind: 'none' })

                    // C2b: a plain removal is written exactly when it changes nothing and no fallback follows.
                    const removal = removeRawLine(content, read.line)
                    const removalView = withoutProbability(realView(removal))
                    const unchanged = removalView.threw === before.threw && removalView.body === before.body
                        && JSON.stringify(removalView.seen) === JSON.stringify(before.seen)
                    const lines = parseDecoratorBlock(content).lines
                    const at = lines.findIndex((l) => l.line === read.line)
                    const fallbackFollows = lines[at + 1]?.fallback === true
                    expect(keeps).toBe(!unchanged || fallbackFollows)
                    if (!keeps) expect(result).toBe(removal)
                }
            }),
            { seed: 33, numRuns: 2000 },
        )
    })
})
