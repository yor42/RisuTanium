import fc from 'fast-check'
import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'
import { checkCbs, checkCbsWithExpansions, type CbsCheckResult, type CbsProblemKind } from './cbsCheck'
import { valuations, type GenDynamic } from './cbsGen.test-helpers'
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
function run(text: string, values: Record<string, string> = {}): string {
    valuation.values = values
    return risuChatParser(text, {})
}

const check = (text: string): CbsCheckResult => checkCbs(text, index, { mode: 'cbs', slotAllowed: false })

describe('the expansion against the engine', () => {
    // Element texts as JSON array items. `$` patterns exercise the string replacement; braces stay out
    // of them because a header with a nested value is not a literal one.
    const ITEMS = ['1', '"a"', '"$&"', '"$`"', '"$\'"', '"$$"', '"$1"', '"b c"', 'null', '[1,2]', '{"k":"v"}', '""', '"  z "']
    const BODY_PARTS = [
        't', ' ', '\n', '  lead', '{{slot::x}}', '{{slot::item}}', '{{slot}}', '{{slot::y}}', '{{trim:: a }}', '{{getvar::v}}',
        '{#if 0\nZ#}', '{#if 1\n {{slot::x}} #}', '{#trim::q}}', '{#x#}', 'end}', '}', '{', '$&', '${{slot::x}}',
        '{{#if 1}}k{{/if}}', '{{#pure}}{{slot::x}}{{/pure}}', '{{#foo}}b{{/foo}}',
    ]

    const headerArb = fc.tuple(
        fc.oneof(
            fc.array(fc.constantFrom(...ITEMS), { minLength: 0, maxLength: 3 }).map((items) => `[${items.join(',')}]`),
            fc.array(fc.constantFrom('a', 'b$&c', "d$'e", ' f ', ''), { minLength: 1, maxLength: 3 }).map((items) => items.join('§')),
        ),
        fc.constantFrom('x', 'item'),
        fc.constantFrom('as', 'compat'),
        fc.boolean(),
        fc.boolean(),
    ).map(([array, slot, form, keep, leadingAs]) => {
        const tail = form === 'as' ? `${array} as ${slot}` : `${array} ${slot}`
        return `#each ${keep ? '::keep ' : ''}${leadingAs ? 'as ' : ''}${tail}`
    })

    const bodyArb = fc.array(fc.constantFrom(...BODY_PARTS), { maxLength: 6 }).map((parts) => parts.join(''))

    test('the engine output with the block equals the output with the checker expansion in its place', () => {
        let compared = 0
        let nonEmpty = 0
        fc.assert(
            fc.property(
                headerArb, bodyArb, fc.constantFrom('', 'P', ' P '), fc.constantFrom('', 'S', ' S\n'),
                (head, body, prefix, suffix) => {
                    const block = `{{${head}}}${body} {{/each}}`
                    const text = `${prefix}${block}${suffix}`
                    const { result, expansions } = checkCbsWithExpansions(text, index, { mode: 'cbs', slotAllowed: false })
                    // A body structure the checker cannot judge, and a block that never closes (so nothing is
                    // expanded), are not under test here.
                    if(result.valueDependent || result.problems.some((p) => p.kind === 'unclosed-block')){
                        return
                    }
                    expect(expansions.length, text).toBeLessThanOrEqual(1)
                    const expansion = expansions[0] ?? ''
                    compared++
                    if(expansion !== ''){
                        nonEmpty++
                    }
                    expect(run(text), JSON.stringify(text)).toBe(run(`${prefix}${expansion}${suffix}`))
                },
            ),
            { seed: 20261113, numRuns: 500 },
        )
        console.log(`engine/expansion comparison: ${compared} of 500 texts judged, ${nonEmpty} with a non-empty expansion`)
        // The comparison only tells something while most texts are judged and most expand to something.
        expect(compared).toBeGreaterThan(300)
        expect(nonEmpty).toBeGreaterThan(150)
    })

    test('a `}}` that closes a macro across the seam is read the way the engine reads it', () => {
        const closed = '{{trim::{{#each [1] as y}}}{{/each}}}'
        expect(run(closed)).not.toContain('{{trim::')
        expect(check(closed).problems).toEqual([])
        const open = '{{trim::{{#each [1] as y}}}{{/each}}'
        expect(run(open)).toContain('{{trim::')
        expect(check(open).problems.map((p) => p.kind)).toEqual(['unclosed-macro'])
    })
})

// Existence-level oracles over texts with literal, empty and value-dependent arrays. A problem in
// an expansion is anchored at the `#each` closer, so the ids of an expansion cannot be compared; what
// is compared is whether the engine shows a marker of the kind at all.
describe('the checker against the engine over generated texts with #each', () => {
    type EachAtom = 'each' | 'each-keep' | 'each-empty' | 'each-dynamic' | 'closer' | 'opener' | 'text-opener' | 'open-macro'
        | 'stray' | 'slot' | 'return' | 'plain'

    const KINDS: readonly EachAtom[] = [
        'each', 'each', 'each-keep', 'each-dynamic', 'closer', 'closer', 'closer', 'opener', 'text-opener',
        'open-macro', 'stray', 'slot', 'slot', 'return', 'plain',
    ]

    function build(kinds: readonly EachAtom[]): { text: string; dynamics: GenDynamic[] } {
        const dynamics: GenDynamic[] = []
        let text = ''
        kinds.forEach((kind, id) => {
            let piece: string
            switch(kind){
                case 'each': piece = `{{#each [1,2] as x}}B${id}.`; break
                case 'each-keep': piece = `{{#each ::keep ["a"] as x}}B${id}.`; break
                case 'each-empty': piece = `{{#each [] as x}}B${id}.`; break
                case 'each-dynamic':
                    dynamics.push({ variable: `d${id}`, values: ['[1]', 'x'] })
                    piece = `{{#each {{getvar::d${id}}} as x}}B${id}.`
                    break
                case 'closer': piece = `{{/K${id}.}}`; break
                case 'opener': piece = `{{#if 1}}B${id}.`; break
                case 'text-opener': piece = `{{#foo}}B${id}.`; break
                case 'open-macro': piece = `{{trim::U${id}.`; break
                case 'stray': piece = `}}S${id}.`; break
                case 'slot': piece = '{{slot::x}}'; break
                case 'return': piece = `{{return::R${id}.}}`; break
                case 'plain': piece = `t${id}.`; break
            }
            text += `${piece}q${id}.`
        })
        return { text, dynamics }
    }

    const ORACLES: { name: string; kind: CbsProblemKind; marker: RegExp }[] = [
        { name: 'O1', kind: 'unclosed-block', marker: /<B\d+\./ },
        { name: 'O2', kind: 'stray-block-close', marker: /\{\{\/K\d+\.\}\}/ },
        { name: 'O3', kind: 'unclosed-macro', marker: /\{\{trim::U\d+\./ },
        { name: 'O3p', kind: 'stray-macro-close', marker: /\}\}S\d+\./ },
    ]

    test('what the engine shows is what the checker reports, or the checker stopped', () => {
        let stopped = 0
        let simulated = 0
        let withMarker = 0
        fc.assert(
            fc.property(
                fc.array(fc.constantFrom(...KINDS), { minLength: 2, maxLength: 9 }),
                fc.array(fc.nat(255), { minLength: 24, maxLength: 24 }),
                (kinds, picks) => {
                    const { text, dynamics } = build(kinds)
                    const { result, expansions } = checkCbsWithExpansions(text, index, { mode: 'cbs', slotAllowed: false })
                    if(expansions.length > 0){
                        simulated++
                    }
                    if(result.valueDependent){
                        stopped++
                    }
                    const outputs: string[] = []
                    let returned = false
                    for(const values of valuations(dynamics, picks)){
                        const output = run(text, values)
                        if(/^R\d+\.$/.test(output)){
                            returned = true
                            continue
                        }
                        outputs.push(output)
                    }
                    if(returned){
                        expect(result.valueDependent, text).toBe(true)
                    }
                    const reported = new Set(result.problems.map((p) => p.kind))
                    // An unclosed pure block hands its body to the output as it stands, so a marker in it says
                    // nothing about pairing: only the block oracle (O1) ranges over such texts.
                    const rawEmitted = result.problems.some((p) => p.kind === 'unclosed-block')
                    for(const oracle of ORACLES){
                        if(rawEmitted && oracle.name !== 'O1'){
                            continue
                        }
                        const seen = outputs.map((output) => oracle.marker.test(output))
                        if(seen.some(Boolean)){
                            withMarker++
                        }
                        if(!result.valueDependent){
                            for(const engine of seen){
                                expect({ text, oracle: oracle.name, engine }).toEqual({ text, oracle: oracle.name, engine: reported.has(oracle.kind) })
                            }
                            continue
                        }
                        // Stopped: whatever is reported is shown by the engine under every valuation.
                        if(reported.has(oracle.kind)){
                            for(const engine of seen){
                                expect(engine, `${oracle.name} reported but not shown: ${JSON.stringify(text)}`).toBe(true)
                            }
                        }
                    }
                    if(!result.valueDependent){
                        // The oracles that differ between valuations never occur without a stop.
                        for(const oracle of ORACLES){
                            if(rawEmitted && oracle.name !== 'O1'){
                                continue
                            }
                            const seen = outputs.map((output) => oracle.marker.test(output))
                            expect(seen.every((s) => s === seen[0]), `${oracle.name} differs: ${JSON.stringify(text)}`).toBe(true)
                        }
                    }
                },
            ),
            { seed: 20261113, numRuns: 500 },
        )
        console.log(`#each differential: 500 texts, ${simulated} simulated, ${stopped} stopped, ${withMarker} oracle hits`)
        // Informative only while some texts are simulated, some are judged and the oracles see something.
        expect(simulated).toBeGreaterThan(50)
        expect(stopped).toBeLessThan(450)
        expect(withMarker).toBeGreaterThan(50)
    })
})

describe('timing of the largest check (diagnostic, best-case hardware)', () => {
    test('a long text and an expansion at the budget', () => {
        const long = 'plain text {{getvar::a}} more text\n'.repeat(3000)
        const body = 'b'.repeat(180)
        const items = Array.from({ length: 1000 }, (_, k) => k % 10).join(',')
        const heavy = `${long}{{#each [${items}] as x}}${body}{{slot::x}}{{/each}}${long}`
        const before = performance.now()
        const result = check(heavy)
        const elapsed = performance.now() - before
        console.log(`checked ${heavy.length} characters with a 1000-element expansion in ${elapsed.toFixed(1)} ms (stopped: ${result.valueDependent})`)
    })
})
