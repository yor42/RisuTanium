/**
 * The group member map `risutanium_members` (chaId -> {name, slot}).
 *
 * Invariants exercised here:
 * - A record is written when a member joins (`addGroupChar`) and at no other
 *   time: members already in the group get none, a removal keeps the record,
 *   a reorder or the removal of others never changes a slot.
 * - A slot is the lowest free one of 0..7; with all taken, the one held by the
 *   fewest current members; a rejoin keeps its previous slot unless a current
 *   member holds it. The joining id's own old record never counts as held.
 * - A member name is the live character's, else the group's record, else
 *   "Unknown Character". Only own keys of a well-formed map resolve; a
 *   malformed map reads as empty, is never overwritten and takes no record.
 * - For a non-group owner `memberName` equals today's `findCharacterbyId`.
 *
 * The join tests run the real `addGroupChar` and `rmCharFromGroup` over the
 * harness of `groupAddColdMember.test.ts`; the rest are pure helper cases.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, character, groupChat } from '../../storage/database.svelte'

const alertErrorMock = vi.hoisted(() => vi.fn())
const alertConfirmMock = vi.hoisted(() => vi.fn())
const alertSelectCharMock = vi.hoisted(() => vi.fn())

vi.mock(import('../../stores.svelte'), () => {
    const state = { db: {} as unknown as Database }
    return {
        DBState: state,
        selectedCharID: writable(-1),
        CharEmotion: writable({}),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../storage/database.svelte'), async () => {
    const { DBState } = await import('../../stores.svelte')
    return {
        getDatabase: vi.fn(() => DBState.db),
        setDatabase: vi.fn((db: Database) => { DBState.db = db }),
    } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../../util'), async () => {
    const { DBState } = await import('../../stores.svelte')
    return {
        findCharacterbyId: (id: string) => {
            for (const candidate of DBState.db.characters) {
                if (candidate.type !== 'group' && candidate.chaId === id) {
                    return candidate
                }
            }
            return { name: 'Unknown Character', firstMessage: '', chaId: id, type: 'character', chats: [] }
        },
    } as unknown as typeof import('../../util')
})

vi.mock(import('../../alert'), () => ({
    alertConfirm: alertConfirmMock,
    alertError: alertErrorMock,
    alertNormal: vi.fn(),
    alertSelectChar: alertSelectCharMock,
    alertToast: vi.fn(),
    alertMd: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../coldstorage.svelte'), () => ({
    readColdStorageItem: vi.fn(),
    getColdStorageItem: async () => null,
}) as unknown as typeof import('../coldstorage.svelte'))

vi.mock(import('../../characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('../../characters'))

vi.mock(import('../index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('../index.svelte'))

import { addGroupChar, rmCharFromGroup } from '../group'
import { joinRecord, liveMember, memberName, memberRecord, remapMemberKeys } from '../groupMembers'
import { DBState, selectedCharID } from '../../stores.svelte'

type Slot = Database['characters'][number]

function member(chaId: string, name: string = `${chaId} name`): character {
    return {
        type: 'character',
        name,
        image: '',
        chaId,
        chatPage: 0,
        firstMessage: '',
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: 'Chat 1', localLore: [] }],
    } as unknown as character
}

function groupOf(members: string[], extra: Record<string, unknown> = {}): groupChat {
    return {
        type: 'group',
        name: 'the group',
        chaId: 'group-1',
        chatPage: 0,
        characters: [...members],
        characterTalks: members.map(() => 1),
        characterActive: members.map(() => true),
        chats: [{ id: 'chat', message: [], note: '', name: 'Chat', localLore: [] }],
        ...extra,
    } as unknown as groupChat
}

/** The group, selected, in slot 0 of a library holding the given characters. */
function install(group: groupChat, library: character[]): groupChat {
    DBState.db = { characters: [group as unknown as Slot, ...(library as unknown as Slot[])] } as unknown as Database
    selectedCharID.set(0)
    return DBState.db.characters[0] as unknown as groupChat
}

async function join(id: string): Promise<void> {
    alertSelectCharMock.mockResolvedValue(id)
    alertConfirmMock.mockResolvedValue(false)
    await addGroupChar()
}

function recordsOf(group: groupChat): Record<string, { name: string, slot: number }> {
    return group.risutanium_members as Record<string, { name: string, slot: number }>
}

function slotsOf(group: groupChat): Record<string, number> {
    return Object.fromEntries(Object.entries(recordsOf(group)).map(([id, record]) => [id, record.slot]))
}

beforeEach(() => {
    alertErrorMock.mockReset()
    alertConfirmMock.mockReset()
    alertSelectCharMock.mockReset()
})

describe('addGroupChar writes the join record', () => {
    test('T1: a join writes the live name and the lowest free slot, and gives no other member a record', async () => {
        const group = install(groupOf(['x']), [member('x', 'Xavier'), member('a', 'Alice')])

        await join('a')

        expect(group.characters).toEqual(['x', 'a'])
        expect(group.risutanium_members).toEqual({ a: { name: 'Alice', slot: 0 } })
    })

    test('T2: a freed slot is reused, a reorder changes no slot, and with 8 slots held the fewest-held slot is taken', async () => {
        const library = ['a', 'b', 'c', 'd', 'e'].map((id) => member(id, id.toUpperCase()))
        const group = install(groupOf([]), library)
        for (const id of ['a', 'b', 'c']) {
            await join(id)
        }
        expect(slotsOf(group)).toEqual({ a: 0, b: 1, c: 2 })

        rmCharFromGroup(group.characters.indexOf('b'))
        await join('d')
        expect(slotsOf(group)).toEqual({ a: 0, b: 1, c: 2, d: 1 })

        group.characters.reverse()
        await join('e')
        expect(slotsOf(group)).toEqual({ a: 0, b: 1, c: 2, d: 1, e: 3 })
    })

    test('T2: the 9th member takes slot 0 and the 10th takes slot 1, because slot 0 is then held twice', async () => {
        const ids = Array.from({ length: 10 }, (_, i) => `m${i}`)
        const group = install(groupOf([]), ids.map((id) => member(id)))
        for (const id of ids) {
            await join(id)
        }

        const slots = slotsOf(group)
        expect(ids.slice(0, 8).map((id) => slots[id])).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
        expect(slots.m8).toBe(0)
        expect(slots.m9).toBe(1)
    })

    test('T3: a removal keeps the record as a tombstone that holds no slot, and a rejoin writes the live name and keeps its previous slot', async () => {
        const library = ['a', 'b', 'c', 'd'].map((id) => member(id, id.toUpperCase()))
        const group = install(groupOf([]), library)
        for (const id of ['a', 'b', 'c', 'd']) {
            await join(id)
        }

        rmCharFromGroup(group.characters.indexOf('a'))
        rmCharFromGroup(group.characters.indexOf('b'))
        expect(recordsOf(group).b).toEqual({ name: 'B', slot: 1 })

        ;(library[1] as character).name = 'Bea'
        await join('b')

        expect(recordsOf(group).b).toEqual({ name: 'Bea', slot: 1 })
    })

    test('T3: a rejoin whose previous slot a current member now holds takes the first free slot', async () => {
        const library = ['a', 'b', 'c', 'd'].map((id) => member(id))
        const group = install(groupOf([]), library)
        for (const id of ['a', 'b', 'c']) {
            await join(id)
        }
        rmCharFromGroup(group.characters.indexOf('b'))
        await join('d')
        expect(recordsOf(group).d.slot).toBe(1)

        await join('b')

        expect(recordsOf(group).b.slot).toBe(3)
    })

    test('T4: a join into an old group writes only the joiner, with no backfill for its members', async () => {
        const group = install(groupOf(['x', 'y']), [member('x'), member('y'), member('z', 'Zed')])

        await join('z')

        expect(group.risutanium_members).toEqual({ z: { name: 'Zed', slot: 0 } })
    })
})

describe('memberName and memberRecord', () => {
    const record = { name: 'Alice', slot: 0 }

    test('the live character beats the record, and the record beats Unknown Character', () => {
        const group = groupOf(['a', 'gone'], { risutanium_members: { a: record, gone: { name: 'Gone', slot: 1 } } })
        const characters = [group as unknown as character, member('a', 'Alicia')]

        expect(memberName(characters, group, 'a')).toBe('Alicia')
        expect(memberName(characters, group, 'gone')).toBe('Gone')
        expect(memberName(characters, group, 'nobody')).toBe('Unknown Character')
    })

    test('T18: an own map does not resolve inherited ids, including prototype names and an inherited valid record', () => {
        const group = groupOf(['constructor', 'm-x'], { risutanium_members: {} })
        const characters = [group as unknown as character]
        Object.defineProperty(Object.prototype, 'm-x', { value: { name: 'Inherited', slot: 0 }, configurable: true })
        try {
            expect(memberName(characters, group, 'constructor')).toBe('Unknown Character')
            expect(memberName(characters, group, 'm-x')).toBe('Unknown Character')
            expect(memberRecord(group, 'm-x')).toBeNull()
        } finally {
            delete (Object.prototype as unknown as Record<string, unknown>)['m-x']
        }
    })

    test.each([
        ['an array map', [record]],
        ['a null map', null],
        ['a string map', 'text'],
        ['a record with a string slot', { a: { name: 'Alice', slot: '0' } }],
        ['a record with slot 8', { a: { name: 'Alice', slot: 8 } }],
        ['a record with a negative slot', { a: { name: 'Alice', slot: -1 } }],
        ['a record with a fractional slot', { a: { name: 'Alice', slot: 0.5 } }],
        ['a record with a number name', { a: { name: 7, slot: 0 } }],
        ['a record that is not an object', { a: 'Alice' }],
    ])('T19: %s reads as no record and throws nothing', (_label, map) => {
        const group = groupOf(['a'], { risutanium_members: map })

        expect(memberRecord(group, 'a')).toBeNull()
        expect(memberName([group as unknown as character], group, 'a')).toBe('Unknown Character')
    })

    test('T19: a join into a malformed map writes no record and leaves the map as it was', () => {
        for (const map of [[], null, 'text', 7]) {
            const group = groupOf(['a'], { risutanium_members: map })

            joinRecord(group, 'a', 'Alice')

            expect(group.risutanium_members).toBe(map)
        }
    })

    test('a join with an unusable id writes nothing', () => {
        const group = groupOf(['root'])

        joinRecord(group, 'root', 'Root')
        joinRecord(group, '__proto__', 'Proto')
        joinRecord(group, '', 'Empty')

        expect(Object.hasOwn(group, 'risutanium_members')).toBe(false)
    })

    test('E3: the joining id\'s own old record is left out when held slots are counted', () => {
        const group = groupOf(['a', 'b'], { risutanium_members: { a: { name: 'A', slot: 0 }, b: { name: 'B', slot: 1 } } })

        joinRecord(group, 'b', 'B again')

        expect(recordsOf(group).b).toEqual({ name: 'B again', slot: 1 })
    })

    test('T25: reading never creates the key', () => {
        const group = groupOf(['a'])

        memberName([group as unknown as character], group, 'a')
        memberRecord(group, 'a')

        expect(Object.hasOwn(group, 'risutanium_members')).toBe(false)
    })

    test.each([
        ['a character', false],
        ['a character lacking a chaId', true],
    ])('T29: with a non-group owner or an undefined id, memberName equals findCharacterbyId (%s)', (_label, lacksId) => {
        const nameless = member('q', 'Nameless') as unknown as Record<string, unknown>
        if (lacksId) {
            delete nameless.chaId
        }
        const characters: (character | groupChat)[] = [nameless as unknown as character, member('live', 'Live')]
        const owner = member('o')
        // findCharacterbyId as it is today: the first non-group character whose chaId equals the id.
        const today = (id: string | undefined) => {
            for (const char of characters) {
                if (char.type !== 'group' && char.chaId === id) {
                    return char.name
                }
            }
            return 'Unknown Character'
        }

        for (const id of ['x', 'live', undefined]) {
            expect(memberName(characters, owner, id as string)).toBe(today(id))
            expect(memberName(characters, undefined, id as string)).toBe(today(id))
        }
    })
})

describe('remapMemberKeys', () => {
    test('returns the same object when no key changes and a new one when a key does', () => {
        const map = { a: { name: 'A', slot: 0 }, b: { name: 'B', slot: 1 } }

        expect(remapMemberKeys(map, new Map([['zzz', 'yyy']]))).toBe(map)
        const next = remapMemberKeys(map, new Map([['a', 'n1']])) as Record<string, unknown>
        expect(next).not.toBe(map)
        expect(Object.keys(next)).toEqual(['n1', 'b'])
        expect(Object.keys(map)).toEqual(['a', 'b'])
    })

    test('a map that is not a plain object is returned as it is', () => {
        const list = [1]

        expect(remapMemberKeys(list, new Map([['0', 'x']]))).toBe(list)
        expect(remapMemberKeys(undefined, new Map())).toBeUndefined()
    })
})

afterEach(() => {
    delete (Object.prototype as unknown as Record<string, unknown>)['m-x']
})
