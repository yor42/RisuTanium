/**
 * Guard: the one-slot hold on a store2 asset deletion. A writer that captures the slot waits for the delete in flight,
 * an empty slot resolves at once, a failed remover frees the slot before the caller resumes and still reaches the caller,
 * and an overlapping hold is refused with its own error class. Pure promise logic; no storage is involved.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
    AssetDeleteHoldOverlapError,
    assetDeletionSettled,
    holdAssetDeletion,
    isAssetDeletionHeld,
    resetAssetDeleteHoldForTests,
} from '../assetDeleteHold'

function deferred(): { promise: Promise<void>, resolve: () => void, reject: (error: Error) => void } {
    let resolve: () => void = () => undefined
    let reject: (error: Error) => void = () => undefined
    const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

beforeEach(() => resetAssetDeleteHoldForTests())
afterEach(() => resetAssetDeleteHoldForTests())

describe('the asset deletion hold slot', () => {
    test('guard: a waiter resumes only after the delete in flight settles', async () => {
        const gate = deferred()
        const events: string[] = []
        const held = holdAssetDeletion(async () => {
            await gate.promise
            events.push('removed')
        })
        expect(isAssetDeletionHeld()).toBe(true)
        const waiter = assetDeletionSettled().then(() => events.push('waiter'))
        await Promise.resolve()
        await Promise.resolve()
        expect(events).toEqual([])
        gate.resolve()
        await held
        await waiter
        expect(events).toEqual(['removed', 'waiter'])
        expect(isAssetDeletionHeld()).toBe(false)
    })

    test('guard: an empty slot resolves at once', async () => {
        expect(isAssetDeletionHeld()).toBe(false)
        await expect(assetDeletionSettled()).resolves.toBeUndefined()
    })

    test('guard: the slot is registered before the remover is awaited, within the synchronous run of the call', () => {
        const gate = deferred()
        void holdAssetDeletion(() => gate.promise)
        expect(isAssetDeletionHeld()).toBe(true)
        gate.resolve()
    })

    test('guard: a remover that throws synchronously still frees the slot', async () => {
        const failure = new Error('sync')
        await expect(holdAssetDeletion(() => { throw failure })).rejects.toBe(failure)
        expect(isAssetDeletionHeld()).toBe(false)
    })

    test('guard: a rejected remover frees the slot before the caller resumes, rethrows its error, and a waiter never sees the rejection', async () => {
        const gate = deferred()
        const failure = new Error('delete failed')
        const held = holdAssetDeletion(async () => {
            await gate.promise
            throw failure
        })
        const waiter = assetDeletionSettled()
        gate.reject(failure)
        let heldWhenCallerResumed: boolean | null = null
        await expect(held.catch((error: Error) => {
            heldWhenCallerResumed = isAssetDeletionHeld()
            throw error
        })).rejects.toBe(failure)
        expect(heldWhenCallerResumed).toBe(false)
        await expect(waiter).resolves.toBeUndefined()
    })

    test('guard: two sequential holds do not overlap', async () => {
        await holdAssetDeletion(async () => undefined)
        await holdAssetDeletion(async () => undefined)
        expect(isAssetDeletionHeld()).toBe(false)
    })

    test('guard: a hold requested while another is pending throws the overlap error and leaves the first hold intact', async () => {
        const gate = deferred()
        const first = holdAssetDeletion(() => gate.promise)
        expect(() => holdAssetDeletion(async () => undefined)).toThrow(AssetDeleteHoldOverlapError)
        expect(isAssetDeletionHeld()).toBe(true)
        gate.resolve()
        await first
        expect(isAssetDeletionHeld()).toBe(false)
    })

    test('guard: a waiter that captured the slot before it cleared does not wait for a later hold', async () => {
        const gate = deferred()
        const first = holdAssetDeletion(() => gate.promise)
        const waiter = assetDeletionSettled()
        gate.resolve()
        await first
        const secondGate = deferred()
        const second = holdAssetDeletion(() => secondGate.promise)
        await waiter
        expect(isAssetDeletionHeld()).toBe(true)
        secondGate.resolve()
        await second
    })

    test('guard: the reset helper empties a pending slot', () => {
        void holdAssetDeletion(() => new Promise<void>(() => undefined))
        expect(isAssetDeletionHeld()).toBe(true)
        resetAssetDeleteHoldForTests()
        expect(isAssetDeletionHeld()).toBe(false)
    })
})
