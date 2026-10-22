/**
 * The put-back on a store2 page (`../memory/characterPutBack`, the branch that runs while a residency is registered):
 * a character the residency loaded and nothing changed goes back into its slot as the stub of its acknowledged entry,
 * once the user has moved on and a save iteration has committed. The cases of `characterPutBack.svelte.test.ts` are
 * ported to it, with the residency's verdict where that suite fingerprints.
 *
 * What is real: the engine, `coldRetained` (the load records), the keep-set, the busy registry, the restored-bytes
 * counter, `characterSaveMarks` (an installed tracker records the marks), the quiet trigger and a reactive `DBState`
 * built with `$state`. What is a stand-in: the residency (its verdict is whatever the test says; the real verdict is
 * proved against the real codec in `storage/tests/stage4Reproducers.test.ts`), the save loop (`afterNextSaveCommit`
 * collects callbacks and `commit()` runs them, as the loop does after an iteration committed; `isSaveClean` answers
 * `h.clean`) and `isWriting`.
 *
 * Effects live in this suite: none. A mark in the tracker is one the put-back made.
 *
 * Labels: "acceptance" tests the store2 put-back, which does not exist on the red base (the W4b-1 commit);
 * "guard" passes with or without the code it names.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const h = vi.hoisted(() => ({
    commits: [] as Array<() => void>,
    writing: new Set<string>(),
    clean: false,
    verdicts: new Map<string, 'clean' | 'dirty' | 'unknown'>(),
    verdictCalls: [] as string[],
    stubCalls: [] as unknown[],
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    afterNextSaveCommit: (callback: () => void) => { h.commits.push(callback) },
    isSaveClean: () => h.clean,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/chatOrigin'), () => ({
    isWriting: (target: { chaId: string }) => h.writing.has(target.chaId),
}) as unknown as typeof import('src/ts/process/chatOrigin'))

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { findChaIdHolders, loadedRecordOf, resetRetainedForTest, retainOnLoad } from 'src/ts/process/coldRetained'
import { getPutBackCounters, resetPutBackForTest, startCharacterPutBack } from 'src/ts/process/memory/characterPutBack'
import { beginBusy, beginChokePoint, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { noteRestoredBytes, resetRestoredBytesForTest, restoredBytesOf, restoredBytesOutside } from 'src/ts/process/memory/restoredBytes'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { Residency } from 'src/ts/storage/store2/residency'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { characterMatchesAcknowledged, encodeDatabase, previousFrom } from 'src/ts/storage/store2/codec'
import { dbWithCharacters, fakeLists, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'

type Slot = Database['characters'][number]

const LARGE = 2 * 1024 * 1024

let stop: (() => void) | null = null
let cleanup: (() => void) | undefined
let tracker: toSaveType

/** A residency whose verdict is the test's and whose stub is what the real one makes: the entry's identity with the live slot's carried fields. */
const residency: Residency = {
    entryOf: () => null,
    readCharacter: async () => ({ status: 'error', error: new Error('unused') }),
    load: async () => ({ status: 'error', error: new Error('unused') }),
    hydrate: () => { },
    verdict: (slot) => {
        const chaId = String((slot as { chaId?: unknown }).chaId)
        h.verdictCalls.push(chaId)
        return h.verdicts.get(chaId) ?? 'clean'
    },
    stubFor: (slot) => {
        h.stubCalls.push(slot)
        const chaId = String((slot as { chaId?: unknown }).chaId)
        const stub: Record<string, unknown> = { chaId, name: slot.name, type: 'character', coldstorage: `u-${chaId}`, chatPage: 0 }
        if (typeof slot.lastInteraction === 'number') {
            stub.lastInteraction = slot.lastInteraction
        }
        if (slot.trashTime) {
            stub.trashTime = slot.trashTime
        }
        return stub as never
    },
}

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

function stubOf(source: Slot): Slot {
    return { chaId: source.chaId, name: source.name, type: source.type, coldstorage: `u-${source.chaId}`, chats: [], ...(source.type === 'group' ? { characters: (source as { characters?: string[] }).characters } : {}) } as unknown as Slot
}

const sourcesById = new Map<string, Slot>()

/** Puts the stubs of `sources` in the list; the first-listed is slot 0. */
function archiveAll(sources: Slot[], dbExtra: Record<string, unknown> = {}): void {
    DBState.db = {
        formatversion: 5,
        archiveCharacters: true,
        plugins: [],
        characters: sources.map(stubOf),
        ...dbExtra,
    } as unknown as Database
    sourcesById.clear()
    for (const source of sources) {
        sourcesById.set(source.chaId, source)
    }
}

const slot = (chaId: string): Slot => DBState.db.characters[findChaIdHolders(chaId)[0]]
const isStub = (chaId: string): boolean => typeof slot(chaId).coldstorage === 'string'

/** What the load path does: installs the full character in the stub's slot and records the load. */
function load(chaId: string, bytes = 100): void {
    const index = findChaIdHolders(chaId)[0]
    DBState.db.characters[index] = JSON.parse(JSON.stringify(sourcesById.get(chaId))) as Slot
    retainOnLoad(DBState.db.characters[index], chaId, `u-${chaId}`)
    noteRestoredBytes(chaId, bytes)
}

/** Loads `chaId` and selects it, as `changeChar` does. */
function open(chaId: string, bytes = 100): void {
    load(chaId, bytes)
    selectedCharID.set(findChaIdHolders(chaId)[0])
}

/** What the save loop does after an iteration committed. */
function commit(): void {
    const callbacks = h.commits.splice(0)
    for (const callback of callbacks) {
        callback()
    }
}

function begin(): void {
    stop = startCharacterPutBack()
}

function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
}

/** Fake timers with the clock the quiet trigger measures idle time on. */
function fakeClock(): void {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })
}

beforeEach(() => {
    h.commits.length = 0
    h.writing.clear()
    h.clean = false
    h.verdicts.clear()
    h.verdictCalls.length = 0
    h.stubCalls.length = 0
    resetRetainedForTest()
    resetPutBackForTest()
    resetBusyActionsForTest()
    resetRestoredBytesForTest()
    resetCharacterSaveMarksForTest()
    resetResidencyForTest()
    registerResidency(residency)
    selectedCharID.set(-1)
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    installCharacterSaveMarks({ tracker, schedule: vi.fn() })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    stop?.()
    stop = null
    cleanup?.()
    cleanup = undefined
    resetResidencyForTest()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, 'visibilityState')
    vi.restoreAllMocks()
})

describe('a character the residency loaded and the user only looked at', () => {
    test('acceptance: is replaced by the residency\'s stub, marked for save, in the same task, and its restored bytes are released', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        open('A')
        open('B')
        open('C')
        expect(isStub('A')).toBe(false)
        expect(restoredBytesOf('A')).toBeGreaterThan(0)

        commit()

        // No await between the commit callback and the assertion: the verdict and the swap are one task.
        expect(isStub('A')).toBe(true)
        expect(slot('A').coldstorage).toBe('u-A')
        expect(h.verdictCalls).toEqual(['A'])
        expect(restoredBytesOf('A')).toBe(0)
        expect(restoredBytesOutside()).toBe(restoredBytesOf('B') + restoredBytesOf('C'))
        expect(tracker.character).toEqual(['A'])
        expect(isStub('B')).toBe(false)
        expect(isStub('C')).toBe(false)
        expect(getPutBackCounters().clean).toBe(1)
    })

    test('acceptance: needs a commit; until the save loop has committed nothing is swapped, and a later commit does it', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        open('A')
        open('B')
        open('C')

        expect(isStub('A')).toBe(false)
        expect(h.commits.length).toBe(1)
        expect(h.verdictCalls).toEqual([])
        expect(tracker.character).toEqual([])

        commit()
        expect(isStub('A')).toBe(true)
    })

    test('acceptance (W4-Q2): a character that was created or imported, never loaded from the store, is not judged or unloaded', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), fullCharacter('D')])
        DBState.db.characters[findChaIdHolders('A')[0]] = fullCharacter('A')
        load('B')
        begin()
        selectedCharID.set(findChaIdHolders('A')[0])
        selectedCharID.set(findChaIdHolders('B')[0])
        selectedCharID.set(findChaIdHolders('C')[0])
        selectedCharID.set(findChaIdHolders('D')[0])

        commit()
        commit()

        expect(loadedRecordOf(slot('A'))).toBeUndefined()
        expect(isStub('A')).toBe(false)
        expect(h.verdictCalls).toEqual(['B'])
        expect(isStub('B')).toBe(true)
    })

    test('guard: a character installed before the put-back started and loaded by the residency is a candidate', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B')])
        load('A')
        begin()
        open('B')

        commit()

        expect(h.verdictCalls).toEqual(['A'])
        expect(isStub('A')).toBe(true)
    })
})

describe('the keep-set', () => {
    test('guard: the selected character and the previous selection stay loaded', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        open('A')
        open('B')

        commit()

        expect(isStub('A')).toBe(false)
        expect(isStub('B')).toBe(false)
        expect(h.verdictCalls).toEqual([])
        expect(tracker.character).toEqual([])
    })

    test('acceptance: a character that became a member of the selected group before the commit stays loaded', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), groupCharacter('G', ['A', 'B'])])
        begin()
        open('A')
        open('B')
        open('C')
        open('G')

        commit()

        expect(isStub('A')).toBe(false)
        expect(isStub('B')).toBe(false)
        expect(getPutBackCounters().kept).toBeGreaterThanOrEqual(1)
        expect(tracker.character).toEqual([])
    })

    test('acceptance: going home keeps the previous selection and releases the one that was shown', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        open('A')
        open('B')
        selectedCharID.set(-1)

        commit()

        expect(isStub('A')).toBe(false)
        expect(isStub('B')).toBe(true)
    })

    test('acceptance: the members of the selected group, and then of the previous group, stay loaded; one swap per commit', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), groupCharacter('G', ['A', 'B']), fullCharacter('X'), fullCharacter('Y')])
        begin()
        open('A')
        open('B')
        open('G')
        commit()
        expect(['A', 'B', 'G'].map(isStub)).toEqual([false, false, false])

        open('X')
        commit()
        expect(['A', 'B', 'G'].map(isStub)).toEqual([false, false, false])

        open('Y')
        commit()
        expect(['A', 'B', 'G'].map(isStub)).toEqual([true, false, false])
        commit()
        expect(['A', 'B', 'G'].map(isStub)).toEqual([true, true, false])
        commit()
        expect(['A', 'B', 'G'].map(isStub)).toEqual([true, true, true])
        expect(isStub('X')).toBe(false)
        expect(isStub('Y')).toBe(false)
        expect(tracker.character).toEqual(['A', 'B', 'G'])
    })

    test('acceptance: a character a unit of work is writing stays loaded and is put back after the work ends', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        open('A')
        open('B')
        open('C')
        h.writing.add('A')

        commit()
        expect(isStub('A')).toBe(false)
        expect(getPutBackCounters().writing).toBe(1)
        expect(h.verdictCalls).toEqual([])
        expect(h.commits.length).toBe(1)

        h.writing.clear()
        commit()
        expect(isStub('A')).toBe(true)
    })

    test('acceptance: selecting the character again before the commit keeps it', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        open('A')
        open('B')
        open('C')
        selectedCharID.set(findChaIdHolders('A')[0])

        commit()

        expect(isStub('A')).toBe(false)
        expect(tracker.character).toEqual(['B'])
    })
})

describe('what blocks a put-back', () => {
    test.each([
        ['a busy action', () => beginBusy('import').end],
        ['a backupSave busy entry (that the .bin export entry points hold one is pinned in drive/tests/backupSaveBusy)', () => beginBusy('backupSave').end],
        ['a write at a choke point', () => beginChokePoint('asset')],
    ])('acceptance: %s defers it and a later commit does it', (_label, startBlock) => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        open('A')
        open('B')
        open('C')
        const end = startBlock()

        commit()
        expect(isStub('A')).toBe(false)
        expect(h.verdictCalls).toEqual([])
        expect(getPutBackCounters().busy).toBe(1)
        expect(h.commits.length).toBe(1)

        end()
        commit()
        expect(isStub('A')).toBe(true)
    })

    test('acceptance: a dirty verdict keeps the character loaded and marked, and the next commit judges it again', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        open('A')
        open('B')
        open('C')
        h.verdicts.set('A', 'dirty')

        commit()
        expect(isStub('A')).toBe(false)
        expect(tracker.character).toEqual(['A'])
        expect(getPutBackCounters().dirty).toBe(1)
        expect(h.commits.length).toBe(1)

        h.verdicts.set('A', 'clean')
        commit()
        expect(isStub('A')).toBe(true)
        expect(h.verdictCalls).toEqual(['A', 'A'])
    })

    test('acceptance: only a dirty verdict counts toward the cap of three, and a selection of the character starts the count again', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        open('A')
        open('B')
        open('C')
        h.verdicts.set('A', 'dirty')

        commit()
        commit()
        commit()
        expect(h.verdictCalls).toEqual(['A', 'A', 'A'])
        expect(isStub('A')).toBe(false)
        expect(h.commits.length).toBe(0)

        // Out of retries: a later selection change does not judge it again.
        selectedCharID.set(findChaIdHolders('B')[0])
        commit()
        expect(h.verdictCalls).toEqual(['A', 'A', 'A'])

        // Selecting it starts the count again.
        selectedCharID.set(findChaIdHolders('A')[0])
        selectedCharID.set(findChaIdHolders('B')[0])
        selectedCharID.set(findChaIdHolders('C')[0])
        h.verdicts.set('A', 'clean')
        commit()
        expect(isStub('A')).toBe(true)
    })

    test('acceptance: a verdict the acknowledged encoding cannot give leaves the character loaded and unmarked, and asks again only at the next selection', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        open('A')
        open('B')
        open('C')
        h.verdicts.set('A', 'unknown')

        commit()

        expect(isStub('A')).toBe(false)
        expect(tracker.character).toEqual([])
        expect(h.commits.length).toBe(0)
        expect(getPutBackCounters().gone).toBeGreaterThanOrEqual(1)
    })

    test('acceptance: a slot replaced by another object, and a chaId held twice, are left alone', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), fullCharacter('D')])
        begin()
        open('A')
        open('B')
        open('C')
        open('D')
        const replacement = fullCharacter('A', { name: 'replaced' })
        DBState.db.characters[findChaIdHolders('A')[0]] = replacement
        DBState.db.characters.push(fullCharacter('B', { name: 'second holder' }))

        commit()
        commit()

        expect(slot('A').name).toBe('replaced')
        expect(slot('A').coldstorage).toBeUndefined()
        expect(DBState.db.characters.filter((cha) => cha.chaId === 'B').every((cha) => cha.coldstorage === undefined)).toBe(true)
        expect(h.verdictCalls).not.toContain('A')
        expect(h.verdictCalls).not.toContain('B')
        expect(getPutBackCounters().gone).toBeGreaterThanOrEqual(2)
        expect(tracker.character).not.toContain('A')
        expect(tracker.character).not.toContain('B')
    })

    test('guard: a Playground character is never recorded as loaded or put back', () => {
        archiveAll([fullCharacter('§playground'), fullCharacter('B'), fullCharacter('C')])
        begin()
        open('§playground')
        open('B')
        open('C')

        commit()

        expect(isStub('§playground')).toBe(false)
        expect(loadedRecordOf(slot('§playground'))).toBeUndefined()
        expect(h.verdictCalls).not.toContain('§playground')
    })

    test.each([
        ['an enabled V2.1 plugin', { plugins: [{ enabled: true, version: '2.1' }] }],
        ['archiving switched off', { archiveCharacters: false }],
        ['a format before the block format', { formatversion: 4 }],
    ])('guard: %s puts nothing back', (_label, dbExtra) => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')], dbExtra)
        begin()
        open('A')
        open('B')
        open('C')

        commit()

        expect(isStub('A')).toBe(false)
        expect(h.verdictCalls).toEqual([])
        expect(tracker.character).toEqual([])
    })
})

describe('the budget of one commit', () => {
    test('acceptance: at most three verdicts and one swap; the rest wait for the next commits', () => {
        archiveAll(['A', 'B', 'C', 'D', 'E', 'F'].map((id) => fullCharacter(id)))
        begin()
        for (const id of ['A', 'B', 'C', 'D', 'E']) {
            open(id)
        }
        for (const id of ['A', 'B', 'C']) {
            h.verdicts.set(id, 'dirty')
        }
        open('F')

        commit()
        expect(['A', 'B', 'C', 'D'].map(isStub)).toEqual([false, false, false, false])
        expect(h.verdictCalls).toEqual(['A', 'B', 'C'])
        expect(getPutBackCounters().dirty).toBe(3)
        expect(h.commits.length).toBe(1)

        for (const id of ['A', 'B', 'C']) {
            h.verdicts.set(id, 'clean')
        }
        commit()
        expect(['A', 'B', 'C', 'D'].map(isStub)).toEqual([true, false, false, false])
        expect(h.commits.length).toBe(1)
        commit()
        expect(['A', 'B', 'C', 'D'].map(isStub)).toEqual([true, true, false, false])
    })
})

describe('the stub that takes the slot', () => {
    test('acceptance: the stub is made from the live character, so what changed since the commit survives, and its absence', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), fullCharacter('D')])
        begin()
        open('A')
        open('B')
        open('C')
        open('D')
        slot('A').lastInteraction = 4242
        slot('A').trashTime = 777
        delete slot('B').lastInteraction
        const liveA = slot('A')

        commit()
        commit()

        expect(h.stubCalls[0]).toBe(liveA)
        expect(slot('A').coldstorage).toBe('u-A')
        expect(slot('A').lastInteraction).toBe(4242)
        expect(slot('A').trashTime).toBe(777)
        expect(slot('B').coldstorage).toBe('u-B')
        expect('lastInteraction' in slot('B')).toBe(false)
        expect('trashTime' in slot('B')).toBe(false)
    })

    test('acceptance: a residency that has no stub for the character leaves it loaded', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        const stubFor = vi.spyOn(residency, 'stubFor').mockReturnValue(null)
        begin()
        open('A')
        open('B')
        open('C')

        commit()

        expect(stubFor).toHaveBeenCalledTimes(1)
        expect(isStub('A')).toBe(false)
        expect(tracker.character).toEqual([])
    })
})

describe('a deferral', () => {
    test('guard: a busy deferral waits for the next commit; it arms no timer, so a page that stays busy does not spin', () => {
        fakeClock()
        h.clean = true
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        const busy = beginBusy('import')
        open('A')
        open('B')
        open('C')
        // The busy entry's in-flight token keeps a timer of its own.
        const baseline = vi.getTimerCount()

        commit()
        expect(getPutBackCounters().busy).toBe(1)
        expect(vi.getTimerCount()).toBe(baseline)
        vi.advanceTimersByTime(60_000)
        expect(getPutBackCounters().busy).toBe(1)
        expect(h.commits.length).toBe(1)

        busy.end()
        commit()
        expect(isStub('A')).toBe(true)
    })
})

describe('a large character (W4-Q3, W4-Q7, N7)', () => {
    const select = (chaId: string): void => selectedCharID.set(findChaIdHolders(chaId)[0])

    /** L is large and the only loaded character; the page then moves on twice, so L is free and, after one commit, waits for the quiet trigger. */
    function largeThenMoveOn(): void {
        archiveAll([fullCharacter('L'), fullCharacter('A'), fullCharacter('B'), groupCharacter('G', [])])
        begin()
        open('L', LARGE)
        select('A')
        select('B')
    }

    beforeEach(() => {
        fakeClock()
        vi.stubGlobal('requestIdleCallback', undefined)
        setVisibility('visible')
    })

    test('guard: the foreground never judges it, however many commits come', () => {
        largeThenMoveOn()

        commit()
        commit()
        commit()

        expect(h.verdictCalls).toEqual([])
        expect(isStub('L')).toBe(false)
        expect(tracker.character).toEqual([])
    })

    test('acceptance: hidden after its save has committed, it is judged and unloaded in that task', () => {
        largeThenMoveOn()
        commit()
        h.clean = true

        setVisibility('hidden')
        vi.advanceTimersByTime(0)

        expect(isStub('L')).toBe(true)
        expect(h.verdictCalls).toEqual(['L'])
        expect(tracker.character).toEqual(['L'])
    })

    test('acceptance: hidden before its save has committed, it waits for the commit', () => {
        largeThenMoveOn()
        commit()
        h.clean = false

        setVisibility('hidden')
        vi.advanceTimersByTime(5000)
        expect(isStub('L')).toBe(false)
        expect(h.verdictCalls).toEqual([])

        h.clean = true
        commit()
        vi.advanceTimersByTime(0)
        expect(isStub('L')).toBe(true)
    })

    test('acceptance: 30 s without input, through the idle callback where it exists', () => {
        const idle = vi.fn((callback: () => void) => { callback(); return 1 })
        vi.stubGlobal('requestIdleCallback', idle)
        largeThenMoveOn()
        commit()
        h.clean = true

        vi.advanceTimersByTime(29_999)
        expect(isStub('L')).toBe(false)
        vi.advanceTimersByTime(1)

        expect(idle).toHaveBeenCalledTimes(1)
        expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 })
        expect(isStub('L')).toBe(true)
    })

    test('acceptance: 30 s without input, through a zero timer where the browser has no idle callback', () => {
        largeThenMoveOn()
        commit()
        h.clean = true

        vi.advanceTimersByTime(29_999)
        expect(isStub('L')).toBe(false)
        vi.advanceTimersByTime(1)
        // A zero timer started inside a timer callback runs one millisecond later.
        vi.advanceTimersByTime(1)

        expect(isStub('L')).toBe(true)
    })

    test('acceptance: input starts the 30 s again', () => {
        largeThenMoveOn()
        commit()
        h.clean = true

        vi.advanceTimersByTime(20_000)
        document.dispatchEvent(new Event('keydown'))
        vi.advanceTimersByTime(29_999)
        expect(isStub('L')).toBe(false)
        vi.advanceTimersByTime(1)
        // A zero timer started inside a timer callback runs one millisecond later.
        vi.advanceTimersByTime(1)

        expect(isStub('L')).toBe(true)
    })

    test('acceptance (F5): the 30 s path also needs a committed save: with one pending it waits for the commit', () => {
        largeThenMoveOn()
        commit()
        h.clean = false

        vi.advanceTimersByTime(60_000)
        expect(isStub('L')).toBe(false)
        expect(h.verdictCalls).toEqual([])

        h.clean = true
        commit()
        vi.advanceTimersByTime(5)
        expect(isStub('L')).toBe(true)
    })

    test('acceptance (F4): the quiet run keeps the busy gate and does not spin while it holds', () => {
        largeThenMoveOn()
        commit()
        h.clean = true
        const busy = beginBusy('backupSave')

        setVisibility('hidden')
        vi.advanceTimersByTime(60_000)

        // One refusal, not one per timer tick: the run waits for the next commit instead of spinning.
        expect(isStub('L')).toBe(false)
        expect(h.verdictCalls).toEqual([])
        expect(getPutBackCounters().busy).toBe(1)

        busy.end()
        commit()
        vi.advanceTimersByTime(0)
        expect(isStub('L')).toBe(true)
    })

    test('acceptance: the quiet run repeats the keep-set check: a character that joined the selected group meanwhile is not unloaded', () => {
        largeThenMoveOn()
        commit()
        select('G')
        ;(slot('G') as unknown as { characters: string[] }).characters = ['L']
        h.clean = true

        setVisibility('hidden')
        vi.advanceTimersByTime(0)

        expect(isStub('L')).toBe(false)
        expect(h.verdictCalls).toEqual([])
        expect(getPutBackCounters().kept).toBeGreaterThanOrEqual(1)
    })

    test('acceptance: the quiet run repeats the writing check', () => {
        largeThenMoveOn()
        commit()
        h.clean = true
        h.writing.add('L')

        setVisibility('hidden')
        vi.advanceTimersByTime(0)

        expect(isStub('L')).toBe(false)
        expect(h.verdictCalls).toEqual([])
        h.writing.clear()
        commit()
        vi.advanceTimersByTime(0)
        expect(isStub('L')).toBe(true)
    })

    test('acceptance (N7): foreground deferrals count for nothing: after three of them, dirty verdicts still get their retries', () => {
        archiveAll([fullCharacter('L'), fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        open('L', LARGE)
        select('A')
        select('B')
        commit()
        select('C')
        commit()
        select('A')
        commit()
        select('B')
        commit()
        expect(h.verdictCalls).toEqual([])
        h.verdicts.set('L', 'dirty')
        h.clean = true

        setVisibility('hidden')
        vi.advanceTimersByTime(0)
        expect(isStub('L')).toBe(false)
        expect(tracker.character).toEqual(['L'])

        h.verdicts.set('L', 'clean')
        commit()
        vi.advanceTimersByTime(0)
        expect(h.verdictCalls).toEqual(['L', 'L'])
        expect(isStub('L')).toBe(true)
    })

    test('acceptance: the quiet run unloads one large character per run and asks again after the commit', () => {
        archiveAll([fullCharacter('L'), fullCharacter('M'), fullCharacter('A'), fullCharacter('B')])
        begin()
        open('L', LARGE)
        open('M', LARGE)
        select('A')
        select('B')
        commit()
        h.clean = true

        setVisibility('hidden')
        vi.advanceTimersByTime(0)
        expect([isStub('L'), isStub('M')]).toEqual([true, false])

        commit()
        vi.advanceTimersByTime(0)
        expect([isStub('L'), isStub('M')]).toEqual([true, true])
    })

    test('guard: a large character that is selected again leaves the quiet set', () => {
        largeThenMoveOn()
        commit()
        select('L')
        h.clean = true

        setVisibility('hidden')
        vi.advanceTimersByTime(60_000)

        expect(h.verdictCalls).toEqual([])
        expect(isStub('L')).toBe(false)
    })
})

describe('stopping the put-back (F5)', () => {
    test('acceptance: every document listener the engine installed is removed, and nothing runs afterwards', () => {
        fakeClock()
        const added = vi.spyOn(document, 'addEventListener')
        const removed = vi.spyOn(document, 'removeEventListener')
        archiveAll([fullCharacter('L'), fullCharacter('A'), fullCharacter('B')])

        begin()
        open('L', LARGE)
        open('A')
        open('B')
        commit()
        h.clean = true
        stop?.()
        stop = null

        const installed = added.mock.calls.map(([type, handler]) => `${type}:${String(handler)}`)
        const gone = removed.mock.calls.map(([type, handler]) => `${type}:${String(handler)}`)
        expect(installed.length).toBeGreaterThanOrEqual(5)
        expect(new Set(gone)).toEqual(new Set(installed))
        for (const call of added.mock.calls) {
            expect(removed.mock.calls.some(([type, handler]) => type === call[0] && handler === call[1])).toBe(true)
        }
        setVisibility('hidden')
        vi.advanceTimersByTime(60_000)
        expect(h.verdictCalls).toEqual([])
    })
})

describe('the subscription', () => {
    test('guard: a selection set inside an effect makes that effect depend on nothing the put-back reads', () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        open('A')
        open('B')
        const target = findChaIdHolders('C')[0]
        let runs = 0
        cleanup = $effect.root(() => {
            $effect(() => {
                runs += 1
                selectedCharID.set(target)
            })
        })
        flushSync()
        expect(runs).toBe(1)

        DBState.db.characters.push(fullCharacter('Z'))
        DBState.db.characters[0].name = 'changed'
        flushSync()

        expect(runs).toBe(1)
    })
})

describe('the real verdict over a character whose data cannot be read', () => {
    test('acceptance: the character stays loaded, the others are still judged, and the put-back is armed again', () => {
        const sources = ['A', 'B', 'C', 'D', 'E'].map((id) => fullCharacter(id))
        const previous = previousFrom(encodeDatabase(
            dbWithCharacters(sources as unknown as Obj[]),
            { env: seededEnv(1), lists: fakeLists, seq: 1, createdAt: 1_700_000_000_000 },
        ))
        resetResidencyForTest()
        registerResidency({
            ...residency,
            verdict: (character) => characterMatchesAcknowledged(character, { env: seededEnv(5), lists: fakeLists, previous }),
        })
        archiveAll(sources)
        begin()
        for (const id of ['A', 'B', 'C', 'D', 'E']) {
            open(id)
        }
        // A plugin left a value in the first candidate that cannot be read as JSON.
        ;(slot('A') as unknown as Record<string, unknown>).personality = { toJSON() { throw new Error('toJSON fault') } }

        // What the save loop does after a commit: a throwing callback is logged and the others still run.
        const thrown: unknown[] = []
        for (const callback of h.commits.splice(0)) {
            try {
                callback()
            } catch (error) {
                thrown.push(error)
            }
        }

        expect(thrown).toEqual([])
        expect(isStub('A')).toBe(false)
        expect(isStub('B')).toBe(true)
        expect(isStub('C')).toBe(false)
        // The put-back waits for the next commit, so the third candidate is judged then.
        expect(h.commits.length).toBe(1)
    })
})
