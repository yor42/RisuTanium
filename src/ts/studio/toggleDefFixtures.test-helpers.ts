import fc from 'fast-check'
import type { LineId, Structure, StructureExemption } from './toggleDef'

// Fixtures, arbitraries and the test-side structure oracle for the toggle model. This file never imports the engine
// parser: the oracle takes it as a parameter, so only toggleDef.oracle.test.ts reads the real one. All data is synthetic.

/** Texts as an HTML textarea yields them (LF) and as a raw-string import carries them; `crlf` makes the second kind. */
export const crlf = (text: string): string => text.replace(/\n/g, '\r\n')

export type CorpusEntry = { name: string, text: string }

export const corpus: readonly CorpusEntry[] = [
    { name: 'empty', text: '' },
    { name: 'only newline', text: '\n' },
    { name: 'value rows', text: 'a=A\nb=B=text\nc=C=textarea\nd=D=select=x,y\ne=E=select\n' },
    { name: 'check rows and unknown type', text: 'a=A=weird\nb=B=check\nc=C=text=ignored' },
    { name: 'tails beyond four', text: 'a=A=select=x,y=tail=more\nb=B=group=1=2=3' },
    { name: 'blank and dropped', text: 'a=A\n\n  \n\t\nnoseparator\n=nokey\nnolabel=\n=\nb=B' },
    { name: 'caption', text: '=note=caption\nk=v=caption\n==caption\nx==caption\n' },
    { name: 'divider', text: '==divider\n=Section=divider\nk=v=divider' },
    { name: 'group closed by end', text: 'g=G=group\na=A\ng_end=G=groupEnd\nb=B' },
    { name: 'group closed by next group', text: 'g=G=group\na=A\nh=H=group\nb=B\nh_end=H=groupEnd' },
    { name: 'group open at end', text: 'g=G=group\na=A\nh=H=group\nb=B' },
    { name: 'stray end', text: 'a=A\nx_end=X=groupEnd\nb=B' },
    { name: 'empty-label group end', text: 'g=G=group\na=A\ng_end==groupEnd' },
    { name: 'empty group', text: 'g=G=group\ng_end=G=groupEnd' },
    { name: 'caption-only group', text: 'g=G=group\n=note=caption\n==divider\ng_end=G=groupEnd' },
    { name: 'empty group sharing a row key', text: 'k=G=group\nk_end=G=groupEnd\nk=K' },
    { name: 'CR suffix on type', text: 'k=v=text\r\nk2=v2=select\r\nk3=v3=select=a,b\r\n' },
    { name: 'CR on structural types', text: 'g=G=group\r\na=A\r\ng_end=G=groupEnd\r\nh=H=group\r\n' },
    { name: 'near-miss group types', text: 'g=G=Group\ng=G=group\r\ng=G=groupEnd\r\ng=G= group' },
    { name: 'BOM key next to plain key', text: '﻿k=A\nk=B' },
    { name: 'lookalike keys', text: 'Key=A\nkey=B\nk_e_y=C\nk e y=D\n k=E\nk =F\nk y=G' },
    { name: 'duplicate keys', text: 'k=A\nk=B\nk=C=text' },
    { name: 'few options', text: 'a=A=select=\nb=B=select=x\nc=C=select=x,y\nd=D=select=,' },
    { name: 'non-BMP', text: '😀=😀\nb=B' },
    { name: 'lone CR and mixed endings', text: 'a=A\r\nb=B\nc=C\rd=D\r\n\r\n' },
    { name: 'trailing blank lines', text: 'a=A\n\n\n' },
    { name: 'two groups, stray end first', text: 'a=A\nx_end=X=groupEnd\nb=B\ng=G=group\nc=C\ng_end=G=groupEnd' },
    { name: 'nested attempt', text: 'g1=G1=group\na=A\ng2=G2=group\nb=B\nend=E=groupEnd\nc=C' },
    { name: 'group then unclosed single', text: 'g1=G1=group\na=A' },
    { name: 'double end', text: 'g1=G1=group\na=A\ng_end=E=groupEnd\ng_end=E=groupEnd' },
]

// ---- the test-side structure oracle ----------------------------------------------------------------------------

export type ParseFn = (text: string) => readonly { type?: string }[]

/**
 * The structure of a line sequence, from the engine parser read one line at a time: a group replaces an open group, a
 * group end closes the open group (or is stray), and a group still open after the last line is open at the end.
 */
export function oracleStructure(parse: ParseFn, raws: readonly string[], ids: readonly LineId[]): Structure {
    const parentOf = new Map<LineId, LineId | null>()
    const endOf = new Map<LineId, LineId | null>()
    const stray = new Set<LineId>()
    let current: LineId | null = null
    raws.forEach((raw, position) => {
        const id = ids[position]
        const type = parse(raw)[0]?.type
        parentOf.set(id, null)
        if (type === 'group') {
            endOf.set(id, null)
            current = id
        } else if (type === 'groupEnd') {
            if (current === null) {
                stray.add(id)
            } else {
                endOf.set(current, id)
                current = null
            }
        } else if (current !== null) {
            parentOf.set(id, current)
        }
    })
    return { parentOf, endOf, stray, openAtEnd: current }
}

/** The legality rule written from its description, not from the model: every line present in both keeps its place. */
export function oracleSameStructure(before: Structure, after: Structure, exempt: StructureExemption): boolean {
    const problems: string[] = []
    for (const id of after.parentOf.keys()) {
        if (!before.parentOf.has(id)) {
            continue
        }
        if (id !== exempt.parentOf && before.parentOf.get(id) !== after.parentOf.get(id)) {
            problems.push(`parent of ${id}`)
        }
        if (before.stray.has(id) !== after.stray.has(id)) {
            problems.push(`stray ${id}`)
        }
        if (before.endOf.has(id) && after.endOf.has(id) && id !== exempt.endOf && before.endOf.get(id) !== after.endOf.get(id)) {
            problems.push(`end of ${id}`)
        }
    }
    const wasOpen = before.openAtEnd
    const survives = wasOpen !== null && after.parentOf.has(wasOpen) && wasOpen !== exempt.endOf
    if (survives ? after.openAtEnd !== wasOpen : after.openAtEnd !== null) {
        problems.push('open at end')
    }
    return problems.length === 0
}

// ---- arbitraries -----------------------------------------------------------------------------------------------

const wordArb = fc.constantFrom('a', 'b', 'k', 'x', 'K', 'g', 'h')
const typeSuffixArb = fc.constantFrom('', '=select=a,b', '=text', '=textarea', '=select', '=weird', '=select=', '=check', '=text=1', '=text\r')

const valueLineArb = fc.tuple(wordArb, wordArb, typeSuffixArb).map(([key, label, suffix]) => `${key}=${label}${suffix}`)
const groupLineArb = fc.tuple(wordArb, wordArb).map(([key, label]) => `${key}=${label}=group`)
const endLineArb = fc.tuple(wordArb, wordArb).map(([key, label]) => `${key}_end=${label}=groupEnd`)
const nearMissArb = fc.constantFrom('g=G=group\r', 'g=G=Group', 'g=G=groupEnd\r', 'g=G=group=x', 'g=G=groupEnd=y', 'g=G= group')
const otherLineArb = fc.constantFrom('', ' ', '\r', '=c=caption', 'k=v=caption', '==caption', '==divider', 'k=v=divider', 'junk', '=x', 'x=', 'a=b=c=d=e')

/** One toggle line, biased toward group structure: groups, ends (stray when unmatched), near misses and junk. */
export const lineArb: fc.Arbitrary<string> = fc.oneof(
    { weight: 5, arbitrary: valueLineArb },
    { weight: 3, arbitrary: groupLineArb },
    { weight: 3, arbitrary: endLineArb },
    { weight: 1, arbitrary: nearMissArb },
    { weight: 2, arbitrary: otherLineArb },
)

/** Whole texts built from `lineArb` with LF, CRLF or mixed endings and an optional trailing newline. */
export const structureTextArb: fc.Arbitrary<string> = fc
    .tuple(fc.array(fc.tuple(lineArb, fc.constantFrom('\n', '\n', '\r\n')), { maxLength: 10 }), fc.boolean())
    .map(([lines, trailing]) => lines.map(([line, eol], index) => (index === lines.length - 1 && !trailing ? line : line + eol)).join(''))

/** Texts of every shape: full unicode, a small separator alphabet, and structure-biased toggle texts. */
export const textArb: fc.Arbitrary<string> = fc.oneof(
    fc.string({ unit: 'binary', maxLength: 50 }),
    fc.string({ unit: fc.constantFrom('a', 'g', 'x', '=', '\n', '\r', ' ', ','), maxLength: 40 }),
    structureTextArb,
)
