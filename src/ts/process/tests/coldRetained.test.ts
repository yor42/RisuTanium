/**
 * What a restore retains of the placeholder it replaced (`../coldRetained`):
 * the fingerprint of the unit's character, the record found by the installed
 * character's identity, and the unit keys cleanup must treat as referenced.
 *
 * The stores are a stand-in with plain objects; the reactive-proxy case and the
 * put-back itself are in `characterPutBack.svelte.test.ts`. Every test is an
 * acceptance test of code that does not exist on the base, except where
 * labelled a guard.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
}) as unknown as typeof import('src/ts/stores.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import {
    contentFingerprint,
    differingKeys,
    dropRetained,
    hasRetained,
    pruneRetained,
    resetRetainedForTest,
    retainOnRestore,
    retainedRecordOf,
    retainedUnitKeys,
} from '../coldRetained'
import { buildColdStub } from '../coldCharacter'

type Slot = Database['characters'][number]

function full(chaId: string): Slot {
    return {
        chaId,
        name: chaId,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat`, message: [{ role: 'char', data: 'hello', time: 1 }], note: '', name: '', localLore: [] }],
        lastInteraction: 10,
    } as unknown as Slot
}

function stubOf(source: Slot, unitKey: string, chats: string[] = []): Slot {
    return buildColdStub(source, unitKey, chats)
}

function install(...slots: Slot[]): void {
    DBState.db = { characters: slots } as unknown as Database
}

beforeEach(() => {
    resetRetainedForTest()
    install()
})

describe('contentFingerprint', () => {
    test('acceptance: the same content gives the same fingerprint whatever lastInteraction and trashTime hold', () => {
        const a = full('a')
        const b = { ...full('a'), trashTime: 99, lastInteraction: 123456 } as Slot

        expect(contentFingerprint(a)).toBe(contentFingerprint(b))
        expect(contentFingerprint(a)).toMatch(/^\d+:[0-9a-f]+:[0-9a-f]+$/)
    })

    test('acceptance: a change of any field, nested or not, changes the fingerprint', () => {
        const base = contentFingerprint(full('a'))
        const renamed = { ...full('a'), name: 'renamed' } as Slot
        const nested = full('a')
        nested.chats[0].message.push({ role: 'user', data: 'more', time: 2 } as never)
        const added = { ...full('a'), globalLore: [] } as Slot

        expect(new Set([base, contentFingerprint(renamed), contentFingerprint(nested), contentFingerprint(added)]).size).toBe(4)
    })

    test('acceptance: two texts of one length that differ in one unit give different fingerprints', () => {
        const one = { ...full('a'), name: 'abcdefgh' } as Slot
        const two = { ...full('a'), name: 'abcdefgi' } as Slot

        expect(contentFingerprint(one)).not.toBe(contentFingerprint(two))
    })

    test('acceptance: the fingerprint is not stored on the character it was taken from', () => {
        const unit = full('a')
        const before = JSON.stringify(unit)

        contentFingerprint(unit)

        expect(JSON.stringify(unit)).toBe(before)
    })
})

describe('retainOnRestore', () => {
    test('acceptance: the record is found by the installed character and not by a copy of it', () => {
        const unit = full('a')
        const stub = stubOf(unit, 'unit-a')
        const installed = unit
        install(installed)

        retainOnRestore(installed, stub, unit)

        const record = retainedRecordOf(installed)
        expect(record?.stub).toBe(stub)
        expect(record?.unitKey).toBe('unit-a')
        expect(record?.fp).toBe(contentFingerprint(unit))
        expect(retainedRecordOf({ ...installed } as Slot)).toBeUndefined()
        expect(retainedRecordOf(null)).toBeUndefined()
    })

    test('acceptance: the record keeps the stub and never the installed full character', () => {
        const unit = full('a')
        const stub = stubOf(unit, 'unit-a')
        install(unit)

        retainOnRestore(unit, stub, unit)

        const record = retainedRecordOf(unit)!
        expect(Object.values(record)).not.toContain(unit)
        expect(Object.keys(record).sort()).toEqual(['chaId', 'fp', 'keyHashes', 'stub', 'unitKey'])
    })

    test('acceptance: the Playground character, a stub without a unit key and a character without an id are never retained', () => {
        const playground = full('§playground')
        const noKey = full('b')
        const noId = full('')
        install(playground, noKey, noId)

        retainOnRestore(playground, stubOf(playground, 'unit-p'), playground)
        retainOnRestore(noKey, { ...stubOf(noKey, 'unit-b'), coldstorage: undefined } as Slot, noKey)
        retainOnRestore(noId, stubOf(noId, 'unit-c'), noId)

        expect(hasRetained()).toBe(false)
        expect(retainedRecordOf(playground)).toBeUndefined()
    })

    test('acceptance: a character that cannot be fingerprinted is left unretained and the restore does not throw', () => {
        const unit = full('a') as unknown as Record<string, unknown>
        unit.self = unit
        const error = vi.spyOn(console, 'error').mockImplementation(() => { })
        install(unit as unknown as Slot)

        expect(() => retainOnRestore(unit as unknown as Slot, stubOf(full('a'), 'unit-a'), unit as unknown as Slot)).not.toThrow()

        expect(hasRetained()).toBe(false)
        error.mockRestore()
    })

    test('acceptance: dropRetained forgets the record, and a record whose installed character left the list is pruned', () => {
        const a = full('a')
        const b = full('b')
        install(a, b)
        retainOnRestore(a, stubOf(a, 'unit-a'), a)
        retainOnRestore(b, stubOf(b, 'unit-b'), b)

        dropRetained(retainedRecordOf(a)!)
        expect(retainedRecordOf(a)).toBeUndefined()
        expect(hasRetained()).toBe(true)

        DBState.db.characters.splice(1, 1)
        pruneRetained()
        expect(hasRetained()).toBe(false)
    })
})

describe('retainedUnitKeys', () => {
    test('acceptance: names the unit of every retained stub and the archived chats the stub points at', () => {
        const a = full('a')
        const b = full('b')
        install(a, b)
        retainOnRestore(a, stubOf(a, 'unit-a', ['chat-1', 'chat-2']), a)
        retainOnRestore(b, stubOf(b, 'unit-b'), b)

        expect(retainedUnitKeys()).toEqual(new Set(['unit-a', 'chat-1', 'chat-2', 'unit-b']))
    })

    test('acceptance: a record whose character was removed from the list no longer names its units', () => {
        const a = full('a')
        const b = full('b')
        install(a, b)
        retainOnRestore(a, stubOf(a, 'unit-a'), a)
        retainOnRestore(b, stubOf(b, 'unit-b'), b)

        DBState.db.characters.splice(0, 1)

        expect(retainedUnitKeys()).toEqual(new Set(['unit-b']))
    })

    test('guard: nothing retained names nothing', () => {
        expect(retainedUnitKeys().size).toBe(0)
    })
})

describe('differingKeys (development diagnostics)', () => {
    test('acceptance: names the top-level keys that changed since the restore, and not the volatile ones', () => {
        const unit = full('a')
        install(unit)
        retainOnRestore(unit, stubOf(unit, 'unit-a'), unit)
        const record = retainedRecordOf(unit)!

        unit.name = 'renamed'
        unit.chats[0].note = 'edited'
        unit.lastInteraction = 99999
        unit.trashTime = 5

        expect(differingKeys(record, unit).sort()).toEqual(['chats', 'name'])
    })
})
