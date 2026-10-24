/**
 * `sessionUse`: what counts as use since launch. Reproducers: each signal fails against a tracker that records nothing.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('../stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { selectedCharID: writable(-1), loadedStore: writable(false) } as unknown as typeof import('../stores.svelte')
})

const saveMarks = vi.hoisted(() => ({ count: 0 }))
vi.mock(import('../globalApi.svelte'), () => ({
    getSaveMarkCount: () => saveMarks.count,
}) as unknown as typeof import('../globalApi.svelte'))

import { loadedStore, selectedCharID } from '../stores.svelte'
import { beginInFlight, resetInFlightForTest } from './inFlightWork'
import { noteReadyBaseline, resetSessionUseForTest, sessionUse, startSessionUseTracking } from './sessionUse'

beforeEach(() => {
    resetSessionUseForTest()
    resetInFlightForTest()
    selectedCharID.set(-1)
    loadedStore.set(false)
    saveMarks.count = 0
})

afterEach(() => {
    resetSessionUseForTest()
    resetInFlightForTest()
})

describe('sessionUse', () => {
    test('reproducer: opening a character is remembered, and the boot value of -1 is not', () => {
        startSessionUseTracking()
        expect(sessionUse(0).characterOpened).toBe(false)
        selectedCharID.set(3)
        selectedCharID.set(-1)
        expect(sessionUse(0).characterOpened).toBe(true)
    })

    test('reproducer: a chat in flight is remembered after it ends, and another kind is not', () => {
        startSessionUseTracking()
        beginInFlight('tts')()
        expect(sessionUse(0).chatSeen).toBe(false)
        const end = beginInFlight('chat')
        end()
        expect(sessionUse(0).chatSeen).toBe(true)
    })

    test('reproducer: the baseline is carried with the marks now', () => {
        noteReadyBaseline(7)
        expect(sessionUse(9)).toMatchObject({ marksNow: 9, marksAtReady: 7 })
    })

    test('reproducer: the baseline is the mark count after the rest of the ready run, and later marks stay above it', async () => {
        startSessionUseTracking()
        saveMarks.count = 2
        loadedStore.set(true)
        // Requested later in the same synchronous run as the flip, like the first save request of boot.
        saveMarks.count = 5
        await Promise.resolve()
        saveMarks.count = 6
        expect(sessionUse(saveMarks.count)).toMatchObject({ marksNow: 6, marksAtReady: 5 })
    })

    test('reproducer: no baseline is taken while the page is not ready', async () => {
        startSessionUseTracking()
        saveMarks.count = 4
        await Promise.resolve()
        expect(sessionUse(saveMarks.count).marksAtReady).toBe(0)
    })

    test('reproducer: stopping also ends the ready watch, so no baseline is taken afterwards', async () => {
        const stop = startSessionUseTracking()
        stop()
        saveMarks.count = 4
        loadedStore.set(true)
        await Promise.resolve()
        expect(sessionUse(saveMarks.count).marksAtReady).toBe(0)
    })

    test('guard: starting twice watches once, and stopping ends the watch', () => {
        const stop = startSessionUseTracking()
        expect(startSessionUseTracking()).toBe(stop)
        stop()
        selectedCharID.set(2)
        expect(sessionUse(0).characterOpened).toBe(false)
    })
})
