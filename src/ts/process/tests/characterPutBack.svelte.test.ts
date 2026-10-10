/**
 * The character put-back (`../memory/characterPutBack`): a character restored
 * from its unit and left unchanged goes back into its slot as the stub it
 * replaced, once the user has moved on and a save iteration has committed.
 *
 * What is real: `restoreColdCharacter` and `coldRetained` (the restore retains
 * the stub), the keep-set, the busy registry, the restored-bytes counter,
 * `characterSaveMarks` (an installed tracker records the marks) and a reactive
 * `DBState` built with `$state`, so characters are the same proxies the
 * application holds. What is a stand-in: the unit reader (a map), the save
 * loop (`afterNextSaveCommit` collects callbacks and `commit()` runs them, as
 * the loop does after an iteration committed) and `isWriting`.
 *
 * Effects live in this suite: none. `registerDbChangeEffects` is not
 * registered, so nothing marks a restored or replaced character; a mark in
 * the tracker is one the put-back made. The identity tracker's behaviour is in
 * `dbChangeEffects.svelte.test.ts`, and the committed save in
 * `globalApi.putBack.svelte.test.ts`.
 *
 * Labels: "acceptance" tests the put-back, which does not exist on the base;
 * "guard" passes with or without the code it names.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'
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
import { contentFingerprint, resetRetainedForTest, retainedRecordOf, retainedUnitKeys } from 'src/ts/process/coldRetained'
import { getPutBackCounters, resetPutBackForTest, startCharacterPutBack } from 'src/ts/process/memory/characterPutBack'
import { beginBusy, beginChokePoint, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { resetRestoredBytesForTest, restoredBytesOf, restoredBytesOutside } from 'src/ts/process/memory/restoredBytes'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'

type Slot = Database['characters'][number]

let stop: (() => void) | null = null
let cleanup: (() => void) | undefined
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

/** Puts the stubs of `sources` in the list and their units in the reader; the first-listed is slot 0. */
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

/** Restores `chaId` and selects it, as `changeChar` does. */
async function open(chaId: string): Promise<void> {
    const outcome = await restoreColdCharacter(slot(chaId), { byChaId: true, quiet: true })
    expect(outcome.status).toBe('restored')
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

beforeEach(() => {
    h.units.clear()
    h.commits.length = 0
    h.writing.clear()
    resetRetainedForTest()
    resetPutBackForTest()
    resetBusyActionsForTest()
    resetRestoredBytesForTest()
    resetCharacterSaveMarksForTest()
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
    vi.restoreAllMocks()
})

describe('a character the user only looked at', () => {
    test('acceptance: is put back as the very stub it replaced, marked for save, and its restored bytes are released', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        const stubA = slot('A')
        begin()
        await open('A')
        await open('B')
        await open('C')
        expect(isStub('A')).toBe(false)
        expect(restoredBytesOf('A')).toBeGreaterThan(0)

        commit()

        expect(slot('A')).toBe(stubA)
        expect(slot('A').coldstorage).toBe('unit-A')
        expect(restoredBytesOf('A')).toBe(0)
        expect(restoredBytesOutside()).toBe(restoredBytesOf('B') + restoredBytesOf('C'))
        expect(tracker.character).toEqual(['A'])
        expect(isStub('B')).toBe(false)
        expect(isStub('C')).toBe(false)
        expect(getPutBackCounters().clean).toBe(1)
    })

    test('acceptance: needs a commit; until the save loop has committed nothing is swapped, and a later commit does it', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        await open('A')
        await open('B')
        await open('C')

        expect(isStub('A')).toBe(false)
        expect(h.commits.length).toBe(1)
        expect(tracker.character).toEqual([])

        commit()
        expect(isStub('A')).toBe(true)
    })

    test('acceptance: a put-back character that is opened again restores to the unit content', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        await open('A')
        await open('B')
        await open('C')
        commit()
        expect(isStub('A')).toBe(true)

        await open('A')

        expect(isStub('A')).toBe(false)
        expect(slot('A').chats[0].message[0].data).toBe('hello')
        expect(retainedRecordOf(slot('A'))?.unitKey).toBe('unit-A')
    })

    test('acceptance: the retained fingerprint of a reactive proxy equals the fingerprint of the plain unit', async () => {
        const source = fullCharacter('A')
        archiveAll([source])
        begin()
        await open('A')

        expect(retainedRecordOf(slot('A'))?.fp).toBe(contentFingerprint(slot('A')))
        expect(retainedRecordOf(slot('A'))?.fp).toBe(contentFingerprint(source))
    })
})

describe('the keep-set', () => {
    test('acceptance: the selected character and the previous selection stay loaded', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        await open('A')
        await open('B')

        commit()

        expect(isStub('A')).toBe(false)
        expect(isStub('B')).toBe(false)
        expect(tracker.character).toEqual([])
    })

    test('acceptance: a character that became a member of the selected group before the commit stays loaded', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), groupCharacter('G', ['A', 'B'])])
        begin()
        await open('A')
        await open('B')
        await open('C')
        await open('G')

        commit()

        expect(isStub('A')).toBe(false)
        expect(isStub('B')).toBe(false)
        expect(getPutBackCounters().kept).toBeGreaterThanOrEqual(1)
        expect(tracker.character).toEqual([])
    })

    test('acceptance: going home keeps the previous selection and releases the one that was shown', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        await open('A')
        await open('B')
        selectedCharID.set(-1)

        commit()

        expect(isStub('A')).toBe(false)
        expect(isStub('B')).toBe(true)
    })

    test('acceptance: the members of the selected group, and then of the previous group, stay loaded; one swap per commit', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), groupCharacter('G', ['A', 'B']), fullCharacter('X'), fullCharacter('Y')])
        begin()
        await open('A')
        await open('B')
        await open('G')
        commit()
        expect(['A', 'B', 'G'].map(isStub)).toEqual([false, false, false])

        await open('X')
        commit()
        expect(['A', 'B', 'G'].map(isStub)).toEqual([false, false, false])

        await open('Y')
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

    test('acceptance: a character a unit of work is writing stays loaded and is put back after the work ends', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        await open('A')
        await open('B')
        await open('C')
        h.writing.add('A')

        commit()
        expect(isStub('A')).toBe(false)
        expect(getPutBackCounters().writing).toBe(1)
        expect(h.commits.length).toBe(1)

        h.writing.clear()
        commit()
        expect(isStub('A')).toBe(true)
    })

    test('acceptance: selecting the character again before the commit keeps it', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        await open('A')
        await open('B')
        await open('C')
        selectedCharID.set(findChaIdHolders('A')[0])

        commit()

        expect(isStub('A')).toBe(false)
        expect(tracker.character).toEqual(['B'])
    })
})

describe('what blocks a put-back', () => {
    test.each([
        ['a busy action', () => beginBusy('import').end],
        ['a write at a choke point', () => beginChokePoint('asset')],
    ])('acceptance: %s defers it and a later commit does it', async (_label, startBlock) => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        await open('A')
        await open('B')
        await open('C')
        const end = startBlock()

        commit()
        expect(isStub('A')).toBe(false)
        expect(getPutBackCounters().busy).toBe(1)
        expect(h.commits.length).toBe(1)

        end()
        commit()
        expect(isStub('A')).toBe(true)
    })

    test.each([
        ['a chat message', (cha: Slot) => { cha.chats[0].message.push({ role: 'user', data: 'hi', time: 2 } as never) }, 'chats'],
        ['a field', (cha: Slot) => { cha.name = 'renamed' }, 'name'],
        ['a lorebook entry', (cha: Slot) => { cha.globalLore.push({ key: 'k', comment: '', content: 'c', mode: 'normal', insertorder: 1, alwaysActive: false, secondkey: '', selective: false } as never) }, 'globalLore'],
    ])('acceptance: %s added after the restore keeps the character loaded, with the edit, for good', async (_label, edit, changedKey) => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), fullCharacter('D')])
        begin()
        await open('A')
        edit(slot('A'))
        const edited = JSON.stringify(slot('A'))
        await open('B')
        await open('C')

        commit()
        expect(isStub('A')).toBe(false)
        expect(JSON.stringify(slot('A'))).toBe(edited)
        expect(getPutBackCounters().dirty).toBe(1)
        expect(console.debug).toHaveBeenCalledWith(expect.stringContaining('[put-back]'), 'A', [changedKey])
        expect(retainedRecordOf(slot('A'))).toBeUndefined()
        expect(retainedUnitKeys().has('unit-A')).toBe(false)

        // A later switch finds nothing retained for it.
        await open('D')
        commit()
        expect(isStub('A')).toBe(false)
        expect(tracker.character).not.toContain('A')
    })

    test('acceptance: a lastInteraction or trashTime change alone is not an edit', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        await open('A')
        slot('A').lastInteraction = 99999
        slot('A').trashTime = 12345
        await open('B')
        await open('C')

        commit()

        expect(isStub('A')).toBe(true)
        expect(getPutBackCounters().dirty).toBe(0)
    })

    test('acceptance: a slot replaced by another object, and a chaId held twice, are left alone', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), fullCharacter('D')])
        begin()
        await open('A')
        await open('B')
        await open('C')
        await open('D')
        const replacement = fullCharacter('A', { name: 'replaced' })
        DBState.db.characters[findChaIdHolders('A')[0]] = replacement
        DBState.db.characters.push(fullCharacter('B', { name: 'second holder' }))

        commit()
        commit()

        expect(slot('A').name).toBe('replaced')
        expect(slot('A').coldstorage).toBeUndefined()
        expect(DBState.db.characters.filter((cha) => cha.chaId === 'B').every((cha) => cha.coldstorage === undefined)).toBe(true)
        expect(getPutBackCounters().gone).toBeGreaterThanOrEqual(2)
        expect(tracker.character).not.toContain('A')
        expect(tracker.character).not.toContain('B')
    })

    test('acceptance: a Playground character is never retained or put back', async () => {
        archiveAll([fullCharacter('§playground'), fullCharacter('B'), fullCharacter('C')])
        begin()
        await open('§playground')
        await open('B')
        await open('C')

        commit()

        expect(isStub('§playground')).toBe(false)
        expect(retainedRecordOf(slot('§playground'))).toBeUndefined()
        expect(retainedUnitKeys().has('unit-§playground')).toBe(false)
    })

    test('guard: a restore that is refused retains nothing', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B')])
        h.units.delete('unit-A')
        begin()

        const outcome = await restoreColdCharacter(slot('A'), { byChaId: true, quiet: true })

        expect(outcome.status).toBe('refused')
        expect(retainedUnitKeys().size).toBe(0)
    })

    test.each([
        ['an enabled V2.1 plugin', { plugins: [{ enabled: true, version: '2.1' }] }],
        ['archiving switched off', { archiveCharacters: false }],
        ['a format before the block format', { formatversion: 4 }],
    ])('acceptance: %s puts nothing back', async (_label, dbExtra) => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')], dbExtra)
        begin()
        await open('A')
        await open('B')
        await open('C')

        commit()

        expect(isStub('A')).toBe(false)
        expect(tracker.character).toEqual([])
    })
})

describe('the budget of one commit', () => {
    test('acceptance: at most three fingerprints and one swap; the rest wait for the next commits', async () => {
        archiveAll(['A', 'B', 'C', 'D', 'E', 'F'].map((id) => fullCharacter(id)))
        begin()
        for (const id of ['A', 'B', 'C', 'D', 'E']) {
            await open(id)
        }
        for (const id of ['A', 'B', 'C']) {
            slot(id).name = `${id} edited`
        }
        await open('F')

        commit()
        expect(['A', 'B', 'C', 'D'].map(isStub)).toEqual([false, false, false, false])
        expect(getPutBackCounters().dirty).toBe(3)
        expect(h.commits.length).toBe(1)

        commit()
        expect(['A', 'B', 'C', 'D'].map(isStub)).toEqual([false, false, false, true])
        expect(getPutBackCounters().clean).toBe(1)
        expect(tracker.character).toEqual(['D'])
        expect(h.commits.length).toBe(0)
    })
})

describe('the state a put-back carries onto the stub', () => {
    test('acceptance: the live lastInteraction and trashTime, and their absence', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C'), fullCharacter('D')])
        begin()
        await open('A')
        await open('B')
        await open('C')
        await open('D')
        slot('A').lastInteraction = 4242
        slot('A').trashTime = 777
        delete slot('B').lastInteraction

        commit()
        commit()

        expect(slot('A').coldstorage).toBe('unit-A')
        expect(slot('A').lastInteraction).toBe(4242)
        expect(slot('A').trashTime).toBe(777)
        expect(slot('B').coldstorage).toBe('unit-B')
        expect('lastInteraction' in slot('B')).toBe(false)
        expect('trashTime' in slot('B')).toBe(false)
    })

    test('guard: a stub put back with a newer lastInteraction than its unit keeps that value when it is restored again', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        await open('A')
        slot('A').lastInteraction = 4242
        await open('B')
        await open('C')
        commit()
        expect(slot('A').lastInteraction).toBe(4242)
        expect((h.units.get('unit-A') as { character: Slot }).character.lastInteraction).toBe(100)

        await open('A')

        expect(isStub('A')).toBe(false)
        expect(slot('A').lastInteraction).toBe(4242)
    })

    test('acceptance: a character taken out of the trash after the restore returns as a stub that is not trashed', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        slot('A').trashTime = 555
        begin()
        await open('A')
        expect(slot('A').trashTime).toBe(555)
        delete slot('A').trashTime
        await open('B')
        await open('C')

        commit()

        expect(slot('A').coldstorage).toBe('unit-A')
        expect('trashTime' in slot('A')).toBe(false)
    })
})

describe('the subscription', () => {
    test('acceptance: a selection set inside an effect makes that effect depend on nothing the put-back reads', async () => {
        archiveAll([fullCharacter('A'), fullCharacter('B'), fullCharacter('C')])
        begin()
        await open('A')
        await open('B')
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
