import { beforeEach, describe, expect, test } from 'vitest'
import {
    getMainFileEpoch,
    isMainFileOutcomeKnown,
    noteMainFileRead,
    noteMainFileRecorded,
    resetMainFileOutcomeForTests,
} from '../mainFileOutcome'

beforeEach(() => {
    resetMainFileOutcomeForTests()
})

describe('main-file outcome tracking', () => {
    test('is known before anything happens', () => {
        expect(isMainFileOutcomeKnown()).toBe(true)
    })

    test('a read is known once its bytes are recorded, and not before', () => {
        noteMainFileRead()
        expect(isMainFileOutcomeKnown()).toBe(false)
        noteMainFileRecorded()
        expect(isMainFileOutcomeKnown()).toBe(true)
    })

    test('a read that is never recorded leaves the outcome unknown', () => {
        noteMainFileRead()
        expect(isMainFileOutcomeKnown()).toBe(false)
    })

    test('every event moves the epoch, and a reset never returns an older one', () => {
        const start = getMainFileEpoch()
        noteMainFileRead()
        const afterRead = getMainFileEpoch()
        noteMainFileRecorded()
        const afterRecord = getMainFileEpoch()
        expect(new Set([start, afterRead, afterRecord]).size).toBe(3)
        resetMainFileOutcomeForTests()
        expect(getMainFileEpoch()).toBeGreaterThan(afterRecord)
    })
})
