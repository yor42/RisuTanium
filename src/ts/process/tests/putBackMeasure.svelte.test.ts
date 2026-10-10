/**
 * The put-back measurement hooks (`../memory/putBackMeasure`, `measureFlag`,
 * and their callers in `characterPutBack` and `coldRetained`): reason counters,
 * fire and fingerprint samples, candidate waits, dirty-key tallies, the
 * measurement A/B switch and the late-write tripwire.
 *
 * The setup is that of `characterPutBack.svelte.test.ts`: the same stand-ins
 * for the unit reader, the save loop (`h.commits`) and `isWriting`.
 *
 * Labels: "acceptance" tests the hooks, which do not exist on the base;
 * "feature" tests the tripwire, which cannot fail on 1b code and is not a
 * defect reproducer; "guard" passes with or without the code it names.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const h = vi.hoisted(() => ({
    units: new Map<string, unknown>(),
    commits: [] as Array<() => void>,
    writing: new Set<string>(),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    afterNextSaveCommit: (callback: () => void) => { h.commits.push(callback) },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/chatOrigin'), () => ({
    isWriting: (target: { chaId: string }) => h.writing.has(target.chaId),
}) as unknown as typeof import('src/ts/process/chatOrigin'))

vi.mock(import('src/ts/process/coldstorage.svelte'), async () => {
    const { noteReadSize } = await import('src/ts/process/memory/restoredBytes')
    return {
        readColdStorageItem: async (key: string) => {
            const unit = h.units.get(key)
            if (unit === undefined) {
                return { status: 'missing' }
            }
            const json = JSON.stringify(unit)
            const result = { status: 'ok', value: JSON.parse(json) }
            noteReadSize(result, json.length)
            return result
        },
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { restoreColdCharacter, findChaIdHolders } from 'src/ts/process/coldCharacterRestore'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import { rawRefOf, resetRetainedForTest, retainedCount, retainedRecordOf } from 'src/ts/process/coldRetained'
import { getPutBackCounters, resetPutBackForTest, startCharacterPutBack } from 'src/ts/process/memory/characterPutBack'
import { beginBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { MEASURE, putBackEnabled, resetMeasureFlagsForTest, tripwireEnabled } from 'src/ts/process/memory/measureFlag'
import { heldValue, noteDirty, noteReplaced, onFinalized, reset, snapshot, tripwireStep } from 'src/ts/process/memory/putBackMeasure'
import { resetRestoredBytesForTest, restoredBytesOf } from 'src/ts/process/memory/restoredBytes'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'

type Slot = Database['characters'][number]

let stop: (() => void) | null = null
let clock = 0

function fullCharacter(chaId: string, extra: Record<string, unknown> = {}): Slot {
    return {
        chaId,
        name: chaId,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat`, message: [{ role: 'char', data: 'hello', time: 1 }], note: '', name: '', localLore: [] }],
        globalLore: [],
        lastInteraction: 100,
        ...extra,
    } as unknown as Slot
}

function groupCharacter(chaId: string, members: string[]): Slot {
    return { ...fullCharacter(chaId), type: 'group', characters: members } as unknown as Slot
}

function archiveAll(sources: Slot[], dbExtra: Record<string, unknown> = {}): void {
    const stubs = sources.map((source) => {
        const key = `unit-${source.chaId}`
        h.units.set(key, { character: source })
        return buildColdStub(source, key, [])
    })
    DBState.db = {
        formatversion: 5,
        archiveCharacters: true,
        plugins: [],
        characters: stubs,
        ...dbExtra,
    } as unknown as Database
}

const slot = (chaId: string): Slot => DBState.db.characters[findChaIdHolders(chaId)[0]]
const isStub = (chaId: string): boolean => typeof slot(chaId).coldstorage === 'string'

async function open(chaId: string): Promise<void> {
    const outcome = await restoreColdCharacter(slot(chaId), { byChaId: true, quiet: true })
    expect(outcome.status).toBe('restored')
    selectedCharID.set(findChaIdHolders(chaId)[0])
}

function commit(): void {
    const callbacks = h.commits.splice(0)
    for (const callback of callbacks) {
        callback()
    }
}

/** Replaces the page's storage; `null` makes every read throw. */
function stubStorage(values: Record<string, string> | null): void {
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => {
            if (values === null) {
                throw new Error('storage unavailable')
            }
            return values[key] ?? null
        },
    })
    resetMeasureFlagsForTest()
}

beforeEach(() => {
    h.units.clear()
    h.commits.length = 0
    h.writing.clear()
    clock = 0
    resetRetainedForTest()
    resetPutBackForTest()
    resetBusyActionsForTest()
    resetRestoredBytesForTest()
    resetCharacterSaveMarksForTest()
    resetMeasureFlagsForTest()
    selectedCharID.set(-1)
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    installCharacterSaveMarks({ tracker, schedule: vi.fn() })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    stop?.()
    stop = null
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    resetMeasureFlagsForTest()
})

/** Opens A, B and C so that A is a candidate whose put-back waits for the next commit. */
async function openThree(extra: Slot[] = []): Promise<void> {
    archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), ...extra])
    stop = startCharacterPutBack()
    await open('A')
    await open('B')
    await open('C')
}

describe('the build flag', () => {
    test('acceptance: MEASURE is false and nothing is installed when the module is loaded outside development', async () => {
        vi.resetModules()
        vi.stubEnv('DEV', false)
        stubStorage({ 'risu-measure-putback': 'off', 'risu-measure-tripwire': 'on' })
        const holder = globalThis as { __risuPutBackMeasure?: unknown }
        const installed = holder.__risuPutBackMeasure
        delete holder.__risuPutBackMeasure

        try {
            const flag = await import('src/ts/process/memory/measureFlag')
            await import('src/ts/process/memory/putBackMeasure')

            expect(flag.MEASURE).toBe(false)
            expect(flag.putBackEnabled()).toBe(true)
            expect(flag.tripwireEnabled()).toBe(false)
            expect(holder.__risuPutBackMeasure).toBeUndefined()
        } finally {
            holder.__risuPutBackMeasure = installed
        }
    })

    test('guard: MEASURE is true in this suite and the hook is installed', () => {
        expect(MEASURE).toBe(true)
        expect((globalThis as { __risuPutBackMeasure?: { snapshot(): unknown } }).__risuPutBackMeasure?.snapshot).toBeTypeOf('function')
    })
})

describe('the A/B switch', () => {
    test('acceptance: off retains nothing and puts nothing back', async () => {
        stubStorage({ 'risu-measure-putback': 'off' })
        await openThree()

        expect(putBackEnabled()).toBe(false)
        expect(retainedCount()).toBe(0)
        expect(retainedRecordOf(slot('A'))).toBeUndefined()
        expect(h.commits.length).toBe(0)
        commit()
        expect(isStub('A')).toBe(false)
        expect(getPutBackCounters().clean).toBe(0)
        expect(snapshot().fingerprint.samples.length).toBe(0)
    })

    test.each([
        ['storage without the key', {}],
        ['garbage in the key', { 'risu-measure-putback': 'maybe' }],
        ['storage that throws', null],
    ])('acceptance: %s leaves put-back on', async (_label, values) => {
        stubStorage(values)
        await openThree()

        expect(putBackEnabled()).toBe(true)
        expect(retainedCount()).toBe(3)
        commit()
        expect(isStub('A')).toBe(true)
    })

    test('guard: the tripwire defaults to off for absent, garbage and throwing storage', () => {
        for (const values of [{}, { 'risu-measure-tripwire': 'yes' }, null]) {
            stubStorage(values)
            expect(tripwireEnabled()).toBe(false)
        }
        stubStorage({ 'risu-measure-tripwire': 'on' })
        expect(tripwireEnabled()).toBe(true)
    })
})

describe('counters and samples', () => {
    test('acceptance: a clean put-back records the fire, the three fingerprint sources and the wait with its exit', async () => {
        await openThree()
        commit()

        const snap = snapshot()
        expect(snap.counters.clean).toBe(1)
        expect(snap.fire.byOutcome.fingerprinted?.count).toBe(1)
        expect(snap.fire.fingerprinting.count).toBe(1)
        expect(Object.keys(snap.fingerprint.bySource).sort()).toEqual(['fire', 'restore', 'restore-keyhash'])
        expect(snap.fingerprint.samples.every((sample) => sample.length > 0)).toBe(true)
        expect(snap.candidateWait.samples.map((sample) => sample.exit)).toEqual(['swap'])
        expect(snap.candidateWait.stillPending).toBe(0)
        expect(snap.retainedCount).toBe(2)
    })

    test('acceptance: a candidate waits from its first add; a re-add does not restart the wait', async () => {
        vi.spyOn(performance, 'now').mockImplementation(() => clock)
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), fullCharacter('D')])
        stop = startCharacterPutBack()
        await open('A')
        await open('B')
        clock = 10
        await open('C')
        clock = 20
        await open('D')
        clock = 50
        expect(snapshot().candidateWait.stillPending).toBe(2)
        expect(snapshot().candidateWait.oldestPendingMs).toBe(40)

        commit()

        const waits = snapshot().candidateWait.samples
        expect(waits.map((sample) => sample.exit)).toEqual(['swap'])
        expect(waits[0].ms).toBe(40)
    })

    test('acceptance: a dirty verdict tallies the differing key and keeps a sample', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        stop = startCharacterPutBack()
        await open('A')
        slot('A').name = 'renamed'
        await open('B')
        await open('C')

        commit()

        const snap = snapshot()
        expect(snap.counters.dirty).toBe(1)
        expect(snap.counters.dirtyNoKeys).toBe(0)
        expect(snap.dirty.byKey).toEqual({ name: 1 })
        expect(snap.dirty.samples).toEqual([{ chaId: 'A', keys: ['name'] }])
        expect(snap.candidateWait.samples.map((sample) => sample.exit)).toEqual(['dirty'])
    })

    test('acceptance: the per-key hash cost of a dirty verdict is its own sample and is left out of the fire duration and budget', async () => {
        // The development console line sits inside the excluded span, so it stands in for slow key hashing.
        vi.spyOn(performance, 'now').mockImplementation(() => clock)
        vi.mocked(console.debug).mockImplementation(() => { clock += 1000 })
        archiveAll(['A', 'B', 'C', 'D', 'E', 'F'].map((id) => fullCharacter(id)))
        stop = startCharacterPutBack()
        for (const id of ['A', 'B', 'C', 'D', 'E']) {
            await open(id)
        }
        for (const id of ['A', 'B', 'C']) {
            slot(id).name = `${id} edited`
        }
        await open('F')

        commit()

        const snap = snapshot()
        expect(snap.counters.dirty).toBe(3)
        expect(snap.fingerprint.bySource['fire-keyhash']?.count).toBe(3)
        expect(snap.fingerprint.bySource.fire?.count).toBe(3)
        expect(snap.fire.fingerprinting.max).toBe(0)
        expect(clock).toBe(3000)
    })

    test('acceptance: a dirty verdict with an empty key list is counted as dirtyNoKeys and tallies no key', () => {
        // A reactive character keeps its key order, so a fingerprint-only difference cannot be staged through a restored one.
        noteDirty('A', [])

        const snap = snapshot()
        expect(snap.counters.dirtyNoKeys).toBe(1)
        expect(snap.dirty.byKey).toEqual({})
        expect(snap.dirty.samples).toEqual([{ chaId: 'A', keys: [] }])
    })

    test('acceptance: a candidate that joins the keep-set leaves as kept', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), groupCharacter('G', ['A', 'B'])])
        stop = startCharacterPutBack()
        await open('A')
        await open('B')
        await open('C')
        await open('G')

        commit()
        const afterKept = snapshot()
        expect(afterKept.counters.kept).toBeGreaterThanOrEqual(1)
        expect(afterKept.candidateWait.byExit.kept?.count).toBeGreaterThanOrEqual(1)
        expect(afterKept.fire.byOutcome['kept-only']?.count).toBe(1)
    })

    test('acceptance: a candidate selected again before the commit leaves as cleared', async () => {
        await openThree()

        selectedCharID.set(findChaIdHolders('A')[0])

        const afterSelect = snapshot()
        expect(afterSelect.candidateWait.byExit['cleared-selection']?.count).toBe(1)
        expect(afterSelect.counters.cleared).toBe(1)
    })

    test('acceptance: a busy deferral and an isWriting deferral are tagged by outcome and keep the wait running', async () => {
        await openThree()
        const end = beginBusy('import').end

        commit()
        expect(snapshot().fire.byOutcome.busy?.count).toBe(1)
        expect(snapshot().counters.busy).toBe(1)
        expect(snapshot().candidateWait.stillPending).toBe(1)
        end()
        h.writing.add('A')

        commit()
        expect(snapshot().fire.byOutcome.writing?.count).toBe(1)
        expect(snapshot().counters.writing).toBe(1)
        expect(snapshot().candidateWait.samples).toEqual([])
        h.writing.clear()

        commit()
        expect(snapshot().candidateWait.samples.map((sample) => sample.exit)).toEqual(['swap'])
    })

    test('acceptance: both early exits clear the waiting candidates and record why', async () => {
        await openThree()
        DBState.db.archiveCharacters = false
        commit()
        expect(snapshot().candidateWait.byExit['cleared-early']?.count).toBe(1)
        expect(snapshot().fire.byOutcome.empty?.count).toBe(1)

        await openThree()
        ;(DBState.db as { characters: unknown }).characters = undefined
        commit()
        expect(snapshot().candidateWait.byExit['cleared-early']?.count).toBe(2)
        expect(snapshot().counters.cleared).toBe(2)
        expect(snapshot().candidateWait.stillPending).toBe(0)
    })

    test('acceptance: the snapshot counts restored bytes outside the keep-set and the retained records', async () => {
        await openThree()

        const snap = snapshot()
        expect(snap.restoredBytesOutside).toBe(restoredBytesOf('A'))
        expect(snap.restoredBytesOutside).toBeGreaterThan(0)
        expect(snap.retainedCount).toBe(3)
    })
})

describe('the tripwire', () => {
    test('feature: a write to the replaced character at the next commit is a late write, once, with its key', async () => {
        stubStorage({ 'risu-measure-tripwire': 'on' })
        await openThree()
        const replaced = slot('A')
        commit()
        expect(isStub('A')).toBe(true)

        replaced.name = 'late'
        commit()

        expect(snapshot().tripwire.lateWrites).toEqual([{ chaId: 'A', keys: ['name'], atCommit: 1 }])
        commit()
        commit()
        expect(snapshot().tripwire.lateWrites.length).toBe(1)
        expect(replaced.name).toBe('late')
    })

    test('feature: an untouched replaced character adds nothing, is pinned after three commits, and undetermined before', async () => {
        stubStorage({ 'risu-measure-tripwire': 'on' })
        await openThree()
        const replaced = slot('A')
        commit()

        commit()
        expect(snapshot().tripwire).toMatchObject({ swaps: 1, undetermined: 1, pinned: 0, lateWrites: [] })
        commit()
        commit()

        expect(snapshot().tripwire).toMatchObject({ swaps: 1, undetermined: 0, pinned: 1, lateWrites: [] })
        expect(replaced.chaId).toBe('A')
    })

    test('feature: the record keeps a weak reference to the raw decoded object, and the snapshot splits proxy from raw', async () => {
        stubStorage({ 'risu-measure-tripwire': 'on' })
        await openThree()
        const rawRef = rawRefOf(retainedRecordOf(slot('A'))!)
        expect(rawRef).toBeInstanceOf(WeakRef)
        expect(rawRef?.deref()).toBeDefined()
        expect(rawRef?.deref()).not.toBe(slot('A'))
        const replaced = slot('A')
        commit()

        expect(snapshot().tripwire).toMatchObject({ swaps: 1, proxyAlive: 1, rawAlive: 1 })
        expect(replaced.chaId).toBe('A')
    })

    test('feature: an entry is pinned while only the raw object is alive, and collected only when both are gone', () => {
        const dead = new WeakSet<object>()
        vi.stubGlobal('WeakRef', class {
            constructor(private readonly target: object) { }
            deref(): object | undefined {
                return dead.has(this.target) ? undefined : this.target
            }
        })
        const proxy = { name: 'proxy' }
        const raw = { name: 'raw' }
        noteReplaced('X', 'fp', undefined, proxy, new WeakRef(raw))
        dead.add(proxy)
        for (let i = 0; i < 3; i++) {
            tripwireStep()
        }
        expect(snapshot().tripwire).toMatchObject({ swaps: 1, pinned: 1, collected: 0, proxyAlive: 0, rawAlive: 1 })

        dead.add(raw)

        expect(snapshot().tripwire).toMatchObject({ swaps: 1, pinned: 0, collected: 1, proxyAlive: 0, rawAlive: 0 })
    })

    test('acceptance: a finalization from before a reset is ignored; one from the current generation counts, by kind', () => {
        const before = heldValue(false, 0)
        const beforeRaw = heldValue(true, 0)
        reset()

        onFinalized(before)
        onFinalized(beforeRaw)
        expect(snapshot().tripwire).toMatchObject({ finalizedProxy: 0, finalizedRaw: 0 })

        onFinalized(heldValue(false, 3))
        onFinalized(heldValue(true, 3))
        onFinalized(heldValue(true, 4))
        expect(snapshot().tripwire).toMatchObject({ finalizedProxy: 1, finalizedRaw: 2 })
    })

    test('feature: it stops asking for commits after three', async () => {
        stubStorage({ 'risu-measure-tripwire': 'on' })
        await openThree()
        commit()

        for (let i = 0; i < 3; i++) {
            expect(h.commits.length).toBe(1)
            commit()
        }

        expect(h.commits.length).toBe(0)
    })

    test('feature: with the tripwire off no watch is started and no commit callback is queued', async () => {
        await openThree()

        commit()

        expect(isStub('A')).toBe(true)
        expect(h.commits.length).toBe(0)
        expect(snapshot().tripwire.swaps).toBe(0)
    })
})
