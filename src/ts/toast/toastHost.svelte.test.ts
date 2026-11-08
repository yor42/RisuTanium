// @vitest-environment jsdom

/**
 * The toast host: defaults, admission and queue, holds, the undo contract, announcements, suspension and reset.
 * Every host but the singleton runs on a fake clock; `recordCaughtError` is mocked so failures can be asserted.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const recordCaughtError = vi.hoisted(() => vi.fn())
vi.mock('../caughtErrors', () => ({ recordCaughtError }))

import {
    createToastHost,
    DEFAULT_TOAST_CONFIG,
    NO_TOAST,
    resetToastHostForTests,
    toastHost,
    type ToastClock,
    type ToastHost,
    type UndoAction,
    type UndoOutcome,
} from './toastHost.svelte'

interface FakeClock extends ToastClock {
    advance(ms: number): void
    pending(): number
}

function fakeClock(): FakeClock {
    let time = 0
    let nextKey = 1
    const timers = new Map<number, { at: number, run: () => void }>()
    return {
        now: () => time,
        after(ms, run) {
            const key = nextKey++
            timers.set(key, { at: time + ms, run })
            return () => { timers.delete(key) }
        },
        advance(ms) {
            const target = time + ms
            for (;;) {
                let next: [number, { at: number, run: () => void }] | null = null
                for (const entry of timers) {
                    if (entry[1].at <= target && (next === null || entry[1].at < next[1].at)) {
                        next = entry
                    }
                }
                if (next === null) {
                    break
                }
                timers.delete(next[0])
                time = next[1].at
                next[1].run()
            }
            time = target
        },
        pending: () => timers.size,
    }
}

function setup(config?: Partial<typeof DEFAULT_TOAST_CONFIG>) {
    const clock = fakeClock()
    const host = createToastHost({ clock, config })
    return { clock, host }
}

function action(run: () => UndoOutcome | Promise<UndoOutcome>, id = 'a1'): UndoAction {
    return { id, run, failedText: 'FAILED' }
}

function postUndo(host: ToastHost, undo: UndoAction, text = 'Removed') {
    return host.postUndo({ text, actionLabel: 'Undo', action: undo })
}

const ok = (text = 'Restored') => action(() => ({ ok: true, text }))
const ids = (host: ToastHost) => host.visible.map((toast) => toast.id)
const texts = (host: ToastHost) => host.visible.map((toast) => toast.text)

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

/** Lets `activate`'s promise chain settle. */
async function settle() {
    for (let turn = 0; turn < 5; turn += 1) {
        await Promise.resolve()
    }
}

beforeEach(() => {
    recordCaughtError.mockClear()
})

afterEach(() => {
    resetToastHostForTests()
    vi.useRealTimers()
})

describe('durations and configuration', () => {
    test('TH1 defaults: info and success 5 s, undo 6 s, warning and error stay', () => {
        expect(DEFAULT_TOAST_CONFIG).toEqual({ maxVisible: 3, stickyCap: 2, infoMs: 5000, successMs: 5000, undoMs: 6000, undoRunTimeoutMs: 10000 })
        const { clock, host } = setup()
        const info = host.post({ text: 'i' })
        const success = host.post({ kind: 'success', text: 's' })
        postUndo(host, ok())
        clock.advance(4999)
        expect(texts(host)).toContain('i')
        expect(texts(host)).toContain('s')
        clock.advance(1)
        expect(ids(host)).not.toContain(info)
        expect(ids(host)).not.toContain(success)
        host.post({ kind: 'warning', text: 'w' })
        expect(host.visible.map((toast) => toast.kind)).toEqual(['undo', 'warning'])
        clock.advance(999)
        expect(host.visible.map((toast) => toast.kind)).toEqual(['undo', 'warning'])
        clock.advance(1)
        expect(host.visible.map((toast) => toast.kind)).toEqual(['warning'])
        clock.advance(3_600_000)
        expect(host.visible.map((toast) => toast.kind)).toEqual(['warning'])
    })

    test('TH2 config overrides are honoured and invalid configs throw', () => {
        const { clock, host } = setup({ infoMs: 1000, undoMs: 2000 })
        host.post({ text: 'i' })
        clock.advance(999)
        expect(host.visible).toHaveLength(1)
        clock.advance(1)
        expect(host.visible).toHaveLength(0)
        expect(() => createToastHost({ config: { stickyCap: 3 } })).toThrow()
        expect(() => createToastHost({ config: { stickyCap: 0 } })).toThrow()
        expect(() => createToastHost({ config: { infoMs: 0 } })).toThrow()
        expect(() => createToastHost({ config: { undoRunTimeoutMs: -1 } })).toThrow()
    })
})

describe('holds', () => {
    test('TH3 hover and focus each pause every timer and resuming keeps the remaining time', () => {
        const { clock, host } = setup()
        host.post({ text: 'i' })
        clock.advance(3000)
        host.setHold('hover', true)
        clock.advance(60_000)
        expect(host.visible).toHaveLength(1)
        host.setHold('hover', false)
        clock.advance(1999)
        expect(host.visible).toHaveLength(1)
        clock.advance(1)
        expect(host.visible).toHaveLength(0)

        host.post({ text: 'j' })
        clock.advance(1000)
        host.setHold('focus', true)
        clock.advance(60_000)
        expect(host.visible).toHaveLength(1)
        // The two inputs are independent: releasing one leaves the other holding.
        host.setHold('hover', true)
        host.setHold('focus', false)
        clock.advance(60_000)
        expect(host.visible).toHaveLength(1)
        host.setHold('hover', false)
        clock.advance(3999)
        expect(host.visible).toHaveLength(1)
        clock.advance(1)
        expect(host.visible).toHaveLength(0)
    })

    test('TH3 a pending undo holds only its own timer', async () => {
        const { clock, host } = setup()
        const pending = deferred<UndoOutcome>()
        const undoId = postUndo(host, action(() => pending.promise))
        const infoId = host.post({ text: 'i' })
        void host.activate(undoId)
        clock.advance(5000)
        expect(ids(host)).toEqual([undoId])
        // Past the undo duration but inside the run timeout: the pending toast's own timer is held.
        clock.advance(4000)
        expect(ids(host)).toEqual([undoId])
        pending.resolve({ ok: true, text: 'Restored' })
        await settle()
        expect(infoId).not.toBe(undoId)
        expect(host.visible[0].kind).toBe('success')
    })

    test('TH4 results, ends, eviction and suspension leave the holds; clearHolds, reset and an empty stack clear them', async () => {
        const outcomes: Array<() => UndoOutcome | Promise<UndoOutcome>> = [
            () => ({ ok: true, text: 'done' }),
            () => ({ ok: false, text: 'refused' }),
            () => ({ ok: false, text: 'again', after: 'keep' }),
            () => ({ ok: false, text: 'closed', after: 'close' }),
            () => { throw new Error('boom') },
        ]
        for (const run of outcomes) {
            const { host } = setup()
            host.post({ text: 'A' })
            host.setHold('hover', true)
            host.setHold('focus', true)
            await host.activate(postUndo(host, action(run)))
            expect(host.holds()).toEqual({ hover: true, focus: true })
        }

        const { host } = setup()
        const a = host.post({ text: 'A' })
        host.post({ text: 'B' })
        host.setHold('hover', true)
        host.setHold('focus', true)
        host.dismiss(a)
        expect(host.holds()).toEqual({ hover: true, focus: true })
        host.post({ text: 'C' })
        host.post({ text: 'D' })
        host.post({ text: 'E' })
        expect(host.holds()).toEqual({ hover: true, focus: true })

        let flag = $state(false)
        const stop = $effect.root(() => { host.suspendWhile(() => flag) })
        flushSync()
        flag = true
        flushSync()
        expect(host.suspended).toBe(true)
        expect(host.holds()).toEqual({ hover: true, focus: true })
        flag = false
        flushSync()
        expect(host.suspended).toBe(false)
        expect(host.holds()).toEqual({ hover: true, focus: true })
        stop()

        host.clearHolds()
        expect(host.holds()).toEqual({ hover: false, focus: false })

        const lone = setup().host
        const only = lone.post({ text: 'only' })
        lone.setHold('hover', true)
        lone.setHold('focus', true)
        lone.dismiss(only)
        expect(lone.holds()).toEqual({ hover: false, focus: false })

        const resettable = setup().host
        resettable.post({ text: 'x' })
        resettable.setHold('hover', true)
        resettable.reset()
        expect(resettable.holds()).toEqual({ hover: false, focus: false })
    })
})

describe('admission and queue', () => {
    test('TH5 S1 queues a sticky beyond the cap', () => {
        const { host } = setup()
        host.post({ kind: 'error', text: 'e1' })
        host.post({ kind: 'error', text: 'e2' })
        host.post({ kind: 'error', text: 'e3' })
        expect(texts(host)).toEqual(['e1', 'e2'])
        expect(host.count().queued).toBe(1)
    })

    test('TH5 S3 evicts the oldest timed plain toast, never the newest', () => {
        const { host } = setup()
        const first = host.post({ text: 'a' })
        host.post({ kind: 'warning', text: 'w' })
        host.post({ text: 'b' })
        host.post({ text: 'c' })
        expect(ids(host)).not.toContain(first)
        expect(texts(host)).toEqual(['w', 'b', 'c'])
    })

    test('TH5 U2 evicts the oldest evictable undo for an arriving undo', () => {
        const { host } = setup()
        const first = postUndo(host, ok(), 'u1')
        postUndo(host, ok(), 'u2')
        postUndo(host, ok(), 'u3')
        postUndo(host, ok(), 'u4')
        expect(ids(host)).not.toContain(first)
        expect(texts(host)).toEqual(['u2', 'u3', 'u4'])
    })

    test('TH5 P4 queues a plain toast over [error, warning, undo]', () => {
        const { host } = setup()
        host.post({ kind: 'error', text: 'e' })
        host.post({ kind: 'warning', text: 'w' })
        postUndo(host, ok(), 'u')
        host.post({ text: 'p' })
        expect(texts(host)).toEqual(['e', 'w', 'u'])
        expect(host.count().queued).toBe(1)
    })

    test('TH5 an undo is shown at post time over every reachable 3-toast stack', () => {
        const kinds = ['info', 'success', 'warning', 'error', 'undo'] as const
        let checked = 0
        for (const a of kinds) for (const b of kinds) for (const c of kinds) {
            const stickies = [a, b, c].filter((kind) => kind === 'warning' || kind === 'error').length
            if (stickies > 2) {
                continue
            }
            const { host } = setup()
            for (const kind of [a, b, c]) {
                if (kind === 'undo') {
                    postUndo(host, ok(), 'u')
                } else {
                    host.post({ kind, text: kind })
                }
            }
            expect(host.visible).toHaveLength(3)
            const id = postUndo(host, ok(), 'new')
            expect(ids(host)).toContain(id)
            expect(host.count().queued).toBe(0)
            checked += 1
        }
        expect(checked).toBeGreaterThan(50)
    })

    test('TH5 release is FIFO, skips a cap-blocked sticky and never evicts', () => {
        const { host } = setup()
        const e1 = host.post({ kind: 'error', text: 'e1' })
        host.post({ kind: 'warning', text: 'w' })
        const u = postUndo(host, ok(), 'u')
        host.post({ kind: 'error', text: 'e2' })
        host.post({ text: 'q' })
        host.post({ text: 'r' })
        expect(host.count().queued).toBe(3)

        host.dismiss(u)
        expect(texts(host)).toEqual(['e1', 'w', 'q'])
        expect(host.count().queued).toBe(2)

        host.dismiss(e1)
        expect(texts(host)).toEqual(['w', 'q', 'e2'])
        expect(host.count().queued).toBe(1)
    })

    test('TH5 a queued toast starts its timer and its announcement when shown', () => {
        const { clock, host } = setup()
        host.post({ kind: 'error', text: 'e' })
        host.post({ kind: 'warning', text: 'w' })
        postUndo(host, ok(), 'u')
        host.post({ text: 'queued' })
        expect(host.polite.text).not.toContain('queued')
        clock.advance(6000)
        expect(texts(host)).toEqual(['e', 'w', 'queued'])
        expect(host.polite.text).toContain('queued')
        clock.advance(4999)
        expect(texts(host)).toContain('queued')
        clock.advance(1)
        expect(texts(host)).not.toContain('queued')
    })

    test('TH6 a pending undo is never evicted; the stack may exceed the cap and drains before the queue releases', async () => {
        const { host } = setup()
        host.post({ kind: 'error', text: 'e' })
        host.post({ kind: 'warning', text: 'w' })
        const pendingRun = deferred<UndoOutcome>()
        const u1 = postUndo(host, action(() => pendingRun.promise, 'p1'), 'u1')
        void host.activate(u1)
        const u2 = postUndo(host, ok(), 'u2')
        expect(host.visible).toHaveLength(4)
        expect(ids(host)).toContain(u1)
        host.post({ text: 'queued' })
        expect(host.count().queued).toBe(1)

        pendingRun.resolve({ ok: true, text: 'Restored' })
        await settle()
        expect(host.visible.find((toast) => toast.id === u1)?.kind).toBe('success')
        const u3 = postUndo(host, ok(), 'u3')
        // The outcome of the settled run is a timed plain toast and is the one evicted.
        expect(ids(host)).not.toContain(u1)
        expect(ids(host)).toContain(u3)
        expect(host.visible).toHaveLength(4)

        host.dismiss(u2)
        expect(host.count().queued).toBe(1)
        host.dismiss(u3)
        expect(host.count().queued).toBe(0)
        expect(texts(host)).toEqual(['e', 'w', 'queued'])
    })
})

describe('undo contract', () => {
    test('TH7 ok:true shows success with a fresh 5 s and a second press does not rerun a pending run', async () => {
        const { clock, host } = setup()
        const run = vi.fn((): UndoOutcome => ({ ok: true, text: 'Restored' }))
        const id = postUndo(host, action(run))
        clock.advance(3000)
        await host.activate(id)
        expect(run).toHaveBeenCalledTimes(1)
        expect(host.visible[0]).toMatchObject({ kind: 'success', text: 'Restored', pending: false })
        expect(host.visible[0].actionLabel).toBeUndefined()
        clock.advance(4999)
        expect(host.visible).toHaveLength(1)
        clock.advance(1)
        expect(host.visible).toHaveLength(0)

        const slow = deferred<UndoOutcome>()
        const slowRun = vi.fn(() => slow.promise)
        const slowId = postUndo(host, action(slowRun))
        const first = host.activate(slowId)
        const second = host.activate(slowId)
        expect(host.visible[0].pending).toBe(true)
        slow.resolve({ ok: true, text: 'Restored' })
        await Promise.all([first, second])
        expect(slowRun).toHaveBeenCalledTimes(1)
    })

    test('TH8 refusal: default info, close ends at once, keep stays an undo and can rerun', async () => {
        const { clock, host } = setup()
        const refuse = vi.fn((): UndoOutcome => ({ ok: false, text: 'Cannot undo' }))
        const id = postUndo(host, action(refuse))
        await host.activate(id)
        expect(host.visible[0]).toMatchObject({ kind: 'info', text: 'Cannot undo' })
        expect(host.visible[0].actionLabel).toBeUndefined()
        clock.advance(5000)
        expect(host.visible).toHaveLength(0)

        const close = postUndo(host, action(() => ({ ok: false, text: 'Gone', after: 'close' })))
        await host.activate(close)
        expect(host.visible).toHaveLength(0)
        expect(host.polite.text).toContain('Gone')

        const keepRun = vi.fn((): UndoOutcome => ({ ok: false, text: 'Try later', after: 'keep' }))
        const keep = postUndo(host, action(keepRun))
        clock.advance(2000)
        await host.activate(keep)
        expect(host.visible[0]).toMatchObject({ kind: 'undo', text: 'Try later', pending: false })
        expect(host.visible[0].actionLabel).toBe('Undo')
        clock.advance(5999)
        expect(host.visible).toHaveLength(1)
        await host.activate(keep)
        expect(keepRun).toHaveBeenCalledTimes(2)
        clock.advance(6000)
        expect(host.visible).toHaveLength(0)
    })

    test('TH9 a throw, a rejection and every non-outcome take the failure path and are recorded', async () => {
        const cases: Array<[string, () => unknown]> = [
            ['sync throw', () => { throw new Error('boom') }],
            ['rejection', () => Promise.reject(new Error('nope'))],
            ['undefined', () => undefined],
            ['ok is a string', () => ({ ok: 'yes', text: 'Restored' })],
            ['blank success text', () => ({ ok: true, text: '' })],
            ['whitespace success text', () => ({ ok: true, text: '  ' })],
            ['blank refusal text', () => ({ ok: false, text: '' })],
            ['bogus after', () => ({ ok: false, text: 'x', after: 'bogus' })],
        ]
        for (const [name, run] of cases) {
            recordCaughtError.mockClear()
            const { host } = setup()
            const id = postUndo(host, action(run as () => UndoOutcome))
            await host.activate(id)
            expect(host.visible[0], name).toMatchObject({ kind: 'info', text: 'FAILED' })
            expect(recordCaughtError, name).toHaveBeenCalledWith('toast.undo', expect.anything())
        }
    })

    test('TH10 a never-settling run times out on time, under holds and suspension, and a late settlement changes nothing', async () => {
        const { clock, host } = setup()
        host.setHold('hover', true)
        host.setHold('focus', true)
        const late = deferred<UndoOutcome>()
        const id = postUndo(host, action(() => late.promise))
        const pressed = host.activate(id)
        clock.advance(9999)
        expect(host.visible[0].pending).toBe(true)
        clock.advance(1)
        await pressed
        expect(host.visible[0]).toMatchObject({ kind: 'info', text: 'FAILED' })
        expect(recordCaughtError).toHaveBeenCalledWith('toast.undo', expect.objectContaining({ message: 'undo run timed out' }))
        host.setHold('hover', false)
        host.setHold('focus', false)
        clock.advance(4999)
        expect(host.visible).toHaveLength(1)
        const seqBefore = host.polite.seq
        late.resolve({ ok: true, text: 'Restored' })
        await settle()
        expect(host.visible[0]).toMatchObject({ kind: 'info', text: 'FAILED' })
        expect(host.polite.seq).toBe(seqBefore)
        expect(recordCaughtError).toHaveBeenCalledWith('toast.undo.late', expect.anything())
        clock.advance(1)
        expect(host.visible).toHaveLength(0)

        const suspendedSetup = setup()
        let flag = $state(true)
        const stop = $effect.root(() => { suspendedSetup.host.suspendWhile(() => flag) })
        flushSync()
        const never = deferred<UndoOutcome>()
        const suspendedId = postUndo(suspendedSetup.host, action(() => never.promise))
        const suspendedPress = suspendedSetup.host.activate(suspendedId)
        suspendedSetup.clock.advance(10000)
        await suspendedPress
        expect(suspendedSetup.host.visible[0]).toMatchObject({ kind: 'info', text: 'FAILED' })
        flag = false
        stop()
    })

    test('TH11 dismiss and dismissUndo while pending do not resurrect the toast and the result is announced', async () => {
        for (const end of ['dismiss', 'dismissUndo'] as const) {
            const { host } = setup()
            const pending = deferred<UndoOutcome>()
            const id = postUndo(host, action(() => pending.promise, 'x'))
            const pressed = host.activate(id)
            if (end === 'dismiss') {
                host.dismiss(id)
            } else {
                host.dismissUndo('x')
            }
            expect(host.visible).toHaveLength(0)
            pending.resolve({ ok: true, text: 'Restored anyway' })
            await pressed
            expect(host.visible).toHaveLength(0)
            expect(host.polite.text).toContain('Restored anyway')
        }
    })

    test('TH12 expiry, dismissal, eviction and reset never run the action; the caller can still run it', async () => {
        const history: string[] = []
        const run = vi.fn((): UndoOutcome => { history.push('restored'); return { ok: true, text: 'Restored' } })
        const undo = action(run, 'h1')
        const { clock, host } = setup()
        postUndo(host, undo)
        clock.advance(6000)
        expect(host.count().visible).toBe(0)
        const second = postUndo(host, undo)
        host.dismiss(second)
        postUndo(host, undo)
        host.reset()
        for (let index = 0; index < 4; index += 1) {
            postUndo(host, action(run, 'other' + index), 'u' + index)
        }
        expect(run).not.toHaveBeenCalled()
        expect(history).toEqual([])
        await undo.run()
        expect(history).toEqual(['restored'])

        const both = setup().host
        postUndo(both, undo, 'one')
        postUndo(both, undo, 'two')
        both.post({ text: 'plain' })
        both.dismissUndo('h1')
        expect(texts(both)).toEqual(['plain'])
        both.dismissUndo('unknown')
        both.dismiss(NO_TOAST)
        both.dismiss(9999)
        expect(texts(both)).toEqual(['plain'])
    })

    test('TH13 blank fields refuse the post with NO_TOAST and record it; a blank sub is absent; posting never throws', () => {
        const { host } = setup()
        const good = ok()
        const attempts: Array<() => number> = [
            () => host.post({ text: '' }),
            () => host.post({ text: '   ' }),
            () => host.post({ text: 5 as unknown as string }),
            () => host.postUndo({ text: 'x', actionLabel: '', action: good }),
            () => host.postUndo({ text: 'x', actionLabel: 'Undo', action: { ...good, failedText: ' ' } }),
            () => host.postUndo({ text: 'x', actionLabel: 'Undo', action: { ...good, id: '' } }),
        ]
        for (const attempt of attempts) {
            recordCaughtError.mockClear()
            expect(attempt()).toBe(NO_TOAST)
            expect(recordCaughtError).toHaveBeenCalledWith('toast.post', expect.anything())
        }
        expect(host.visible).toHaveLength(0)
        const id = host.post({ text: 'ok', sub: '  ' })
        expect(id).not.toBe(NO_TOAST)
        expect(host.visible[0].sub).toBeUndefined()
        expect(() => host.post(null as unknown as { text: string })).not.toThrow()
    })
})

describe('suspension', () => {
    test('TH14 suspendWhile holds timers and keeps the remaining time; owners are counted and tied to teardown', () => {
        const { clock, host } = setup()
        let flag = $state(false)
        const stop = $effect.root(() => { host.suspendWhile(() => flag) })
        flushSync()
        host.post({ text: 'i' })
        clock.advance(2000)
        flag = true
        flushSync()
        expect(host.suspended).toBe(true)
        clock.advance(60_000)
        expect(host.visible).toHaveLength(1)
        flag = false
        flushSync()
        expect(host.suspended).toBe(false)
        clock.advance(2999)
        expect(host.visible).toHaveLength(1)
        clock.advance(1)
        expect(host.visible).toHaveLength(0)

        let other = $state(true)
        const stopOther = $effect.root(() => { host.suspendWhile(() => other) })
        flag = true
        flushSync()
        expect(host.count().suspenders).toBe(2)
        flag = false
        flushSync()
        expect(host.suspended).toBe(true)
        stopOther()
        expect(host.suspended).toBe(false)
        expect(host.count().suspenders).toBe(0)
        other = false
        stop()
    })

    test('TH14 destroying an owner whose flag is still true ends its suspension; reset then stop is harmless', () => {
        const { host } = setup()
        const stop = $effect.root(() => { host.suspendWhile(() => true) })
        flushSync()
        expect(host.suspended).toBe(true)
        stop()
        expect(host.suspended).toBe(false)

        const stopAgain = $effect.root(() => { host.suspendWhile(() => true) })
        flushSync()
        host.reset()
        expect(host.count().suspenders).toBe(0)
        expect(() => stopAgain()).not.toThrow()
        expect(host.count().suspenders).toBe(0)
        expect(host.suspended).toBe(false)
    })

    test('TH14 an undo posted while suspended is shown at once; its timer and announcement start at resume', () => {
        const { clock, host } = setup()
        let flag = $state(true)
        const stop = $effect.root(() => { host.suspendWhile(() => flag) })
        flushSync()
        const id = postUndo(host, ok(), 'Removed X')
        expect(ids(host)).toEqual([id])
        expect(host.polite.text).toBe('')
        clock.advance(60_000)
        expect(ids(host)).toEqual([id])
        flag = false
        flushSync()
        expect(host.polite.text).toBe('Removed X')
        clock.advance(5999)
        expect(ids(host)).toEqual([id])
        clock.advance(1)
        expect(ids(host)).toEqual([])
        stop()
    })
})

describe('pause', () => {
    test('TP1 pauseWhile holds the timer, keeps the toast and resumes with the remaining time', () => {
        const { clock, host } = setup()
        let flag = $state(false)
        const stop = $effect.root(() => { host.pauseWhile(() => flag) })
        flushSync()
        const id = postUndo(host, ok())
        clock.advance(2000)
        flag = true
        flushSync()
        expect(host.paused).toBe(true)
        clock.advance(60_000)
        expect(ids(host)).toEqual([id])
        flag = false
        flushSync()
        expect(host.paused).toBe(false)
        clock.advance(3999)
        expect(ids(host)).toEqual([id])
        clock.advance(1)
        expect(ids(host)).toEqual([])
        stop()
    })

    test('TP2 a pause composes with the focus hold, the hover hold and a suspension', () => {
        for (const other of ['focus', 'hover', 'suspend'] as const) {
            const { clock, host } = setup()
            let paused = $state(false)
            let suspended = $state(false)
            const stop = $effect.root(() => {
                host.pauseWhile(() => paused)
                host.suspendWhile(() => suspended)
            })
            flushSync()
            const id = postUndo(host, ok())
            clock.advance(1000)
            paused = true
            flushSync()
            if (other === 'suspend') {
                suspended = true
                flushSync()
            } else {
                host.setHold(other, true)
            }
            paused = false
            flushSync()
            // The other reason still holds the timer after the pause ends.
            clock.advance(60_000)
            expect(ids(host)).toEqual([id])
            if (other === 'suspend') {
                suspended = false
                flushSync()
            } else {
                host.setHold(other, false)
            }
            clock.advance(4999)
            expect(ids(host)).toEqual([id])
            clock.advance(1)
            expect(ids(host)).toEqual([])
            stop()
        }
    })

    test('TP3 pause owners are counted: the pause lasts until the last one releases', () => {
        const { clock, host } = setup()
        let first = $state(true)
        let second = $state(true)
        const stop = $effect.root(() => {
            host.pauseWhile(() => first)
            host.pauseWhile(() => second)
        })
        flushSync()
        const id = postUndo(host, ok())
        expect(host.count().pausers).toBe(2)
        first = false
        flushSync()
        expect(host.paused).toBe(true)
        clock.advance(60_000)
        expect(ids(host)).toEqual([id])
        second = false
        flushSync()
        expect(host.paused).toBe(false)
        expect(host.count().pausers).toBe(0)
        clock.advance(6000)
        expect(ids(host)).toEqual([])
        stop()
    })

    test('TP4 a toast posted while paused is shown and announced at once and its timer starts at release', () => {
        const { clock, host } = setup()
        let flag = $state(true)
        const stop = $effect.root(() => { host.pauseWhile(() => flag) })
        flushSync()
        const versionBefore = host.version
        flag = false
        flushSync()
        flag = true
        flushSync()
        expect(host.version).toBe(versionBefore)

        const seqBefore = host.polite.seq
        const id = postUndo(host, ok(), 'Removed X')
        expect(ids(host)).toEqual([id])
        expect(host.polite.text).toBe('Removed X')
        expect(host.polite.seq).toBe(seqBefore + 1)
        expect(host.version).toBe(versionBefore + 1)
        clock.advance(60_000)
        expect(ids(host)).toEqual([id])
        flag = false
        flushSync()
        clock.advance(5999)
        expect(ids(host)).toEqual([id])
        clock.advance(1)
        expect(ids(host)).toEqual([])
        stop()
    })

    test('TP5 a warning stays through a pause and gets no timer at release', () => {
        const { clock, host } = setup()
        let flag = $state(false)
        const stop = $effect.root(() => { host.pauseWhile(() => flag) })
        flushSync()
        host.post({ kind: 'warning', text: 'before' })
        flag = true
        flushSync()
        host.post({ kind: 'error', text: 'during' })
        clock.advance(60_000)
        expect(texts(host)).toEqual(['before', 'during'])
        flag = false
        flushSync()
        expect(clock.pending()).toBe(0)
        clock.advance(60_000)
        expect(texts(host)).toEqual(['before', 'during'])
        stop()
    })

    test('TP6 admission is unchanged while paused and a released toast waits for the resume', () => {
        const { clock, host } = setup()
        let flag = $state(true)
        const stop = $effect.root(() => { host.pauseWhile(() => flag) })
        flushSync()
        postUndo(host, ok(), 'u1')
        postUndo(host, ok(), 'u2')
        const u3 = postUndo(host, ok(), 'u3')
        postUndo(host, ok(), 'u4')
        expect(texts(host)).toEqual(['u2', 'u3', 'u4'])
        host.post({ text: 'plain' })
        expect(host.count().queued).toBe(1)
        host.dismiss(u3)
        expect(texts(host)).toEqual(['u2', 'u4', 'plain'])
        expect(host.count().queued).toBe(0)
        clock.advance(60_000)
        expect(texts(host)).toEqual(['u2', 'u4', 'plain'])
        flag = false
        flushSync()
        clock.advance(5000)
        expect(texts(host)).toEqual(['u2', 'u4'])
        clock.advance(1000)
        expect(texts(host)).toEqual([])
        stop()
    })

    test('TP7 the undo run timeout still fires while paused and the failure toast waits for the resume', async () => {
        const { clock, host } = setup()
        let flag = $state(false)
        const stop = $effect.root(() => { host.pauseWhile(() => flag) })
        flushSync()
        const never = deferred<UndoOutcome>()
        const id = postUndo(host, action(() => never.promise, 'never'))
        const pressed = host.activate(id)
        flag = true
        flushSync()
        clock.advance(10_000)
        await pressed
        expect(host.visible[0].kind).toBe('info')
        expect(host.visible[0].text).toBe('FAILED')
        clock.advance(60_000)
        expect(ids(host)).toEqual([id])
        flag = false
        flushSync()
        clock.advance(4999)
        expect(ids(host)).toEqual([id])
        clock.advance(1)
        expect(ids(host)).toEqual([])
        stop()
    })

    test('TP8 destroying an owner ends its pause; reset clears the pausers; a pause changes neither version nor suspension', () => {
        const { host } = setup()
        const stop = $effect.root(() => { host.pauseWhile(() => true) })
        flushSync()
        expect(host.paused).toBe(true)
        expect(host.suspended).toBe(false)
        expect(host.count().pausers).toBe(1)
        stop()
        expect(host.paused).toBe(false)
        expect(host.count().pausers).toBe(0)

        const stopAgain = $effect.root(() => { host.pauseWhile(() => true) })
        flushSync()
        host.reset()
        expect(host.count().pausers).toBe(0)
        expect(host.paused).toBe(false)
        const versionAfterReset = host.version
        expect(() => stopAgain()).not.toThrow()
        expect(host.count().pausers).toBe(0)
        expect(host.version).toBe(versionAfterReset)
    })

    test('TP9 the outcome toast of an undo pressed while paused starts its 5 s at the resume', async () => {
        const { clock, host } = setup()
        let flag = $state(true)
        const stop = $effect.root(() => { host.pauseWhile(() => flag) })
        flushSync()
        const id = postUndo(host, ok('Restored'))
        await host.activate(id)
        expect(host.visible[0].kind).toBe('success')
        clock.advance(60_000)
        expect(ids(host)).toEqual([id])
        flag = false
        flushSync()
        clock.advance(4999)
        expect(ids(host)).toEqual([id])
        clock.advance(1)
        expect(ids(host)).toEqual([])
        stop()
    })
})

describe('announcements, reset and version', () => {
    test('TH15 regions by kind, a seq per write, identical texts twice, one batched write on resume', async () => {
        const { host } = setup()
        host.post({ text: 'info' })
        host.post({ kind: 'success', text: 'success' })
        postUndo(host, ok(), 'undo')
        expect(host.polite.text).toBe('undo')
        expect(host.assertive.seq).toBe(0)
        host.reset()
        host.post({ kind: 'warning', text: 'warn' })
        host.post({ kind: 'error', text: 'err' })
        expect(host.assertive.text).toBe('err')
        expect(host.assertive.seq).toBe(2)
        expect(host.polite.seq).toBe(0)

        const twice = setup().host
        twice.post({ text: 'same' })
        const first = twice.polite.seq
        twice.post({ text: 'same' })
        expect(twice.polite.text).toBe('same')
        expect(twice.polite.seq).toBe(first + 1)

        const result = setup().host
        await result.activate(postUndo(result, ok('Restored')))
        expect(result.polite.text).toBe('Restored')

        const batch = setup().host
        let flag = $state(true)
        const stop = $effect.root(() => { batch.suspendWhile(() => flag) })
        flushSync()
        batch.post({ text: 'one' })
        batch.post({ kind: 'error', text: 'two' })
        batch.post({ text: 'three' })
        const politeSeq = batch.polite.seq
        const assertiveSeq = batch.assertive.seq
        flag = false
        flushSync()
        expect(batch.polite.text).toBe('one\nthree')
        expect(batch.polite.seq).toBe(politeSeq + 1)
        expect(batch.assertive.text).toBe('two')
        expect(batch.assertive.seq).toBe(assertiveSeq + 1)
        stop()
    })

    test('TH16 reset clears everything, cancels every timer and makes a settlement late', async () => {
        vi.useFakeTimers()
        resetToastHostForTests()
        toastHost.post({ text: 'i' })
        toastHost.post({ kind: 'error', text: 'e' })
        const never = deferred<UndoOutcome>()
        const id = toastHost.postUndo({ text: 'u', actionLabel: 'Undo', action: action(() => never.promise) })
        const pressed = toastHost.activate(id)
        // Timers are running here (the info toast's, the run timeout), so a reset that forgot one is visible.
        expect(vi.getTimerCount()).toBeGreaterThan(1)
        resetToastHostForTests()
        await pressed
        expect(vi.getTimerCount()).toBe(0)
        expect(toastHost.count()).toEqual({ visible: 0, queued: 0, suspenders: 0, pausers: 0 })
        expect(toastHost.holds()).toEqual({ hover: false, focus: false })
        expect(toastHost.polite).toEqual({ text: '', seq: 0 })
        expect(toastHost.assertive).toEqual({ text: '', seq: 0 })
        never.resolve({ ok: true, text: 'late' })
        await settle()
        expect(toastHost.visible).toHaveLength(0)
        expect(recordCaughtError).toHaveBeenCalledWith('toast.undo.late', expect.anything())
    })

    test('TH16 reset also clears suspenders, pausers and holds', () => {
        resetToastHostForTests()
        const stopOwner = $effect.root(() => { toastHost.suspendWhile(() => true) })
        const stopPauser = $effect.root(() => { toastHost.pauseWhile(() => true) })
        flushSync()
        expect(toastHost.count().suspenders).toBe(1)
        expect(toastHost.count().pausers).toBe(1)
        expect(toastHost.paused).toBe(true)
        for (const name of ['a', 'b', 'c']) {
            toastHost.post({ kind: 'error', text: name })
        }
        expect(toastHost.count().queued).toBe(1)
        toastHost.setHold('hover', true)
        resetToastHostForTests()
        expect(toastHost.count()).toEqual({ visible: 0, queued: 0, suspenders: 0, pausers: 0 })
        expect(toastHost.suspended).toBe(false)
        expect(toastHost.paused).toBe(false)
        expect(toastHost.holds()).toEqual({ hover: false, focus: false })
        stopOwner()
        stopPauser()
    })

    test('TH18 the singleton obeys fake timers installed after import', () => {
        vi.useFakeTimers()
        resetToastHostForTests()
        toastHost.post({ text: 'i' })
        vi.advanceTimersByTime(4999)
        expect(toastHost.visible).toHaveLength(1)
        vi.advanceTimersByTime(1)
        expect(toastHost.visible).toHaveLength(0)
    })

    test('TH19 version increments on every visible or suspension change and on nothing else', async () => {
        const { clock, host } = setup()
        let last = host.version
        const grew = () => {
            const changed = host.version > last
            last = host.version
            return changed
        }

        const a = host.post({ text: 'a' })
        expect(grew()).toBe(true)
        host.post({ kind: 'error', text: 'e1' })
        grew()
        host.post({ kind: 'error', text: 'e2' })
        grew()
        const queued = host.post({ kind: 'error', text: 'e3' })
        expect(host.count().queued).toBe(1)
        expect(grew()).toBe(false)
        host.dismiss(queued)
        expect(grew()).toBe(false)
        host.dismiss(9999)
        host.dismiss(NO_TOAST)
        host.setHold('hover', true)
        host.setHold('hover', false)
        host.clearHolds()
        expect(grew()).toBe(false)

        host.dismiss(a)
        expect(grew()).toBe(true)

        const undoId = postUndo(host, action(() => ({ ok: true, text: 'Restored' }), 'v'))
        grew()
        const pressed = host.activate(undoId)
        expect(grew()).toBe(true)
        await pressed
        expect(grew()).toBe(true)

        const results: Array<() => UndoOutcome> = [
            () => ({ ok: false, text: 'no' }),
            () => ({ ok: false, text: 'again', after: 'keep' }),
            () => ({ ok: false, text: 'closed', after: 'close' }),
            () => { throw new Error('boom') },
        ]
        for (const run of results) {
            host.dismissUndo('none')
            const id = postUndo(host, action(run, 'r'))
            grew()
            // A synchronous run settles inside `activate`, so the press covers both the pending flip and the result.
            const press = host.activate(id)
            await press
            expect(host.version - last).toBeGreaterThanOrEqual(2)
            last = host.version
            host.dismissUndo('r')
            host.dismiss(id)
        }

        const timed = host.post({ text: 'timed' })
        grew()
        clock.advance(5000)
        expect(grew()).toBe(true)
        expect(ids(host)).not.toContain(timed)

        const untilEvict = setup().host
        untilEvict.post({ text: '1' })
        untilEvict.post({ text: '2' })
        untilEvict.post({ text: '3' })
        const before = untilEvict.version
        untilEvict.post({ text: '4' })
        expect(untilEvict.version).toBeGreaterThan(before)

        let flag = $state(false)
        const stop = $effect.root(() => { host.suspendWhile(() => flag) })
        flushSync()
        grew()
        flag = true
        flushSync()
        expect(grew()).toBe(true)
        flag = false
        flushSync()
        expect(grew()).toBe(true)
        stop()
    })
})
