/**
 * TS11, the cells that need no classic component: refusals (`null`), the typeless-row rules (MC-4116), purity and
 * aliasing, and the block-range table. The typeless arrays N1 and N2 are synthetic, because classic throws on
 * those values; their expected arrays are written out by hand from the rules.
 *
 * Titles saying "regression reproducer" fail against a module that returns its input unchanged; titles saying
 * "compatibility guard" pass before and after.
 */
import { describe, expect, test } from 'vitest'
import type { triggerEffect, triggerEffectV2 } from '../../../process/triggers'
import {
    appendEffect, canMoveEffect, copyEffects, deleteEffect, getBlockRange, getInsertIndent, insertEffectBefore, isBlockOpener,
    moveEffect, moveEffectDown, moveEffectUp, pasteEffects, replaceEffect,
} from '../triggerV2Blocks'
import { v2DefaultEffect } from '../triggerV2Defaults'
import {
    BLOCK_END, CORPUS_IDS, MALFORMED_IDS, TYPELESS_IDS, WELL_FORMED_IDS, corpusArray, typeOfRow,
} from './triggerBlockCorpus.test-helpers'
import { firstDifference } from './triggerExactEqual.test-helpers'

const rows = (id: string): triggerEffect[] => corpusArray(id)

const sameAs = (actual: unknown, expected: unknown): void => {
    expect(firstDifference(actual, expected)).toBeNull()
}

describe('TS11-R refusals return null', () => {
    test('regression reproducer: an index outside what the classic UI can target is refused by every list function', () => {
        const input = rows('W2')
        const edited = v2DefaultEffect('v2IfAdvanced')
        const effect = v2DefaultEffect('v2SetVar')
        for (const bad of [-1, input.length, 1.5, Number.NaN]) {
            expect(insertEffectBefore(input, bad, effect, { addElse: false }), `insert ${bad}`).toBeNull()
            expect(replaceEffect(input, bad, edited, { addElse: false }), `replace ${bad}`).toBeNull()
            expect(deleteEffect(input, bad), `delete ${bad}`).toBeNull()
            expect(copyEffects(input, bad), `copy ${bad}`).toBeNull()
            expect(moveEffectUp(input, bad), `up ${bad}`).toBeNull()
            expect(moveEffectDown(input, bad), `down ${bad}`).toBeNull()
        }
        for (const bad of [-1, input.length + 1, 0.5]) {
            expect(pasteEffects(input, bad, [effect]), `paste ${bad}`).toBeNull()
        }
        expect(pasteEffects(input, input.length, [effect]), 'paste at the end is allowed').not.toBeNull()
    })

    test('regression reproducer: Move up of row 0 and Move down past the end of every corpus array return null', () => {
        for (const id of CORPUS_IDS) {
            const input = rows(id)
            if (input.length === 0) continue
            expect(moveEffectUp(input, 0), `${id} up 0`).toBeNull()
            input.forEach((_, index) => {
                const end = BLOCK_END[id]?.[index] ?? index
                if (end + 2 > input.length) expect(moveEffectDown(input, index), `${id} down ${index}`).toBeNull()
            })
        }
    })

    test('regression reproducer: copying a v2Else row returns null', () => {
        for (const id of CORPUS_IDS) {
            rows(id).forEach((row, index) => {
                if (typeOfRow(row) === 'v2Else') expect(copyEffects(rows(id), index), `${id} ${index}`).toBeNull()
            })
        }
    })

    test('regression reproducer: pasting nothing returns null', () => {
        expect(pasteEffects(rows('W1'), 0, [])).toBeNull()
    })

    test('regression reproducer: Move up and Move down of every v2EndIndent and v2Else row return null (classic renders no handle, so there is no drive)', () => {
        let checked = 0
        for (const id of [...WELL_FORMED_IDS, ...MALFORMED_IDS]) {
            rows(id).forEach((row, index) => {
                if (typeOfRow(row) !== 'v2EndIndent' && typeOfRow(row) !== 'v2Else') return
                expect(moveEffectUp(rows(id), index), `${id} up ${index}`).toBeNull()
                expect(moveEffectDown(rows(id), index), `${id} down ${index}`).toBeNull()
                expect(canMoveEffect(rows(id), index, index + 2), `${id} can ${index}`).toBe(false)
                checked++
            })
        }
        expect(checked).toBeGreaterThan(20)
    })
})

describe('TS11 block rules read from the arrays', () => {
    test('regression reproducer: isBlockOpener holds for the four opener types only', () => {
        for (const type of ['v2If', 'v2IfAdvanced', 'v2Loop', 'v2LoopNTimes'] as const) {
            expect(isBlockOpener(v2DefaultEffect(type)), type).toBe(true)
        }
        for (const type of ['v2SetVar', 'v2Else', 'v2Comment'] as const) {
            expect(isBlockOpener(v2DefaultEffect(type)), type).toBe(false)
        }
        expect(isBlockOpener({ type: 'v2EndIndent', indent: 1 })).toBe(false)
        expect(isBlockOpener(null as unknown as triggerEffect)).toBe(false)
    })

    test('regression reproducer: getBlockRange equals the hand-derived table for every opener and is {i, i} for every other row', () => {
        for (const id of CORPUS_IDS) {
            rows(id).forEach((row, index) => {
                const end = BLOCK_END[id]?.[index] ?? index
                expect(getBlockRange(rows(id), index), `${id} ${index} ${String(typeOfRow(row))}`).toEqual({ start: index, end })
            })
        }
    })

    test('regression reproducer: an Else at the wrong indent ends the block at the End but is still unwrapped by delete (M7)', () => {
        const input = rows('M7')
        expect(getBlockRange(input, 0)).toEqual({ start: 0, end: 2 })
        sameAs(deleteEffect(rows('M7'), 0), [{ ...(input[1] as object), indent: 0 }, { ...(input[4] as object), indent: 0 }])
    })

    test('compatibility guard: getInsertIndent follows the row before the position, End rows and the end of the list', () => {
        const w3 = rows('W3')
        expect(getInsertIndent(w3, 0)).toBe(0)
        expect(getInsertIndent(w3, 1)).toBe(1)
        expect(getInsertIndent(w3, 2)).toBe(1)
        expect(getInsertIndent(w3, 3)).toBe(0)
        expect(getInsertIndent(w3, w3.length)).toBe(0)
        expect(getInsertIndent(rows('W0'), 0)).toBe(0)
        expect(getInsertIndent(rows('W2'), 3)).toBe(0)
    })
})

describe('TS11 replaceEffect writes the edited row', () => {
    test('regression reproducer: a non-If row is replaced by the edited row at its index and nothing else changes', () => {
        const input = rows('W1')
        const edited = { ...(rows('W1')[1] as object), value: 'changed' } as triggerEffectV2
        const expected = rows('W1')
        expected[1] = edited
        sameAs(replaceEffect(input, 1, edited, { addElse: false }), expected)
    })

    test('regression reproducer: an If row with the toggle unchanged is replaced by the edited row and is not refused', () => {
        for (const [id, index, addElse] of [['W2', 0, false], ['W3', 0, true], ['W7', 0, true], ['M2', 0, false]] as const) {
            const input = rows(id)
            const edited = { ...(rows(id)[index] as object), source: 'changed' } as triggerEffectV2
            const expected = rows(id)
            expected[index] = edited
            sameAs(replaceEffect(input, index, edited, { addElse }), expected)
        }
    })
})

describe('TS11-N typeless rows (MC-4116; synthetic, because classic throws on these values)', () => {
    const n1 = (): triggerEffect[] => rows('N1')
    const setVar = (value: string, indent: number): triggerEffect => ({ ...v2DefaultEffect('v2SetVar'), value, indent } as triggerEffect)
    const ifAdv = (): triggerEffect => v2DefaultEffect('v2IfAdvanced')
    const end1 = (): triggerEffect => ({ type: 'v2EndIndent', indent: 1 })

    test('regression reproducer (a): deleting the null or the string removes only that row', () => {
        sameAs(deleteEffect(n1(), 1), [setVar('a', 0), 'x', ifAdv(), setVar('b', 1), end1(), 7])
        sameAs(deleteEffect(n1(), 2), [setVar('a', 0), null, ifAdv(), setVar('b', 1), end1(), 7])
    })

    test('regression reproducer (b): copying a string gives it as it is and pasting it above the opener does not write to it', () => {
        const copied = copyEffects(n1(), 2)
        sameAs(copied, ['x'])
        sameAs(pasteEffects(n1(), 3, copied ?? []), [setVar('a', 0), null, 'x', 'x', ifAdv(), setVar('b', 1), end1(), 7])
    })

    test('regression reproducer (c): a typeless row moves up and down like any leaf', () => {
        sameAs(moveEffectUp(n1(), 1), [null, setVar('a', 0), 'x', ifAdv(), setVar('b', 1), end1(), 7])
        sameAs(moveEffectDown(n1(), 1), [setVar('a', 0), 'x', null, ifAdv(), setVar('b', 1), end1(), 7])
    })

    test('regression reproducer (d): deleting the opener dedents its child, removes the End and leaves the later row alone', () => {
        sameAs(deleteEffect(n1(), 3), [setVar('a', 0), null, 'x', setVar('b', 0), 7])
    })

    test('regression reproducer (e): inserting above a typeless row writes its undefined indent, keeping the key at its default position', () => {
        const studio = insertEffectBefore(n1(), 1, v2DefaultEffect('v2SetVar'), { addElse: false })
        sameAs(studio, [setVar('a', 0), { ...v2DefaultEffect('v2SetVar'), indent: undefined }, null, 'x', ifAdv(), setVar('b', 1), end1(), 7])
    })

    test('regression reproducer (f): getBlockRange of a typeless row is {i, i}', () => {
        for (const index of [1, 2, 6]) expect(getBlockRange(n1(), index)).toEqual({ start: index, end: index })
    })

    test('regression reproducer (g): moving the opener block above a typeless row computes NaN indents, as classic does for a missing indent', () => {
        const nan = (row: triggerEffect): triggerEffect => ({ ...(row as object), indent: Number.NaN } as triggerEffect)
        sameAs(moveEffect(n1(), 3, 2), [setVar('a', 0), null, nan(ifAdv()), nan(setVar('b', 1)), nan(end1()), 'x', 7])
    })

    test('regression reproducer (h): deleting the opener of N2 skips the null without writing to it', () => {
        sameAs(deleteEffect(rows('N2'), 0), [null, setVar('a', 0)])
    })
})

/** Freezes the value and everything reachable from it, so that any write during a call throws in strict mode. */
function deepFreeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
        Object.freeze(value)
        for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
    }
    return value
}

function collectObjects(value: unknown, into: Set<object>): void {
    if (typeof value !== 'object' || value === null || into.has(value)) return
    into.add(value)
    for (const key of Object.keys(value)) collectObjects((value as Record<string, unknown>)[key], into)
}

type Call = readonly [string, () => triggerEffect[] | null, readonly unknown[]]

/** Every list function at every index of `effects`, each with its inputs, for the purity and aliasing tests. */
function callsFor(effects: triggerEffect[]): Call[] {
    const calls: Call[] = []
    const setVar = deepFreeze(v2DefaultEffect('v2SetVar'))
    const ifAdvanced = deepFreeze(v2DefaultEffect('v2IfAdvanced'))
    const loop = deepFreeze(v2DefaultEffect('v2LoopNTimes'))
    for (const [name, effect, addElse] of [['SetVar', setVar, false], ['IfAdvanced+Else', ifAdvanced, true], ['LoopNTimes', loop, false]] as const) {
        calls.push([`append ${name}`, () => appendEffect(effects, effect, { addElse }), [effect]])
    }
    for (let index = 0; index < effects.length; index++) {
        for (const addElse of [false, true]) {
            calls.push([`insert ${index} ${addElse}`, () => insertEffectBefore(effects, index, ifAdvanced, { addElse }), [ifAdvanced]])
            calls.push([`replace ${index} ${addElse}`, () => replaceEffect(effects, index, ifAdvanced, { addElse }), [ifAdvanced]])
        }
        calls.push([`delete ${index}`, () => deleteEffect(effects, index), []])
        calls.push([`copy ${index}`, () => copyEffects(effects, index), []])
        const copied = copyEffects(effects, index)
        if (copied !== null) {
            deepFreeze(copied)
            for (let at = 0; at <= effects.length; at++) calls.push([`paste ${index} at ${at}`, () => pasteEffects(effects, at, copied), [copied]])
        }
        calls.push([`up ${index}`, () => moveEffectUp(effects, index), []])
        calls.push([`down ${index}`, () => moveEffectDown(effects, index), []])
        for (let to = 0; to <= effects.length; to++) calls.push([`move ${index} to ${to}`, () => moveEffect(effects, index, to), []])
    }
    return calls
}

const PURITY_IDS = [...CORPUS_IDS, ...TYPELESS_IDS]

describe('TS11-Pm purity: inputs are never mutated and no function throws on a frozen input', () => {
    test.each(PURITY_IDS)('compatibility guard (passes before and after; the mutants MT8 and MT14 make it fail): every function on frozen %s writes nothing and throws nothing', (id) => {
        const effects = deepFreeze(rows(id))
        const before = JSON.stringify(effects)
        const calls = callsFor(effects)
        expect(calls.length).toBeGreaterThan(0)
        for (const [label, call] of calls) {
            expect(() => call(), `${id} ${label}`).not.toThrow()
        }
        expect(JSON.stringify(effects)).toBe(before)
    })
})

describe('TS11-Pa aliasing: the result is a new array that shares no object with any input', () => {
    test.each(PURITY_IDS)('regression reproducer: every result on %s is a new array of new objects', (id) => {
        const effects = rows(id)
        const inputObjects = new Set<object>()
        collectObjects(effects, inputObjects)
        const calls = callsFor(effects)
        let results = 0
        for (const [label, call, extra] of calls) {
            const result = call()
            if (result === null) continue
            results++
            const argumentObjects = new Set<object>(inputObjects)
            for (const value of extra) collectObjects(value, argumentObjects)
            expect(result, `${id} ${label}: same array`).not.toBe(effects)
            const seen = new Set<object>()
            collectObjects(result, seen)
            // the result's own root array is not an input; every other object must be new
            for (const object of seen) {
                expect(argumentObjects.has(object), `${id} ${label}: shares an object with an input`).toBe(false)
            }
        }
        expect(results).toBeGreaterThan(0)
    })
})
