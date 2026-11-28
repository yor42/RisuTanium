// @vitest-environment jsdom
// The holder of the preset save ack: one ack at a time, built only by the factory a request resolves to and only while
// that request is current, so every built ack is held or disposed. Every live ack holds one repeating peer-poll timer on
// the fake clock, so `clock.pendingTimers()` counts live acks while no note is armed. New-rule guards (the module is new).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        frozenSaveKeysStore: writable([]),
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getSaveMarkCount: () => h.marks,
    getCommittedSaveMarkCount: () => 0,
    afterNextSaveCommit: () => {},
    requestSaveNow: () => {},
    getPeerSaveCount: () => 0,
    isCharacterUnsavable: () => false,
    isItemUnsavable: () => false,
    isSavingStopped: () => false,
    moduleCommitVerdict: () => 'saved',
    onSavingStopped: () => () => {},
    saving: { state: false },
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import { studioOpen } from 'src/ts/studio/studioOpen'
import { presetOwnerKey } from '../presetTarget'
import { presetNamed, seedPresetDb } from './presetFixture.test-helpers'
import { resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { createFakeClock, drainMicrotasks, type FakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createSaveAck, type SaveAck, type SaveAckDeps } from '../saveAck.svelte'
import { beginPresetAck, currentPresetAck, endPresetAck, notePresetEdit, resetPresetAckForTests, setPresetAckLoaderForTests, type PresetAckHolder } from '../presetAck.svelte'

let clock: FakeClock
let built: SaveAck[]
let marks: () => number

function makeAck(): SaveAck {
    const deps: SaveAckDeps = {
        getMarkCount: () => marks(),
        getCommittedMarkCount: () => 0,
        afterNextCommit: () => {},
        requestSaveNow: () => {},
        getPeerSaveCount: () => 0,
        onStopped: () => () => {},
        isStopped: () => false,
        subscribeFailure: () => () => {},
        currentFailure: () => null,
        frozenKeys: () => new Set<string>(),
        isCharacterUnsavable: () => false,
        onPassStart: () => () => {},
        visible: () => true,
        onVisibilityChange: () => () => {},
        clock,
    }
    const ack = createSaveAck(deps, { kind: 'preset', verdict: () => 'saved' })
    vi.spyOn(ack, 'dispose')
    vi.spyOn(ack, 'noteEdit')
    built.push(ack)
    return ack
}

// A factory that builds a real ack on the fake clock and records it.
function newFactory() {
    return vi.fn(() => makeAck())
}

// A load the test resolves or rejects by hand; every call returns the one shared promise, as the production import does.
function deferredLoad() {
    let resolve!: (factory: () => SaveAck) => void
    let reject!: (error: Error) => void
    const promise = new Promise<() => SaveAck>((res, rej) => {
        resolve = res
        reject = rej
    })
    const load = vi.fn(() => promise)
    return { load, resolve, reject }
}

function immediateLoad(factory: () => SaveAck) {
    return vi.fn(async () => factory)
}

const settle = () => drainMicrotasks()
const live = () => clock.pendingTimers()

let unhandled: unknown[]
const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }

beforeEach(() => {
    clock = createFakeClock()
    built = []
    marks = () => 1
    unhandled = []
    process.on('unhandledRejection', onUnhandled)
    studioOpen.set(false)
    resetPresetAckForTests()
})

afterEach(() => {
    resetPresetAckForTests()
    studioOpen.set(false)
    process.off('unhandledRejection', onUnhandled)
    vi.restoreAllMocks()
})

describe('begin and end', () => {
    test('H1 the same preset in the same visit keeps one ack and builds once', async () => {
        const factory = newFactory()
        setPresetAckLoaderForTests(immediateLoad(factory))
        beginPresetAck('A', 'v1')
        await settle()
        const first = currentPresetAck('A')
        expect(first).not.toBeNull()
        beginPresetAck('A', 'v1')
        await settle()
        expect(factory).toHaveBeenCalledTimes(1)
        expect(currentPresetAck('A')).toBe(first)
        expect(live()).toBe(1)
    })

    test('H2 another preset disposes the old ack and holds a new one', async () => {
        const factory = newFactory()
        setPresetAckLoaderForTests(immediateLoad(factory))
        beginPresetAck('A', 'v1')
        await settle()
        const first = built[0]
        beginPresetAck('B', 'v1')
        await settle()
        expect(first.dispose).toHaveBeenCalledTimes(1)
        expect(currentPresetAck('A')).toBeNull()
        expect(currentPresetAck('B')).toBe(built[1])
        expect(live()).toBe(1)
    })

    test('H2b a switch disposes the old ack before the new one resolves', async () => {
        const factory = newFactory()
        const slow = deferredLoad()
        setPresetAckLoaderForTests(immediateLoad(factory))
        beginPresetAck('A', 'v1')
        await settle()
        setPresetAckLoaderForTests(slow.load)
        beginPresetAck('B', 'v1')
        expect(currentPresetAck('A')).toBeNull()
        expect(currentPresetAck('B')).toBeNull()
        expect(built[0].dispose).toHaveBeenCalledTimes(1)
        expect(live()).toBe(0)
        slow.resolve(factory)
        await settle()
        expect(currentPresetAck('B')).toBe(built[1])
    })

    test('H3 a new visit of the same preset replaces the ack', async () => {
        const factory = newFactory()
        setPresetAckLoaderForTests(immediateLoad(factory))
        beginPresetAck('A', 'v1')
        await settle()
        beginPresetAck('A', 'v2')
        await settle()
        expect(built).toHaveLength(2)
        expect(built[0].dispose).toHaveBeenCalledTimes(1)
        expect(currentPresetAck('A')).toBe(built[1])
        expect(live()).toBe(1)
    })

    test('H4 Studio closing disposes the ack and makes it current for nobody', async () => {
        studioOpen.set(true)
        setPresetAckLoaderForTests(immediateLoad(newFactory()))
        beginPresetAck('A', 'v1')
        await settle()
        expect(currentPresetAck('A')).not.toBeNull()
        studioOpen.set(false)
        expect(currentPresetAck('A')).toBeNull()
        expect(built[0].dispose).toHaveBeenCalledTimes(1)
        expect(live()).toBe(0)
    })

    test('H4b Studio closing during a pending import builds nothing, and the next visit builds one', async () => {
        studioOpen.set(true)
        const factory = newFactory()
        const pending = deferredLoad()
        setPresetAckLoaderForTests(pending.load)
        beginPresetAck('A', 'v1')
        studioOpen.set(false)
        pending.resolve(factory)
        await settle()
        expect(factory).toHaveBeenCalledTimes(0)
        expect(currentPresetAck('A')).toBeNull()
        expect(live()).toBe(0)
        studioOpen.set(true)
        beginPresetAck('A', 'v2')
        await settle()
        expect(factory).toHaveBeenCalledTimes(1)
        expect(currentPresetAck('A')).toBe(built[0])
        expect(live()).toBe(1)
    })

    test('H5 an end for another preset changes nothing; an end for its own, or with no id, disposes', async () => {
        setPresetAckLoaderForTests(immediateLoad(newFactory()))
        beginPresetAck('A', 'v1')
        await settle()
        endPresetAck('B')
        expect(currentPresetAck('A')).toBe(built[0])
        expect(built[0].dispose).not.toHaveBeenCalled()
        endPresetAck('A')
        expect(currentPresetAck('A')).toBeNull()
        expect(built[0].dispose).toHaveBeenCalledTimes(1)
        beginPresetAck('A', 'v2')
        await settle()
        endPresetAck()
        expect(built[1].dispose).toHaveBeenCalledTimes(1)
        expect(live()).toBe(0)
    })

    test('H10 the ack is current for its own id only', async () => {
        setPresetAckLoaderForTests(immediateLoad(newFactory()))
        beginPresetAck('A', 'v1')
        await settle()
        expect(currentPresetAck('A')).not.toBeNull()
        expect(currentPresetAck('B')).toBeNull()
        expect(currentPresetAck(null)).toBeNull()
    })
})

describe('notes', () => {
    test('H6 an edit is forwarded to the ack of its own preset only', async () => {
        setPresetAckLoaderForTests(immediateLoad(newFactory()))
        beginPresetAck('A', 'v1')
        await settle()
        notePresetEdit('B', 1)
        expect(built[0].noteEdit).not.toHaveBeenCalled()
        notePresetEdit('A', 2)
        expect(built[0].noteEdit).toHaveBeenCalledWith('A', 2)
    })

    test('H7a notes made while the import runs are replayed once, with the earliest count', async () => {
        const pending = deferredLoad()
        setPresetAckLoaderForTests(pending.load)
        beginPresetAck('A', 'v1')
        notePresetEdit('A', 5)
        notePresetEdit('A', 3)
        notePresetEdit('B', 0)
        pending.resolve(newFactory())
        await settle()
        expect(built[0].noteEdit).toHaveBeenCalledTimes(1)
        expect(built[0].noteEdit).toHaveBeenCalledWith('A', 3)
    })

    test('H7c an end before the import resolves builds no ack, even after a note', async () => {
        const factory = newFactory()
        const pending = deferredLoad()
        setPresetAckLoaderForTests(pending.load)
        beginPresetAck('A', 'v1')
        endPresetAck('A')
        notePresetEdit('A', 1)
        pending.resolve(factory)
        await settle()
        expect(factory).toHaveBeenCalledTimes(0)
        expect(currentPresetAck('A')).toBeNull()
        expect(live()).toBe(0)
    })

    test('H7b begin, end, begin on one import, and begin A, B, A, each build exactly one ack', async () => {
        const first = newFactory()
        const one = deferredLoad()
        setPresetAckLoaderForTests(one.load)
        beginPresetAck('A', 'v1')
        endPresetAck('A')
        beginPresetAck('A', 'v1')
        one.resolve(first)
        await settle()
        expect(first).toHaveBeenCalledTimes(1)
        expect(currentPresetAck('A')).toBe(built[0])
        expect(live()).toBe(1)

        resetPresetAckForTests()
        built.length = 0
        const second = newFactory()
        const two = deferredLoad()
        setPresetAckLoaderForTests(two.load)
        beginPresetAck('A', 'v1')
        beginPresetAck('B', 'v1')
        beginPresetAck('A', 'v1')
        two.resolve(second)
        await settle()
        expect(second).toHaveBeenCalledTimes(1)
        expect(currentPresetAck('A')).toBe(built[0])
        expect(currentPresetAck('B')).toBeNull()
        expect(live()).toBe(1)
    })

    test('I3b across a mixed run, every built ack is held or disposed and live timers equal the held acks', async () => {
        studioOpen.set(true)
        const factory = newFactory()
        setPresetAckLoaderForTests(immediateLoad(factory))
        const steps: (() => void)[] = [
            () => beginPresetAck('A', 'v1'),
            () => beginPresetAck('B', 'v1'),
            () => endPresetAck('B'),
            () => beginPresetAck('A', 'v2'),
            () => beginPresetAck('A', 'v2'),
            () => endPresetAck(),
            () => beginPresetAck('C', 'v3'),
        ]
        for (const step of steps) {
            step()
            await settle()
            const heldCount = [currentPresetAck('A'), currentPresetAck('B'), currentPresetAck('C')].filter((ack) => ack !== null).length
            const disposed = built.filter((ack) => vi.mocked(ack.dispose).mock.calls.length > 0).length
            expect(heldCount).toBeLessThanOrEqual(1)
            expect(built.length).toBe(disposed + heldCount)
            expect(live()).toBe(heldCount)
        }
    })
})

describe('failures', () => {
    test('H9 a rejected import and a throwing factory are logged once, leave nothing, and the next begin retries', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

        const failing = deferredLoad()
        setPresetAckLoaderForTests(failing.load)
        beginPresetAck('A', 'v1')
        notePresetEdit('A', 0)
        failing.reject(new Error('import failed'))
        await settle()
        expect(currentPresetAck('A')).toBeNull()
        expect(logged).toHaveBeenCalledTimes(1)
        expect(live()).toBe(0)

        const working = newFactory()
        setPresetAckLoaderForTests(immediateLoad(working))
        beginPresetAck('A', 'v1')
        await settle()
        expect(currentPresetAck('A')).toBe(built[0])
        expect(built[0].noteEdit).not.toHaveBeenCalled()
        expect(live()).toBe(1)

        resetPresetAckForTests()
        logged.mockClear()
        const throwing = vi.fn((): SaveAck => { throw new Error('factory failed') })
        setPresetAckLoaderForTests(immediateLoad(throwing))
        beginPresetAck('A', 'v1')
        await settle()
        expect(throwing).toHaveBeenCalledTimes(1)
        expect(currentPresetAck('A')).toBeNull()
        expect(logged).toHaveBeenCalledTimes(1)
        expect(live()).toBe(0)

        setPresetAckLoaderForTests(immediateLoad(newFactory()))
        beginPresetAck('A', 'v1')
        await settle()
        expect(currentPresetAck('A')).not.toBeNull()
        expect(live()).toBe(1)
        expect(unhandled).toEqual([])
    })

    test('H9c a throwing replay disposes the ack it built and holds nothing', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        marks = () => { throw new Error('marks unreadable') }
        const factory = newFactory()
        const pending = deferredLoad()
        setPresetAckLoaderForTests(pending.load)
        beginPresetAck('A', 'v1')
        notePresetEdit('A', 0)
        pending.resolve(factory)
        await settle()
        expect(factory).toHaveBeenCalledTimes(1)
        expect(built[0].dispose).toHaveBeenCalledTimes(1)
        expect(currentPresetAck('A')).toBeNull()
        expect(live()).toBe(0)
        expect(logged).toHaveBeenCalledTimes(1)
        expect(unhandled).toEqual([])
    })

    test('H12 a reset while the import is pending builds nothing when it resolves', async () => {
        const factory = newFactory()
        const pending = deferredLoad()
        setPresetAckLoaderForTests(pending.load)
        beginPresetAck('A', 'v1')
        resetPresetAckForTests()
        setPresetAckLoaderForTests(immediateLoad(newFactory()))
        pending.resolve(factory)
        await settle()
        expect(factory).toHaveBeenCalledTimes(0)
        expect(currentPresetAck('A')).toBeNull()
        expect(live()).toBe(0)
    })

    test('H12b a begin after the reset does not adopt the old request', async () => {
        const stale = newFactory()
        const fresh = newFactory()
        const pending = deferredLoad()
        setPresetAckLoaderForTests(pending.load)
        beginPresetAck('A', 'v1')
        resetPresetAckForTests()
        setPresetAckLoaderForTests(immediateLoad(fresh))
        beginPresetAck('A', 'v1')
        pending.resolve(stale)
        await settle()
        expect(stale).toHaveBeenCalledTimes(0)
        expect(fresh).toHaveBeenCalledTimes(1)
        expect(live()).toBe(1)
    })
})

describe('H8 the real history service feeds the held ack', () => {
    const PATH = 'customModuleToggle'
    let ids: string[]

    function service() {
        return createOwnerHistoryService({
            store: createMemoryStudioStore({ pageSession: 'p1' }),
            claim: createClaimDouble(),
            clock,
            pageSession: 'p1',
            getVisitId: () => 'v1',
            getMarkCount: () => h.marks,
            registerLeaveFlush: () => () => {},
        })
    }

    beforeEach(() => {
        h.marks = 4
        resetStudioScreenForTests()
        ids = seedPresetDb([presetNamed('A', 'a=A'), presetNamed('B', 'b=B')], 0, 'a=A')
    })

    afterEach(() => {
        resetStudioScreenForTests()
    })

    test('a landed preset edit notes the held ack with the count read before the write', async () => {
        setPresetAckLoaderForTests(immediateLoad(newFactory()))
        beginPresetAck(ids[1], 'v1')
        await settle()
        expect(service().editText(presetOwnerKey(ids[1]), PATH, 'b=edited', 'single')).toEqual({ ok: true })
        expect(built[0].noteEdit).toHaveBeenCalledTimes(1)
        expect(built[0].noteEdit).toHaveBeenCalledWith(ids[1], 4)
    })

    test('a refused edit of a preset that is gone notes nothing', async () => {
        setPresetAckLoaderForTests(immediateLoad(newFactory()))
        beginPresetAck(ids[1], 'v1')
        await settle()
        const svc = service()
        DBState.db.botPresets.splice(1, 1)
        const result = svc.editText(presetOwnerKey(ids[1]), PATH, 'b=edited', 'single')
        expect(result.ok).toBe(false)
        expect(built[0].noteEdit).not.toHaveBeenCalled()
    })
})

describe('holders', () => {
    const h1: PresetAckHolder = { label: 'one' }
    const h2: PresetAckHolder = { label: 'two' }

    test('A1 one holder ending leaves the ack another holder joined; the last holder disposes it', async () => {
        setPresetAckLoaderForTests(immediateLoad(newFactory()))
        beginPresetAck('A', 'v1', h1)
        beginPresetAck('A', 'v1', h2)
        await settle()
        const ack = currentPresetAck('A')
        expect(ack).not.toBeNull()
        endPresetAck('A', h1)
        expect(currentPresetAck('A')).toBe(ack)
        expect(built[0].dispose).not.toHaveBeenCalled()
        expect(live()).toBe(1)
        endPresetAck('A', h2)
        expect(currentPresetAck('A')).toBeNull()
        expect(live()).toBe(0)
    })

    test('A2 a holder that never joined the entry ends nothing', async () => {
        setPresetAckLoaderForTests(immediateLoad(newFactory()))
        beginPresetAck('A', 'v1', h1)
        await settle()
        endPresetAck('A', h2)
        expect(currentPresetAck('A')).toBe(built[0])
        expect(built[0].dispose).not.toHaveBeenCalled()
        expect(live()).toBe(1)
    })

    test('A3 a lone holder ends the ack it began, after a deferred import (compatibility guard)', async () => {
        const pending = deferredLoad()
        setPresetAckLoaderForTests(pending.load)
        beginPresetAck('A', 'v1', h1)
        pending.resolve(newFactory())
        await settle()
        expect(currentPresetAck('A')).toBe(built[0])
        endPresetAck('A', h1)
        expect(currentPresetAck('A')).toBeNull()
        expect(live()).toBe(0)
    })

    test('A4 a holder end of one preset leaves another preset; the no-argument end ends everything (compatibility guard)', async () => {
        setPresetAckLoaderForTests(immediateLoad(newFactory()))
        beginPresetAck('A', 'v1', h1)
        beginPresetAck('B', 'v1', h2)
        await settle()
        endPresetAck('A', h1)
        expect(currentPresetAck('B')).toBe(built[0])
        expect(live()).toBe(1)
        endPresetAck()
        expect(currentPresetAck('B')).toBeNull()
        expect(live()).toBe(0)
    })

    test('A5a the last holder ending during the import builds nothing (compatibility guard)', async () => {
        const factory = newFactory()
        const pending = deferredLoad()
        setPresetAckLoaderForTests(pending.load)
        beginPresetAck('A', 'v1', h1)
        endPresetAck('A', h1)
        pending.resolve(factory)
        await settle()
        expect(factory).not.toHaveBeenCalled()
        expect(currentPresetAck('A')).toBeNull()
        expect(live()).toBe(0)
    })

    test('A5b one holder ending during the import leaves the request the other joined', async () => {
        const factory = newFactory()
        const pending = deferredLoad()
        setPresetAckLoaderForTests(pending.load)
        beginPresetAck('A', 'v1', h1)
        beginPresetAck('A', 'v1', h2)
        endPresetAck('A', h1)
        pending.resolve(factory)
        await settle()
        expect(factory).toHaveBeenCalledTimes(1)
        expect(currentPresetAck('A')).toBe(built[0])
        expect(live()).toBe(1)
        endPresetAck('A', h2)
        expect(currentPresetAck('A')).toBeNull()
        expect(live()).toBe(0)
    })

    test('A6 a late end of an older visit\'s holder leaves the newer visit\'s ack', async () => {
        setPresetAckLoaderForTests(immediateLoad(newFactory()))
        beginPresetAck('A', 'v1', h1)
        await settle()
        beginPresetAck('A', 'v2', h2)
        await settle()
        expect(built[0].dispose).toHaveBeenCalledTimes(1)
        endPresetAck('A', h1)
        expect(currentPresetAck('A')).toBe(built[1])
        expect(built[1].dispose).not.toHaveBeenCalled()
        expect(live()).toBe(1)
    })

    test('A7 a same-entry begin while the import runs joins it and keeps the edit noted meanwhile', async () => {
        const pending = deferredLoad()
        setPresetAckLoaderForTests(pending.load)
        beginPresetAck('A', 'v1', h1)
        beginPresetAck('A', 'v1', h2)
        notePresetEdit('A', 3)
        endPresetAck('A', h2)
        pending.resolve(newFactory())
        await settle()
        expect(currentPresetAck('A')).toBe(built[0])
        expect(built[0].noteEdit).toHaveBeenCalledWith('A', 3)
        expect(built[0].dispose).not.toHaveBeenCalled()
        endPresetAck('A', h1)
        expect(currentPresetAck('A')).toBeNull()
        expect(live()).toBe(0)
    })
})