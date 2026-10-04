import { beforeEach, describe, expect, test } from 'vitest'
import {
    beginMainFileWrite,
    confirmMainFileWrite,
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

    test('a write is unknown from the moment it begins until it is confirmed', () => {
        const attempt = beginMainFileWrite()
        expect(isMainFileOutcomeKnown()).toBe(false)
        confirmMainFileWrite(attempt)
        expect(isMainFileOutcomeKnown()).toBe(true)
    })

    test('a write that is never confirmed leaves the outcome unknown, also after later recorded bytes', () => {
        beginMainFileWrite()
        noteMainFileRecorded()
        expect(isMainFileOutcomeKnown()).toBe(false)
    })

    test('a later confirmed write makes an earlier unconfirmed one known again', () => {
        beginMainFileWrite()
        confirmMainFileWrite(beginMainFileWrite())
        expect(isMainFileOutcomeKnown()).toBe(true)
    })

    test('an older confirmation does not resolve a newer attempt', () => {
        const older = beginMainFileWrite()
        beginMainFileWrite()
        confirmMainFileWrite(older)
        expect(isMainFileOutcomeKnown()).toBe(false)
    })

    test('a read is known once its bytes are recorded, and not before', () => {
        beginMainFileWrite()
        noteMainFileRead()
        expect(isMainFileOutcomeKnown()).toBe(false)
        noteMainFileRecorded()
        expect(isMainFileOutcomeKnown()).toBe(true)
    })

    test('a read that is never recorded leaves the outcome unknown', () => {
        noteMainFileRead()
        expect(isMainFileOutcomeKnown()).toBe(false)
    })

    test('a write that begins after a read makes that read stale, so recording it does not resolve the outcome', () => {
        noteMainFileRead()
        beginMainFileWrite()
        noteMainFileRecorded()
        expect(isMainFileOutcomeKnown()).toBe(false)
    })

    test('every event moves the epoch, and a reset never returns an older one', () => {
        const start = getMainFileEpoch()
        const attempt = beginMainFileWrite()
        const afterBegin = getMainFileEpoch()
        confirmMainFileWrite(attempt)
        const afterConfirm = getMainFileEpoch()
        noteMainFileRead()
        const afterRead = getMainFileEpoch()
        noteMainFileRecorded()
        const afterRecord = getMainFileEpoch()
        expect(new Set([start, afterBegin, afterConfirm, afterRead, afterRecord]).size).toBe(5)
        resetMainFileOutcomeForTests()
        expect(getMainFileEpoch()).toBeGreaterThan(afterRecord)
    })
})
