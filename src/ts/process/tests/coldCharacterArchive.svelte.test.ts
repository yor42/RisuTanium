/**
 * The one-character archive (`../coldCharacterArchive`): a full character is
 * written to a new unit, read back and compared, and only then does a stub that
 * names the unit take its place in the list.
 *
 * What is real: the engine, `buildColdStub`, `coldRetained`, the restored-bytes
 * counter, `characterSaveMarks` (an installed tracker records the marks),
 * `idleReloadBootState` and a reactive `DBState` built with `$state`, so
 * characters are the same proxies the application holds. What is a stand-in:
 * the unit writer and reader (a map whose behaviour a test can bend). A pass
 * here says nothing about the real IndexedDB, Tauri or Node stores.
 *
 * Labels: "new behaviour" tests the archive, which does not exist on the base;
 * "guard" passes with or without the behaviour it names.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

type ReadResult = { status: 'ok', value: unknown } | { status: 'missing' } | { status: 'error', error: unknown }

const h = vi.hoisted(() => ({
    units: new Map<string, unknown>(),
    writes: [] as string[],
    deletes: [] as string[],
    writeOk: true,
    /** Runs while a write is in flight, after the unit is stored. */
    whileWriting: null as null | (() => void),
    /** Runs while a read is in flight. */
    whileReading: null as null | (() => void),
    readOverride: null as null | ((key: string) => ReadResult),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    setColdStorageItem: async (key: string, value: unknown) => {
        h.writes.push(key)
        await Promise.resolve()
        if (!h.writeOk) {
            return false
        }
        h.units.set(key, JSON.parse(JSON.stringify(value)))
        h.whileWriting?.()
        return true
    },
    readColdStorageItem: async (key: string): Promise<ReadResult> => {
        await Promise.resolve()
        h.whileReading?.()
        if (h.readOverride) {
            return h.readOverride(key)
        }
        const unit = h.units.get(key)
        return unit === undefined ? { status: 'missing' } : { status: 'ok', value: JSON.parse(JSON.stringify(unit)) }
    },
    deleteColdStorageItem: async (key: string) => { h.deletes.push(key) },
    removeColdStorageItem: async (key: string) => { h.deletes.push(key) },
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { archiveCharacterNow, archiveMayRun, type ArchiveResult } from 'src/ts/process/coldCharacterArchive'
import { contentFingerprint, resetRetainedForTest, retainedRecordOf, retainOnRestore } from 'src/ts/process/coldRetained'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import { noteBootArchiveSession, resetIdleReloadBootStateForTest } from 'src/ts/process/memory/idleReloadBootState'
import { noteRestoredBytes, resetRestoredBytesForTest, restoredBytesOf } from 'src/ts/process/memory/restoredBytes'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import * as marks from 'src/ts/storage/characterSaveMarks'
import * as restoredBytes from 'src/ts/process/memory/restoredBytes'

type Slot = Database['characters'][number]

let tracker: toSaveType

function fullCharacter(chaId: string, extra: Record<string, unknown> = {}): Slot {
    return {
        chaId,
        name: chaId,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat`, message: [{ role: 'char', data: 'hello', time: 1 }], note: '', name: '', localLore: [] }],
        globalLore: [],
        tags: ['t1'],
        lastInteraction: 100,
        ...extra,
    } as unknown as Slot
}

function setDb(characters: Slot[], extra: Record<string, unknown> = {}): void {
    DBState.db = {
        formatversion: 5,
        archiveCharacters: true,
        plugins: [],
        characters,
        ...extra,
    } as unknown as Database
}

function failed(result: ArchiveResult): Extract<ArchiveResult, { ok: false }> {
    if (result.ok === true) {
        throw new Error('expected a failure')
    }
    return result
}

function succeeded(result: ArchiveResult): Extract<ArchiveResult, { ok: true }> {
    if (result.ok === false) {
        throw new Error(`expected ok, got ${result.reason}`)
    }
    return result
}

const live = (index: number): Slot => DBState.db.characters[index]

beforeEach(() => {
    h.units.clear()
    h.writes.length = 0
    h.deletes.length = 0
    h.writeOk = true
    h.whileWriting = null
    h.whileReading = null
    h.readOverride = null
    resetRetainedForTest()
    resetRestoredBytesForTest()
    resetCharacterSaveMarksForTest()
    resetIdleReloadBootStateForTest()
    noteBootArchiveSession(true)
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    installCharacterSaveMarks({ tracker, schedule: vi.fn() })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    setDb([])
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('a new character', () => {
    test('new behaviour: is written, read back and appended as a stub that names the unit, and marked for save', async () => {
        const card = fullCharacter('A', { trashTime: undefined })
        const before = JSON.stringify(card)

        const result = succeeded(await archiveCharacterNow({ kind: 'new', character: card }, { newUnitKey: () => 'unit-1' }))

        expect(result.index).toBe(0)
        expect(result.unitKey).toBe('unit-1')
        expect(result.previousUnitKey).toBeNull()
        expect(result.chaId).toBe('A')
        expect(DBState.db.characters.length).toBe(1)
        expect(DBState.db.characters[result.index]).toBe(result.stub)
        expect(live(0).coldstorage).toBe('unit-1')
        expect(live(0).coldVersion).toBeGreaterThanOrEqual(3)
        expect((live(0) as { tags?: string[] }).tags).toEqual(['t1'])
        expect(live(0).lastInteraction).toBe(100)
        expect(h.units.get('unit-1')).toEqual({ character: JSON.parse(before) })
        expect(tracker.character).toEqual(['A'])
    })

    test('new behaviour: appends after existing characters and reports the index', async () => {
        setDb([fullCharacter('X'), fullCharacter('Y')])

        const result = succeeded(await archiveCharacterNow({ kind: 'new', character: fullCharacter('A') }))

        expect(result.index).toBe(2)
        expect(live(2).chaId).toBe('A')
        expect(live(0).coldstorage).toBeUndefined()
    })

    test('new behaviour: the live volatile fields are copied onto the stub, and absent ones stay absent', async () => {
        const withTrash = succeeded(await archiveCharacterNow({ kind: 'new', character: fullCharacter('A', { trashTime: 55 }) }))
        expect(live(withTrash.index).trashTime).toBe(55)

        const bare = fullCharacter('B')
        delete (bare as { lastInteraction?: number }).lastInteraction
        const result = succeeded(await archiveCharacterNow({ kind: 'new', character: bare }))
        expect('lastInteraction' in live(result.index)).toBe(false)
        expect('trashTime' in live(result.index)).toBe(false)
    })

    test('new behaviour: lastInteraction edited during the write is the one the stub carries', async () => {
        const card = fullCharacter('A')
        h.whileWriting = () => { card.lastInteraction = 777 }

        const result = succeeded(await archiveCharacterNow({ kind: 'new', character: card }))

        expect(live(result.index).lastInteraction).toBe(777)
    })

    test.each([
        ['an already archived stub', { chaId: 'A', coldstorage: 'u' }],
        ['a missing chaId', { chaId: undefined }],
        ['an empty chaId', { chaId: '' }],
        ['a chaId that cannot name a block', { chaId: '\ud800' }],
        ['the hidden-character prefix', { chaId: '§playground' }],
    ])('new behaviour: %s is refused as bad-target and nothing is written', async (_name, extra) => {
        const result = failed(await archiveCharacterNow({ kind: 'new', character: fullCharacter('A', extra) }))

        expect(result.reason).toBe('bad-target')
        expect(result.countsAsFailure).toBe(false)
        expect(h.writes).toEqual([])
        expect(DBState.db.characters.length).toBe(0)
    })

    test('new behaviour: a chaId some slot already holds is refused before the write', async () => {
        setDb([fullCharacter('A')])

        const result = failed(await archiveCharacterNow({ kind: 'new', character: fullCharacter('A') }))

        expect(result.reason).toBe('id-taken')
        expect(h.writes).toEqual([])
    })

    test('new behaviour: a chaId taken during the write is refused at the final step, with the orphan reported', async () => {
        const card = fullCharacter('A')
        h.whileWriting = () => { DBState.db.characters.push(fullCharacter('A')) }

        const result = failed(await archiveCharacterNow({ kind: 'new', character: card }, { newUnitKey: () => 'unit-1' }))

        expect(result.reason).toBe('id-taken')
        expect(result.writtenUnitKey).toBe('unit-1')
        expect(DBState.db.characters.length).toBe(1)
        expect(DBState.db.characters[0].coldstorage).toBeUndefined()
    })
})

describe('the gates', () => {
    test.each([
        ['the session cannot archive', () => noteBootArchiveSession(false), 'unavailable'],
        ['the setting is false', () => { DBState.db.archiveCharacters = false }, 'setting'],
        ['the setting is not yet committed (undefined)', () => { DBState.db.archiveCharacters = undefined }, 'setting'],
        ['the format version is below the block format', () => { DBState.db.formatversion = 4 }, 'format-version'],
        ['a V2.1 plugin is enabled', () => { DBState.db.plugins = [{ enabled: true, version: '2.1' }] as unknown as Database['plugins'] }, 'v21-plugin'],
    ])('new behaviour: %s -> refused at once, nothing written, not a counted failure', async (_name, apply, reason) => {
        apply()

        const result = failed(await archiveCharacterNow({ kind: 'new', character: fullCharacter('A') }))

        expect(result.reason).toBe(reason)
        expect(result.writtenUnitKey).toBeNull()
        expect(result.countsAsFailure).toBe(false)
        expect(h.writes).toEqual([])
        expect(archiveMayRun()).toBe(reason)
    })

    test.each([
        ['the setting flips', () => { DBState.db.archiveCharacters = false }, 'setting'],
        ['a V2.1 plugin is enabled', () => { DBState.db.plugins = [{ enabled: true, version: '2.1' }] as unknown as Database['plugins'] }, 'v21-plugin'],
        ['the session stops being able to archive', () => noteBootArchiveSession(false), 'unavailable'],
    ])('new behaviour: %s while the write is in flight -> refused at the final step, list untouched, orphan reported', async (_name, apply, reason) => {
        h.whileWriting = apply

        const result = failed(await archiveCharacterNow({ kind: 'new', character: fullCharacter('A') }, { newUnitKey: () => 'unit-1' }))

        expect(result.reason).toBe(reason)
        expect(result.writtenUnitKey).toBe('unit-1')
        expect(result.countsAsFailure).toBe(false)
        expect(DBState.db.characters.length).toBe(0)
        expect(tracker.character).toEqual([])
    })
})

describe('a unit that does not hold', () => {
    test('new behaviour: a write that returns false is a counted failure with no orphan', async () => {
        h.writeOk = false

        const result = failed(await archiveCharacterNow({ kind: 'new', character: fullCharacter('A') }))

        expect(result.reason).toBe('write-failed')
        expect(result.countsAsFailure).toBe(true)
        expect(result.writtenUnitKey).toBeNull()
        expect(DBState.db.characters.length).toBe(0)
    })

    test.each([
        ['a read error', () => ({ status: 'error', error: new Error('x') }) as ReadResult, 'read-failed'],
        ['a missing unit', () => ({ status: 'missing' }) as ReadResult, 'read-failed'],
        ['a unit with another chaId', () => ({ status: 'ok', value: { character: fullCharacter('OTHER') } }) as ReadResult, 'read-mismatch'],
        ['a unit with changed content', () => ({ status: 'ok', value: { character: fullCharacter('A', { name: 'changed' }) } }) as ReadResult, 'read-mismatch'],
        ['a unit without a character', () => ({ status: 'ok', value: {} }) as ReadResult, 'read-mismatch'],
    ])('new behaviour: %s is a counted failure that leaves the list as it was', async (_name, override, reason) => {
        h.readOverride = override
        const card = fullCharacter('A')
        const before = JSON.stringify(card)

        const result = failed(await archiveCharacterNow({ kind: 'new', character: card }, { newUnitKey: () => 'unit-1' }))

        expect(result.reason).toBe(reason)
        expect(result.countsAsFailure).toBe(true)
        expect(result.writtenUnitKey).toBe('unit-1')
        expect(DBState.db.characters.length).toBe(0)
        expect(JSON.stringify(card)).toBe(before)
    })

    test('new behaviour: a throw while writing is mapped to a counted error, never a rejection', async () => {
        const card = fullCharacter('A')
        ;(card as unknown as { cyclic: unknown }).cyclic = card

        const result = failed(await archiveCharacterNow({ kind: 'new', character: card }))

        expect(result.reason).toBe('error')
        expect(result.countsAsFailure).toBe(true)
        expect(DBState.db.characters.length).toBe(0)
    })
})

describe('a loaded character', () => {
    async function archiveLoaded(index: number, extra: { previousUnitKey?: string, finalCheck?: () => string | null } = {}): Promise<ArchiveResult> {
        return await archiveCharacterNow(
            { kind: 'loaded', character: live(index), ...(extra.previousUnitKey ? { previousUnitKey: extra.previousUnitKey } : {}) },
            { newUnitKey: () => 'unit-new', ...(extra.finalCheck ? { finalCheck: extra.finalCheck } : {}) },
        )
    }

    test('new behaviour: replaces exactly its own slot, carries the live volatile fields and echoes previousUnitKey', async () => {
        setDb([fullCharacter('X'), fullCharacter('A'), fullCharacter('Y')])
        const other = live(2)

        const result = succeeded(await archiveLoaded(1, { previousUnitKey: 'unit-old' }))

        expect(result.index).toBe(1)
        expect(result.previousUnitKey).toBe('unit-old')
        expect(DBState.db.characters[1]).toBe(result.stub)
        expect(live(1).coldstorage).toBe('unit-new')
        expect(live(2)).toBe(other)
        expect(live(0).coldstorage).toBeUndefined()
        expect(tracker.character).toEqual(['A'])
        expect(h.deletes).toEqual([])
    })

    test('new behaviour: the lastInteraction and trashTime of the live character at the final step are the stub\'s', async () => {
        setDb([fullCharacter('A', { trashTime: 5 })])
        h.whileReading = () => { live(0).lastInteraction = 999; live(0).trashTime = 0 }

        const result = succeeded(await archiveLoaded(0))

        expect(live(result.index).lastInteraction).toBe(999)
        expect('trashTime' in live(result.index)).toBe(false)
    })

    test('new behaviour: releases the restored bytes and the retained record of the character it replaces', async () => {
        const stubOf = buildColdStub(fullCharacter('A'), 'unit-old', [])
        setDb([fullCharacter('A')])
        retainOnRestore(live(0), stubOf, fullCharacter('A'))
        noteRestoredBytes('A', 500)
        expect(retainedRecordOf(live(0))).toBeDefined()
        expect(restoredBytesOf('A')).toBe(500)
        const replaced = live(0)

        succeeded(await archiveLoaded(0, { previousUnitKey: 'unit-old' }))

        expect(retainedRecordOf(replaced)).toBeUndefined()
        expect(restoredBytesOf('A')).toBe(0)
    })

    test('new behaviour: an edit during the write is refused as changed, and the character stays loaded', async () => {
        setDb([fullCharacter('A')])
        const card = live(0)
        h.whileWriting = () => { card.name = 'edited' }

        const result = failed(await archiveLoaded(0))

        expect(result.reason).toBe('changed')
        expect(result.countsAsFailure).toBe(false)
        expect(result.writtenUnitKey).toBe('unit-new')
        expect(live(0)).toBe(card)
        expect(tracker.character).toEqual([])
    })

    test('new behaviour: a slot replaced during the write is slot-gone', async () => {
        setDb([fullCharacter('A')])
        h.whileWriting = () => { DBState.db.characters[0] = fullCharacter('A') }

        expect(failed(await archiveLoaded(0)).reason).toBe('slot-gone')
    })

    test('new behaviour: a slot removed during the write is slot-gone', async () => {
        setDb([fullCharacter('A')])
        h.whileWriting = () => { DBState.db.characters.splice(0, 1) }

        expect(failed(await archiveLoaded(0)).reason).toBe('slot-gone')
    })

    test('new behaviour: a second holder of the chaId is id-taken, before and during the write', async () => {
        setDb([fullCharacter('A'), fullCharacter('A')])
        expect(failed(await archiveLoaded(0)).reason).toBe('id-taken')
        expect(h.writes).toEqual([])

        setDb([fullCharacter('A')])
        h.whileWriting = () => { DBState.db.characters.push(fullCharacter('A')) }
        expect(failed(await archiveLoaded(0)).reason).toBe('id-taken')
    })

    test('new behaviour: a character that is not in the list is slot-gone', async () => {
        setDb([fullCharacter('X')])

        const result = failed(await archiveCharacterNow({ kind: 'loaded', character: fullCharacter('A') }))

        expect(result.reason).toBe('slot-gone')
        expect(h.writes).toEqual([])
    })

    test('new behaviour: the hidden-character prefix is bad-target', async () => {
        setDb([fullCharacter('§playground')])

        expect(failed(await archiveLoaded(0)).reason).toBe('bad-target')
        expect(h.writes).toEqual([])
    })

    test('new behaviour: finalCheck refusing gives refused, with nothing changed and the orphan reported', async () => {
        setDb([fullCharacter('A')])
        const card = live(0)
        const finalCheck = vi.fn(() => 'busy')

        const result = failed(await archiveLoaded(0, { finalCheck }))

        expect(result.reason).toBe('refused')
        expect(result.countsAsFailure).toBe(false)
        expect(result.writtenUnitKey).toBe('unit-new')
        expect(finalCheck).toHaveBeenCalledTimes(1)
        expect(live(0)).toBe(card)
    })

    test('new behaviour: finalCheck is called after the built-in final checks, so a changed character never reaches it', async () => {
        setDb([fullCharacter('A')])
        const card = live(0)
        h.whileWriting = () => { card.name = 'edited' }
        const finalCheck = vi.fn(() => null)

        expect(failed(await archiveLoaded(0, { finalCheck })).reason).toBe('changed')
        expect(finalCheck).not.toHaveBeenCalled()
    })
})

describe('after the stub is placed', () => {
    test('new behaviour: a markCharacterForSave that throws still gives ok, with one slot and no duplicate', async () => {
        vi.spyOn(marks, 'markCharacterForSave').mockImplementation(() => { throw new Error('mark') })

        const result = succeeded(await archiveCharacterNow({ kind: 'new', character: fullCharacter('A') }))

        expect(result.index).toBe(0)
        expect(DBState.db.characters.filter((cha) => cha.chaId === 'A').length).toBe(1)
        expect(live(0).coldstorage).toBeTruthy()
    })

    test('new behaviour: a clearRestoredBytes that throws still gives ok, and the mark is still made', async () => {
        setDb([fullCharacter('A')])
        vi.spyOn(restoredBytes, 'clearRestoredBytes').mockImplementation(() => { throw new Error('clear') })

        const result = succeeded(await archiveCharacterNow({ kind: 'loaded', character: live(0) }))

        expect(live(0)).toBe(result.stub)
        expect(DBState.db.characters.filter((cha) => cha.chaId === 'A').length).toBe(1)
        expect(tracker.character).toEqual(['A'])
    })
})

describe('what the engine leaves alone', () => {
    test('guard: never changes its input, never deletes a unit, and gives the same fingerprint before and after', async () => {
        const card = fullCharacter('A')
        const before = contentFingerprint(card)
        const json = JSON.stringify(card)

        await archiveCharacterNow({ kind: 'new', character: card })
        h.writeOk = false
        await archiveCharacterNow({ kind: 'new', character: fullCharacter('B') })

        expect(contentFingerprint(card)).toBe(before)
        expect(JSON.stringify(card)).toBe(json)
        expect(h.deletes).toEqual([])
    })

    test('guard: every unit key is a fresh one', async () => {
        const first = succeeded(await archiveCharacterNow({ kind: 'new', character: fullCharacter('A') }))
        const second = succeeded(await archiveCharacterNow({ kind: 'new', character: fullCharacter('B') }))

        expect(first.unitKey).not.toBe(second.unitKey)
        expect(h.units.size).toBe(2)
    })

    test('guard: a throwing finalCheck or storage never makes it reject', async () => {
        setDb([fullCharacter('A')])

        const result = await archiveCharacterNow({ kind: 'loaded', character: live(0) }, { finalCheck: () => { throw new Error('boom') } })

        expect(failed(result).reason).toBe('error')
    })
})
