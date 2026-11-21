/**
 * The Data page's sheet controller. Post-fix guard (new module): a request that cannot be shown, or whose host
 * goes away, resolves `null`; the running flag is cleared however an action ends.
 */
import { afterEach, describe, expect, test } from 'vitest'
import type { BinLeaveOutEntry } from '../drive/binLeaveOut'
import { answerBackupChoice, answerLeaveOut, askBackupChoice, askLeaveOutAnswer, dataSheetState, registerDataSheetHost, runDataAction } from './dataSheets.svelte'

const unregisters: Array<() => void> = []

afterEach(() => {
    for (const stop of unregisters.splice(0)) stop()
    dataSheetState.pending = null
    dataSheetState.pendingLeaveOut = null
    dataSheetState.running = false
    dataSheetState.lastBinLeftOut = null
})

describe('askLeaveOutAnswer', () => {
    const SUMMARY: BinLeaveOutEntry[] = [{ kind: 'usageStats', count: 1 }]

    test('S2-R9: with no host it resolves null at once and holds nothing', async () => {
        expect(await askLeaveOutAnswer(SUMMARY)).toBeNull()
        expect(dataSheetState.pendingLeaveOut).toBeNull()
    })

    test('S2-R9: with a host it waits, publishes the built definition, and settles with the answer', async () => {
        unregisters.push(registerDataSheetHost())
        const asked = askLeaveOutAnswer(SUMMARY)
        expect(dataSheetState.pendingLeaveOut?.def.severity).toBe('caution')
        answerLeaveOut('rtb')
        expect(await asked).toBe('rtb')
        expect(dataSheetState.pendingLeaveOut).toBeNull()
    })

    test('S2-R9: the host unregistering while the request is pending resolves it null, never cancel', async () => {
        const stop = registerDataSheetHost()
        const asked = askLeaveOutAnswer(SUMMARY)
        stop()
        expect(await asked).toBeNull()
        expect(dataSheetState.pendingLeaveOut).toBeNull()
    })

    test('S2-R9: a request while the chooser or another question is pending resolves null and leaves the first waiting', async () => {
        unregisters.push(registerDataSheetHost())
        const chooser = askBackupChoice()
        expect(await askLeaveOutAnswer(SUMMARY)).toBeNull()
        answerBackupChoice(null)
        await chooser

        const first = askLeaveOutAnswer(SUMMARY)
        expect(await askLeaveOutAnswer(SUMMARY)).toBeNull()
        expect(await askBackupChoice()).toBeNull()
        answerLeaveOut('bin')
        expect(await first).toBe('bin')
    })
})

describe('askBackupChoice', () => {
    test('S1-U2: with no host it resolves null at once and holds nothing', async () => {
        expect(await askBackupChoice()).toBeNull()
        expect(dataSheetState.pending).toBeNull()
    })

    test('S1-U2: with a host it waits for the answer', async () => {
        unregisters.push(registerDataSheetHost())
        const asked = askBackupChoice()
        expect(dataSheetState.pending).not.toBeNull()
        answerBackupChoice({ format: 'bin', scope: 'partial' })
        expect(await asked).toEqual({ format: 'bin', scope: 'partial' })
        expect(dataSheetState.pending).toBeNull()
    })

    test('R1: a settings-only sealed .rtb answer reaches the asker unchanged', async () => {
        unregisters.push(registerDataSheetHost())
        const asked = askBackupChoice()
        answerBackupChoice({ format: 'rtb', scope: 'settings', password: 'pw 한' })
        expect(await asked).toEqual({ format: 'rtb', scope: 'settings', password: 'pw 한' })
    })

    test('S1-U2: a second request while one is pending resolves null and leaves the first waiting', async () => {
        unregisters.push(registerDataSheetHost())
        const first = askBackupChoice()
        expect(await askBackupChoice()).toBeNull()
        answerBackupChoice({ format: 'rtb', scope: 'full' })
        expect(await first).toEqual({ format: 'rtb', scope: 'full' })
    })

    test('S1-U2: the host unregistering while a request is pending resolves it null', async () => {
        const stop = registerDataSheetHost()
        const asked = askBackupChoice()
        stop()
        expect(await asked).toBeNull()
        expect(dataSheetState.pending).toBeNull()
    })

    test('S1-U2: one of two hosts leaving keeps the request pending; the last one resolves it', async () => {
        const stopA = registerDataSheetHost()
        const stopB = registerDataSheetHost()
        const asked = askBackupChoice()
        stopA()
        expect(dataSheetState.pending).not.toBeNull()
        stopB()
        expect(await asked).toBeNull()
    })

    test('S1-U2: unregistering twice does not unbalance the count', async () => {
        const stopA = registerDataSheetHost()
        const stopB = registerDataSheetHost()
        stopA()
        stopA()
        const asked = askBackupChoice()
        expect(dataSheetState.pending).not.toBeNull()
        stopB()
        expect(await asked).toBeNull()
    })
})

describe('runDataAction', () => {
    test('S1-U2: it holds the running flag while the action runs and clears it after', async () => {
        let release: () => void = () => {}
        const running = runDataAction(() => new Promise<void>((resolve) => { release = resolve }))
        expect(dataSheetState.running).toBe(true)
        release()
        await running
        expect(dataSheetState.running).toBe(false)
    })

    test('S1-U2: it clears the flag after the action throws, and rethrows', async () => {
        await expect(runDataAction(async () => { throw new Error('boom') })).rejects.toThrow('boom')
        expect(dataSheetState.running).toBe(false)
    })

    test('S1-U2: a call while another action runs does not run its action', async () => {
        let release: () => void = () => {}
        let ran = 0
        const first = runDataAction(() => new Promise<void>((resolve) => { release = resolve }))
        expect(await runDataAction(async () => { ran += 1 })).toBeUndefined()
        expect(ran).toBe(0)
        release()
        await first
    })
})
