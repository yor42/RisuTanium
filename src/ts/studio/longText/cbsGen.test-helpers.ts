// Generator and oracles for the checker's differential tests. A generated text is a sequence of
// atoms; each atom has a fresh id `n` and is followed by the separator `q<n>.`, so an id never
// reads as a prefix of another and neighbouring atoms never fuse.
//
// Oracles read the engine's output for the marker an atom leaves behind:
// - O1: `<B<n>.` is visible when the block opened by atom n is still open at the end of the input.
// - O2: `{{/K<n>.}}` is visible when the closer atom n closed nothing.
// - O3: `{{trim::U<n>.` is visible when the macro opened by atom n was never closed.
// - O3': `}}S<n>.` is visible when the stray atom n (`}}S<n>.` or the run `}}}S<n>.`) closed nothing.
// An early return is an output that is exactly `R<n>.`.
import fc from 'fast-check'

export type AtomKind = 'opener' | 'dynamic-opener' | 'text-opener' | 'closer' | 'open-macro' | 'legacy-open' | 'stray'
    | 'return' | 'dynamic-return' | 'dynamic' | 'dynamic-head' | 'role-tag' | 'legacy-close' | 'stray-run'

export type GenAtom = { kind: AtomKind; id: number; start: number; end: number }

// A chat variable the text reads, and the values a valuation may give it.
export type GenDynamic = { variable: string; values: readonly string[] }

export type GenText = { text: string; atoms: readonly GenAtom[]; dynamics: readonly GenDynamic[] }

export type AtomSpec = { kind: AtomKind; pick: number }

export type AtomSet = 'full' | 'visible'

// `$v` stands for the variable macro of the atom. The values keep `#if` and `#when` heads valid in
// both outcomes and make an `#each` header a literal array or plain text.
const FULL_HEADS: readonly { head: string; values?: readonly string[] }[] = [
    { head: '#if 1' }, { head: '#if 0' }, { head: '#if_pure 1' }, { head: '#if_pure 0' },
    { head: '#when 1' }, { head: '#when 0' }, { head: '#when::legacy::1' }, { head: '#when::legacy::0' },
    { head: '#when::keep::1' }, { head: '#pure' }, { head: '#puredisplay' }, { head: '#code' },
    { head: '#escape' }, { head: '#func f' },
    { head: '#each [1,2] as x' },
]

// Heads whose block (and so whose pure state) depends on a chat variable.
const DYNAMIC_HEADS: readonly { head: string; values: readonly string[] }[] = [
    { head: '#each $v as x', values: ['[1]', 'x'] },
    { head: '#if $v', values: ['1', '0'] },
    { head: '#when $v', values: ['1', '0'] },
    { head: '#when::legacy::$v', values: ['1', '0'] },
]

// Heads the engine leaves as text outside a pure body and opens a counted frame for inside one.
const TEXT_HEADS: readonly string[] = ['#foo', '#bar x', ':foo']

// Heads whose body the engine always evaluates and emits in place, so the visibility oracles
// (O2, O3, O3') hold for every valuation.
const VISIBLE_HEADS: readonly { head: string; values?: readonly string[] }[] = [
    { head: '#if 1' }, { head: '#when 1' }, { head: '#when::legacy::1' }, { head: '#when::keep::1' },
    { head: '#if_pure 1' },
]

const FULL_KINDS: readonly AtomKind[] = [
    'opener', 'opener', 'dynamic-opener', 'dynamic-opener', 'text-opener', 'text-opener', 'closer', 'closer',
    'open-macro', 'legacy-open', 'stray', 'stray', 'return', 'dynamic-return', 'dynamic', 'dynamic-head',
    'role-tag', 'legacy-close', 'stray-run',
]

const VISIBLE_KINDS: readonly AtomKind[] = [
    'opener', 'opener', 'text-opener', 'closer', 'closer', 'open-macro', 'legacy-open', 'stray', 'stray', 'dynamic',
    'dynamic-head', 'role-tag', 'legacy-close', 'stray-run',
]

export const atomSpecArb = (set: AtomSet): fc.Arbitrary<AtomSpec> => fc.record({
    kind: fc.constantFrom(...(set === 'full' ? FULL_KINDS : VISIBLE_KINDS)),
    pick: fc.nat(1000),
})

export const atomSpecsArb = (set: AtomSet, maxLength = 7): fc.Arbitrary<AtomSpec[]> =>
    fc.array(atomSpecArb(set), { minLength: 1, maxLength })

export function buildText(specs: readonly AtomSpec[], set: AtomSet): GenText {
    const heads = set === 'full' ? FULL_HEADS : VISIBLE_HEADS
    const atoms: GenAtom[] = []
    const dynamics: GenDynamic[] = []
    let text = ''
    specs.forEach((spec, id) => {
        const variable = `d${id}`
        const variableMacro = `{{getvar::${variable}}}`
        let piece: string
        switch(spec.kind){
            case 'opener':{
                piece = `{{${heads[spec.pick % heads.length].head}}}B${id}.`
                break
            }
            case 'dynamic-opener':{
                const entry = DYNAMIC_HEADS[spec.pick % DYNAMIC_HEADS.length]
                dynamics.push({ variable, values: entry.values })
                piece = `{{${entry.head.replace('$v', variableMacro)}}}B${id}.`
                break
            }
            case 'text-opener':
                piece = `{{${TEXT_HEADS[spec.pick % TEXT_HEADS.length]}}}B${id}.`
                break
            case 'closer':
                piece = `{{/K${id}.}}`
                break
            case 'open-macro':
                piece = `{{trim::U${id}.`
                break
            case 'legacy-open':
                piece = `{#trim::U${id}.`
                break
            case 'stray':
                piece = `}}S${id}.`
                break
            case 'stray-run':
                piece = `}}}S${id}.`
                break
            case 'role-tag':
                piece = '<user>'
                break
            case 'legacy-close':
                piece = '#}'
                break
            case 'return':
                piece = `{{return::R${id}.}}`
                break
            case 'dynamic-return':
                dynamics.push({ variable, values: ['urn', 'x'] })
                piece = `{{ret${variableMacro}::R${id}.}}`
                break
            case 'dynamic-head':
                dynamics.push({ variable, values: ['x', 'y'] })
                piece = `{{${variableMacro}}}`
                break
            case 'dynamic':
                dynamics.push({ variable, values: ['a', 'b'] })
                piece = variableMacro
                break
        }
        atoms.push({ kind: spec.kind, id, start: text.length, end: text.length + piece.length })
        text += `${piece}q${id}.`
    })
    return { text, atoms, dynamics }
}

export type OracleKind = 'O1' | 'O2' | 'O3' | 'O3p'

const MARKER: Record<OracleKind, (id: number) => string> = {
    O1: (id) => `<B${id}.`,
    O2: (id) => `{{/K${id}.}}`,
    O3: (id) => `{{trim::U${id}.`,
    O3p: (id) => `}}S${id}.`,
}

// The atom kinds an oracle ranges over.
const ORACLE_ATOMS: Record<OracleKind, readonly AtomKind[]> = {
    O1: ['opener', 'dynamic-opener', 'text-opener'],
    O2: ['closer'],
    O3: ['open-macro', 'legacy-open'],
    O3p: ['stray', 'stray-run'],
}

export function oracleIds(output: string, kind: OracleKind, gen: GenText): Set<number> {
    const ids = new Set<number>()
    for(const atom of gen.atoms){
        if(ORACLE_ATOMS[kind].includes(atom.kind) && output.includes(MARKER[kind](atom.id))){
            ids.add(atom.id)
        }
    }
    return ids
}

// The id of an early return, or null when the output is not exactly a return value.
export function earlyReturnId(output: string): number | null {
    const m = /^R(\d+)\.$/.exec(output)
    return m ? Number(m[1]) : null
}

// All-first, all-last and `random` extra valuations (picks index into each variable's values).
export function valuations(dynamics: readonly GenDynamic[], picks: readonly number[], random = 4): Record<string, string>[] {
    const result: Record<string, string>[] = []
    result.push(Object.fromEntries(dynamics.map((d) => [d.variable, d.values[0]])))
    result.push(Object.fromEntries(dynamics.map((d) => [d.variable, d.values[d.values.length - 1]])))
    for(let r = 0; r < random; r++){
        result.push(Object.fromEntries(dynamics.map((d, k) => [
            d.variable,
            d.values[picks[(r * dynamics.length + k) % Math.max(picks.length, 1)] % d.values.length],
        ])))
    }
    return result
}
