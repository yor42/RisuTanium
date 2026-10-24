/**
 * `sessionUse` ready baseline against real Svelte effects. The effects model the save loop's change effects
 * (`registerDbChangeEffects`): each counts one save mark on its first run. They are modelled here, not called.
 * Reproducer: with no Svelte batch pending at the flip, a baseline read without flushing pending effects misses
 * their first-run marks and a page nobody touched would count as used.
 */
import { flushSync } from 'svelte'
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
import { resetInFlightForTest } from './inFlightWork'
import { resetSessionUseForTest, sessionUse, startSessionUseTracking } from './sessionUse'

const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const stops: Array<() => void> = []

beforeEach(() => {
    resetSessionUseForTest()
    resetInFlightForTest()
    selectedCharID.set(-1)
    loadedStore.set(false)
    saveMarks.count = 0
})

afterEach(() => {
    for (const stop of stops.splice(0)) {
        stop()
    }
    resetSessionUseForTest()
    resetInFlightForTest()
})

describe('sessionUse ready baseline with real effects', () => {
    test('reproducer: first-run marks of effects registered at the flip are in the baseline, so an untouched page is not used', async () => {
        startSessionUseTracking()
        await macrotask()
        loadedStore.set(true)
        stops.push($effect.root(() => {
            for (let i = 0; i < 3; i++) {
                $effect(() => {
                    saveMarks.count += 1
                })
            }
        }))
        await macrotask()
        flushSync()
        expect(saveMarks.count).toBe(3)
        const use = sessionUse(saveMarks.count)
        expect(use.marksAtReady).toBe(use.marksNow)
    })

    test('guard: a mark made after the page settled stays above the baseline', async () => {
        startSessionUseTracking()
        await macrotask()
        loadedStore.set(true)
        stops.push($effect.root(() => {
            $effect(() => {
                saveMarks.count += 1
            })
        }))
        await macrotask()
        flushSync()
        saveMarks.count += 1
        const use = sessionUse(saveMarks.count)
        expect(use.marksNow).toBe(use.marksAtReady + 1)
    })
})
