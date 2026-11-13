// @vitest-environment node
// Ancestor inset of the pack linter (DD-260), round-4 reader: the generated spelling matrix (T-1), the side of every single-slot row (T-1p), the family coverage guard (T-2), the safe-context admissions on chain parts (T-2s) and the subject forms (T-5).
// A box is built in px per side, so the real inset is known by construction, and is written the way a pack author writes it: every reader row at every arity, in every placement, with and without an importance suffix.
// The expectation is computed here from the construction (never from geometry.ts) for every judged chain that contains the box's parts, floors included.
import { describe, expect, it } from 'vitest'
import { CHAT_CHAINS, CHAT_LIVE_CHAINS, COMPOUND } from './engine'
import { FAMILY_CLASSES, READER_ROWS, familyClass, type FamilyClass, type GeometryChain, type InsetGrammar, type InsetKind, type InsetSlot, type ReaderRow } from './geometry'
import { lintAreaPack, type ThemeArea } from './index'
import { HOME_CHAINS } from './registries/home'
import { SETTINGS_CHAINS } from './registries/settings'
import { STUDIO_CHAINS } from './registries/studio'
import { PROP_ALLOW, isAllowedProperty } from './scope'

const BUDGET = 120
const VIEW = 360

type Reads = Partial<Record<InsetSlot, number>>
interface Piece { kind: InsetKind; reads: Reads }
interface Val { text: string; px: number; root?: string }
type Pair = readonly [Val, Val]
interface Vals { length: Pair; margin: Pair; width: Pair; style: Pair; line: Pair }
interface Built { decls: [string, string][]; pieces: Piece[]; roots: string[] }

// ---- values: each carries the px it measures to, so a box is known by construction
const v = (text: string, px: number, root?: string): Val => ({ text, px, root })
const LENGTH_POOL = {
    px: [v('18px', 18), v('22px', 22), v('30px', 30)],
    plus: [v('+14px', 14), v('+26px', 26)],
    decimal: [v('12.5px', 12.5), v('20.25px', 20.25)],
    rem: [v('1rem', 16), v('1.5rem', 24)],
    pct: [v('5%', 18), v('10%', 36)],
    zero: [v('0', 0)],
    pack: [v('var(--pack-a)', 20, '--pack-a:20px'), v('var(--pack-b)', 28, '--pack-b:28px')],
    app: [v('var(--space-8)', 10), v('var(--space-16)', 24)],
    auto: [v('auto', 0)],
} as const
type LengthKind = keyof typeof LENGTH_POOL
const PADDING_KINDS: readonly LengthKind[] = ['px', 'plus', 'decimal', 'rem', 'pct', 'zero', 'pack', 'app']
// the value rules refuse a percentage margin (MC-1549, MC-1555), so margins are written in lengths, tokens and auto
const MARGIN_KINDS: readonly LengthKind[] = ['px', 'plus', 'decimal', 'rem', 'zero', 'pack', 'app', 'auto']
const WIDTH_POOL = {
    px: [v('4px', 4), v('6px', 6), v('8px', 8)],
    plus: [v('+5px', 5)],
    decimal: [v('4.5px', 4.5)],
    rem: [v('0.5rem', 8)],
    thick: [v('thick', 5)],
    medium: [v('medium', 3)],
    thin: [v('thin', 1)],
    zero: [v('0', 0)],
    pack: [v('var(--pack-c)', 6, '--pack-c:6px'), v('var(--pack-d)', 9, '--pack-d:9px')],
} as const
type WidthKind = keyof typeof WIDTH_POOL
const WIDTH_KINDS = Object.keys(WIDTH_POOL) as WidthKind[]
const STYLE_POOL: readonly Val[] = [...['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'].map((s) => v(s, 3)), v('none', 0), v('hidden', 0)]
// a border line shorthand in every order a pack writes it: the stated width counts, else a visible style counts 3 px, else 0
const LINE_POOL: readonly Val[] = [v('5px solid #000000', 5), v('solid 5px #000000', 5), v('#000000 solid 5px', 5), v('6px dashed red', 6), v('solid', 3), v('solid red', 3), v('dotted #abc', 3), v('none', 0), v('hidden', 0), v('0 solid', 0),
    v('thick solid', 5), v('medium double', 3), v('thin solid #000000', 1), v('+7px double #000000', 7), v('1rem solid #000000', 16), v('9.5px solid rgb(0 0 0)', 9.5), v('7px ridge var(--pack-e)', 7, '--pack-e:#000000'), v('0 none', 0)]
const tiny = (text: string, px: number): Pair => [v(text, px), v(text, px)]
const TINY: Vals = { length: tiny('1px', 1), margin: tiny('1px', 1), width: tiny('1px', 1), style: tiny('solid', 3), line: tiny('1px solid #000000', 1) }
// the vertical values of a four-value box: a reader that picks the wrong value of the list reads these
const DECOYS = { length: ['40px', '3px'], width: ['12px', '2px'], style: ['dashed', 'none'] } as const

const pickKind = <K extends string, T>(kinds: readonly K[], pool: Record<K, readonly T[]>, i: number, shift: number): T => {
    const entries = pool[kinds[(i + shift) % kinds.length]]
    return entries[Math.floor(i / kinds.length + shift) % entries.length]
}
const valsAt = (i: number): Vals => ({
    length: [pickKind(PADDING_KINDS, LENGTH_POOL, i, 0), pickKind(PADDING_KINDS, LENGTH_POOL, i, 3)],
    margin: [pickKind(MARGIN_KINDS, LENGTH_POOL, i, 0), pickKind(MARGIN_KINDS, LENGTH_POOL, i, 4)],
    width: [pickKind(WIDTH_KINDS, WIDTH_POOL, i, 0), pickKind(WIDTH_KINDS, WIDTH_POOL, i, 4)],
    style: [STYLE_POOL[i % STYLE_POOL.length], STYLE_POOL[(i + 3) % STYLE_POOL.length]],
    line: [LINE_POOL[i % LINE_POOL.length], LINE_POOL[(i + 5) % LINE_POOL.length]],
})
const rootsOf = (...vals: Val[]): string[] => [...new Set(vals.flatMap((x) => (x.root ? [x.root] : [])))]

// ---- the spellings of one reader row: arity decides how many values are written
const formsOf = (row: ReaderRow): number[] => (row.arity === 'box' ? [1, 2, 3, 4] : row.arity === 'pair' ? [1, 2] : [1])
const pairOf = (row: ReaderRow, vals: Vals): Pair => (row.kind === 'margin' ? vals.margin : row.grammar === 'length' ? vals.length : vals[row.grammar])
const decoysOf = (row: ReaderRow): readonly [string, string] => DECOYS[row.grammar === 'line' ? 'width' : row.grammar]
const rowBuilt = (row: ReaderRow, n: number, vals: Vals): Built => {
    const [a, b] = pairOf(row, vals)
    const [dA, dB] = decoysOf(row)
    let value: string
    const reads: Reads = {}
    if (row.arity === 'box') {
        value = n === 4 ? `${dA} ${b.text} ${dB} ${a.text}` : n === 3 ? `${dA} ${a.text} ${dB}` : n === 2 ? `${dA} ${a.text}` : a.text
        reads.L = a.px
        reads.R = n === 4 ? b.px : a.px
    } else if (row.arity === 'pair') {
        value = n === 2 ? `${a.text} ${b.text}` : a.text
        reads.S = a.px
        reads.E = n === 2 ? b.px : a.px
    } else {
        const first = row.slots.length > 1 || row.slots[0] === 'L' || row.slots[0] === 'S'
        const x = first ? a : b
        value = x.text
        for (const slot of row.slots) reads[slot] = x.px
    }
    return { decls: [[row.prop, value]], pieces: [{ kind: row.kind, reads }], roots: rootsOf(a, b) }
}

// ---- the splits: one box written in several declarations (shorthand and longhand, physical and logical, one side only)
interface Spec { id: string; build: (vals: Vals) => Built }
const SPLITS: Spec[] = []
for (const kind of ['padding', 'margin'] as const) {
    const side = (vals: Vals): Pair => (kind === 'margin' ? vals.margin : vals.length)
    SPLITS.push(
        { id: `${kind} shorthand and left longhand`, build: (vals) => { const [a, b] = side(vals); return { decls: [[kind, `${DECOYS.length[0]} ${b.text} ${DECOYS.length[1]} 0`], [`${kind}-left`, a.text]], pieces: [{ kind, reads: { R: b.px, L: 0 } }, { kind, reads: { L: a.px } }], roots: rootsOf(a, b) } } },
        { id: `${kind} left and inline-end`, build: (vals) => { const [a, b] = side(vals); return { decls: [[`${kind}-left`, a.text], [`${kind}-inline-end`, b.text]], pieces: [{ kind, reads: { L: a.px } }, { kind, reads: { E: b.px } }], roots: rootsOf(a, b) } } },
        { id: `${kind} inline-start and right`, build: (vals) => { const [a, b] = side(vals); return { decls: [[`${kind}-inline-start`, a.text], [`${kind}-right`, b.text]], pieces: [{ kind, reads: { S: a.px } }, { kind, reads: { R: b.px } }], roots: rootsOf(a, b) } } },
        { id: `${kind} inline pair and left`, build: (vals) => { const [a, b] = side(vals); return { decls: [[`${kind}-inline`, `${a.text} ${b.text}`], [`${kind}-left`, b.text]], pieces: [{ kind, reads: { S: a.px, E: b.px } }, { kind, reads: { L: b.px } }], roots: rootsOf(a, b) } } },
        { id: `${kind} left only`, build: (vals) => { const [a] = side(vals); return { decls: [[`${kind}-left`, a.text]], pieces: [{ kind, reads: { L: a.px } }], roots: rootsOf(a) } } },
        { id: `${kind} right only`, build: (vals) => { const [, b] = side(vals); return { decls: [[`${kind}-right`, b.text]], pieces: [{ kind, reads: { R: b.px } }], roots: rootsOf(b) } } },
    )
}
SPLITS.push(
    { id: 'border line and inline-end width', build: (vals) => { const [la] = vals.line; const [, wb] = vals.width; return { decls: [['border-left', la.text], ['border-inline-end-width', wb.text]], pieces: [{ kind: 'border', reads: { L: la.px } }, { kind: 'border', reads: { E: wb.px } }], roots: rootsOf(la, wb) } } },
    { id: 'border width shorthand and left line', build: (vals) => { const [la] = vals.line; const [, wb] = vals.width; return { decls: [['border-width', `${DECOYS.width[0]} ${wb.text} ${DECOYS.width[1]} 0`], ['border-left', la.text]], pieces: [{ kind: 'border', reads: { R: wb.px, L: 0 } }, { kind: 'border', reads: { L: la.px } }], roots: rootsOf(la, wb) } } },
    { id: 'border style shorthand and left width', build: (vals) => { const [sa, sb] = vals.style; const [wa] = vals.width; return { decls: [['border-style', `${DECOYS.style[0]} ${sb.text} ${DECOYS.style[1]} ${sa.text}`], ['border-left-width', wa.text]], pieces: [{ kind: 'border', reads: { R: sb.px, L: sa.px } }, { kind: 'border', reads: { L: wa.px } }], roots: rootsOf(wa) } } },
    { id: 'border right line only', build: (vals) => { const [, lb] = vals.line; return { decls: [['border-right', lb.text]], pieces: [{ kind: 'border', reads: { R: lb.px } }], roots: rootsOf(lb) } } },
    { id: 'border inline-start style and right width', build: (vals) => { const [sa] = vals.style; const [, wb] = vals.width; return { decls: [['border-inline-start-style', sa.text], ['border-right-width', wb.text]], pieces: [{ kind: 'border', reads: { S: sa.px } }, { kind: 'border', reads: { R: wb.px } }], roots: rootsOf(wb) } } },
)
const ROW_SPECS: Spec[] = READER_ROWS.flatMap((row) => formsOf(row).map((n) => ({ id: `${row.prop} x${n}`, build: (vals: Vals) => rowBuilt(row, n, vals) })))

// ---- placements
type Placement = 'one block' | 'a block per declaration' | '@media' | 'a state' | 'a root attribute' | 'a selector list' | 'a selector list, own first' | 'one list, two chain parts' | 'last declaration in @media' | 'safe context'
const PLACEMENTS: readonly Placement[] = ['one block', 'a block per declaration', '@media', 'a state', 'a root attribute', 'a selector list', 'a selector list, own first', 'one list, two chain parts', 'last declaration in @media', 'safe context']
const SUFFIXES = ['', '!important', ' !important', ' !IMPORTANT'] as const
// `second` is the family's other chain part: the placement that names both parts of a chain in one selector list puts the declarations on both.
const place = (placement: Placement, part: string, peer: string, second: string, decls: string[]): string => {
    const s = `[data-part="${part}"]`
    switch (placement) {
        case 'one block': return `${s}{${decls.join(';')}}`
        case 'a block per declaration': return decls.map((d) => `${s}{${d}}`).join('')
        case '@media': return `@media (min-width:1px){${s}{${decls.join(';')}}}`
        case 'a state': return `${s}:hover{${decls.join(';')}}`
        case 'a root attribute': return `html[data-layout="phone"] ${s}{${decls.join(';')}}`
        case 'a selector list': return `[data-part="${peer}"],${s}{${decls.join(';')}}`
        case 'a selector list, own first': return `${s},[data-part="${peer}"]{${decls.join(';')}}`
        case 'one list, two chain parts': return `${s},[data-part="${second}"]{${decls.join(';')}}`
        case 'last declaration in @media': return decls.length > 1 ? `${s}{${decls.slice(0, -1).join(';')}}@media (min-width:1px){${s}{${decls[decls.length - 1]}}}` : `@media (min-width:1px){${s}{${decls.join(';')}}}`
        case 'safe context': return `[data-role="user"] ${s}{${decls.join(';')}}`
    }
}

// ---- the judged chains of a family and the construction model
interface Family { id: string; area: ThemeArea; a: string; b: string; peer: string; engine: readonly GeometryChain[]; live: readonly GeometryChain[] }
const FAMILIES: readonly Family[] = [
    { id: 'sheet chain', area: 'chat', a: 'chat-sheet', b: 'chat-sheet-body', peer: 'chat-send', engine: CHAT_CHAINS, live: CHAT_LIVE_CHAINS },
    // the box on the part that has a page padding of its own: each side is floored by it
    { id: 'sheet chain, floored body', area: 'chat', a: 'chat-sheet-body', b: 'chat-sheet', peer: 'chat-send', engine: CHAT_CHAINS, live: CHAT_LIVE_CHAINS },
    { id: 'transcript chain', area: 'chat', a: 'chat-message', b: 'chat-message-stage', peer: 'chat-send', engine: CHAT_CHAINS, live: CHAT_LIVE_CHAINS },
    { id: 'failed-card chain', area: 'chat', a: 'chat-shell', b: 'chat-composer-host', peer: 'chat-send', engine: CHAT_CHAINS, live: CHAT_LIVE_CHAINS },
    // Home runs the reader for named subjects as reference-lint parity: these rows test reader mechanics on a named subject, not a Home claim (R20).
    { id: 'home library chain (reader mechanics on a named subject, not a Home claim)', area: 'home', a: 'home-main', b: 'home-library', peer: 'home-empty-hero', engine: [...CHAT_CHAINS, ...HOME_CHAINS], live: [] },
]
const KINDS: readonly InsetKind[] = ['padding', 'border', 'margin']
// Left plus right of one box kind of one part, in the larger of the two reading directions (start is the left in a left-to-right page and the right in a right-to-left one), each side not below the page's own value.
const acrossOf = (pieces: readonly Piece[], floor: number): number => {
    const most = (slot: InsetSlot): number => Math.max(0, ...pieces.map((p) => p.reads[slot] ?? 0))
    const ltr = Math.max(most('L'), most('S'), floor) + Math.max(most('R'), most('E'), floor)
    const rtl = Math.max(most('L'), most('E'), floor) + Math.max(most('R'), most('S'), floor)
    return Math.max(ltr, rtl)
}
const chainSum = (chain: GeometryChain, boxes: ReadonlyMap<string, readonly Piece[]>): number => {
    let sum = 0
    for (const part of chain.parts) for (const kind of KINDS) sum += acrossOf((boxes.get(part) ?? []).filter((p) => p.kind === kind), kind === 'padding' ? (chain.defaults?.[part] ?? 0) / 2 : 0)
    return sum
}
const messageOf = (chain: GeometryChain, sum: number): string => `ancestor padding along ${chain.name} sums to ${Math.round(sum)} px of ${VIEW}`

interface Case { label: string; family: Family; placement: Placement; css: string; boxes: Map<string, Piece[]> }
// The spelled box sits on the family's outer part; the inner part carries margins that bring the critical chain to exactly `target`, so one px decides the verdict.
const assemble = (family: Family, spec: Spec, vals: Vals, placement: Placement, suffix: string, target: number | null): Case | { skipped: string } => {
    const built = spec.build(vals)
    const boxes = new Map<string, Piece[]>([[family.a, [...built.pieces]]])
    // one list that names both chain parts puts the declarations on both
    const both = placement === 'one list, two chain parts'
    if (both) boxes.set(family.b, [...built.pieces])
    let css = ''
    const roots = built.roots
    css += place(placement, family.a, family.peer, family.b, built.decls.map(([prop, value]) => `${prop}:${value}${suffix}`))
    if (target !== null) {
        const critical = [...family.engine, ...family.live].find((c) => c.parts.includes(family.b))!
        const base = chainSum(critical, boxes)
        const need = target - base
        if (need < 0 || need > 128) return { skipped: `the box leaves ${need} px for the filler` }
        const left = Math.floor(need / 2), right = need - left
        // the filler takes the kind the spelled box does not use, so that on the second part it adds to the box instead of merging with it
        const fillKind: InsetKind = both && !built.pieces.some((p) => p.kind === 'border') ? 'border' : 'margin'
        boxes.set(family.b, [...(boxes.get(family.b) ?? []), { kind: fillKind, reads: { L: left, R: right } }])
        css += fillKind === 'margin' ? `[data-part="${family.b}"]{margin-left:${left}px;margin-right:${right}px}` : `[data-part="${family.b}"]{border-left:${left}px solid #000000;border-right:${right}px solid #000000}`
    }
    if (roots.length) css = `:root{${roots.join(';')}}${css}`
    return { label: `${family.id} | ${spec.id} | ${placement} | suffix "${suffix}"`, family, placement, css, boxes }
}

const GEOMETRY_ERROR = /ancestor padding along|cannot be measured/
interface Verdict { ok: boolean; whys: string[] }
const judge = (family: Family, css: string): Verdict => {
    const result = lintAreaPack(family.area, css, 'probe')
    return { ok: result.ok, whys: result.errors.map((e) => e.why) }
}
// what the construction says: the engine chains that are over budget; when none is, the live chains
const expectedOver = (c: Case): { chain: GeometryChain; sum: number }[] => {
    const over = (chains: readonly GeometryChain[]): { chain: GeometryChain; sum: number }[] => chains.map((chain) => ({ chain, sum: chainSum(chain, c.boxes) })).filter((x) => x.sum > (x.chain.budget ?? BUDGET))
    const engine = over(c.family.engine)
    return engine.length ? engine : over(c.family.live)
}
const judgedChains = (family: Family): readonly GeometryChain[] => [...family.engine, ...family.live]

// ---- the matrix: every reader row at every arity and every split, in every placement, with every importance suffix on one block
interface Plan { family: Family; spec: Spec; placement: Placement; suffix: string; index: number }
const plans: Plan[] = []
{
    let index = 0
    for (const family of FAMILIES) {
        for (const spec of [...ROW_SPECS, ...SPLITS]) {
            for (const placement of PLACEMENTS) {
                if (placement === 'last declaration in @media' && !SPLITS.includes(spec)) continue
                plans.push({ family, spec, placement, suffix: SUFFIXES[index % SUFFIXES.length], index })
                index++
            }
            for (const suffix of SUFFIXES) plans.push({ family, spec, placement: 'one block', suffix, index: index++ })
        }
    }
}
// The first picks of values for which the box fits the critical chain's budget with the family's floors; a big box on a chain with large floors takes the next picks.
const fit = (plan: Plan, target: number): Case | null => {
    for (let shift = 0; shift < 64; shift++) {
        const made = assemble(plan.family, plan.spec, valsAt(plan.index + shift), plan.placement, plan.suffix, target)
        if (!('skipped' in made)) return made
    }
    return null
}
// the reason a spelling is refused when every box is 1 px, without the property, the value and the numbers
const stem = (why: string): string => why.replace(/^[a-z-]+:\s*/, '').replace(/\s*\(.*$/, '')

interface Outcome { overRefused: string[]; withinAccepted: string[]; sums: string[]; unfit: string[]; table: Record<string, number>; cases: number }
let outcome: Outcome | null = null
const runMatrix = (): Outcome => {
    if (outcome) return outcome
    const result: Outcome = { overRefused: [], withinAccepted: [], sums: [], unfit: [], table: {}, cases: 0 }
    const count = (key: string): void => { result.table[key] = (result.table[key] ?? 0) + 1 }
    for (const plan of plans) {
        // a spelling the engine refuses for its own reasons when every box is 1 px cannot carry a geometry expectation; it is counted by reason and placement
        const tinyCase = assemble(plan.family, plan.spec, TINY, plan.placement, plan.suffix, null)
        if ('skipped' in tinyCase) throw new Error(tinyCase.skipped)
        const pre = judge(plan.family, tinyCase.css)
        if (!pre.ok && !pre.whys.some((w) => GEOMETRY_ERROR.test(w))) { count(`excluded: ${stem(pre.whys[0])} | ${plan.placement}`); continue }
        count(`included | ${plan.placement}`)
        for (const target of [BUDGET, BUDGET + 1]) {
            const made = fit(plan, target)
            if (!made) { result.unfit.push(`${plan.family.id} | ${plan.spec.id} | ${plan.placement}`); continue }
            result.cases++
            const got = judge(plan.family, made.css)
            const over = expectedOver(made)
            const context = `${made.css.slice(0, 220)} => ${got.whys.join(' / ').slice(0, 260)}`
            if (!over.length) {
                if (!got.ok) result.withinAccepted.push(`${made.label} (${target} px): ${context}`)
                continue
            }
            if (got.ok) result.overRefused.push(`${made.label} (${target} px): accepted :: ${made.css.slice(0, 220)}`)
            // a message carries the constructed sum, and a chain within budget carries none (a live chain is judged only when no other pass refuses)
            for (const chain of judgedChains(made.family)) {
                const expected = over.find((o) => o.chain === chain)
                const named = got.whys.filter((w) => w.includes(`ancestor padding along ${chain.name} sums to `))
                if (expected && !named.some((w) => w.includes(messageOf(chain, expected.sum)))) result.sums.push(`${made.label} (${target} px): no "${messageOf(chain, expected.sum)}" :: ${context}`)
                if (!expected && named.length) result.sums.push(`${made.label} (${target} px): "${chain.name}" is within budget but named :: ${context}`)
            }
        }
    }
    outcome = result
    return result
}

describe('T-1: the generated spelling matrix', () => {
    it('every box over budget on a judged chain is refused, in every spelling', () => {
        const run = runMatrix()
        expect(run.unfit).toEqual([])
        expect(run.overRefused.slice(0, 8)).toEqual([])
    }, 60_000)
    it('REPRO (T-3r): every box within budget on every judged chain is accepted, in every spelling', () => {
        expect(runMatrix().withinAccepted.slice(0, 8)).toEqual([])
    }, 60_000)
    it('a refusal names each over-budget chain with its constructed sum and no other chain', () => {
        expect(runMatrix().sums.slice(0, 8)).toEqual([])
    }, 60_000)
    // The exclusions are counted, not only printed: a row whose spelling falls out of the matrix, or an engine change that refuses more spellings first, shrinks the coverage and must be seen here.
    // The 13 excluded spellings per family (five families) are the nine logical border rows (border-inline, -inline-start and -inline-end, each bare, -width and -style) and the two splits that use one: the engine refuses them for a plain
    // chain-part selector, and the safe-context placement is the only form that reaches the reader.
    const ALLOWLIST = 'is not on the declaration allowlist for a surface that can contain or be a protected element'
    it('the cases and the exclusions are the recorded ones', () => {
        const run = runMatrix()
        expect({ boxes: run.cases, ...run.table }).toEqual({
            boxes: 6780,
            'included | one block': 1250, 'included | a block per declaration': 250, 'included | @media': 250, 'included | a state': 250, 'included | a root attribute': 250, 'included | a selector list': 250, 'included | a selector list, own first': 250, 'included | one list, two chain parts': 250, 'included | last declaration in @media': 75, 'included | safe context': 315,
            [`excluded: ${ALLOWLIST} | one block`]: 325, [`excluded: ${ALLOWLIST} | a block per declaration`]: 65, [`excluded: ${ALLOWLIST} | @media`]: 65, [`excluded: ${ALLOWLIST} | a state`]: 65, [`excluded: ${ALLOWLIST} | a root attribute`]: 65,
            [`excluded: ${ALLOWLIST} | a selector list`]: 65, [`excluded: ${ALLOWLIST} | a selector list, own first`]: 65, [`excluded: ${ALLOWLIST} | one list, two chain parts`]: 65,[`excluded: ${ALLOWLIST} | last declaration in @media`]: 10,
        })
    }, 60_000)
})

// ---- the spellings the reader cannot measure: the explicit short list. Each is refused with "cannot be measured" on every row it applies to, in every placement and family, whatever the size of the rest of the box.
interface Unmeasurable { label: string; applies: (row: ReaderRow) => boolean; value: (row: ReaderRow) => string }
const UNMEASURABLE: readonly Unmeasurable[] = [
    { label: 'inherit', applies: () => true, value: () => 'inherit' },
    { label: 'auto on padding', applies: (row) => row.kind === 'padding', value: () => 'auto' },
    { label: 'revert on padding and margin', applies: (row) => row.kind !== 'border', value: () => 'revert' },
    { label: 'an unknown word', applies: (row) => row.grammar !== 'line', value: () => 'wibble' },
    { label: 'five values', applies: (row) => row.arity === 'box', value: (row) => (row.grammar === 'style' ? 'solid solid solid solid solid' : '1px 2px 3px 4px 5px') },
    { label: 'a percentage on a border width or line', applies: (row) => row.kind === 'border' && row.grammar !== 'style', value: (row) => (row.grammar === 'line' ? '5% solid #000000' : '5%') },
    { label: 'a variable with no value', applies: () => true, value: () => 'var(--nope)' },
]
describe('T-1: what the reader cannot measure is refused, never read as 0', () => {
    it('refuses every short-list spelling in every placement and family', () => {
        const misses: string[] = []
        let checked = 0
        READER_ROWS.forEach((row, rowIndex) => PLACEMENTS.forEach((placement, placementIndex) => {
            const family = FAMILIES[(rowIndex + placementIndex) % FAMILIES.length]
            for (const entry of UNMEASURABLE.filter((u) => u.applies(row))) {
                checked++
                const css = place(placement === 'last declaration in @media' ? '@media' : placement, family.a, family.peer, family.b, [`${row.prop}:${entry.value(row)}`])
                const got = judge(family, css)
                if (got.ok || !got.whys.some((w) => w.startsWith(`${row.prop}: `) && /cannot be measured/.test(w))) misses.push(`${family.id} | ${entry.label} | ${placement} | ${css}`)
            }
        }))
        expect(misses.slice(0, 8)).toEqual([])
        expect(checked).toBe(1180)
    })
})

// ---- T-2: every padding, margin and border name the property allow-list admits has exactly one class
// The grid below generates the names; a name outside it is not reached by the lists, but the family rule still refuses it at run time (a family name with no class is REFUSED), so the failure is closed. The allow-list sources that can admit such a name are pinned as well.
const WORDS = ['top', 'right', 'bottom', 'left', 'block', 'inline', 'start', 'end']
const FAMILY_HEADS = ['padding', 'margin', 'border']
const FAMILY_TAILS = ['', '-width', '-style', '-color', '-radius', '-collapse', '-spacing']
const generatedNames = (prefix: string): string[] => FAMILY_HEADS.flatMap((head) => ['', ...WORDS.map((a) => `-${a}`), ...WORDS.flatMap((a) => WORDS.map((b) => `-${a}-${b}`))].flatMap((middle) => FAMILY_TAILS.map((tail) => `${prefix}${head}${middle}${tail}`)))
const CLASS_KEYS: readonly FamilyClass[] = ['READ', 'BLOCK', 'PAINT', 'NO-EFFECT', 'REFUSED']
const ALLOWED_FAMILY = generatedNames('').filter((name) => isAllowedProperty(name))

describe('T-2: the family classes cover every allowed padding, margin and border name', () => {
    it('the classes hold exactly the 133 names the allow-list admits, each in one class', () => {
        expect(ALLOWED_FAMILY.length).toBe(133)
        const listed = CLASS_KEYS.flatMap((key) => FAMILY_CLASSES[key])
        expect(new Set(listed).size).toBe(listed.length)
        expect([...listed].sort()).toEqual([...ALLOWED_FAMILY].sort())
        for (const name of ALLOWED_FAMILY) expect(CLASS_KEYS.filter((key) => FAMILY_CLASSES[key].includes(name)), name).toHaveLength(1)
        expect(CLASS_KEYS.map((key) => FAMILY_CLASSES[key].length)).toEqual([30, 25, 11, 17, 50])
    })

    it('every name has the class its sides say: horizontal or side-less names are read or paint, block-axis names are block or paint, radii have no effect, the rest are refused', () => {
        const blockAxis = (name: string): boolean => name.split('-').some((word) => word === 'top' || word === 'bottom' || word === 'block')
        const cornerOfSide = /-(top|right|bottom|left)-(start|end)(-|$)/
        for (const name of FAMILY_CLASSES.READ) expect(!blockAxis(name) && !/-color$|-radius$/.test(name) && !cornerOfSide.test(name), name).toBe(true)
        for (const name of FAMILY_CLASSES.BLOCK) expect(blockAxis(name) && !/-color$|-radius$/.test(name) && !cornerOfSide.test(name), name).toBe(true)
        for (const name of FAMILY_CLASSES.PAINT) expect(/-color$/.test(name) && !cornerOfSide.test(name), name).toBe(true)
        for (const name of FAMILY_CLASSES['NO-EFFECT']) expect(/-radius$/.test(name), name).toBe(true)
        for (const name of FAMILY_CLASSES.REFUSED) expect(cornerOfSide.test(name) || name === 'border-collapse' || name === 'border-spacing', name).toBe(true)
        // and nothing that is a corner of a physical side with start or end is read, block or paint
        for (const name of ALLOWED_FAMILY.filter((n) => cornerOfSide.test(n) && !/-radius$/.test(n))) expect(FAMILY_CLASSES.REFUSED, name).toContain(name)
        // the reader rows are exactly the READ class
        expect(READER_ROWS.map((row) => row.prop)).toEqual(FAMILY_CLASSES.READ)
    })

    it('GUARD: the allow-list has exactly four sources that mention padding, margin or border', () => {
        expect(PROP_ALLOW.filter((pattern) => /padding|margin|border/.test(pattern.source)).map((pattern) => pattern.source)).toEqual([
            '^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-(width|style|color))?$',
            '^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$',
            '^(margin|padding)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$',
            '^(border-collapse|border-spacing|table-layout|caption-side|empty-cells)$',
        ])
    })

    it('familyClass agrees with the lists, refuses an unlisted family name and ignores other properties', () => {
        for (const key of CLASS_KEYS) for (const name of FAMILY_CLASSES[key]) expect(familyClass(name), name).toBe(key)
        for (const alias of generatedNames('-webkit-').slice(0, 40)) expect(familyClass(alias), alias).toBe('REFUSED')
        expect(familyClass('border-image')).toBe('REFUSED')
        expect(familyClass('padding-block-width')).toBe('REFUSED')
        for (const other of ['color', 'width', 'gap', 'inset-inline', 'box-shadow', 'outline']) expect(familyClass(other), other).toBeNull()
        // the allow-list admits no vendor alias, so each is refused by the family deny-list or by nothing at all
        expect(generatedNames('-webkit-').filter((name) => isAllowedProperty(name))).toEqual([])
    })
})

// The areas, with the parts the area's own pass admits on a chain: a part another area owns is refused for its name alone, which says nothing about the property.
const AREA_CHAINS: Record<ThemeArea, readonly GeometryChain[]> = {
    chat: CHAT_CHAINS,
    home: [...CHAT_CHAINS, ...HOME_CHAINS],
    studio: [...CHAT_CHAINS, ...STUDIO_CHAINS],
    settings: [...CHAT_CHAINS, ...SETTINGS_CHAINS],
}
const AREAS = Object.keys(AREA_CHAINS) as ThemeArea[]
const partsOfArea = (area: ThemeArea): { judged: string[]; unjudged: string[] } => {
    const parts = [...new Set(AREA_CHAINS[area].flatMap((chain) => chain.parts))]
    const judged = parts.filter((part) => lintAreaPack(area, `[data-part="${part}"]{padding-left:1px}`, 'probe').ok)
    return { judged, unjudged: parts.filter((part) => !judged.includes(part)) }
}

describe('T-2: a name the reach tier refuses is refused on every chain part of every area', () => {
    // names the family deny-list does not read, so the engine's own allowlist is the only thing that keeps them off a chain part
    const REACH_REFUSED: [string, string][] = [['min-width', '10px'], ['inline-size', '10px'], ['min-inline-size', '10px'], ['max-inline-size', '10px'], ['box-sizing', 'border-box'], ['top', '1px'], ['inset', '1px'], ['inset-inline', '1px'], ['border-collapse', 'collapse'], ['border-spacing', '1px']]
    it('refuses each name in the plain selector form', () => {
        const kept: string[] = []
        const misses: string[] = []
        for (const area of AREAS) for (const part of partsOfArea(area).judged) {
            kept.push(`${area}:${part}`)
            for (const [name, value] of REACH_REFUSED) if (!lintAreaPack(area, `[data-part="${part}"]{${name}:${value}}`, 'probe').errors.some((e) => e.prop === name)) misses.push(`${area} ${part} ${name}`)
        }
        expect(misses).toEqual([])
        expect(kept.length).toBe(48)
    })

    it('every vendor alias of the family is refused as unmeasurable on a chain part, in the plain and the safe-context forms', () => {
        const misses: string[] = []
        for (const area of AREAS) for (const part of partsOfArea(area).judged) for (const alias of ['-webkit-padding-start', '-webkit-margin-start', '-webkit-border-start']) for (const context of ['', '[data-role="user"] ']) {
            const result = lintAreaPack(area, `${context}[data-part="${part}"]{${alias}:200px}`, 'probe')
            if (result.ok || !result.errors.some((e) => e.prop === alias && /cannot be measured/.test(e.why))) misses.push(`${area} ${part} ${alias} ${context ? 'safe context' : 'plain'}`)
        }
        expect(misses).toEqual([])
    })
})

// ---- T-2s: the safe-context form puts a chain part in the safe tier, where the engine's reach allowlist does not run, so layout and paint names reach it; they are recorded residue (R10, R11, R12, R13, R19), not rules.
// A name admitted here that is not recorded must be classified before it can pass.
const SAFE_CONTEXT_CANDIDATES: [string, string][] = [['width', '120px'], ['max-width', '200px'], ['min-width', '10px'], ['min-inline-size', '10px'], ['max-inline-size', '200px'], ['flex-basis', '50px'], ['flex', '1'], ['display', 'grid'], ['display', 'inline-block'],
    ['grid-template-columns', '1fr 1fr'], ['text-indent', '4px'], ['column-count', '2'], ['box-sizing', 'border-box'], ['position', 'static'], ['font-size', '14px'], ['word-spacing', '1px'], ['letter-spacing', '1px'], ['gap', '4px'], ['column-gap', '4px'],
    ['justify-content', 'center'], ['align-items', 'center'], ['aspect-ratio', '1/1'], ['overflow', 'hidden'], ['list-style-position', 'inside'], ['white-space', 'nowrap'], ['box-shadow', '0 0 0 1px #000000'], ['text-shadow', '0 0 1px #000000'], ['height', '20px'], ['max-height', '40px'],
    // the reader never sees the -moz- aliases (the family rule matches -webkit- only): chat and Studio refuse them through the property allow-list, and Home's safe-context form admits them (R19, R20)
    ['-moz-padding-start', '48px'], ['-moz-padding-end', '48px'], ['-moz-margin-start', '48px'], ['-moz-margin-end', '48px'], ['-moz-border-start', '16px solid #000000'], ['-moz-border-end', '16px solid #000000']]
const PAINT_CANDIDATES = ['opacity:0.5', 'fill:#000000', 'stroke:#000000', 'background-clip:padding-box']
const WIDTH_NAMES = 'width max-width min-width min-inline-size max-inline-size'
// refused in chat and Studio by the property allow-list, admitted in Home and Settings
const MOZ_ALIASES = '-moz-padding-start -moz-padding-end -moz-margin-start -moz-margin-end -moz-border-start -moz-border-end'
const CHAT_TRANSCRIPT = ['chat-shell', 'chat-transcript', 'chat-message', 'chat-message-stage', 'chat-message-body', 'chat-message-text']
// per area: the candidate names refused in the safe-context form (the rest are admitted), with the chain parts that share that refusal; and the parts the area's own pass refuses even in the plain form
const SAFE_CONTEXT_SNAPSHOT: Record<ThemeArea, { refused: Record<string, string[]>; unjudged: string[]; paint: boolean }> = {
    chat: { refused: { [`column-count ${MOZ_ALIASES}`]: CHAT_TRANSCRIPT, [`${WIDTH_NAMES} column-count ${MOZ_ALIASES}`]: ['chat-sheet', 'chat-sheet-body'] }, unjudged: [], paint: true },
    home: { refused: { '': [...CHAT_TRANSCRIPT, 'home-shell', 'home-main', 'home-library', 'home-realm'], [WIDTH_NAMES]: ['chat-sheet', 'chat-sheet-body', 'home-dialog'] }, unjudged: [], paint: true },
    studio: {
        refused: { [`column-count ${MOZ_ALIASES}`]: ['studio-shell', 'studio-body', 'studio-main', 'studio-form-host', 'studio-form', 'studio-tgb-banners', 'studio-tgb-merged', 'studio-tgb-merged-section', 'studio-toast-box'], [`${WIDTH_NAMES} column-count ${MOZ_ALIASES}`]: ['studio-sheet-root'] },
        unjudged: [...CHAT_TRANSCRIPT, 'chat-sheet', 'chat-sheet-body'], paint: false,
    },
    settings: {
        refused: { '': [...CHAT_TRANSCRIPT, 'settings-page', 'settings-page-body', 'settings-section', 'settings-rows', 'settings-row', 'settings-preset-card', 'settings-connection-list', 'settings-connection-card', 'settings-connection-card-main'], [WIDTH_NAMES]: ['chat-sheet', 'chat-sheet-body'] },
        unjudged: ['settings-dialog-backdrop', 'settings-dialog'], paint: true,
    },
}
describe('T-2s: the safe-context admissions on chain parts are the recorded ones', () => {
    it.each(AREAS)('%s', (area) => {
        const { judged, unjudged } = partsOfArea(area)
        const refused: Record<string, string[]> = {}
        for (const part of judged) {
            const names = SAFE_CONTEXT_CANDIDATES.filter(([name, value]) => !lintAreaPack(area, `[data-role="user"] [data-part="${part}"]{${name}:${value}}`, 'probe').ok).map(([name]) => name)
            const key = [...new Set(names)].join(' ')
            refused[key] = [...(refused[key] ?? []), part]
        }
        const paint = PAINT_CANDIDATES.every((declaration) => lintAreaPack(area, `[data-role="user"] [data-part="chat-send"]{${declaration}}`, 'probe').ok)
        expect({ refused, unjudged, paint }).toEqual(SAFE_CONTEXT_SNAPSHOT[area])
    })
})

// ---- T-1p: the two sides of a single-slot reader row are told apart by verdict
// Each row's side is read from its CSS property name, written here, and never from READER_ROWS slots: the expectation must not follow the table under test, or a wrong slot would move the test's own reads with it.
// A box with a on one side and b on the other counts both; a reader that swaps a side drops b, and one that widens a row to both sides counts the larger value twice. The within cases are built in both orientations so
// that widening either row of a pair changes the sum (the reader keeps the per-slot maximum, so widening the row that holds the smaller value changes nothing). A logical row read as its physical neighbour (start as left, end as right) leaves
// every pair sum unchanged, because the reader takes the larger of the two reading directions; only the slot pin below catches it.
const NAME_SIDES: readonly (readonly [RegExp, InsetSlot])[] = [[/-left(-|$)/, 'L'], [/-right(-|$)/, 'R'], [/-inline-start(-|$)/, 'S'], [/-inline-end(-|$)/, 'E']]
const nameSideOf = (prop: string): InsetSlot | undefined => NAME_SIDES.find(([pattern]) => pattern.test(prop))?.[1]
const selectedRows = (): ReaderRow[] => READER_ROWS.filter((row) => nameSideOf(row.prop) !== undefined || row.slots.length === 1)

interface SidePair { kind: InsetKind; grammar: InsetGrammar; first: ReaderRow; second: ReaderRow; firstSide: InsetSlot; secondSide: InsetSlot }
// L is paired with R and S with E, within one (kind, grammar)
const sidePairs = (): SidePair[] => {
    const rows = selectedRows().filter((row) => nameSideOf(row.prop) !== undefined)
    const pairs: SidePair[] = []
    for (const key of [...new Set(rows.map((row) => `${row.kind}|${row.grammar}`))]) {
        const group = rows.filter((row) => `${row.kind}|${row.grammar}` === key)
        for (const [firstSide, secondSide] of [['L', 'R'], ['S', 'E']] as const) {
            const first = group.find((row) => nameSideOf(row.prop) === firstSide)
            const second = group.find((row) => nameSideOf(row.prop) === secondSide)
            if (first && second) pairs.push({ kind: first.kind, grammar: first.grammar, first, second, firstSide, secondSide })
        }
    }
    return pairs
}
// the logical border names are refused on a plain chain-part selector by the engine, so those pairs run in the safe context only
const placementsOfPair = (pair: SidePair): Placement[] => (pair.kind === 'border' && pair.firstSide === 'S' ? ['safe context'] : ['one block', 'a block per declaration'])
// the subject part's largest per-side padding floor over the judged chains that hold it
const floorOfSubject = (family: Family): number => Math.max(0, ...judgedChains(family).filter((chain) => chain.parts.includes(family.a)).map((chain) => (chain.defaults?.[family.a] ?? 0) / 2))

type PairCaseKind = 'over' | 'within' | 'within reversed'
// a and b are the two values of a case: a is the larger. A length is written a = F + 9 and b = F + 4 px, so both sides stay above the floor F and each counts in full.
const pairValues = (pair: SidePair, family: Family, kind: PairCaseKind | 'tiny'): { a: Val; b: Val } => {
    const floor = pair.kind === 'padding' ? floorOfSubject(family) : 0
    const length = (px: number): Val => v(`${px}px`, px)
    const line = (px: number): Val => v(`${px}px solid #000000`, px)
    if (kind === 'tiny') return pair.grammar === 'style' ? { a: v('solid', 3), b: v('solid', 3) } : pair.grammar === 'line' ? { a: line(1), b: line(1) } : { a: length(1), b: length(1) }
    if (pair.grammar === 'style') return { a: v('solid', 3), b: kind === 'over' ? v('dashed', 3) : v('none', 0) }
    const make = pair.grammar === 'line' ? line : length
    return { a: make(floor + 9), b: make(floor + 4) }
}
const pairSpec = (pair: SidePair, first: Val, second: Val): Spec => ({
    id: `${pair.first.prop} | ${pair.second.prop}`,
    build: () => ({ decls: [[pair.first.prop, first.text], [pair.second.prop, second.text]], pieces: [{ kind: pair.kind, reads: { [pair.firstSide]: first.px } }, { kind: pair.kind, reads: { [pair.secondSide]: second.px } }], roots: [] }),
})
// the over-budget chains of a case must be named with the constructed sum, and no chain within budget may be named
const sumMisses = (made: Case, got: Verdict, over: { chain: GeometryChain; sum: number }[]): string[] => {
    const misses: string[] = []
    for (const chain of judgedChains(made.family)) {
        const expected = over.find((o) => o.chain === chain)
        const named = got.whys.filter((w) => w.includes(`ancestor padding along ${chain.name} sums to `))
        if (expected && !named.some((w) => w.includes(messageOf(chain, expected.sum)))) misses.push(`${made.label}: no "${messageOf(chain, expected.sum)}" :: ${made.css.slice(0, 200)} => ${got.whys.join(' / ').slice(0, 240)}`)
        if (!expected && named.length) misses.push(`${made.label}: "${chain.name}" is within budget but named :: ${made.css.slice(0, 200)}`)
    }
    return misses
}
const runPairCases = (which: PairCaseKind): { cases: number; failures: string[]; other: string[] } => {
    const failures: string[] = [], other: string[] = []
    let cases = 0
    for (const family of FAMILIES) for (const pair of sidePairs()) for (const placement of placementsOfPair(pair)) {
        const tiny = pairValues(pair, family, 'tiny')
        const pre = assemble(family, pairSpec(pair, tiny.a, tiny.b), TINY, placement, '', null)
        if ('skipped' in pre) throw new Error(pre.skipped)
        const preVerdict = judge(family, pre.css)
        if (!preVerdict.ok && !preVerdict.whys.some((w) => GEOMETRY_ERROR.test(w))) { other.push(`${family.id} | ${pair.first.prop} | ${placement}: ${preVerdict.whys[0]}`); continue }
        const { a, b } = pairValues(pair, family, which)
        const made = assemble(family, which === 'within reversed' ? pairSpec(pair, b, a) : pairSpec(pair, a, b), TINY, placement, '', which === 'over' ? BUDGET + 1 : BUDGET)
        if ('skipped' in made) { failures.push(`${family.id} | ${pair.first.prop} | ${placement}: ${made.skipped}`); continue }
        cases++
        const got = judge(family, made.css)
        const over = expectedOver(made)
        if (which === 'over') {
            if (!over.length) failures.push(`${made.label}: the construction is not over budget`)
            if (got.ok) failures.push(`${made.label}: accepted over budget :: ${made.css.slice(0, 220)}`)
            failures.push(...sumMisses(made, got, over))
        } else {
            if (over.length) failures.push(`${made.label}: the construction is over budget`)
            if (!got.ok) failures.push(`${made.label}: refused within budget :: ${made.css.slice(0, 220)} => ${got.whys.join(' / ').slice(0, 240)}`)
        }
    }
    return { cases, failures, other }
}

describe('T-1p: the side of every single-slot reader row (GUARD)', () => {
    it('the 20 single-slot rows each carry the slot their property name says, in 10 side pairs of which each row is in exactly one', () => {
        const rows = selectedRows()
        expect(rows).toHaveLength(20)
        expect(rows.filter((row) => nameSideOf(row.prop) === undefined).map((row) => row.prop)).toEqual([])
        for (const row of rows) expect(row.slots, row.prop).toEqual([nameSideOf(row.prop)])
        const pairs = sidePairs()
        expect(pairs).toHaveLength(10)
        const used = pairs.flatMap((pair) => [pair.first.prop, pair.second.prop])
        expect([...used].sort()).toEqual(rows.map((row) => row.prop).sort())
        expect(pairs.reduce((total, pair) => total + placementsOfPair(pair).length, 0)).toBe(17)
    })
    // over: both sides count, so a swapped side drops the smaller value and the sum falls under the budget
    it('over: a box with a on one side and b on the other is refused with its constructed sum, for every pair, placement and family', () => {
        const run = runPairCases('over')
        expect(run.other).toEqual([])
        expect(run.failures.slice(0, 8)).toEqual([])
        expect(run.cases).toBe(85)
    }, 60_000)
    // within: widening the row that holds a counts a twice, so the box leaves the budget
    it('within: a on the first side of the pair and b on the second is accepted at the budget edge', () => {
        const run = runPairCases('within')
        expect(run.other).toEqual([])
        expect(run.failures.slice(0, 8)).toEqual([])
        expect(run.cases).toBe(85)
    }, 60_000)
    it('within reversed: b on the first side of the pair and a on the second is accepted at the budget edge', () => {
        const run = runPairCases('within reversed')
        expect(run.other).toEqual([])
        expect(run.failures.slice(0, 8)).toEqual([])
        expect(run.cases).toBe(85)
    }, 60_000)
})

// ---- T-5: the subject of a selector and the reader agree
// The reader attributes a declaration only to the parts named by valued data-part attributes in the last compound of each selector-list entry; Rule SCOPE refuses every entry the reader would not attribute to a part. This generates the
// subject forms from the alternatives of the engine's compound grammar (root, attributes, state), the two combinators and the wrappers, varying one factor at a time from the plain named subject (attribute pairs combine, in both orders; ancestors are each COMPOUND alternative, with either combinator, alone and as an outer plus an inner ancestor; a list holds the subject first or second beside a peer or [data-part]). Only these listed shapes are covered, and
// puts a box of every spelling on each judged chain part. A form is in one of these cells: (1) refused at 1 px for a reason that is not the geometry, (2) measured like the plain named subject, (3) a [data-role] form refused on the chain sum,
// (3b) a form no entry of which can match the part, so the box lands on another part (counted, not asserted empty), (4) accepted over budget. Cell 4 must be empty, and every case must be in a cell.
interface SubjectEntry { text: string; parts: readonly string[] }
interface SubjectForm { id: string; entries: readonly SubjectEntry[]; wrapper: 'plain' | '@media' }
type SubjectArea = 'chat' | 'studio'
const SUBJECT_AREAS: readonly SubjectArea[] = ['chat', 'studio']
// an area part that sits in no judged chain
const OTHER_PART: Record<SubjectArea, string> = { chat: 'chat-send', studio: 'studio' }
const renderSubject = (form: SubjectForm, decls: string[]): string => {
    const block = `${form.entries.map((entry) => entry.text).join(',')}{${decls.join(';')}}`
    return form.wrapper === '@media' ? `@media (min-width:1px){${block}}` : block
}
// an entry whose last compound names a valued data-part, none of which is the part, cannot select the part's element (an element carries one data-part value); the record is the generator's own, never parsed back from the text
const canMatchPart = (form: SubjectForm, part: string): boolean => form.entries.some((entry) => entry.parts.length === 0 || entry.parts.includes(part))
// The ancestor compounds are the alternatives of COMPOUND (a bare root, a root with a root attribute, an attribute alone, an attribute with each state), in front of the subject with either combinator, once and twice.
const ancestorCompounds = (other: string): string[] => {
    const roots = ['html', ':root']
    const rootAttributes = ['[data-input="touch"]', '[data-layout="phone"]']
    const attributes = ['[data-role="user"]', '[data-x]', `[data-part="${other}"]`]
    const states = [':hover', ':focus-within', ':focus-visible']
    return [...roots, ...roots.flatMap((root) => rootAttributes.map((attribute) => root + attribute)), ...attributes, ...states.map((state) => `[data-part="${other}"]${state}`)]
}
const ancestorChains = (other: string): string[] => {
    const compounds = ancestorCompounds(other)
    const outer = [':root', 'html[data-input="touch"]', '[data-x]']
    const inner = [`[data-part="${other}"]`, `[data-part="${other}"]:hover`]
    const chains: string[] = []
    for (const combinator of [' ', '>']) {
        for (const compound of compounds) chains.push(compound + combinator)
        for (const first of outer) for (const second of inner) chains.push(first + combinator + second + combinator)
    }
    return chains
}
const subjectForms = (part: string, other: string): SubjectForm[] => {
    const own: SubjectEntry = { text: `[data-part="${part}"]`, parts: [part] }
    const valueless: SubjectEntry = { text: '[data-part]', parts: [] }
    const peer: SubjectEntry = { text: `[data-part="${other}"]`, parts: [other] }
    const attributes: SubjectEntry[] = [own, valueless, { text: '[data-x]', parts: [] }, { text: '[data-x="y"]', parts: [] }, { text: '[data-role="user"]', parts: [] }, peer, { text: '[data-x="a b"]', parts: [] }, { text: '[data-x="a>b"]', parts: [] }]
    const forms: SubjectForm[] = []
    const add = (id: string, entries: SubjectEntry[], wrapper: 'plain' | '@media' = 'plain'): void => { forms.push({ id, entries, wrapper }) }
    add('plain', [own])
    for (const attribute of attributes.slice(1)) add(`attribute ${attribute.text}`, [attribute])
    add('attribute [data-part=""]', [{ text: '[data-part=""]', parts: [''] }])
    for (const first of attributes) for (const second of attributes) if (first !== second) add(`attributes ${first.text}${second.text}`, [{ text: first.text + second.text, parts: [...first.parts, ...second.parts] }])
    for (const root of ['html', ':root']) add(`root ${root}`, [{ text: root + own.text, parts: [part] }])
    for (const state of [':hover', ':focus-within', ':focus-visible']) add(`state ${state}`, [{ text: own.text + state, parts: [part] }])
    for (const ancestor of ancestorChains(other)) add(`ancestor ${ancestor}`, [{ text: ancestor + own.text, parts: [part] }])
    add('@media, the named subject', [own], '@media')
    add('@media, [data-part]', [valueless], '@media')
    add('list with a named peer, the named subject', [peer, own])
    add('list with a named peer, [data-part]', [peer, valueless])
    add('list with the named subject first, a named peer', [own, peer])
    add('list with the named subject first, [data-part]', [own, valueless])
    return forms
}

// the spellings of a box: padding-inline, margin-inline, and border-left with border-right
interface SubjectSpelling { id: string; kind: InsetKind; decls: (px: number) => string[]; pieces: (px: number) => Piece[] }
const SUBJECT_SPELLINGS: readonly SubjectSpelling[] = [
    { id: 'padding-inline', kind: 'padding', decls: (px) => [`padding-inline:${px}px`], pieces: (px) => [{ kind: 'padding', reads: { S: px, E: px } }] },
    { id: 'margin-inline', kind: 'margin', decls: (px) => [`margin-inline:${px}px`], pieces: (px) => [{ kind: 'margin', reads: { S: px, E: px } }] },
    { id: 'border-left and border-right', kind: 'border', decls: (px) => [`border-left:${px}px solid #000000`, `border-right:${px}px solid #000000`], pieces: (px) => [{ kind: 'border', reads: { L: px } }, { kind: 'border', reads: { R: px } }] },
]
const subjectChainsOf = (area: SubjectArea): { engine: readonly GeometryChain[]; live: readonly GeometryChain[] } => ({ engine: AREA_CHAINS[area], live: area === 'chat' ? CHAT_LIVE_CHAINS : [] })
const subjectPartsOfArea = (area: SubjectArea): string[] => {
    const { engine, live } = subjectChainsOf(area)
    return [...new Set([...engine, ...live].flatMap((chain) => chain.parts))].filter((part) => lintAreaPack(area, `[data-part="${part}"]{padding-left:1px}`, 'probe').ok)
}
interface SubjectContext { family: Family; held: GeometryChain[]; floor: number }
// The box sits on the part. The filler sits on the same part in the kind the box does not use (a border for a padding or margin box, a margin for a border box), so no other part of any chain is disturbed. It is sized so that the
// tightest chain that holds the part is exactly at its budget (target 120) or one px over it (target 121), and one px decides the verdict.
const subjectContext = (area: SubjectArea, part: string): SubjectContext | null => {
    const { engine, live } = subjectChainsOf(area)
    const held = [...engine, ...live].filter((chain) => chain.parts.includes(part))
    if (!held.length) return null
    const family: Family = { id: `${area} ${part}`, area, a: part, b: part, peer: OTHER_PART[area], engine, live }
    return { family, held, floor: Math.max(0, ...held.map((chain) => (chain.defaults?.[part] ?? 0) / 2)) }
}
const subjectCase = (context: SubjectContext, form: SubjectForm, spelling: SubjectSpelling, target: number): Case | { skipped: string } => {
    const { family, held, floor } = context
    const px = spelling.kind === 'padding' ? floor + 10 : 10
    const boxes = new Map<string, Piece[]>([[family.a, spelling.pieces(px)]])
    const need = Math.min(...held.map((chain) => (chain.budget ?? BUDGET) - chainSum(chain, boxes))) + (target - BUDGET)
    if (need < 0 || need > 400) return { skipped: `${family.id} | ${form.id} | ${spelling.id}: the box leaves ${need} px for the filler` }
    const left = Math.floor(need / 2), right = need - left
    const fillKind: InsetKind = spelling.kind === 'border' ? 'margin' : 'border'
    boxes.get(family.a)!.push({ kind: fillKind, reads: { L: left, R: right } })
    const filler = fillKind === 'margin' ? `margin-left:${left}px;margin-right:${right}px` : `border-left:${left}px solid #000000;border-right:${right}px solid #000000`
    return { label: `${family.id} | ${form.id} | ${spelling.id}`, family, placement: 'one block', css: `${renderSubject(form, spelling.decls(px))}[data-part="${family.a}"]{${filler}}`, boxes }
}
// the reason a form is refused at 1 px, without the names it carries
const reasonKey = (why: string, part: string): string => stem(why).split(part).join('<part>').replace(/\s+/g, ' ').trim()

// Per area: the cases (judged chain parts x 112 forms x 3 spellings) and the cells they fall in. Cell 3 is empty today: every [data-role] form that reaches the reader is measured like the plain named subject (cell 2).
const SUBJECT_REASON_VALUELESS = '[data-part] without a value matches the parts of every screen: name a part of this screen'
const SUBJECT_REASON_NO_PART = 'a selector must end in a [data-part="..."] of this screen; one that names no part reaches elements of every screen'
const SUBJECT_REASON_CHARSET = 'an attribute value or at-rule string in a selector or prelude may hold only a-z, 0-9, - and _'
const SUBJECT_REASON_SIZE = 'on a selector that names no part can resize a protected element directly'
const SUBJECT_CELLS: Record<SubjectArea, Record<string, number>> = {
    chat: {
        cases: 3024, 'cell 2': 1431, 'cell 3b | accepted at 121': 189,
        [`cell 1 | ${SUBJECT_REASON_VALUELESS}`]: 378, [`cell 1 | ${SUBJECT_REASON_NO_PART}`]: 171, [`cell 1 | ${SUBJECT_REASON_CHARSET}`]: 540, [`cell 1 | ${SUBJECT_REASON_SIZE}`]: 288,
        'cell 1 | the part is not a part of the chat screen; a chat stylesheet may name only the chat screen\'s own parts, as the element it styles': 27,
    },
    studio: {
        cases: 3360, 'cell 2': 1590, 'cell 3b | accepted at 121': 210,
        [`cell 1 | ${SUBJECT_REASON_VALUELESS}`]: 420, [`cell 1 | ${SUBJECT_REASON_NO_PART}`]: 190, [`cell 1 | ${SUBJECT_REASON_CHARSET}`]: 600, [`cell 1 | ${SUBJECT_REASON_SIZE}`]: 320,
        'cell 1 | the part is not a part of the studio screen; a studio stylesheet may name only the studio screen\'s own parts, as the element it styles': 30,
    },
}
interface SubjectRun { cases: number; table: Record<string, number>; cell4: string[]; unclassified: string[]; unfit: string[] }
const runSubjects = (area: SubjectArea): SubjectRun => {
    const run: SubjectRun = { cases: 0, table: {}, cell4: [], unclassified: [], unfit: [] }
    const count = (key: string): void => { run.table[key] = (run.table[key] ?? 0) + 1 }
    const other = OTHER_PART[area]
    const judgedParts = subjectPartsOfArea(area)
    for (const part of judgedParts) {
        const context = subjectContext(area, part)
        if (!context) { run.unfit.push(part); continue }
        for (const form of subjectForms(part, other)) for (const spelling of SUBJECT_SPELLINGS) {
            run.cases++
            const pre = judge(context.family, renderSubject(form, spelling.decls(1)))
            if (!pre.ok && !pre.whys.some((w) => GEOMETRY_ERROR.test(w))) { count(`cell 1 | ${reasonKey(pre.whys[0], part)}`); continue }
            const at120 = subjectCase(context, form, spelling, BUDGET)
            const at121 = subjectCase(context, form, spelling, BUDGET + 1)
            if ('skipped' in at120 || 'skipped' in at121) { run.unfit.push('skipped' in at120 ? at120.skipped : (at121 as { skipped: string }).skipped); continue }
            const got120 = judge(context.family, at120.css)
            const got121 = judge(context.family, at121.css)
            const over121 = expectedOver(at121)
            const measuredLikePlain = got120.ok && !expectedOver(at120).length && !got121.ok && over121.length > 0 && sumMisses(at121, got121, over121).length === 0
            if (measuredLikePlain) count('cell 2')
            else if (form.entries.some((entry) => entry.text.includes('[data-role')) && !got121.ok && got121.whys.some((w) => /ancestor padding along/.test(w))) count('cell 3')
            else if (!canMatchPart(form, part)) count(`cell 3b | ${got121.ok ? 'accepted' : 'refused'} at 121`)
            else if (got121.ok) run.cell4.push(`${at121.label} :: ${at121.css}`)
            else run.unclassified.push(`${at121.label} :: ${at121.css} => 120: ${got120.ok ? 'ok' : got120.whys.join(' / ').slice(0, 160)}; 121: ${got121.whys.join(' / ').slice(0, 200)}`)
        }
    }
    return run
}

describe('T-5: every generated subject form that can match a chain part is refused or measured like the plain named subject (GUARD)', () => {
    it.each(SUBJECT_AREAS)('%s: the other part is in no judged chain and the forms record their last compounds', (area) => {
        const other = OTHER_PART[area]
        const { engine, live } = subjectChainsOf(area)
        expect([...engine, ...live].some((chain) => chain.parts.includes(other))).toBe(false)
        expect(lintAreaPack(area, `[data-part="${other}"]{padding-inline:1px}`, 'probe').ok).toBe(true)
        const forms = subjectForms('chat-shell', other)
        expect(forms.find((form) => form.id === `attributes [data-part="${other}"][data-part="chat-shell"]`)?.entries[0].parts).toEqual([other, 'chat-shell'])
        expect(forms.filter((form) => canMatchPart(form, 'chat-shell')).length).toBeGreaterThan(0)
        // every generated ancestor compound is one the engine's grammar admits, and the ancestor forms are the 12 compounds with two combinators plus the outer-inner pairs
        for (const compound of ancestorCompounds(other)) expect(COMPOUND.test(compound), compound).toBe(true)
        expect(ancestorCompounds(other)).toHaveLength(12)
        expect(ancestorChains(other)).toHaveLength(36)
        expect(forms).toHaveLength(112)
        expect(forms.filter((form) => !canMatchPart(form, 'chat-shell')).every((form) => form.entries.every((entry) => entry.parts.length > 0 && !entry.parts.includes('chat-shell')))).toBe(true)
    })
    it.each(SUBJECT_AREAS)('%s: no form is accepted over budget, none is unclassified, and the cells are the recorded ones', (area) => {
        const run = runSubjects(area)
        expect(run.unfit).toEqual([])
        expect(run.cell4.slice(0, 8)).toEqual([])
        expect(run.unclassified.slice(0, 8)).toEqual([])
        expect({ cases: run.cases, ...run.table }).toEqual(SUBJECT_CELLS[area])
    }, 60_000)
})
