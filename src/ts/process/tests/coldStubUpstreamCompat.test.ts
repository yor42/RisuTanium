/**
 * Compatibility guards: a stub this fork writes (version 3, with `tags` and
 * `creator`) is read by the upstream application exactly as an older stub.
 *
 * The reader below is a MODEL of upstream (kwaroran/RisuAI 979dbc9d), written
 * from what its stub handling does, not upstream code: a slot is a stub when
 * `coldstorage` is truthy, its keys are `coldstorage` plus `coldStoragedChats`,
 * opening it replaces the slot wholesale with the unit's character when that
 * character's `chaId` equals the stub's, and the lists read only the name,
 * image, chat count and `creatorNotes`. Every test here passes before and
 * after the version 3 change, except the one marked as a reproducer, which
 * asserts the new keys themselves; they pin that the extra keys stay inert for
 * upstream.
 */
import { describe, test, expect } from 'vitest'
import type { character } from '../../storage/database.svelte'
import { buildColdStub, coldUnitCharacter, enrichLegacyStub } from '../coldCharacter'
import { TRASH_PURGE_AGE_MS } from '../../storage/trashPurge'

interface UpstreamUnit {
    character?: character
}

function fullCharacter(): character {
    return {
        type: 'character',
        name: 'Alice',
        image: 'assets/alice.png',
        chaId: 'cha-alice',
        chatPage: 2,
        firstMsgIndex: 3,
        creatorNotes: 'A short note',
        tags: ['a', 'b'],
        creator: 'Top',
        additionalData: { creator: 'Edited' },
        chats: [
            { id: 'c1', name: 'One', note: '', localLore: [], message: [{ role: 'user', data: 'hello', time: 1 }] },
            { id: 'c2', name: 'Two', note: '', localLore: [], message: [{ role: 'user', data: 'again', time: 2 }] },
        ],
    } as unknown as character
}

/** Model: the keys upstream lists for a slot (the unit and its chat units). */
function upstreamKeys(slot: character): string[] {
    return slot.coldstorage ? [slot.coldstorage, ...(slot.coldStoragedChats ?? [])] : []
}

/** Model: opening a stub replaces the slot wholesale with the unit's character when the `chaId`s agree. */
function upstreamOpen(slot: character, units: Record<string, UpstreamUnit>): character | 'restore-failed' {
    if (!slot.coldstorage) {
        return slot
    }
    const unit = units[slot.coldstorage]
    if (unit?.character && unit.character.chaId === slot.chaId) {
        return unit.character
    }
    return 'restore-failed'
}

/** Model: what the upstream lists read from a slot. */
function upstreamListRead(slot: character) {
    return {
        name: slot.name,
        image: slot.image,
        chatCount: slot.chats.length,
        description: slot.creatorNotes ?? 'No description',
    }
}

function legacyUpstreamStub(): character {
    return {
        type: 'character',
        name: 'Alice',
        image: 'assets/alice.png',
        chaId: 'cha-alice',
        chats: [{ message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
        chatPage: 0,
        firstMsgIndex: 0,
        coldstorage: 'unit-1',
        coldStoragedChats: [],
    } as unknown as character
}

const STUBS: [string, () => character][] = [
    ['a stub made by buildColdStub', () => buildColdStub(fullCharacter(), 'unit-1', [])],
    ['a stub made by enrichLegacyStub from an upstream stub', () => enrichLegacyStub(legacyUpstreamStub(), fullCharacter())],
]

describe.each(STUBS)('compatibility guard (model of upstream): %s', (_label, make) => {
    test('is detected as a stub, and its listed keys name the unit', () => {
        const stub = make()

        expect(stub.coldstorage).toBeTruthy()
        expect(upstreamKeys(stub)).toEqual(['unit-1'])
    })

    test('opening it with its unit restores the full character wholesale, extra stub keys left behind', () => {
        const stub = make()
        const original = fullCharacter()

        const opened = upstreamOpen(stub, { 'unit-1': { character: original } })

        expect(opened).toEqual(fullCharacter())
        expect(opened).not.toBe(stub)
        expect(opened).not.toHaveProperty('coldVersion')
        expect(opened).not.toHaveProperty('coldChatCount')
    })

    test('opening it with a unit of another chaId fails, as upstream does for any stub', () => {
        const stub = make()

        const other = { ...fullCharacter(), chaId: 'someone-else' } as character

        expect(upstreamOpen(stub, { 'unit-1': { character: other } })).toBe('restore-failed')
        expect(upstreamOpen(stub, {})).toBe('restore-failed')
    })

    test('carries every field the upstream lists read', () => {
        const read = upstreamListRead(make())

        expect(read.name).toBe('Alice')
        expect(read.image).toBe('assets/alice.png')
        expect(read.chatCount).toBeGreaterThanOrEqual(1)
        expect(read.description).toBe('A short note')
    })

    test('regression reproducer: carries tags and creator beside the fields upstream reads, which upstream ignores', () => {
        const stub = make()

        expect(stub.tags).toEqual(['a', 'b'])
        expect(stub.creator).toBe('Edited')
        expect(upstreamListRead(stub)).toEqual({ name: 'Alice', image: 'assets/alice.png', chatCount: expect.any(Number), description: 'A short note' })
    })
})

// Trash model, from kwaroran/RisuAI 979dbc9d:
//  - the trash list shows slots with a truthy `trashTime` (GridCatalog.svelte);
//  - untrash sets `slot.trashTime = undefined` on the slot itself (GridCatalog.svelte);
//  - the startup purge in bootstrap.ts uses the same expression as this fork's
//    `isTrashPurgeDue` and only splices the slot: no unit is removed (units go
//    only through the manual "Clean Unused Cold Storage" path);
//  - opening a stub replaces the slot wholesale with the unit's character
//    (changeChar in characters.ts), so the unit's `trashTime` is what survives.

/** Model: whether upstream's trash list shows the slot. */
function upstreamTrashListed(slot: character): boolean {
    return !!slot.trashTime
}

/** Model: upstream's startup purge; it never touches units. */
function upstreamPurge(slots: character[], now: number): character[] {
    return slots.filter((slot) => !(slot.trashTime && slot.trashTime + TRASH_PURGE_AGE_MS < now))
}

/** Model: upstream's untrash. */
function upstreamUntrash(slot: character): void {
    slot.trashTime = undefined
}

describe('compatibility guard (model of upstream): a trashed character this fork archived', () => {
    const TRASHED_AT = 1_700_000_000_000

    function trashed(): character {
        return { ...fullCharacter(), trashTime: TRASHED_AT } as character
    }

    function archive() {
        const source = trashed()
        const stub = buildColdStub(source, 'unit-1', [])
        stub.trashTime = source.trashTime
        const units: Record<string, UpstreamUnit> = { 'unit-1': { character: coldUnitCharacter(source) } }
        return { stub, units }
    }

    test('the trashed stub is listed in upstream\'s trash and its keys name the unit', () => {
        const { stub } = archive()

        expect(upstreamTrashListed(stub)).toBe(true)
        expect(upstreamKeys(stub)).toEqual(['unit-1'])
    })

    test('upstream\'s purge removes the stub after the age and leaves the units as they are', () => {
        const { stub, units } = archive()
        const before = JSON.stringify(units)

        expect(upstreamPurge([stub], TRASHED_AT + TRASH_PURGE_AGE_MS)).toEqual([stub])
        expect(upstreamPurge([stub], TRASHED_AT + TRASH_PURGE_AGE_MS + 1)).toEqual([])
        expect(JSON.stringify(units)).toBe(before)
    })

    test('mutation-checked guard: untrash, then open, gives a character that a later purge keeps', () => {
        // Mutation: a unit that still carries trashTime (writing the source as is) fails this.
        const { stub, units } = archive()

        upstreamUntrash(stub)
        const opened = upstreamOpen(stub, units) as character

        expect(opened.trashTime).toBeUndefined()
        expect(upstreamPurge([opened], TRASHED_AT + 10 * TRASH_PURGE_AGE_MS)).toEqual([opened])
    })

    test('diagnostic: opening without untrashing gives an untrashed character, because the unit carries no trashTime', () => {
        const { stub, units } = archive()

        const opened = upstreamOpen(stub, units) as character

        expect(opened.trashTime).toBeUndefined()
    })
})
