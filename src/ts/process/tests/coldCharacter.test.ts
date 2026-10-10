/**
 * The archived-character placeholder (the "stub") and the restore-time trash
 * merge, in `../coldCharacter`.
 *
 * `buildColdStub` writes the placeholder that stands in for a character whose
 * full data lives in a cold-storage unit. Beyond the pointer fields the save
 * and clean-up code read (`coldstorage`, `coldStoragedChats`, the one dummy
 * chat), it carries what the character lists show: the real `type`, the name,
 * image, `lastInteraction`, `trashTime`, the chat count and the description
 * the grid displays. It carries no message content.
 *
 * The marker that tells a stub built by this fork from one made upstream and
 * the field holding the chat count are not named here, except by the
 * `isLegacyStub` tests, which set `coldVersion` on the stubs they classify, and
 * the `enrichLegacyStub` tests, which assert the marker an enriched stub
 * carries: the other tests read them only through `coldStubChatCount` and
 * `applyStubStateOnRestore`, and build an upstream-shaped stub by hand.
 *
 * Everything here is pure except the load-time guard at the end, which
 * mocks the modules the restore side reaches so it can watch which
 * application modules the new module loads.
 */
import { describe, test, expect, vi } from 'vitest'
import type { character, groupChat } from '../../storage/database.svelte'

const loadedModules = vi.hoisted(() => [] as string[])

vi.mock(import('../../stores.svelte'), () => {
    loadedModules.push('stores.svelte')
    return { DBState: { db: {} } } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../coldstorage.svelte'), () => {
    loadedModules.push('coldstorage.svelte')
    return { readColdStorageItem: vi.fn() } as unknown as typeof import('../coldstorage.svelte')
})

vi.mock(import('../../alert'), () => {
    loadedModules.push('alert')
    return { alertError: vi.fn() } as unknown as typeof import('../../alert')
})

vi.mock(import('../../characters'), () => {
    loadedModules.push('characters')
    return {} as unknown as typeof import('../../characters')
})

vi.mock(import('../index.svelte'), () => {
    loadedModules.push('index.svelte')
    return {} as unknown as typeof import('../index.svelte')
})

import {
    applyStubStateOnRestore,
    buildColdStub,
    coldStubChatCount,
    enrichLegacyStub,
    isArchivableCharacter,
    isLegacyStub,
} from '../coldCharacter'
import { listColdDataKeysFromDb } from '../coldstorageData'
import { language } from '../../../lang'

//#region fixtures

const SECRET_DESC = 'DESCRIPTION-BODY-MARKER'
const SECRET_FIRST_MESSAGE = 'FIRST-MESSAGE-MARKER'
const SECRET_PERSONALITY = 'PERSONALITY-MARKER'
const SECRET_CHAT = 'CHAT-BODY-MARKER'

function makeChats(count: number): character['chats'] {
    const chats: character['chats'] = []
    for (let i = 0; i < count; i++) {
        chats.push({
            id: `chat-${i}`,
            name: `Chat ${i}`,
            note: '',
            localLore: [],
            message: [{ role: 'user', data: `${SECRET_CHAT}-${i}`, time: 1 + i }],
        } as unknown as character['chats'][number])
    }
    return chats
}

function fullCharacter(extra: Record<string, unknown> = {}): character {
    return {
        type: 'character',
        name: 'Alice',
        image: 'assets/alice.png',
        chaId: 'cha-alice',
        chatPage: 2,
        firstMsgIndex: 3,
        lastInteraction: 1_700_000_000_000,
        creatorNotes: 'A short note',
        desc: SECRET_DESC,
        firstMessage: SECRET_FIRST_MESSAGE,
        personality: SECRET_PERSONALITY,
        chats: makeChats(7),
        ...extra,
    } as unknown as character
}

function fullGroup(extra: Record<string, unknown> = {}): groupChat {
    return {
        type: 'group',
        name: 'The Group',
        image: '',
        chaId: 'cha-group',
        chatPage: 1,
        firstMsgIndex: -1,
        lastInteraction: 1_700_000_000_500,
        characters: ['member-1', 'member-2'],
        chats: makeChats(3),
        ...extra,
    } as unknown as groupChat
}

/** An archived character in the shape the upstream application writes. */
function upstreamStub(chaId: string, key: string, extra: Record<string, unknown> = {}): character {
    return {
        type: 'character',
        name: chaId,
        image: '',
        chaId,
        chats: [{ message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
        chatPage: 0,
        firstMsgIndex: 0,
        coldstorage: key,
        coldStoragedChats: [],
        ...extra,
    } as unknown as character
}

const KNOWN_STUB_KEYS = new Set([
    'type', 'name', 'image', 'chaId', 'lastInteraction', 'trashTime', 'characters', 'creatorNotes',
    'coldstorage', 'coldStoragedChats', 'chats', 'chatPage', 'firstMsgIndex',
])

//#endregion

describe('buildColdStub -- what the stub carries', () => {
    test('a group stub keeps type group and a copy of its member list', () => {
        const group = fullGroup()

        const stub = buildColdStub(group, 'unit-g', []) as unknown as groupChat

        expect(stub.type).toBe('group')
        expect(stub.characters).toEqual(['member-1', 'member-2'])
        expect(stub.characters).not.toBe(group.characters)
    })

    test('a group stub carries the common list fields and its real chat count', () => {
        const stub = buildColdStub(fullGroup({ trashTime: 42 }), 'unit-g', ['chat-key'])

        expect(stub.name).toBe('The Group')
        expect(stub.chaId).toBe('cha-group')
        expect(stub.lastInteraction).toBe(1_700_000_000_500)
        expect(stub.trashTime).toBe(42)
        expect(coldStubChatCount(stub)).toBe(3)
        expect(stub.coldstorage).toBe('unit-g')
        expect(stub.coldStoragedChats).toEqual(['chat-key'])
    })

    test('a character stub carries the list fields, the real chat count and the pointer fields', () => {
        const source = fullCharacter({ trashTime: 1_234 })

        const stub = buildColdStub(source, 'unit-1', ['chat-key-1', 'chat-key-2'])

        expect(stub.type).toBe('character')
        expect(stub.name).toBe('Alice')
        expect(stub.image).toBe('assets/alice.png')
        expect(stub.chaId).toBe('cha-alice')
        expect(stub.lastInteraction).toBe(1_700_000_000_000)
        expect(stub.trashTime).toBe(1_234)
        expect(coldStubChatCount(stub)).toBe(7)
        expect(stub.coldstorage).toBe('unit-1')
        expect(stub.coldStoragedChats).toEqual(['chat-key-1', 'chat-key-2'])
        expect(stub.chatPage).toBe(0)
        expect(stub.firstMsgIndex).toBe(0)
        expect(stub.chats).toHaveLength(1)
        expect(stub.chats[0].message[0].data).toBe('')
    })

    // What the grid then displays for these descriptions is asserted through
    // the rendered list in GridCatalog.coldStub.svelte.test.ts.
    test('a plain description is carried in creatorNotes', () => {
        const stub = buildColdStub(fullCharacter({ creatorNotes: 'A short note' }), 'unit-1', [])

        expect(stub.creatorNotes).toBe('A short note')
    })

    test('a multilingual description keeps the en section text', () => {
        const notes = '# `ko`\n한국어 설명\n# `en`\nEnglish description'

        const stub = buildColdStub(fullCharacter({ creatorNotes: notes }), 'unit-1', [])

        expect(stub.creatorNotes).toBeTypeOf('string')
        expect(stub.creatorNotes).toContain('English description')
    })

    test('a very long description is cut to a bounded length that starts like the full one', () => {
        const long = 'abcdefghij'.repeat(2_000)

        const stub = buildColdStub(fullCharacter({ creatorNotes: long }), 'unit-1', [])

        expect(stub.creatorNotes).toBeTruthy()
        expect(stub.creatorNotes.length).toBeLessThan(1_000)
        expect(long.startsWith(stub.creatorNotes)).toBe(true)
    })

    test('a long text before the en section does not push the en section text out of the stub', () => {
        const notes = `${'k'.repeat(5_000)}\n# \`en\`\nEnglish description`

        const stub = buildColdStub(fullCharacter({ creatorNotes: notes }), 'unit-1', [])

        expect(stub.creatorNotes).toBeTypeOf('string')
        expect(stub.creatorNotes).toContain('English description')
    })

    test('a very long en section is cut to a bounded length', () => {
        const notes = `# \`ko\`\n${'k'.repeat(50)}\n# \`en\`\n${'e'.repeat(20_000)}`

        const stub = buildColdStub(fullCharacter({ creatorNotes: notes }), 'unit-1', [])

        expect(stub.creatorNotes).toBeTypeOf('string')
        expect(stub.creatorNotes).toContain('eeee')
        expect(stub.creatorNotes.length).toBeLessThan(1_000)
    })

    test('a group without a member list gives a group stub instead of throwing', () => {
        const group = fullGroup()
        delete (group as { characters?: string[] }).characters

        const stub = buildColdStub(group, 'unit-g', []) as groupChat

        expect(stub.type).toBe('group')
        expect(stub.coldstorage).toBe('unit-g')
    })

    test.each([
        ['a number', 42],
        ['an object', { en: 'not a string' }],
    ])('a creatorNotes that is %s gives a stub with a string description instead of throwing', (_label, notes) => {
        const stub = buildColdStub(fullCharacter({ creatorNotes: notes }), 'unit-1', [])

        expect(typeof stub.creatorNotes).toBe('string')
        expect(stub.coldstorage).toBe('unit-1')
    })

    test('guard: a creatorNotes that is undefined gives a stub with a string description', () => {
        const stub = buildColdStub(fullCharacter({ creatorNotes: undefined }), 'unit-1', [])

        expect(typeof stub.creatorNotes).toBe('string')
    })

    test('guard: a character without trashTime gives a stub with no trashTime key after JSON.stringify', () => {
        const stub = buildColdStub(fullCharacter(), 'unit-1', [])

        const roundTripped = JSON.parse(JSON.stringify(stub)) as Record<string, unknown>

        expect('trashTime' in roundTripped).toBe(false)
    })

    test('guard: the source character is not modified and the stub is a new object', () => {
        const source = fullCharacter({ trashTime: 9 })
        const before = JSON.stringify(source)

        const stub = buildColdStub(source, 'unit-1', ['k'])

        expect(stub).not.toBe(source)
        expect(JSON.stringify(source)).toBe(before)
        expect(source.chats).toHaveLength(7)
    })

    test('guard: the stub carries no message content and at most a marker and a chat count beyond the known fields', () => {
        const stub = buildColdStub(fullCharacter(), 'unit-1', ['k'])

        const text = JSON.stringify(stub)
        expect(text).not.toContain(SECRET_DESC)
        expect(text).not.toContain(SECRET_FIRST_MESSAGE)
        expect(text).not.toContain(SECRET_PERSONALITY)
        expect(text).not.toContain(SECRET_CHAT)
        const extraKeys = Object.keys(stub).filter((key) => !KNOWN_STUB_KEYS.has(key))
        expect(extraKeys.length).toBeLessThanOrEqual(2)
        for (const key of extraKeys) {
            expect(typeof (stub as unknown as Record<string, unknown>)[key]).toBe('number')
        }
        expect('characters' in stub).toBe(false)
    })

    test('guard: a stub with a group source carries no message content either', () => {
        const stub = buildColdStub(fullGroup(), 'unit-g', [])

        expect(JSON.stringify(stub)).not.toContain(SECRET_CHAT)
        const extraKeys = Object.keys(stub).filter((key) => !KNOWN_STUB_KEYS.has(key))
        expect(extraKeys.length).toBeLessThanOrEqual(2)
    })

    test('guard: the pointer fields still list exactly the unit key and the chat unit keys', () => {
        const stub = buildColdStub(fullCharacter(), 'unit-1', ['chat-key-1', 'chat-key-2'])

        const keys = listColdDataKeysFromDb({ characters: [stub], pluginCustomStorage: {} } as never)

        expect(keys).toEqual(['unit-1', 'chat-key-1', 'chat-key-2'])
    })
})

describe('coldStubChatCount', () => {
    test('a stub built from a character with several chats reports that count', () => {
        const stub = buildColdStub(fullCharacter({ chats: makeChats(12) }), 'unit-1', [])

        expect(coldStubChatCount(stub)).toBe(12)
    })

    test('guard: a full character reports its chats.length', () => {
        expect(coldStubChatCount(fullCharacter({ chats: makeChats(5) }))).toBe(5)
    })

    test('guard: an upstream-shaped stub reports its dummy chat array length', () => {
        expect(coldStubChatCount(upstreamStub('cha-up', 'unit-up'))).toBe(1)
    })
})

describe('isArchivableCharacter', () => {
    test('a trashed character is not archivable', () => {
        expect(isArchivableCharacter(fullCharacter({ trashTime: 1_000 }))).toBe(false)
    })

    test('a trashed group is not archivable', () => {
        expect(isArchivableCharacter(fullGroup({ trashTime: 1_000 }))).toBe(false)
    })

    test('guard: a full untrashed character is archivable', () => {
        expect(isArchivableCharacter(fullCharacter())).toBe(true)
    })

    test('guard: a character that is already a stub is not archivable', () => {
        expect(isArchivableCharacter(buildColdStub(fullCharacter(), 'unit-1', []))).toBe(false)
        expect(isArchivableCharacter(upstreamStub('cha-up', 'unit-up'))).toBe(false)
    })
})

describe('isLegacyStub -- the stubs the upstream application wrote', () => {
    test('an upstream stub is a legacy stub', () => {
        expect(isLegacyStub(upstreamStub('cha-up', 'unit-up'))).toBe(true)
    })

    test('a stub whose coldVersion is below 2 is a legacy stub', () => {
        expect(isLegacyStub(upstreamStub('cha-up', 'unit-up', { coldVersion: 1 }))).toBe(true)
    })

    test.each([
        ['a stub built here', () => buildColdStub(fullCharacter(), 'unit-1', [])],
        ['a stub with a later coldVersion', () => upstreamStub('cha-up', 'unit-up', { coldVersion: 3 })],
    ])('%s is not a legacy stub', (_label, make) => {
        expect(isLegacyStub(make())).toBe(false)
    })

    test.each([
        ['a full character', () => fullCharacter()],
        ['a slot whose coldstorage is empty', () => upstreamStub('cha-up', 'unit-up', { coldstorage: '' })],
        ['a slot whose coldstorage is not a string', () => upstreamStub('cha-up', 'unit-up', { coldstorage: 5 })],
        ['a stub whose chaId is empty', () => upstreamStub('', 'unit-up')],
        ['a stub whose chaId is not a string', () => upstreamStub('cha-up', 'unit-up', { chaId: 7 })],
        ['a stub with no chaId', () => upstreamStub('cha-up', 'unit-up', { chaId: undefined })],
        ['a stub whose chaId is a hidden-character id', () => upstreamStub('§temp', 'unit-up')],
        ['null', () => null],
        ['undefined', () => undefined],
        ['a string', () => 'text'],
        ['a number', () => 42],
    ])('%s is not a legacy stub', (_label, make) => {
        expect(isLegacyStub(make())).toBe(false)
    })
})

describe('enrichLegacyStub -- what an upstream stub takes from its unit', () => {
    function legacy(extra: Record<string, unknown> = {}): character {
        return upstreamStub('cha-up', 'unit-up', { name: 'Stub Name', image: 'stub.png', coldStoragedChats: ['stub-chat-key'], ...extra })
    }

    function jsonOf(value: unknown): Record<string, unknown> {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
    }

    function deepFreeze<T>(value: T): T {
        if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
            Object.freeze(value)
            for (const inner of Object.values(value)) {
                deepFreeze(inner)
            }
        }
        return value
    }

    test('a group unit gives a group stub with a copy of its member list, its description, its last interaction and its chat count', () => {
        const unit = fullGroup({ chaId: 'cha-up', creatorNotes: 'Group notes', lastInteraction: 123 })

        const result = enrichLegacyStub(legacy(), unit) as unknown as groupChat

        expect(result.type).toBe('group')
        expect(result.characters).toEqual(['member-1', 'member-2'])
        expect(result.characters).not.toBe(unit.characters)
        expect(result.creatorNotes).toBe('Group notes')
        expect(result.lastInteraction).toBe(123)
        expect(result.coldChatCount).toBe(3)
        expect(result.coldVersion).toBe(2)
        expect(coldStubChatCount(result)).toBe(3)
    })

    test('a character unit gives a character stub with no member list', () => {
        const unit = fullCharacter({ chaId: 'cha-up', creatorNotes: 'Character notes' })

        const result = enrichLegacyStub(legacy(), unit)

        expect(result.type).toBe('character')
        expect(result).not.toHaveProperty('characters')
        expect(result.creatorNotes).toBe('Character notes')
        expect(result.lastInteraction).toBe(1_700_000_000_000)
        expect(result.coldChatCount).toBe(7)
        expect(coldStubChatCount(result)).toBe(7)
        expect(result.coldVersion).toBe(2)
    })

    test('the stub keeps its own name, image, chaId, unit key, chat keys, page, first-message index and placeholder chat, whatever the unit holds', () => {
        const stub = legacy({ chatPage: 0, firstMsgIndex: 0 })
        const unit = fullCharacter({ chaId: 'cha-up', name: 'Name In Unit', image: 'unit.png', chatPage: 2, firstMsgIndex: 3, coldstorage: 'other-unit', coldStoragedChats: ['unit-chat-key'] })

        const result = enrichLegacyStub(stub, unit)

        expect(result.name).toBe('Stub Name')
        expect(result.image).toBe('stub.png')
        expect(result.chaId).toBe('cha-up')
        expect(result.coldstorage).toBe('unit-up')
        expect(result.coldStoragedChats).toEqual(['stub-chat-key'])
        expect(result.chatPage).toBe(0)
        expect(result.firstMsgIndex).toBe(0)
        expect(result.chats).toEqual(stub.chats)
    })

    test('the placeholder chat the stub holds, with the id the boot gave it, is the one the result holds', () => {
        const stub = legacy()
        stub.chats[0].id = 'id-given-by-the-boot'

        const result = enrichLegacyStub(stub, fullCharacter({ chaId: 'cha-up' }))

        expect(result.chats).toHaveLength(1)
        expect(result.chats[0].id).toBe('id-given-by-the-boot')
        expect(result.chats[0].message[0].data).toBe('')
    })

    describe('trash state', () => {
        // The startup purge reads only the installed stub's `trashTime`. The unit of a character that was in the
        // trash before it was archived carries an old `trashTime` its upstream stub never had.
        test('a stub with no trashTime stays without one although the unit holds an old one', () => {
            const result = enrichLegacyStub(legacy(), fullCharacter({ chaId: 'cha-up', trashTime: 1_000 }))

            expect(result).not.toHaveProperty('trashTime')
            expect('trashTime' in jsonOf(result)).toBe(false)
            expect(result.coldVersion).toBe(2)
        })

        test.each([
            ['no trashTime', undefined],
            ['another trashTime', 99],
        ])('a stub with a trashTime keeps it when the unit holds %s', (_label, unitTrash) => {
            const unit = fullCharacter({ chaId: 'cha-up', trashTime: unitTrash })

            const result = enrichLegacyStub(legacy({ trashTime: 5_000 }), unit)

            expect(result.trashTime).toBe(5_000)
            expect(result.coldVersion).toBe(2)
        })

        test('a stub and a unit that are both untrashed give a stub with no trashTime key after JSON.stringify', () => {
            const result = enrichLegacyStub(legacy(), fullCharacter({ chaId: 'cha-up' }))

            expect('trashTime' in jsonOf(result)).toBe(false)
            expect(result.coldVersion).toBe(2)
        })
    })

    describe('last interaction', () => {
        test.each([
            ['a string', 'yesterday'],
            ['null', null],
            ['undefined', undefined],
            ['an object', { at: 1 }],
        ])('a unit whose lastInteraction is %s gives a stub with no lastInteraction', (_label, value) => {
            const result = enrichLegacyStub(legacy(), fullCharacter({ chaId: 'cha-up', lastInteraction: value }))

            expect(result).not.toHaveProperty('lastInteraction')
            expect(result.coldVersion).toBe(2)
        })

        test('a unit whose lastInteraction is zero gives a stub with a lastInteraction of zero', () => {
            const result = enrichLegacyStub(legacy(), fullCharacter({ chaId: 'cha-up', lastInteraction: 0 }))

            expect(result.lastInteraction).toBe(0)
        })
    })

    describe('description', () => {
        const NOTES: [string, unknown][] = [
            ['a plain description', 'A short note'],
            ['a multilingual description', '# `ko`\n한국어 설명\n# `en`\nEnglish description'],
            ['a long text before the en section', `${'k'.repeat(5_000)}\n# \`en\`\nEnglish description`],
            ['a very long description', 'abcdefghij'.repeat(2_000)],
            ['a description cut inside a surrogate pair', `${'a'.repeat(499)}\u{1F600}${'b'.repeat(50)}`],
            ['no description', undefined],
        ]

        test.each(NOTES)('%s is carried as buildColdStub carries it', (_label, notes) => {
            const unit = fullCharacter({ chaId: 'cha-up', creatorNotes: notes })

            const result = enrichLegacyStub(legacy(), unit)

            expect(result.creatorNotes).toBe(buildColdStub(unit, 'unit-up', []).creatorNotes)
        })

        test('a very long description is cut to a bounded length that starts like the full one', () => {
            const long = 'abcdefghij'.repeat(2_000)

            const result = enrichLegacyStub(legacy(), fullCharacter({ chaId: 'cha-up', creatorNotes: long }))

            expect(result.creatorNotes.length).toBe(500)
            expect(long.startsWith(result.creatorNotes)).toBe(true)
        })

        test.each([
            ['a number', 42],
            ['an object', { en: 'not a string' }],
            ['a list', ['text']],
        ])('a description that is %s gives an empty description', (_label, notes) => {
            const result = enrichLegacyStub(legacy(), fullCharacter({ chaId: 'cha-up', creatorNotes: notes }))

            expect(result.creatorNotes).toBe('')
            expect(result.coldVersion).toBe(2)
        })
    })

    test('a unit whose chats are not a list gives a chat count of zero', () => {
        const result = enrichLegacyStub(legacy(), fullCharacter({ chaId: 'cha-up', chats: 'garbled' }))

        expect(result.coldChatCount).toBe(0)
        expect(result.coldVersion).toBe(2)
    })

    test('a group unit with no member list gives a group stub with an empty one', () => {
        const unit = fullGroup({ chaId: 'cha-up' })
        delete (unit as { characters?: string[] }).characters

        const result = enrichLegacyStub(legacy(), unit) as unknown as groupChat

        expect(result.type).toBe('group')
        expect(result.characters).toEqual([])
    })

    test('a unit with no type gives a character stub', () => {
        const unit = fullCharacter({ chaId: 'cha-up', type: undefined })

        const result = enrichLegacyStub(legacy(), unit)

        expect(result.type).toBe('character')
    })

    test('the result is not a legacy stub, and carries no message content of the unit', () => {
        const result = enrichLegacyStub(legacy(), fullCharacter({ chaId: 'cha-up' }))

        expect(isLegacyStub(result)).toBe(false)
        const text = JSON.stringify(result)
        for (const secret of [SECRET_DESC, SECRET_FIRST_MESSAGE, SECRET_PERSONALITY, SECRET_CHAT]) {
            expect(text).not.toContain(secret)
        }
    })

    test('the result lists the same unit keys as the stub did', () => {
        const stub = legacy({ coldStoragedChats: ['chat-key-1', 'chat-key-2'] })

        const result = enrichLegacyStub(stub, fullCharacter({ chaId: 'cha-up' }))

        expect(listColdDataKeysFromDb({ characters: [result], pluginCustomStorage: {} } as never)).toEqual(['unit-up', 'chat-key-1', 'chat-key-2'])
    })

    test('neither the stub nor the unit is modified, and the result is a new object', () => {
        const stub = deepFreeze(legacy({ trashTime: 5_000 }))
        const unit = deepFreeze(fullGroup({ chaId: 'cha-up', trashTime: 99 }))
        const stubBefore = JSON.stringify(stub)
        const unitBefore = JSON.stringify(unit)

        const result = enrichLegacyStub(stub, unit)

        expect(result).not.toBe(stub)
        expect(JSON.stringify(stub)).toBe(stubBefore)
        expect(JSON.stringify(unit)).toBe(unitBefore)
    })
})

describe('applyStubStateOnRestore -- the restored character\'s trash state and lastInteraction', () => {
    function blob(extra: Record<string, unknown> = {}): character {
        return fullCharacter({ chaId: 'cha-alice', ...extra })
    }

    test('a stub built here that was trashed after archiving gives a trashed restored character', () => {
        const stub = buildColdStub(fullCharacter(), 'unit-1', [])
        stub.trashTime = 5_000

        const result = applyStubStateOnRestore(stub, blob())

        expect(result.trashTime).toBe(5_000)
    })

    test('a stub built here that was un-trashed after archiving gives a restored character that is not trashed', () => {
        const stub = buildColdStub(fullCharacter({ trashTime: 4_000 }), 'unit-1', [])
        stub.trashTime = undefined

        const result = applyStubStateOnRestore(stub, blob({ trashTime: 4_000 }))

        expect(result.trashTime).toBeUndefined()
    })

    test('a stub built here from an untrashed character never trashes the restored one', () => {
        const stub = buildColdStub(fullCharacter(), 'unit-1', [])

        const result = applyStubStateOnRestore(stub, blob({ trashTime: 3_000 }))

        expect(result.trashTime).toBeUndefined()
    })

    test('an upstream-shaped stub with a truthy trashTime gives a trashed restored character', () => {
        const stub = upstreamStub('cha-alice', 'unit-up', { trashTime: 6_000 })

        const result = applyStubStateOnRestore(stub, blob())

        expect(result.trashTime).toBe(6_000)
    })

    test('an upstream-shaped stub without trashTime gives a restored character that is not trashed, whatever the unit holds', () => {
        const stub = upstreamStub('cha-alice', 'unit-up')
        const stored = blob({ trashTime: 7_000 })
        const expected = JSON.parse(JSON.stringify(stored)) as Record<string, unknown>
        delete expected.trashTime

        const result = applyStubStateOnRestore(stub, stored)

        expect(result.trashTime).toBeUndefined()
        expect(JSON.parse(JSON.stringify(result))).toEqual(expected)
    })

    test('guard: an upstream-shaped stub without trashTime and a restored character without one stays untrashed', () => {
        const result = applyStubStateOnRestore(upstreamStub('cha-alice', 'unit-up'), blob())

        expect(result.trashTime).toBeUndefined()
    })

    test('guard: the merge changes no field of the restored character other than trashTime', () => {
        const stub = buildColdStub(fullCharacter(), 'unit-1', ['k'])
        stub.trashTime = 8_000
        stub.name = 'name written on the stub'
        stub.lastInteraction = 1
        const stored = blob({ lastInteraction: 555, name: 'stored name', trashTime: undefined })
        const expected = { ...JSON.parse(JSON.stringify(stored)) as Record<string, unknown> }
        delete expected.trashTime

        const result = applyStubStateOnRestore(stub, stored)

        const { trashTime: _trashTime, ...rest } = JSON.parse(JSON.stringify(result)) as Record<string, unknown>
        expect(rest).toEqual(expected)
    })

    // Contract tests: the restored character keeps the newer lastInteraction of
    // stub and unit. Stubs built here copy the unit's value, so the newer-stub
    // cases are only reachable with a stub refreshed after its unit was written.
    test('contract: a stub with a newer lastInteraction gives it to the restored character', () => {
        const stub = buildColdStub(fullCharacter({ lastInteraction: 9_000 }), 'unit-1', [])

        const result = applyStubStateOnRestore(stub, blob({ lastInteraction: 5_000 }))

        expect(result.lastInteraction).toBe(9_000)
    })

    test('contract: a stub with an older lastInteraction leaves the unit\'s value', () => {
        const stub = buildColdStub(fullCharacter({ lastInteraction: 1_000 }), 'unit-1', [])

        const result = applyStubStateOnRestore(stub, blob({ lastInteraction: 5_000 }))

        expect(result.lastInteraction).toBe(5_000)
    })

    test('contract: a unit without a numeric lastInteraction takes the stub\'s number', () => {
        const stub = buildColdStub(fullCharacter({ lastInteraction: 9_000 }), 'unit-1', [])

        expect(applyStubStateOnRestore(stub, blob({ lastInteraction: undefined })).lastInteraction).toBe(9_000)
        expect(applyStubStateOnRestore(stub, blob({ lastInteraction: 'x' })).lastInteraction).toBe(9_000)
    })

    test('contract: a stub value that is not a number leaves the unit\'s value', () => {
        const noValue = buildColdStub(fullCharacter({ lastInteraction: undefined }), 'unit-1', [])
        const oddValue = buildColdStub(fullCharacter({ lastInteraction: undefined }), 'unit-1', [])
        ;(oddValue as unknown as Record<string, unknown>).lastInteraction = '9000'

        expect(applyStubStateOnRestore(noValue, blob({ lastInteraction: 5_000 })).lastInteraction).toBe(5_000)
        expect(applyStubStateOnRestore(oddValue, blob({ lastInteraction: 5_000 })).lastInteraction).toBe(5_000)
        expect(applyStubStateOnRestore(oddValue, blob({ lastInteraction: undefined })).lastInteraction).toBeUndefined()
    })

    test('guard: the restored character carries no stub pointer fields afterwards', () => {
        const stub = buildColdStub(fullCharacter(), 'unit-1', ['k'])

        const result = applyStubStateOnRestore(stub, blob())

        expect(result.coldstorage).toBeUndefined()
        expect(result.coldStoragedChats).toBeUndefined()
        expect(coldStubChatCount(result)).toBe(7)
    })
})

describe('the restore message for an unreadable unit', () => {
    test('is a distinct English message that asks to try again and never says data may be lost', () => {
        const message = language.errors.coldStorageRestoreUnreadable

        expect(typeof message).toBe('string')
        expect(message.length).toBeGreaterThan(0)
        expect(message).not.toBe(language.errors.coldStorageRestoreFailed)
        expect(message).toMatch(/again/i)
        expect(message).not.toMatch(/lost|loss|permanent/i)
    })
})

describe('module placement', () => {
    test('guard: loading the module loads neither characters.ts nor index.svelte.ts', async () => {
        vi.resetModules()
        loadedModules.length = 0

        await import('../coldCharacter')

        expect(loadedModules).not.toContain('characters')
        expect(loadedModules).not.toContain('index.svelte')
    })
})
