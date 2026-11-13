import fc from 'fast-check'
import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'
import { checkCbs, type CbsCheckResult } from './cbsCheck'
import {
    atomSpecsArb,
    buildText,
    earlyReturnId,
    oracleIds,
    valuations,
    type AtomSet,
    type GenText,
    type OracleKind,
} from './cbsGen.test-helpers'
import { createMacroIndex } from './macroIndex'

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

// The valuation a run reads its chat variables from; a variable it does not name reads as its own key.
const valuation = vi.hoisted(() => ({ values: {} as Record<string, string> }))

const varStorage = vi.hoisted(() => new Proxy({}, {
    get(_, prop) {
        if(typeof prop !== 'string'){
            return 'null'
        }
        const key = prop.startsWith('$') ? prop.slice(1) : prop
        return valuation.values[key] ?? key
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
import { collectMacroEntries } from './macroRegistry'

const index = createMacroIndex(collectMacroEntries())

// The parser keeps `callStack` on its options object, so every call gets a fresh one.
function run(text: string, values: Record<string, string>): string {
    valuation.values = values
    return risuChatParser(text, {})
}

const check = (text: string): CbsCheckResult => checkCbs(text, index, { mode: 'cbs', slotAllowed: false })

// The checker's ids for one oracle: the atom whose span starts where a problem of that kind starts.
const CHECKER_KIND: Record<OracleKind, string> = {
    O1: 'unclosed-block',
    O2: 'stray-block-close',
    O3: 'unclosed-macro',
    O3p: 'stray-macro-close',
}

function checkerIds(result: CbsCheckResult, kind: OracleKind, gen: GenText): Set<number> {
    const ids = new Set<number>()
    for(const problem of result.problems){
        if(problem.kind !== CHECKER_KIND[kind]){
            continue
        }
        const atom = gen.atoms.find((a) => a.start === problem.start)
        if(!atom){
            throw new Error(`${kind} problem at ${problem.start} is no atom start in ${JSON.stringify(gen.text)}`)
        }
        ids.add(atom.id)
    }
    return ids
}

const same = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((id) => b.has(id))

const NUM_RUNS = 400
const PICKS = fc.array(fc.nat(255), { minLength: 24, maxLength: 24 })

// Compares the checker with the engine over generated texts for one set of oracles.
//   (r)  a valuation that returns early means the checker stopped;
//   (a)  not stopped: the engine's id set equals the checker's, for every valuation that does not return;
//   (a') stopped: every id the checker reported is in the engine's set, for every such valuation;
//   (b)  two valuations that give different id sets mean the checker stopped.
function differential(set: AtomSet, kinds: OracleKind[]) {
    let texts = 0
    let notStopped = 0
    let nonEmpty = 0
    fc.assert(
        fc.property(atomSpecsArb(set), PICKS, (specs, picks) => {
            const gen = buildText(specs, set)
            const result = check(gen.text)
            // html+cbs keeps every problem except the stray macro close.
            const html = checkCbs(gen.text, index, { mode: 'html+cbs', slotAllowed: false })
            expect(html.problems, gen.text).toEqual(result.problems.filter((p) => p.kind !== 'stray-macro-close'))
            texts++
            if(!result.valueDependent){
                notStopped++
            }
            const outputs: string[] = []
            let returned: number | null = null
            for(const values of valuations(gen.dynamics, picks)){
                const output = run(gen.text, values)
                const id = earlyReturnId(output)
                if(id !== null){
                    returned = id
                    continue
                }
                outputs.push(output)
            }
            if(returned !== null){
                expect(result.valueDependent, gen.text).toBe(true)
                const atom = gen.atoms.find((a) => a.id === returned)
                expect(atom, gen.text).toBeDefined()
                // The return runs where the engine reaches it: at the atom, or (inside an #each body) when
                // the expansion is scanned at the closer. So the stop is at or before the atom, or it is
                // the stop at that closer, whose reason is the expansion's own (each-reparse or early-return)
                // and which lies where the scan stopped.
                const stopAtCloser = result.problems.some((p) => p.kind === 'not-static'
                    && (p.reason === 'each-reparse' || p.reason === 'early-return') && p.start === result.judgedUntil)
                expect(result.judgedUntil <= (atom?.start ?? 0) || stopAtCloser, gen.text).toBe(true)
            }
            for(const kind of kinds){
                const sets = outputs.map((output) => oracleIds(output, kind, gen))
                if(sets.some((s) => s.size > 0)){
                    nonEmpty++
                }
                const reported = checkerIds(result, kind, gen)
                if(!result.valueDependent){
                    for(const engine of sets){
                        expect({ text: gen.text, kind, ids: [...engine].sort() }).toEqual({
                            text: gen.text, kind, ids: [...reported].sort(),
                        })
                    }
                    continue
                }
                for(const engine of sets){
                    for(const id of reported){
                        expect(engine.has(id), `${kind} ${id} in ${JSON.stringify(gen.text)}`).toBe(true)
                    }
                }
            }
            for(const kind of kinds){
                const sets = outputs.map((output) => oracleIds(output, kind, gen))
                if(sets.some((s) => !same(s, sets[0]))){
                    expect(result.valueDependent, `${kind} differs between valuations: ${JSON.stringify(gen.text)}`).toBe(true)
                }
            }
        }),
        { seed: 20261113, numRuns: NUM_RUNS },
    )
    return { texts, notStopped, nonEmpty }
}

describe('checker against the engine over generated texts', () => {
    test('unclosed blocks (O1) over every opener, closer, return and dynamic atom', () => {
        const stats = differential('full', ['O1'])
        // The comparison is only informative while a good share of the texts is judged and the
        // oracle sees something.
        expect(stats.notStopped / stats.texts).toBeGreaterThan(0.2)
        expect(stats.nonEmpty).toBeGreaterThan(20)
    })

    test('stray closers, unclosed macros and stray macro closes (O2, O3, O3p) over visible blocks', () => {
        const stats = differential('visible', ['O2', 'O3', 'O3p'])
        expect(stats.notStopped / stats.texts).toBeGreaterThan(0.5)
        expect(stats.nonEmpty).toBeGreaterThan(100)
    })
})

describe('a return inside a literal #each body', () => {
    test('the engine returns early and the checker stops at the closer, after the return', () => {
        const text = '{{#each [1,2] as x}}{{return::R0.}}q0.{{/K1.}}q1.'
        expect(earlyReturnId(run(text, {}))).toBe(0)
        const result = check(text)
        expect(result.valueDependent).toBe(true)
        expect(result.judgedUntil).toBe(text.indexOf('{{/K1.}}'))
        expect(result.problems.map((p) => p.reason)).toEqual(['early-return'])
    })
})

describe('the generator and oracles are sound (diagnostic)', () => {
    test('each oracle sees its marker in a known text', () => {
        const none = {}
        const cases: [string, OracleKind, number][] = [
            ['{{#if 1}}B0.q0.', 'O1', 0],
            ['{{/K0.}}q0.', 'O2', 0],
            ['{{trim::U0.q0.', 'O3', 0],
            ['{#trim::U0.q0.', 'O3', 0],
            ['}}S0.q0.', 'O3p', 0],
        ]
        for(const [text, kind, id] of cases){
            const gen = buildText([{ kind: kind === 'O1' ? 'opener' : kind === 'O2' ? 'closer' : kind === 'O3' ? (text.startsWith('{#') ? 'legacy-open' : 'open-macro') : 'stray', pick: 0 }], 'visible')
            expect(gen.text, kind).toBe(text)
            expect([...oracleIds(run(text, none), kind, gen)], `${kind} ${JSON.stringify(text)}`).toEqual([id])
        }
    })

    test('a return atom makes the output exactly its value, and a closed construct leaves no marker', () => {
        expect(earlyReturnId(run('{{return::R0.}}q0.', {}))).toBe(0)
        const dynamic = buildText([{ kind: 'dynamic-return', pick: 0 }], 'full')
        expect(earlyReturnId(run(dynamic.text, { d0: 'urn' }))).toBe(0)
        expect(earlyReturnId(run(dynamic.text, { d0: 'x' }))).toBeNull()
        const closed = buildText([{ kind: 'opener', pick: 0 }, { kind: 'closer', pick: 0 }], 'visible')
        expect(oracleIds(run(closed.text, {}), 'O1', closed).size).toBe(0)
        expect(oracleIds(run(closed.text, {}), 'O2', closed).size).toBe(0)
    })
})
