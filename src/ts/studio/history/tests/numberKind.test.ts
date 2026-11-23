// S4b: the number value kind of the history engine. Stored kinds (character, chat, module) keep reading their records
// byte for byte, a number is accepted on a number path only, a non-finite number is refused everywhere, and every
// "which kind may this path carry" decision is the one `valueMatchesKind`.
import { describe, expect, test } from 'vitest'
import { FIELD_SPECS } from '../fieldRegistry'
import { cloneValue, typeofKind, valueMatchesKind } from '../fieldAccess'
import { parseOwnerRecord, SET_PATHS_BY_KIND, textPathsFor, valuePathsFor, type OwnerRecord, type SetPath } from '../historyModel'
import { characterOwnerKey, moduleOwnerKey, type StoredOwnerKey } from '../ownerPhase'
import { PRESET_S4B_NUMBER_PATHS, PRESET_S4B_PATHS } from './presetPaths.test-helpers'

const CHARACTER = characterOwnerKey('c1')
const MODULE = moduleOwnerKey('m1')

function record(ownerKey: StoredOwnerKey, done: unknown[], restore: unknown = null): unknown {
    return { ownerKey, touchedAt: 4, done, undone: [], deleted: [], restore }
}

function setStep(path: string, before: unknown, after: unknown): unknown {
    return { id: 'p:1', at: 1, label: { kind: 'field', field: path }, ops: [{ op: 'set', path, before, after }] }
}

const present = (value: unknown): unknown => ({ had: true, value })

describe('S4b-T1: records of the stored kinds written before the number kind read back unchanged', () => {
    // Hand-built literals of the stored shape for text and boolean steps and a restore point (the real-writer path is
    // covered by the history suites): the number kind touches none of these paths.
    const CHARACTER_BYTES = JSON.stringify(
        record(
            CHARACTER,
            [
                setStep('desc', present('old'), present('new')),
                setStep('hideChatIcon', { had: false }, present(true)),
                setStep('bias', present([['a', 3]]), present([['a', 4]])),
            ],
            { visitId: 'v1', at: 2, fields: { desc: { before: present('old'), last: present('new') }, hideChatIcon: { before: { had: false }, last: present(true) } } },
        ),
    )
    const MODULE_BYTES = JSON.stringify(
        record(MODULE, [setStep('moduleName', present('a'), present('b')), setStep('moduleLowLevelAccess', { had: false }, present(false))]),
    )

    test('a character record with text, boolean and bias steps and a restore point parses to the same record', () => {
        const parsed = parseOwnerRecord(JSON.parse(CHARACTER_BYTES), CHARACTER)
        expect(parsed).not.toBeNull()
        expect(JSON.parse(JSON.stringify(parsed))).toEqual(JSON.parse(CHARACTER_BYTES))
    })

    test('a module record with a text and a boolean step parses to the same record', () => {
        const parsed = parseOwnerRecord(JSON.parse(MODULE_BYTES), MODULE)
        expect(parsed).not.toBeNull()
        expect(JSON.parse(JSON.stringify(parsed))).toEqual(JSON.parse(MODULE_BYTES))
    })
})

describe('S4b-T2: a stored record never holds a number, and a non-finite number is refused everywhere', () => {
    const read = (key: StoredOwnerKey, step: unknown): OwnerRecord | null => parseOwnerRecord(record(key, [step]), key)

    test('a number on a text path or a boolean path is refused whole', () => {
        expect(read(CHARACTER, setStep('desc', present('a'), present(5)))).toBeNull()
        expect(read(CHARACTER, setStep('hideChatIcon', { had: false }, present(1)))).toBeNull()
        expect(read(MODULE, setStep('moduleName', present('a'), present(7)))).toBeNull()
        expect(read(CHARACTER, setStep('desc', present('a'), present('b')))).not.toBeNull()
    })

    test('a set of a preset number path under a character, chat or module key is refused whole', () => {
        for (const path of PRESET_S4B_NUMBER_PATHS) {
            expect(read(CHARACTER, setStep(path, { had: false }, present(5))), path).toBeNull()
            expect(read(MODULE, setStep(path, { had: false }, present(5))), path).toBeNull()
        }
    })

    test('NaN and the infinities are not values of any kind of path', () => {
        for (const path of Object.keys(FIELD_SPECS) as SetPath[]) {
            for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
                expect(valueMatchesKind(path, bad), `${path} ${String(bad)}`).toBe(false)
            }
        }
        expect(valueMatchesKind('presetTemperature', 80)).toBe(true)
        expect(valueMatchesKind('presetTemperature', -1000)).toBe(true)
        expect(valueMatchesKind('presetTemperature', Number.NaN)).toBe(false)
    })
})

describe('S4b-T11 (helper): one decision of which kind each path carries', () => {
    const numberPaths = PRESET_S4B_NUMBER_PATHS as readonly SetPath[]
    const textS4b = PRESET_S4B_PATHS.filter((path) => !numberPaths.includes(path))

    test('a number path takes a finite number only; a text path takes a string only; a boolean path a boolean only', () => {
        for (const path of numberPaths) {
            expect(valueMatchesKind(path, 5), path).toBe(true)
            expect(valueMatchesKind(path, '5'), path).toBe(false)
            expect(valueMatchesKind(path, true), path).toBe(false)
            expect(typeofKind(path), path).toBe('number')
        }
        for (const path of textS4b) {
            expect(valueMatchesKind(path, 'x'), path).toBe(true)
            expect(valueMatchesKind(path, 5), path).toBe(false)
            expect(typeofKind(path), path).toBe('string')
        }
        expect(valueMatchesKind('hideChatIcon', 5)).toBe(false)
        expect(valueMatchesKind('desc', 5)).toBe(false)
        expect(valueMatchesKind('bias', 5)).toBe(false)
    })

    test('the text row of the preset kind holds no number path, the value row holds them, and no stored kind holds one', () => {
        for (const path of numberPaths) {
            expect(textPathsFor('preset'), path).not.toContain(path)
            expect(valuePathsFor('preset'), path).toContain(path)
            for (const kind of ['character', 'chat', 'module'] as const) {
                expect(SET_PATHS_BY_KIND[kind], `${kind} ${path}`).not.toContain(path)
                expect(valuePathsFor(kind), `${kind} ${path}`).not.toContain(path)
            }
        }
        for (const kind of ['character', 'chat', 'module'] as const) {
            expect(valuePathsFor(kind).every((path) => FIELD_SPECS[path].value === 'bool'), kind).toBe(true)
        }
    })

    test('a number is copied as is', () => {
        expect(cloneValue(7)).toBe(7)
    })
})
