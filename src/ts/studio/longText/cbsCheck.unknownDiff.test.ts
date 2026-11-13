import fc from 'fast-check'
import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'
import { ASSET_DISPLAY_NAMES, checkCbs, type CbsCheckResult, type CbsFix } from './cbsCheck'
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

// A variable the text does not name reads as its own key.
const varStorage = vi.hoisted(() => new Proxy({}, {
    get(_, prop) {
        if(typeof prop !== 'string'){
            return 'null'
        }
        return prop.startsWith('$') ? prop.slice(1) : prop
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

import { assetRegex, risuChatParser } from 'src/ts/parser/parser.svelte'
import { collectMacroEntries } from './macroRegistry'

const index = createMacroIndex(collectMacroEntries())

// The parser keeps `callStack` on its options object, so every call gets a fresh one.
const run = (text: string): string => risuChatParser(text, {})

const check = (text: string): CbsCheckResult => checkCbs(text, index, { mode: 'cbs', slotAllowed: true })

//#region unknown macros against the engine

// A tree of plain text, known macros, macros no registry entry answers, and blocks whose body the
// engine renders in place or drops without evaluating (never one that keeps its body as raw text,
// where the macro is visible although it is not run).
type Node =
    | { kind: 'text' }
    | { kind: 'known' }
    | { kind: 'unknown'; form: 'bare' | 'args' | 'nested-arg' }
    | { kind: 'block'; head: string; kids: Node[] }

const HEADS = ['#if 1', '#if 0', '#when 1', '#when::keep::1', '#if_pure 1']

const unknownArb: fc.Arbitrary<Node> = fc.constantFrom<'bare' | 'args' | 'nested-arg'>('bare', 'args', 'nested-arg')
    .map((form): Node => ({ kind: 'unknown', form }))

const leafArb: fc.Arbitrary<Node> = fc.oneof(
    fc.constant<Node>({ kind: 'text' }),
    fc.constant<Node>({ kind: 'known' }),
    unknownArb,
    unknownArb,
)

const nodeArb = (depth: number): fc.Arbitrary<Node> => depth === 0
    ? leafArb
    : fc.oneof(
        leafArb,
        leafArb,
        fc.record({
            kind: fc.constant<'block'>('block'),
            head: fc.constantFrom(...HEADS),
            kids: fc.array(nodeArb(depth - 1), { maxLength: 3 }),
        }),
    )

type Built = { text: string; unknownAt: Map<number, number> }

// Each node gets a fresh id; an unknown macro is named `k<id>.` and starts at the offset recorded for it.
function build(nodes: readonly Node[]): Built {
    const built: Built = { text: '', unknownAt: new Map() }
    let next = 0
    const emit = (list: readonly Node[]) => {
        for(const node of list){
            const id = next++
            switch(node.kind){
                case 'text':
                    built.text += `q${id}.`
                    break
                case 'known':
                    built.text += `{{trim::K${id}.}}`
                    break
                case 'unknown':
                    built.unknownAt.set(id, built.text.length)
                    built.text += node.form === 'bare' ? `{{k${id}.}}`
                        : node.form === 'args' ? `{{k${id}.::a}}` : `{{k${id}.::{{trim::z}}}}`
                    break
                case 'block':
                    built.text += `{{${node.head}}}`
                    emit(node.kids)
                    built.text += `{{/${node.head.slice(1, node.head.startsWith('#when') ? 5 : node.head.indexOf(' '))}}}`
                    break
            }
        }
    }
    emit(nodes)
    return built
}

describe('unknown macros against the engine', () => {
    test('an unknown macro is reported exactly when the engine leaves it visible (generated)', () => {
        let withUnknown = 0
        let visibleAny = 0
        fc.assert(
            fc.property(fc.array(nodeArb(2), { minLength: 1, maxLength: 5 }), (nodes) => {
                const { text, unknownAt } = build(nodes)
                const result = check(text)
                expect(result.valueDependent, text).toBe(false)
                const output = run(text)
                const visible = new Set<number>()
                const reported = new Set<number>()
                for(const id of unknownAt.keys()){
                    if(output.includes(`{{k${id}.`)){
                        visible.add(id)
                    }
                }
                for(const problem of result.problems){
                    if(problem.kind !== 'unknown-macro'){
                        continue
                    }
                    const id = [...unknownAt].find(([, start]) => start === problem.start)?.[0]
                    expect(id, `${problem.start} is no unknown macro in ${JSON.stringify(text)}`).toBeDefined()
                    reported.add(id as number)
                }
                expect({ text, ids: [...reported].sort() }).toEqual({ text, ids: [...visible].sort() })
                if(unknownAt.size > 0){
                    withUnknown++
                }
                if(visible.size > 0){
                    visibleAny++
                }
            }),
            { seed: 20261113, numRuns: 400 },
        )
        // The comparison only informs while many texts hold an unknown macro and the engine shows some.
        expect(withUnknown).toBeGreaterThan(200)
        expect(visibleAny).toBeGreaterThan(100)
    })

    test('the engine leaves an unknown macro as text, and a dropped body hides it (literal rows)', () => {
        expect(run('{{k0.}}')).toBe('{{k0.}}')
        expect(run('{{#if 0}}{{k0.}}{{/if}}')).toBe('')
        expect(check('{{#if 0}}{{k0.}}{{/if}}').problems.filter((p) => p.kind === 'unknown-macro')).toEqual([])
        expect(check('{{#if 1}}{{k0.}}{{/if}}').problems.filter((p) => p.kind === 'unknown-macro')).toHaveLength(1)
    })
})

//#endregion

//#region the asset-display names against the engine's own list

describe('the asset-display names', () => {
    const engineNames = (() => {
        const group = /\(([^()]*)\)::/.exec(assetRegex.source)
        return group ? group[1].split('|') : []
    })()

    test('are exactly the names of the engine regex, in both directions', () => {
        expect(engineNames.length).toBeGreaterThan(0)
        expect([...ASSET_DISPLAY_NAMES].sort()).toEqual([...engineNames].sort())
    })

    test('each name is matched by the engine regex before ::', () => {
        for(const name of ASSET_DISPLAY_NAMES){
            const fresh = new RegExp(assetRegex.source, assetRegex.flags)
            expect(fresh.test(`{{${name}::a}}`), name).toBe(true)
        }
    })

    test('with the real registry, no named entry is reported as unknown', () => {
        const names = index.entries.filter((e) => !e.blockSyntax).flatMap((e) => [e.name, ...e.aliases])
        expect(names.length).toBeGreaterThan(100)
        for(const name of names){
            const unknown = check(`{{${name}::a}}`).problems.filter((p) => p.kind === 'unknown-macro')
            expect(unknown, name).toEqual([])
        }
    })
})

//#endregion

//#region fixes against the engine

const TOKENS = ['<user>', '<char>', '<bot>', '<USER>', '<Char>', 'a', ' ', '\n', ':', '{{trim::b}}', '{{user}}', '}}', '{{']
const textArb = fc.array(fc.constantFrom(...TOKENS), { minLength: 1, maxLength: 12 }).map((tokens) => tokens.join(''))

function applyFixes(text: string, fixes: readonly CbsFix[]): string {
    let out = text
    for(const fix of [...fixes].sort((a, b) => b.start - a.start)){
        out = out.slice(0, fix.start) + fix.text + out.slice(fix.end)
    }
    return out
}

describe('fixes keep the parser output', () => {
    test('every span lies in the text and every fix replaces exactly one role tag (generated)', () => {
        let withFix = 0
        fc.assert(
            fc.property(textArb, (text) => {
                const result = check(text)
                for(const problem of result.problems){
                    expect(problem.start, text).toBeGreaterThanOrEqual(0)
                    expect(problem.start, text).toBeLessThanOrEqual(problem.end)
                    expect(problem.end, text).toBeLessThanOrEqual(text.length)
                    if(problem.fix){
                        expect(text.slice(problem.fix.start, problem.fix.end), text).toMatch(/^<(user|char|bot)>$/i)
                        expect(problem.fix.start).toBe(problem.start)
                        expect(problem.fix.end).toBe(problem.end)
                    }
                }
                const fixes = result.problems.flatMap((p) => p.fix ? [p.fix] : [])
                if(fixes.length > 0){
                    withFix++
                }
                expect(run(applyFixes(text, fixes)), text).toBe(run(text))
            }),
            { seed: 20261113, numRuns: 400 },
        )
        expect(withFix).toBeGreaterThan(150)
    })

    test('a macro spelling renders like the tag it replaces (literal rows)', () => {
        for(const text of ['<user> and <char> and <bot>', '<USER>:<Char>', 'a\n<char> b\nx <bot>: c']){
            const fixes = check(text).problems.flatMap((p) => p.fix ? [p.fix] : [])
            expect(fixes.length, text).toBeGreaterThan(0)
            expect(run(applyFixes(text, fixes)), text).toBe(run(text))
        }
    })
})

//#endregion
