/**
 * Re-archiving loaded characters (`../memory/characterRearchive`): once the user
 * has moved on, a loaded character the put-back cannot return (never archived,
 * or restored and edited) is written to a new unit and replaced by a stub.
 *
 * What is real: the re-archive module, the put-back and its keep-set, the
 * archive engine, `coldRetained`, `restoreColdCharacter`, the busy registry,
 * the restored-bytes counter, `characterSaveMarks` and a reactive `DBState`
 * built with `$state`. What is a stand-in: the unit store (a map; a write
 * serialises its value at call time and a read decodes it, as the real path
 * does), the save loop (`afterNextSaveCommit` collects callbacks and `commit()`
 * runs them) and `isWriting`. The scheduled job runs on a real zero-delay
 * timer, so `settle()` waits one macrotask.
 *
 * Labels: "new behaviour" tests behaviour that does not exist on the base and
 * fails there. "guard" pins a property of the new code and names the mutation
 * it catches; unlike a compatibility guard it may fail on the base, where the
 * code it guards is absent. The two that exercise only base behaviour (a clean
 * restored character is put back, a dirty verdict drops the record while
 * archiving cannot run) pass on the base as well.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

type WriteMode = 'written' | 'failed' | 'too-large'

const h = vi.hoisted(() => ({
    units: new Map<string, unknown>(),
    commits: [] as Array<() => void>,
    writing: new Set<string>(),
    writes: [] as Array<{ key: string, chaId: string }>,
    /** What each write answers, in order; 'written' once the script runs out. */
    modes: [] as string[],
    /** Runs after the value is serialised and before the write finishes: an edit made here is an edit during the write. */
    whileWriting: null as null | ((chaId: string) => void),
    /** Holds every write until it resolves. */
    gate: null as null | Promise<void>,
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
    getPeerSaveCount: () => 0,
    getSaveMarkCount: () => 0,
    isSaveClean: () => false,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/chatOrigin'), () => ({
    isWriting: (target: { chaId: string }) => h.writing.has(target.chaId),
}) as unknown as typeof import('src/ts/process/chatOrigin'))

vi.mock(import('src/ts/process/coldstorage.svelte'), async () => {
    const { noteReadSize } = await import('src/ts/process/memory/restoredBytes')
    return {
        writeColdStorageUnit: async (key: string, value: { character: { chaId: string } }) => {
            // Serialised before the first await, as the real compression does.
            const json = JSON.stringify(value)
            const chaId = value.character.chaId
            h.writes.push({ key, chaId })
            const mode = (h.modes.shift() ?? 'written') as WriteMode
            h.whileWriting?.(chaId)
            await Promise.resolve()
            if (h.gate) {
                await h.gate
            }
            if (mode !== 'written') {
                return mode
            }
            h.units.set(key, json)
            return 'written'
        },
        readColdStorageItem: async (key: string) => {
            const json = h.units.get(key)
            if (json === undefined) {
                return { status: 'missing' }
            }
            const text = typeof json === 'string' ? json : JSON.stringify(json)
            const result = { status: 'ok', value: JSON.parse(text) }
            noteReadSize(result, text.length)
            return result
        },
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { restoreColdCharacter, findChaIdHolders } from 'src/ts/process/coldCharacterRestore'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import { resetRetainedForTest, retainedRecordOf, retainedUnitKeys } from 'src/ts/process/coldRetained'
import { getPutBackCounters, resetPutBackForTest, startCharacterPutBack } from 'src/ts/process/memory/characterPutBack'
import { beginBusy, beginChokePoint, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { noteBootArchiveSession, resetBootArchiveStateForTest } from 'src/ts/process/memory/bootArchiveState'
import { snapshot } from 'src/ts/process/memory/putBackMeasure'
import { resetRestoredBytesForTest, restoredBytesOf } from 'src/ts/process/memory/restoredBytes'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { TRASH_PURGE_AGE_MS } from 'src/ts/storage/trashPurge'
import type { toSaveType } from 'src/ts/storage/risuSave'

type Slot = Database['characters'][number]

let stop: (() => void) | null = null
let tracker: toSaveType

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

/** An entry of `world`: a loaded character, or the stub of one with its unit in the store. */
type Entry = Slot | { archived: Slot }

function world(entries: Entry[], dbExtra: Record<string, unknown> = {}): void {
    const characters = entries.map((entry) => {
        if ('archived' in entry) {
            const key = `unit-${entry.archived.chaId}`
            h.units.set(key, JSON.stringify({ character: entry.archived }))
            return buildColdStub(entry.archived, key, [])
        }
        return entry
    })
    DBState.db = {
        formatversion: 5,
        archiveCharacters: true,
        plugins: [],
        characters,
        ...dbExtra,
    } as unknown as Database
}

const slot = (chaId: string): Slot => DBState.db.characters[findChaIdHolders(chaId)[0]]
const isStub = (chaId: string): boolean => typeof slot(chaId).coldstorage === 'string'
const select = (chaId: string): void => selectedCharID.set(findChaIdHolders(chaId)[0])
const writtenFor = (chaId: string): number => h.writes.filter((write) => write.chaId === chaId).length

/** Restores `chaId` and selects it, as `changeChar` does. */
async function open(chaId: string): Promise<void> {
    const outcome = await restoreColdCharacter(slot(chaId), { byChaId: true, quiet: true })
    expect(outcome.status).toBe('restored')
    select(chaId)
}

/** What the save loop does after an iteration committed. */
function commit(): void {
    for (const callback of h.commits.splice(0)) {
        callback()
    }
}

/** One macrotask: the scheduled job starts and, with no held write, finishes. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function commitAndSettle(): Promise<void> {
    commit()
    await settle()
}

function begin(): void {
    stop = startCharacterPutBack()
}

function unitOf(key: string): { character: Record<string, unknown> } {
    return JSON.parse(h.units.get(key) as string)
}

function clearStrikes(): void {
    localStorage.removeItem('archivePassStrikes')
}

// The job loads the engine on demand; loading it here keeps a job inside one macrotask.
beforeAll(async () => {
    await import('src/ts/process/coldCharacterArchive')
})

beforeEach(() => {
    h.units.clear()
    h.commits.length = 0
    h.writing.clear()
    h.writes.length = 0
    h.modes.length = 0
    h.whileWriting = null
    h.gate = null
    clearStrikes()
    localStorage.removeItem('archivePassSkipped')
    resetRetainedForTest()
    resetPutBackForTest()
    resetBusyActionsForTest()
    resetRestoredBytesForTest()
    resetCharacterSaveMarksForTest()
    resetBootArchiveStateForTest()
    noteBootArchiveSession(true)
    selectedCharID.set(-1)
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    installCharacterSaveMarks({ tracker, schedule: vi.fn() })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    stop?.()
    stop = null
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    clearStrikes()
})

describe('a character that was never archived', () => {
    test('new behaviour: with no restored character anywhere, it is archived after the commit following the user leaving it, one per commit, and the selected one stays', async () => {
        world([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        select('B')
        const before = JSON.stringify(slot('A'))
        begin()
        expect(h.commits.length).toBe(1)

        await commitAndSettle()

        expect(isStub('A')).toBe(true)
        expect(isStub('B')).toBe(false)
        expect(isStub('C')).toBe(false)
        const key = slot('A').coldstorage as string
        expect(unitOf(key).character).toEqual(JSON.parse(before))
        expect(tracker.character).toEqual(['A'])
        expect(h.commits.length).toBe(1)

        await commitAndSettle()

        expect(isStub('C')).toBe(true)
        expect(isStub('B')).toBe(false)
        expect(tracker.character).toEqual(['A', 'C'])
        expect(h.writes).toHaveLength(2)
        expect(snapshot().rearchive.counters.archived).toBe(2)
    })

    test('new behaviour: a restored character edited after the restore is archived with its edit, its record dropped and its restored bytes released', async () => {
        world([{ archived: fullCharacter('A') }, fullCharacter('B'), fullCharacter('C')])
        begin()
        await open('A')
        slot('A').name = 'edited'
        expect(restoredBytesOf('A')).toBeGreaterThan(0)
        select('B')
        select('C')

        await commitAndSettle()

        expect(isStub('A')).toBe(true)
        expect(slot('A').coldstorage).not.toBe('unit-A')
        expect(unitOf(slot('A').coldstorage as string).character.name).toBe('edited')
        expect(slot('A').name).toBe('edited')
        expect(retainedRecordOf(slot('A'))).toBeUndefined()
        expect(retainedUnitKeys().has('unit-A')).toBe(false)
        expect(restoredBytesOf('A')).toBe(0)
        expect(tracker.character).toEqual(['A'])
        expect(getPutBackCounters().dirty).toBe(1)
    })

    test('guard: the previous selection stays loaded and archives only once a later selection moves on; catches leaving previousChaId out of the injected keep-set', async () => {
        world([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), fullCharacter('D')])
        select('A')
        begin()
        select('B')

        await commitAndSettle()
        await commitAndSettle()

        expect(isStub('C')).toBe(true)
        expect(isStub('D')).toBe(true)
        expect(isStub('A')).toBe(false)
        expect(isStub('B')).toBe(false)

        select('C')

        await commitAndSettle()

        expect(isStub('A')).toBe(true)
        expect(isStub('B')).toBe(false)
    })

    test('new behaviour: group members stay loaded while the group is selected or previous; once both are left the group and each member archive, one per commit, and the group stub keeps its members', async () => {
        world([groupCharacter('G', ['M1', 'M2']), fullCharacter('M1'), fullCharacter('M2'), fullCharacter('X'), fullCharacter('Y')])
        select('G')
        begin()

        await commitAndSettle()
        await commitAndSettle()

        expect(isStub('X')).toBe(true)
        expect(isStub('Y')).toBe(true)
        expect(isStub('G')).toBe(false)
        expect(isStub('M1')).toBe(false)
        expect(isStub('M2')).toBe(false)

        select('X')
        await commitAndSettle()
        expect(isStub('G')).toBe(false)

        select('Y')
        await commitAndSettle()
        expect(isStub('G')).toBe(true)
        expect((slot('G') as unknown as { characters: string[] }).characters).toEqual(['M1', 'M2'])
        expect(isStub('M1')).toBe(false)

        await commitAndSettle()
        expect(isStub('M1')).toBe(true)
        expect(isStub('M2')).toBe(false)

        await commitAndSettle()
        expect(isStub('M2')).toBe(true)
    })
})

describe('the put-back and the re-archive stay apart', () => {
    test('guard: restored characters left unchanged are put back by the put-back, one per commit, with no unit written; catches the re-archive taking a restored character the put-back has not decided yet', async () => {
        world([{ archived: fullCharacter('A') }, { archived: fullCharacter('B') }, { archived: fullCharacter('C') }, { archived: fullCharacter('D') }, { archived: fullCharacter('E') }])
        begin()
        await open('A')
        await open('B')
        await open('C')
        await open('D')
        await open('E')

        await commitAndSettle()

        expect(slot('A').coldstorage).toBe('unit-A')
        expect(isStub('B')).toBe(false)
        expect(retainedRecordOf(slot('B'))).toBeDefined()
        expect(h.writes).toHaveLength(0)
        expect(getPutBackCounters().clean).toBe(1)

        await commitAndSettle()
        await commitAndSettle()

        expect(slot('B').coldstorage).toBe('unit-B')
        expect(slot('C').coldstorage).toBe('unit-C')
        expect(isStub('D')).toBe(false)
        expect(h.writes).toHaveLength(0)
    })

    test.each([
        ['archiveCharacters is not set', () => { delete (DBState.db as unknown as Record<string, unknown>).archiveCharacters }],
        ['the session cannot archive', () => { noteBootArchiveSession(false) }],
    ])('guard: when %s, a dirty verdict drops the record and the character stays loaded, as before; catches the dirty hand-off ignoring the gate', async (_label, disable) => {
        world([{ archived: fullCharacter('A') }, fullCharacter('B'), fullCharacter('C')])
        begin()
        await open('A')
        slot('A').name = 'edited'
        disable()
        select('B')
        select('C')

        await commitAndSettle()

        expect(retainedRecordOf(slot('A'))).toBeUndefined()
        expect(isStub('A')).toBe(false)
        expect(h.writes).toHaveLength(0)
    })

    test('new behaviour: a dirty-marked record keeps its unit referenced while it waits, and releases it when the re-archive replaces the character; catches dropping the record at the dirty verdict', async () => {
        world([{ archived: fullCharacter('A') }, fullCharacter('B'), fullCharacter('C')])
        begin()
        await open('A')
        slot('A').name = 'edited'
        select('B')
        select('C')
        commit()
        const busy = beginBusy('export')
        await settle()

        expect(isStub('A')).toBe(false)
        expect(retainedRecordOf(slot('A'))).toBeDefined()
        expect(retainedUnitKeys().has('unit-A')).toBe(true)

        busy.end()
        await commitAndSettle()

        expect(isStub('A')).toBe(true)
        expect(retainedUnitKeys().has('unit-A')).toBe(false)
    })

    test('new behaviour: the put-back does not fingerprint a dirty-marked record again; catches removing the dirty skip from both the selection and the fire', async () => {
        world([{ archived: fullCharacter('A') }, fullCharacter('B'), fullCharacter('C'), fullCharacter('D')])
        begin()
        await open('A')
        slot('A').name = 'edited'
        select('B')
        select('C')
        commit()
        // The job is held back, so the record stays marked.
        const busy = beginBusy('export')
        await settle()
        const fingerprintsAfterVerdict = snapshot().fingerprint.bySource.fire?.count ?? 0
        expect(fingerprintsAfterVerdict).toBe(1)
        expect(retainedRecordOf(slot('A'))).toBeDefined()

        select('D')
        select('B')
        busy.end()
        h.commits.splice(0).forEach((callback) => callback())
        await settle()

        expect(snapshot().fingerprint.bySource.fire?.count ?? 0).toBe(fingerprintsAfterVerdict)
    })
})

describe('what the write can run into', () => {
    test('new behaviour: an edit made during the write is not archived: the list is untouched, nothing is counted, the unit is an orphan, and a second orphan for the character stops its retries', async () => {
        world([fullCharacter('A'), fullCharacter('B')])
        select('B')
        begin()
        let edits = 0
        h.whileWriting = (chaId) => {
            if (chaId === 'A') {
                edits += 1
                ;(slot('A') as unknown as { chats: Array<{ message: Array<{ data: string }> }> }).chats[0].message[0].data = `edit ${edits}`
            }
        }

        await commitAndSettle()

        expect(isStub('A')).toBe(false)
        expect(tracker.character).toEqual([])
        expect(h.units.size).toBe(1)
        // The orphan holds the state before the edit: the value was serialised at the call.
        expect(JSON.stringify([...h.units.values()])).toContain('hello')
        expect(h.commits.length).toBe(1)

        await commitAndSettle()

        expect(h.units.size).toBe(2)
        expect(isStub('A')).toBe(false)
        expect(h.commits.length).toBe(0)

        await commitAndSettle()

        expect(writtenFor('A')).toBe(2)
    })

    test('new behaviour: a character removed during the write, and one whose id is held twice by then, are not archived and the next character still is', async () => {
        world([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        select('C')
        begin()
        h.whileWriting = (chaId) => {
            if (chaId === 'A') {
                DBState.db.characters.splice(findChaIdHolders('A')[0], 1)
            }
        }

        await commitAndSettle()

        expect(findChaIdHolders('A')).toEqual([])
        expect(isStub('B')).toBe(false)
        expect(h.units.size).toBe(1)

        h.whileWriting = (chaId) => {
            if (chaId === 'B') {
                DBState.db.characters.push(fullCharacter('B'))
            }
        }
        await commitAndSettle()

        expect(findChaIdHolders('B')).toHaveLength(2)
        expect(DBState.db.characters.filter((cha) => cha.chaId === 'B').every((cha) => !cha.coldstorage)).toBe(true)
    })

    test('new behaviour: a writer already registered for the character defers it with no write and another candidate goes first', async () => {
        world([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        select('C')
        h.writing.add('A')
        begin()

        await commitAndSettle()

        expect(writtenFor('A')).toBe(0)
        expect(isStub('B')).toBe(true)
        expect(h.commits.length).toBe(1)

        h.writing.delete('A')
        await commitAndSettle()

        expect(isStub('A')).toBe(true)
    })

    test('guard: a writer registered during the write refuses the archive; catches removing isWriting from the final check', async () => {
        world([fullCharacter('A'), fullCharacter('B')])
        select('B')
        begin()
        h.whileWriting = (chaId) => { h.writing.add(chaId) }

        await commitAndSettle()

        expect(h.writes).toHaveLength(1)
        expect(isStub('A')).toBe(false)
        expect(tracker.character).toEqual([])
    })

    test.each([
        ['a busy action such as the manual clean-up', () => beginBusy('cleanup').end],
        ['a write choke point', () => beginChokePoint('asset')],
    ])('guard: %s that starts during the write refuses the archive and leaves the unit an orphan; catches removing the busy check from the final check', async (_label, start) => {
        world([fullCharacter('A'), fullCharacter('B')])
        select('B')
        begin()
        let end: (() => void) | null = null
        h.whileWriting = (chaId) => {
            if (chaId === 'A') {
                end = start()
            }
        }

        await commitAndSettle()

        expect(h.writes).toHaveLength(1)
        expect(isStub('A')).toBe(false)
        expect(h.units.size).toBe(1)
        expect(tracker.character).toEqual([])
        end!()
    })

    test('guard: a character selected during the write is not archived; catches dropping the keep-set from the final check', async () => {
        world([fullCharacter('A'), fullCharacter('B')])
        select('B')
        begin()
        h.whileWriting = (chaId) => { select(chaId) }

        await commitAndSettle()

        expect(h.writes).toHaveLength(1)
        expect(isStub('A')).toBe(false)
    })

    test('new behaviour: a database replaced during the write refuses the archive and forgets what was remembered', async () => {
        world([fullCharacter('A'), fullCharacter('B')])
        select('B')
        begin()
        h.whileWriting = () => { DBState.db = { ...DBState.db } as Database }

        await commitAndSettle()

        expect(isStub('A')).toBe(false)
        expect(h.units.size).toBe(1)
        h.whileWriting = null

        await commitAndSettle()

        expect(writtenFor('A')).toBe(2)
        expect(isStub('A')).toBe(true)
    })

    test('new behaviour: a V2.1 plugin enabled during the write refuses the archive, counts nothing and waits for the next selection', async () => {
        world([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        select('C')
        begin()
        h.whileWriting = () => { DBState.db.plugins = [{ enabled: true, version: '2.1' }] as never }

        await commitAndSettle()

        expect(isStub('A')).toBe(false)
        expect(h.commits.length).toBe(0)

        DBState.db.plugins = []
        h.whileWriting = null
        select('B')

        expect(h.commits.length).toBe(1)
        await commitAndSettle()
        expect(isStub('A')).toBe(true)
    })
})

describe('the trash purge (CHORE-201)', () => {
    test('guard: a character already due for the purge is never written', async () => {
        const now = Date.now()
        world([fullCharacter('A', { trashTime: now - TRASH_PURGE_AGE_MS - 1000 }), fullCharacter('B'), fullCharacter('C')])
        select('C')
        begin()

        await commitAndSettle()
        await commitAndSettle()

        expect(writtenFor('A')).toBe(0)
        expect(isStub('B')).toBe(true)
        expect(isStub('A')).toBe(false)
    })

    test('guard: a character that becomes due for the purge during the write is refused at the final step; catches sampling the clock once per job', async () => {
        const start = Date.now()
        world([fullCharacter('A', { trashTime: start - TRASH_PURGE_AGE_MS + 60_000 }), fullCharacter('B')])
        select('B')
        begin()
        h.whileWriting = () => {
            vi.spyOn(Date, 'now').mockReturnValue(start + 120_000)
        }

        await commitAndSettle()

        expect(writtenFor('A')).toBe(1)
        expect(isStub('A')).toBe(false)
        expect(tracker.character).toEqual([])
    })
})

describe('failures', () => {
    test('new behaviour: two counted failures in a row stop re-archiving for the session, a selection change does not restart it', async () => {
        world([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), fullCharacter('D')])
        select('D')
        begin()
        h.modes.push('failed', 'failed')

        await commitAndSettle()
        expect(h.commits.length).toBe(1)
        await commitAndSettle()

        expect(h.writes).toHaveLength(2)
        expect(h.commits.length).toBe(0)

        select('A')
        select('D')
        await commitAndSettle()

        expect(h.writes).toHaveLength(2)
        expect(isStub('C')).toBe(false)
    })

    test('new behaviour: a success between two counted failures resets the count', async () => {
        world([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), fullCharacter('D'), fullCharacter('E')])
        select('E')
        begin()
        h.modes.push('failed', 'written', 'failed')

        await commitAndSettle()
        await commitAndSettle()
        await commitAndSettle()
        await commitAndSettle()

        expect(h.writes.map((write) => write.chaId)).toEqual(['A', 'B', 'C', 'D'])
        expect(isStub('B')).toBe(true)
        expect(isStub('D')).toBe(true)
    })

    test('new behaviour: a unit too large for the Node server is neither counted nor retried and the backlog keeps draining', async () => {
        world([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), fullCharacter('D')])
        select('D')
        begin()
        h.modes.push('too-large', 'failed', 'written')

        await commitAndSettle()
        // Re-armed for the next commit after a refusal that is not an archive.
        expect(h.commits.length).toBe(1)
        await commitAndSettle()
        await commitAndSettle()
        await commitAndSettle()

        expect(h.writes.map((write) => write.chaId)).toEqual(['A', 'B', 'C'])
        expect(isStub('A')).toBe(false)
        expect(isStub('B')).toBe(false)
        expect(isStub('C')).toBe(true)
        expect(snapshot().rearchive.counters['too-large']).toBe(1)
        expect(snapshot().rearchive.counters['counted-failure']).toBe(1)
    })
})

describe('one job at a time', () => {
    test('new behaviour: two commits and a selection change before the scheduled job runs give exactly one write', async () => {
        world([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        select('C')
        begin()

        commit()
        select('B')
        commit()
        await settle()

        expect(h.writes).toHaveLength(1)
    })

    test('guard: a commit and a selection change while a job is writing start no second job; catches removing the in-flight check from the scheduled fire', async () => {
        world([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), fullCharacter('D')])
        select('D')
        begin()
        let release!: () => void
        h.gate = new Promise<void>((resolve) => { release = resolve })

        commit()
        await settle()
        expect(h.writes).toHaveLength(1)

        select('C')
        select('D')
        expect(h.commits.length).toBe(1)
        commit()
        await settle()

        expect(h.writes).toHaveLength(1)

        h.gate = null
        release()
        await settle()
        await settle()

        expect(isStub('A')).toBe(true)
        expect(h.commits.length).toBe(1)
    })
})

describe('the boot pass\'s device pause (MC-308 4)', () => {
    test.each([
        ['paused', () => localStorage.setItem('archivePassStrikes', '2')],
        ['unreadable', () => vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('blocked') },
            setItem: () => { throw new Error('blocked') },
            removeItem: () => { },
        })],
    ])('new behaviour: with the record %s, no character is archived and nothing is armed', async (_label, pause) => {
        world([fullCharacter('A'), fullCharacter('B')])
        select('B')
        pause()
        begin()

        expect(h.commits.length).toBe(0)
        await commitAndSettle()

        expect(h.writes).toHaveLength(0)
        expect(isStub('A')).toBe(false)
    })

    test('guard: one earlier boot pass strike does not pause re-archiving', async () => {
        world([fullCharacter('A'), fullCharacter('B')])
        select('B')
        localStorage.setItem('archivePassStrikes', '1')
        begin()

        await commitAndSettle()

        expect(isStub('A')).toBe(true)
    })

    test.each([
        ['paused', () => localStorage.setItem('archivePassStrikes', '2')],
        ['unreadable', () => vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('blocked') },
            setItem: () => { throw new Error('blocked') },
            removeItem: () => { },
        })],
    ])('guard: a pause recorded as %s during the write refuses the archive; catches the final check not repeating the pause', async (_label, pause) => {
        world([fullCharacter('A'), fullCharacter('B')])
        select('B')
        begin()
        h.whileWriting = () => { pause() }

        await commitAndSettle()

        expect(h.writes).toHaveLength(1)
        expect(isStub('A')).toBe(false)
    })

    test('guard: a dirty verdict drops the record while the device is paused', async () => {
        world([{ archived: fullCharacter('A') }, fullCharacter('B'), fullCharacter('C')])
        begin()
        await open('A')
        slot('A').name = 'edited'
        localStorage.setItem('archivePassStrikes', '2')
        select('B')
        select('C')

        await commitAndSettle()

        expect(retainedRecordOf(slot('A'))).toBeUndefined()
        expect(h.writes).toHaveLength(0)
    })
})

describe('a character the boot pass skipped', () => {
    test('guard: a chaId in the boot pass\'s skipped memo is not offered; catches ignoring the device memo', async () => {
        localStorage.setItem('archivePassSkipped', JSON.stringify(['A']))
        world([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        select('C')
        begin()

        await commitAndSettle()
        await commitAndSettle()

        expect(writtenFor('A')).toBe(0)
        expect(isStub('B')).toBe(true)
        localStorage.removeItem('archivePassSkipped')
    })
})
