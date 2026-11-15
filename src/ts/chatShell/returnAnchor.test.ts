// @vitest-environment jsdom
// The return hold keeps native scroll anchoring off the transcript host while the surface is hidden and for a short while after it returns.
// It owns the inline property only while engaged, and ends it only after the frames have passed and no step hold is in flight.
import { describe, expect, test } from 'vitest'
import { RETURN_HOLD_RELEASE_FRAMES, beginReturn, createReturnAnchorHold, fallbackRest, returnPlan, type FallbackRestInput, type ReturnRecord } from './returnAnchor'

function rig(options: { frames?: number } = {}) {
    const host = document.createElement('main')
    const pending = new Map<number, () => void>()
    let nextId = 0
    const state = { held: false, hostPresent: true }
    const hold = createReturnAnchorHold({
        host: () => state.hostPresent ? host : undefined,
        held: () => state.held,
        requestFrame: (callback) => { nextId += 1; pending.set(nextId, callback); return nextId },
        cancelFrame: (id) => { pending.delete(id) },
        ...options,
    })
    return {
        host, hold, state, pending,
        value: (): string => host.style.getPropertyValue('overflow-anchor'),
        frame: (): void => { for (const [id, callback] of [...pending]) { pending.delete(id); callback() } },
    }
}

describe('the return hold lifetime', () => {
    test('H1: engage sets none and the release removes it at the second frame, not the first', () => {
        const t = rig()
        const id = t.hold.engage()
        expect(t.value()).toBe('none')
        t.hold.releaseAfterFrames(id)
        expect(t.value()).toBe('none')
        t.frame()
        expect(t.value()).toBe('none')
        t.frame()
        expect(t.value()).toBe('')
        expect(t.pending.size).toBe(0)
    })
    test('the default wait is the named constant', () => {
        expect(RETURN_HOLD_RELEASE_FRAMES).toBe(2)
        const t = rig({ frames: 3 })
        const id = t.hold.engage()
        t.hold.releaseAfterFrames(id)
        t.frame(); t.frame()
        expect(t.value()).toBe('none')
        t.frame()
        expect(t.value()).toBe('')
    })
    test('H2: a step hold in flight keeps the property; it is removed on the first frame after the step hold ends, never while held', () => {
        const t = rig()
        const id = t.hold.engage()
        t.state.held = true
        t.hold.releaseAfterFrames(id)
        for (let i = 0; i < 6; i += 1) { t.frame(); expect(t.value()).toBe('none') }
        t.state.held = false
        t.frame()
        expect(t.value()).toBe('')
    })
    test('H3: reassert sets the property again after someone removed it, and only while engaged', () => {
        const t = rig()
        t.hold.engage()
        t.host.style.removeProperty('overflow-anchor')
        t.hold.reassert()
        expect(t.value()).toBe('none')
        const idle = rig()
        idle.hold.reassert()
        expect(idle.value()).toBe('')
    })
    test('H4: a new engage cancels a pending release', () => {
        const t = rig()
        const first = t.hold.engage()
        t.hold.releaseAfterFrames(first)
        t.frame()
        t.hold.engage()
        expect(t.pending.size).toBe(0)
        for (let i = 0; i < 4; i += 1) t.frame()
        expect(t.value()).toBe('none')
    })
    test('H5: dispose removes the property and cancels a pending release', () => {
        const t = rig()
        const id = t.hold.engage()
        t.hold.releaseAfterFrames(id)
        t.frame()
        t.hold.dispose()
        expect(t.value()).toBe('')
        expect(t.pending.size).toBe(0)
    })
    test('H6: release and dispose do nothing when the hold is not engaged, so a value set by someone else survives', () => {
        const t = rig()
        t.host.style.setProperty('overflow-anchor', 'none')
        t.hold.dispose()
        expect(t.value()).toBe('none')
        t.hold.releaseAfterFrames(null)
        t.hold.releaseAfterFrames(1)
        expect(t.pending.size).toBe(0)
        for (let i = 0; i < 3; i += 1) t.frame()
        expect(t.value()).toBe('none')
    })
    test('H6b: after its own release the hold does not touch the property again', () => {
        const t = rig()
        const id = t.hold.engage()
        t.hold.releaseAfterFrames(id)
        t.frame(); t.frame()
        expect(t.value()).toBe('')
        t.host.style.setProperty('overflow-anchor', 'none')
        t.hold.releaseAfterFrames(id)
        t.hold.dispose()
        for (let i = 0; i < 3; i += 1) t.frame()
        expect(t.value()).toBe('none')
    })
    test('H7: a release keyed to a superseded engagement does nothing', () => {
        const t = rig()
        const stale = t.hold.engage()
        const current = t.hold.engage()
        t.hold.releaseAfterFrames(stale)
        expect(t.pending.size).toBe(0)
        for (let i = 0; i < 3; i += 1) t.frame()
        expect(t.value()).toBe('none')
        t.hold.releaseAfterFrames(current)
        t.frame(); t.frame()
        expect(t.value()).toBe('')
    })
    test('H8: with zero frames the release is synchronous unless a step hold is in flight, and then it waits a frame at a time', () => {
        const t = rig({ frames: 0 })
        t.hold.releaseAfterFrames(t.hold.engage())
        expect(t.value()).toBe('')
        const held = rig({ frames: 0 })
        const id = held.hold.engage()
        held.state.held = true
        held.hold.releaseAfterFrames(id)
        expect(held.value()).toBe('none')
        held.frame()
        expect(held.value()).toBe('none')
        held.state.held = false
        held.frame()
        expect(held.value()).toBe('')
    })
    test('H9: isCurrent is true only for the latest engagement, and a dispose makes it stale', () => {
        const t = rig()
        const a = t.hold.engage()
        expect(t.hold.isCurrent(a)).toBe(true)
        const b = t.hold.engage()
        expect(t.hold.isCurrent(a)).toBe(false)
        expect(t.hold.isCurrent(b)).toBe(true)
        expect(t.hold.isCurrent(null)).toBe(false)
        t.hold.dispose()
        expect(t.hold.isCurrent(b)).toBe(false)
    })
    test('a host that appears after the engage gets the property at the reassert, and the release removes it from there', () => {
        const t = rig()
        t.state.hostPresent = false
        const id = t.hold.engage()
        expect(t.value()).toBe('')
        t.state.hostPresent = true
        t.hold.reassert()
        expect(t.value()).toBe('none')
        t.hold.releaseAfterFrames(id)
        t.frame(); t.frame()
        expect(t.value()).toBe('')
    })
})

function record(overrides: Partial<ReturnRecord> = {}): ReturnRecord {
    return { origin: { index: 40, offset: 25, atBottom: false }, atEnd: false, pixel: 300, owner: 'room', ...overrides }
}
const mountedAll = (): boolean => true
const mountedNone = (): boolean => false

describe('returnPlan', () => {
    test('P1: no record gives none', () => {
        expect(returnPlan({ record: null, rebuilt: true, length: 100, mounted: mountedAll })).toEqual({ kind: 'none' })
    })
    test('P3: a reader at the exact end gets newest, even when the anchor is mounted; the 100 px band of the origin is not the rule', () => {
        expect(returnPlan({ record: record({ atEnd: true }), rebuilt: false, length: 100, mounted: mountedAll })).toEqual({ kind: 'newest' })
        expect(returnPlan({ record: record({ atEnd: false, origin: { index: 40, offset: 25, atBottom: true } }), rebuilt: false, length: 100, mounted: mountedAll })).toEqual({ kind: 'align', index: 40, offset: 25, settle: false })
    })
    test('P4: a mounted anchor gives align, and the settle band is asked for only when the rows were rebuilt', () => {
        expect(returnPlan({ record: record(), rebuilt: false, length: 100, mounted: mountedAll })).toEqual({ kind: 'align', index: 40, offset: 25, settle: false })
        expect(returnPlan({ record: record(), rebuilt: true, length: 100, mounted: mountedAll })).toEqual({ kind: 'align', index: 40, offset: 25, settle: true })
    })
    test('P5: an anchor that is not mounted gives jump with the same index and offset', () => {
        expect(returnPlan({ record: record(), rebuilt: false, length: 100, mounted: mountedNone })).toEqual({ kind: 'jump', index: 40, offset: 25 })
    })
    test('P6: the first message (index -1) is an anchor like any other', () => {
        const first = record({ origin: { index: -1, offset: 0, atBottom: false } })
        expect(returnPlan({ record: first, rebuilt: false, length: 100, mounted: mountedAll })).toEqual({ kind: 'align', index: -1, offset: 0, settle: false })
    })
    test('P7: a negative offset passes through unchanged', () => {
        const above = record({ origin: { index: 40, offset: -33, atBottom: false } })
        expect(returnPlan({ record: above, rebuilt: false, length: 100, mounted: mountedAll })).toEqual({ kind: 'align', index: 40, offset: -33, settle: false })
    })
    test('P8: the index is clamped to the chat', () => {
        const far = record({ origin: { index: 1200, offset: 5, atBottom: false } })
        expect(returnPlan({ record: far, rebuilt: false, length: 1000, mounted: mountedAll })).toEqual({ kind: 'align', index: 999, offset: 5, settle: false })
        expect(returnPlan({ record: far, rebuilt: false, length: 1000, mounted: mountedNone })).toEqual({ kind: 'jump', index: 999, offset: 5 })
        const before = record({ origin: { index: -5, offset: 5, atBottom: false } })
        expect(returnPlan({ record: before, rebuilt: false, length: 1000, mounted: mountedAll })).toEqual({ kind: 'align', index: -1, offset: 5, settle: false })
    })
    test('no message identified: the pixel is the way back only when the rows were rebuilt', () => {
        const unidentified = record({ origin: null })
        expect(returnPlan({ record: unidentified, rebuilt: true, length: 100, mounted: mountedAll })).toEqual({ kind: 'pixel', top: 300 })
        expect(returnPlan({ record: unidentified, rebuilt: false, length: 100, mounted: mountedAll })).toEqual({ kind: 'none' })
        expect(returnPlan({ record: record({ origin: null, pixel: null }), rebuilt: true, length: 100, mounted: mountedAll })).toEqual({ kind: 'none' })
    })
})

describe('beginReturn', () => {
    const base = { record: record(), ownerNow: 'room', rebuilt: false, lowered: false, waiting: false }
    test('P2: a different chat is not restored', () => {
        expect(beginReturn({ ...base, ownerNow: 'other', lowered: true })).toEqual({ restorable: false, deferBump: false })
    })
    test('no record is not restorable', () => {
        expect(beginReturn({ ...base, record: null })).toEqual({ restorable: false, deferBump: false })
    })
    test('P9: a lowered page size with an anchor defers the reset', () => {
        expect(beginReturn({ ...base, lowered: true })).toEqual({ restorable: true, deferBump: true })
    })
    test('P10: a reader at the exact end does not defer the reset', () => {
        expect(beginReturn({ ...base, record: record({ atEnd: true }), lowered: true })).toEqual({ restorable: true, deferBump: false })
    })
    test('P11: a waiting jump or ScrollToMessage request owns the position', () => {
        expect(beginReturn({ ...base, waiting: true, lowered: true })).toEqual({ restorable: false, deferBump: false })
    })
    test('P12: with no message identified, a rebuilt return is restorable by pixel and a plain one is not; the reset is never deferred', () => {
        const unidentified = record({ origin: null })
        expect(beginReturn({ ...base, record: unidentified, rebuilt: true, lowered: true })).toEqual({ restorable: true, deferBump: false })
        expect(beginReturn({ ...base, record: unidentified, rebuilt: false })).toEqual({ restorable: false, deferBump: false })
    })
})

describe('fallbackRest', () => {
    const blocked: FallbackRestInput = { deferred: true, outcome: 'jumpBlocked', readerActed: false, overtaken: false, chatChanged: false, superseded: false }
    test('F1: a restore that did not land rests the reader at the newest message', () => {
        expect(fallbackRest(blocked)).toBe(true)
    })
    test('F2: a restore that landed does not', () => {
        expect(fallbackRest({ ...blocked, outcome: 'landed' })).toBe(false)
    })
    test('F3: a reader who acted owns the position', () => {
        expect(fallbackRest({ ...blocked, outcome: 'jumpCancelled', readerActed: true })).toBe(false)
    })
    test('F4: a failed or skipped restore rests, a newer jump or a changed chat does not', () => {
        expect(fallbackRest({ ...blocked, outcome: 'failed' })).toBe(true)
        expect(fallbackRest({ ...blocked, outcome: 'skipped' })).toBe(true)
        expect(fallbackRest({ ...blocked, overtaken: true })).toBe(false)
        expect(fallbackRest({ ...blocked, chatChanged: true })).toBe(false)
    })
    test('F5: a newer visit owns the position', () => {
        expect(fallbackRest({ ...blocked, superseded: true })).toBe(false)
    })
    test('nothing is deferred: nothing rests', () => {
        expect(fallbackRest({ ...blocked, deferred: false })).toBe(false)
    })
})
