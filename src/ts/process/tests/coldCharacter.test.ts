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
 * the field holding the chat count are read only through `coldStubChatCount`
 * and `applyStubStateOnRestore`; the tests build an upstream-shaped stub by
 * hand.
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
    COLD_STUB_CHAT_COUNT_VERSION,
    COLD_STUB_VERSION,
    applyStubStateOnRestore,
    buildColdStub,
    characterCreator,
    coldStubChatCount,
    coldUnitCharacter,
    stubTags,
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
    'coldstorage', 'coldStoragedChats', 'chats', 'chatPage', 'firstMsgIndex', 'tags', 'creator',
])

/** A fork stub as version 2 wrote it: a marker and a chat count, no tags or creator. */
function versionTwoStub(chaId: string, key: string, extra: Record<string, unknown> = {}): character {
    return upstreamStub(chaId, key, { coldVersion: 2, coldChatCount: 7, creatorNotes: 'old note', ...extra })
}

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

describe('buildColdStub -- tags and creator (stub version 3)', () => {
    test('regression reproducer: a character stub carries its tags as a copy, whole and untruncated', () => {
        const longTag = 't'.repeat(5_000)
        const source = fullCharacter({ tags: ['a', 'b', longTag] })

        const stub = buildColdStub(source, 'unit-1', [])

        expect(stub.tags).toEqual(['a', 'b', longTag])
        expect(stub.tags).not.toBe(source.tags)
    })

    test('regression reproducer: only the string tags are carried, and tags that are not a list give an empty list', () => {
        expect(buildColdStub(fullCharacter({ tags: ['a', 3, null, { x: 1 }, 'b'] }), 'unit-1', []).tags).toEqual(['a', 'b'])
        expect(buildColdStub(fullCharacter({ tags: 'a,b' }), 'unit-1', []).tags).toEqual([])
        expect(buildColdStub(fullCharacter({ tags: undefined }), 'unit-1', []).tags).toEqual([])
    })

    test.each([
        ['the edited additionalData.creator wins over the top-level creator', { creator: 'Top', additionalData: { creator: 'Edited' } }, 'Edited'],
        ['an empty additionalData.creator falls back to the top-level creator', { creator: 'Top', additionalData: { creator: '' } }, 'Top'],
        ['an additionalData without a creator falls back to the top-level creator', { creator: 'Top', additionalData: {} }, 'Top'],
        ['a non-string additionalData.creator falls back to the top-level creator', { creator: 'Top', additionalData: { creator: 5 } }, 'Top'],
        ['a character with neither gives an empty creator', {}, ''],
        ['a non-string top-level creator gives an empty creator', { creator: 9 }, ''],
    ])('regression reproducer: %s', (_label, extra, expected) => {
        const source = fullCharacter(extra)

        expect(buildColdStub(source, 'unit-1', []).creator).toBe(expected)
        expect(characterCreator(source)).toBe(expected)
    })

    test('regression reproducer: a long creator is carried whole', () => {
        const creator = 'c'.repeat(5_000)

        expect(buildColdStub(fullCharacter({ creator }), 'unit-1', []).creator).toBe(creator)
    })

    test('guard: a group stub carries neither tags nor creator', () => {
        const stub = buildColdStub(fullGroup({ tags: ['a'], creator: 'X' }), 'unit-g', [])

        expect('tags' in stub).toBe(false)
        expect('creator' in stub).toBe(false)
    })

    test('specification: characterCreator of a stub is the creator the stub carries, and stubTags never throws on odd input', () => {
        const stub = buildColdStub(fullCharacter({ creator: 'Top', additionalData: { creator: 'Edited' } }), 'unit-1', [])

        expect(characterCreator(stub)).toBe('Edited')
        expect(stubTags({ tags: null } as unknown as character)).toEqual([])
        expect(stubTags({} as unknown as character)).toEqual([])
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

    // Passes before and after the version bump; fails only on a bare bump of the
    // trust gate (the mutant where `coldStubChatCount` requires the current version).
    test('compatibility guard: a version 2 stub, not yet upgraded, still reports its coldChatCount', () => {
        expect(coldStubChatCount(versionTwoStub('cha-v2', 'unit-v2'))).toBe(7)
    })

    test('the chat count trust floor is version 2, below the current version', () => {
        expect(COLD_STUB_CHAT_COUNT_VERSION).toBe(2)
        expect(COLD_STUB_CHAT_COUNT_VERSION).toBeLessThan(COLD_STUB_VERSION)
    })

    test('guard: a stub below the trust floor reports its dummy chat array length', () => {
        expect(coldStubChatCount(upstreamStub('cha-up', 'unit-up', { coldVersion: 1, coldChatCount: 7 }))).toBe(1)
    })
})

describe('coldUnitCharacter', () => {
    test('new behaviour: the unit copy has no trashTime and every other field of the source', () => {
        const source = fullCharacter({ trashTime: 1_234 })
        const unit = coldUnitCharacter(source)
        expect('trashTime' in unit).toBe(false)
        const { trashTime: _dropped, ...rest } = source
        expect(unit).toEqual(rest)
    })

    test('new behaviour: the source keeps its trashTime', () => {
        const source = fullGroup({ trashTime: 99 })
        coldUnitCharacter(source)
        expect(source.trashTime).toBe(99)
    })
})

describe('a trashed character archived with a unit without trashTime', () => {
    // Restore from the trash lifts the stub's trashTime in place; the restore path is unchanged by archiving trashed characters.
    function archived() {
        const source = fullCharacter({ trashTime: 5_000 })
        const stub = buildColdStub(coldUnitCharacter(source), 'unit-1', [])
        stub.trashTime = source.trashTime
        return { stub, unit: () => coldUnitCharacter(source) }
    }

    test('compatibility guard: opening it while still trashed gives the stub\'s trashTime', () => {
        const { stub, unit } = archived()
        expect(applyStubStateOnRestore(stub, unit()).trashTime).toBe(5_000)
    })

    test('compatibility guard: opening it after restore from the trash gives an untrashed character', () => {
        const { stub, unit } = archived()
        stub.trashTime = undefined
        expect(applyStubStateOnRestore(stub, unit())).not.toHaveProperty('trashTime')
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
