// T2-RF-11: `riskyTurnOnsOf`, pure. A write turns a flag on only when it writes an on value over a live value that is
// not on; the live value is read through the reader, so a write of `true` over a live `true` turns nothing on. The
// character paths are decided by any write of the plan (they are written in place, one write at a time, so an
// intermediate turn-on is live); the module path by its last write (a module is written as one copy assigned once).
import { describe, expect, test } from 'vitest'
import type { FieldValue, LiveReader, SetPath, WriteOp } from '../history/historyModel'
import { CHARACTER_RISKY_FLAG_PATHS, RISKY_FLAG_PATHS, RISKY_FLAG_RULE, riskyTurnOnsOf } from './riskyFlags'

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
    test('the four risky paths, the three of a character and each path\'s rule are the literal lists', () => {
        expect([...RISKY_FLAG_PATHS]).toEqual(['lowLevelAccess', 'utilityBot', 'escapeOutput', 'moduleLowLevelAccess', 'lowLevelAccessFix', 'utilityBotFix', 'escapeOutputFix'])
        expect([...CHARACTER_RISKY_FLAG_PATHS]).toEqual(['lowLevelAccess', 'utilityBot', 'escapeOutput'])
        expect(RISKY_FLAG_RULE).toEqual({ lowLevelAccess: 'anyWrite', utilityBot: 'anyWrite', escapeOutput: 'anyWrite', moduleLowLevelAccess: 'lastWrite', lowLevelAccessFix: 'anyWrite', utilityBotFix: 'anyWrite', escapeOutputFix: 'anyWrite' })
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

    test('a character path is decided by any write: on then off over a live off names it', () => {
        const off: WriteOp = { op: 'set', path: 'utilityBot', value: { had: true, value: false } }
        expect(riskyTurnOnsOf([on('utilityBot'), off], reader({ utilityBot: { had: true, value: false } }))).toEqual(['utilityBot'])
    })

    test('the module path is decided by its last write: on then off over a live absent names nothing', () => {
        const off: WriteOp = { op: 'set', path: 'moduleLowLevelAccess', value: { had: true, value: false } }
        expect(riskyTurnOnsOf([on('moduleLowLevelAccess'), off], reader({}))).toEqual([])
        expect(riskyTurnOnsOf([off, on('moduleLowLevelAccess')], reader({}))).toEqual(['moduleLowLevelAccess'])
    })

    test('a foreign truthy value reads on: written over a live absent it names the module path, over a live foreign 1 it does not', () => {
        const foreign: WriteOp = { op: 'set', path: 'moduleLowLevelAccess', value: { had: 'foreign', value: 1 } }
        expect(riskyTurnOnsOf([foreign], reader({}))).toEqual(['moduleLowLevelAccess'])
        expect(riskyTurnOnsOf([foreign], reader({ moduleLowLevelAccess: { had: 'foreign', value: 1 } }))).toEqual([])
    })

    test('two writes of one path name it once, in write order', () => {
        expect(riskyTurnOnsOf([on('escapeOutput'), on('lowLevelAccess'), on('escapeOutput')], reader({}))).toEqual(['escapeOutput', 'lowLevelAccess'])
    })
})
