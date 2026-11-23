// T2-RF-11: `riskyTurnOnsOf`, pure. A write turns a flag on only when it writes `true` over a live value that is not
// `true`; the live value is read through the reader, so a write of `true` over a live `true` turns nothing on.
import { describe, expect, test } from 'vitest'
import type { FieldValue, LiveReader, SetPath, WriteOp } from '../history/historyModel'
import { RISKY_FLAG_PATHS, riskyTurnOnsOf } from './riskyFlags'

function reader(values: Partial<Record<SetPath, FieldValue>>): LiveReader {
    return {
        field: (path) => values[path] ?? { had: false },
        greetings: () => null,
        fmIndex: () => null,
        text: () => null,
        assetRows: () => null,
        folderValue: () => undefined,
    }
}

const on = (path: SetPath): WriteOp => ({ op: 'set', path, value: { had: true, value: true } })

describe('T2-RF-11: riskyTurnOnsOf', () => {
    test('the three risky paths are the literal list', () => {
        expect([...RISKY_FLAG_PATHS]).toEqual(['lowLevelAccess', 'utilityBot', 'escapeOutput'])
    })

    test('a write of true over a live true turns nothing on', () => {
        expect(riskyTurnOnsOf([on('utilityBot')], reader({ utilityBot: { had: true, value: true } }))).toEqual([])
    })

    test.each<[string, FieldValue]>([
        ['absent', { had: false }],
        ['false', { had: true, value: false }],
    ])('a write of true over a live value that is %s turns the flag on', (_name, live) => {
        expect(riskyTurnOnsOf([on('utilityBot')], reader({ utilityBot: live }))).toEqual(['utilityBot'])
    })

    test('a write of false, an absent write and a non-risky path name nothing', () => {
        expect(riskyTurnOnsOf([{ op: 'set', path: 'utilityBot', value: { had: true, value: false } }], reader({}))).toEqual([])
        expect(riskyTurnOnsOf([{ op: 'set', path: 'utilityBot', value: { had: false } }], reader({}))).toEqual([])
        expect(riskyTurnOnsOf([on('hideChatIcon')], reader({}))).toEqual([])
        expect(riskyTurnOnsOf([{ op: 'listSet', index: 0, value: 'x' }], reader({}))).toEqual([])
    })

    test('two writes of one path name it once, in write order', () => {
        expect(riskyTurnOnsOf([on('escapeOutput'), on('lowLevelAccess'), on('escapeOutput')], reader({}))).toEqual(['escapeOutput', 'lowLevelAccess'])
    })
})
