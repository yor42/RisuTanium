// The obj-list half of the host writers (S7-0 Design E): readers, in-place character and chat writes, and the
// copy-on-write module write. A plain object proves aliasing; a reactive proxy proves the write is made through the
// re-read property, since a raw array assigned into a proxy keeps a stale length.
import { describe, expect, test, vi } from 'vitest'
import { proxy } from 'svelte/internal/client'
import type { Chat, character } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'
import { stubModule } from 'src/ts/studio/studioFixtures.test-helpers'
import { moduleOwnerKey } from 'src/ts/studio/history/ownerPhase'
import type { WriteOp } from 'src/ts/studio/history/historyModel'
import { DBState } from 'src/ts/stores.svelte'
import {
    applyCharacterWrites,
    applyChatWrites,
    buildWrittenModule,
    createLiveReader,
    createModuleLiveReader,
    listOfHolder,
    resolveLiveTarget,
    type AssetWriteExtras,
} from '../studioSetters'

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: { characters: [], modules: [] } },
    selIdState: { selId: 0 },
    clearCharEmotionCache: () => {},
}))

type Entry = Record<string, unknown>

const lore = (id: string, extra: Entry = {}): Entry => ({ id, key: id, comment: id, content: `c-${id}`, mode: 'normal', insertorder: 100, alwaysActive: false, selective: false, ...extra })

const noExtras: AssetWriteExtras = { folder: { kind: 'keep' }, retained: undefined } as unknown as AssetWriteExtras

function liveCharacter(extra: Entry = {}): character {
    return { chaId: 'A', type: 'character', alternateGreetings: [], chats: [], chatPage: 0, ...extra } as unknown as character
}

function chatOf(extra: Entry = {}): Chat {
    return { id: 'c1', note: '', message: [], ...extra } as unknown as Chat
}

function insert(index: number, entry: Entry): WriteOp {
    return { op: 'objInsert', list: 'lore', index, entry: entry as never }
}

describe('listOfHolder', () => {
    test('an array is returned as is, an absent value reads empty, anything else is unreadable', () => {
        const list = [1]
        expect(listOfHolder({ a: list }, 'a')).toBe(list)
        expect(listOfHolder({}, 'a')).toEqual([])
        expect(listOfHolder({ a: null }, 'a')).toEqual([])
        expect(listOfHolder({ a: {} }, 'a')).toBeNull()
        expect(listOfHolder({ a: 'x' }, 'a')).toBeNull()
    })
})

describe('live readers', () => {
    test('a character reads its own list; a chat owner reads the chat list and never the character list (MD10)', () => {
        const character = liveCharacter({ globalLore: [lore('g')] })
        const chat = chatOf({ localLore: [lore('l')] })
        expect(createLiveReader({ character, chat: null }).objList?.('lore')).toEqual([lore('g')])
        expect(createLiveReader({ character, chat }).objList?.('lore')).toEqual([lore('l')])
        expect(createLiveReader({ character, chat: chatOf() }).objList?.('lore')).toEqual([])
    })

    test('an absent list reads empty and a non-list reads null', () => {
        expect(createLiveReader({ character: liveCharacter(), chat: null }).objList?.('lore')).toEqual([])
        expect(createLiveReader({ character: liveCharacter({ globalLore: {} }), chat: null }).objList?.('lore')).toBeNull()
    })

    test('prop reads absent, a plain object copy, and null for the wrong shape or kind', () => {
        const settings = { tokens: 10 }
        const character = liveCharacter({ loreSettings: settings, loreExt: [1] })
        const reader = createLiveReader({ character, chat: null })
        expect(reader.prop?.('loreSettings')).toEqual({ had: true, value: { tokens: 10 } })
        const read = reader.prop?.('loreSettings')
        expect(read && read.had && read.value).not.toBe(settings)
        expect(reader.prop?.('loreExt')).toBeNull()
        expect(createLiveReader({ character: liveCharacter(), chat: null }).prop?.('loreSettings')).toEqual({ had: false })
        expect(createLiveReader({ character, chat: chatOf() }).prop?.('loreSettings')).toBeNull()
    })

    test('a module reader reads the lorebook, reads an absent one empty, null for a non-list, and no prop', () => {
        expect(createModuleLiveReader({ id: 'M', lorebook: [lore('m')] } as unknown as RisuModule).objList?.('lore')).toEqual([lore('m')])
        expect(createModuleLiveReader({ id: 'M' } as unknown as RisuModule).objList?.('lore')).toEqual([])
        expect(createModuleLiveReader({ id: 'M', lorebook: {} } as unknown as RisuModule).objList?.('lore')).toBeNull()
        expect(createModuleLiveReader({ id: 'M' } as unknown as RisuModule).prop?.('loreSettings')).toBeNull()
    })
})

describe('character writes', () => {
    test('T19p: an insert stores a fresh copy and never the write\'s own object (plain host)', () => {
        const live = liveCharacter({ globalLore: [] })
        const entry = lore('a')
        applyCharacterWrites(live, [insert(0, entry)], null)
        const stored = (live as unknown as Entry).globalLore as Entry[]
        expect(stored).toEqual([entry])
        expect(stored[0]).not.toBe(entry)
        entry.content = 'changed later'
        expect(stored[0].content).toBe('c-a')
    })

    test('insert, set (had true and false) and remove edit the list in place', () => {
        const list = [lore('a'), lore('b')]
        const live = liveCharacter({ globalLore: list })
        applyCharacterWrites(live, [
            insert(1, lore('x')),
            { op: 'objSet', list: 'lore', index: 0, field: 'content', value: { had: true, value: 'new' } },
            { op: 'objSet', list: 'lore', index: 2, field: 'selective', value: { had: false } },
            { op: 'objRemove', list: 'lore', index: 3 },
        ], null)
        expect((live as unknown as Entry).globalLore).toBe(list)
        expect(list.map((row) => row.id)).toEqual(['a', 'x', 'b'])
        expect(list[0].content).toBe('new')
        expect('selective' in list[2]).toBe(false)
    })

    test('propSet assigns a copy or deletes the key', () => {
        const live = liveCharacter()
        const value = { tokens: 5 }
        applyCharacterWrites(live, [{ op: 'propSet', prop: 'loreSettings', value: { had: true, value } }], null)
        const stored = (live as unknown as Entry).loreSettings
        expect(stored).toEqual(value)
        expect(stored).not.toBe(value)
        applyCharacterWrites(live, [{ op: 'propSet', prop: 'loreSettings', value: { had: false } }], null)
        expect('loreSettings' in live).toBe(false)
    })

    test('N1: an absent globalLore under a reactive proxy takes the first and the next insert and holds them in JSON', () => {
        const live = proxy(liveCharacter()) as character
        applyCharacterWrites(live, [insert(0, lore('a'))], null)
        const held = (live as unknown as Entry).globalLore as Entry[]
        expect(held.length).toBe(1)
        expect(JSON.stringify(live)).toContain('"id":"a"')
        applyCharacterWrites(live, [insert(1, lore('b')), insert(0, lore('c'))], null)
        expect(((live as unknown as Entry).globalLore as Entry[]).map((row) => row.id)).toEqual(['c', 'a', 'b'])
        expect(JSON.parse(JSON.stringify(live)).globalLore.map((row: Entry) => row.id)).toEqual(['c', 'a', 'b'])
        applyCharacterWrites(live, [{ op: 'objRemove', list: 'lore', index: 0 }], null)
        expect(JSON.parse(JSON.stringify(live)).globalLore.map((row: Entry) => row.id)).toEqual(['a', 'b'])
    })

    test('a stored non-list is never replaced by an insert', () => {
        const live = liveCharacter({ globalLore: { not: 'a list' } })
        applyCharacterWrites(live, [insert(0, lore('a'))], null)
        expect((live as unknown as Entry).globalLore).toEqual({ not: 'a list' })
    })
})

describe('chat writes', () => {
    test('the chat\'s own list is written in place and the character\'s list is untouched', () => {
        const character = liveCharacter({ globalLore: [lore('g')] })
        const chat = chatOf({ localLore: [lore('l')] })
        applyChatWrites(chat, [
            insert(1, lore('n')),
            { op: 'objSet', list: 'lore', index: 0, field: 'comment', value: { had: true, value: 'edited' } },
        ])
        expect((chat as unknown as Entry).localLore).toEqual([lore('l', { comment: 'edited' }), lore('n')])
        expect(character).toEqual(liveCharacter({ globalLore: [lore('g')] }))
        applyChatWrites(chat, [{ op: 'objRemove', list: 'lore', index: 0 }])
        expect(((chat as unknown as Entry).localLore as Entry[]).map((row) => row.id)).toEqual(['n'])
    })

    test('a propSet never reaches a chat', () => {
        const chat = chatOf()
        applyChatWrites(chat, [{ op: 'propSet', prop: 'loreSettings', value: { had: true, value: { tokens: 1 } } }])
        expect('loreSettings' in chat).toBe(false)
    })

    test('N1: an absent localLore under a reactive proxy takes the insert; the live chat and its JSON hold it', () => {
        const chat = proxy(chatOf()) as Chat
        applyChatWrites(chat, [insert(0, lore('a'))])
        expect(((chat as unknown as Entry).localLore as Entry[]).length).toBe(1)
        expect(JSON.parse(JSON.stringify(chat)).localLore.map((row: Entry) => row.id)).toEqual(['a'])
        applyChatWrites(chat, [insert(1, lore('b'))])
        expect(JSON.parse(JSON.stringify(chat)).localLore.map((row: Entry) => row.id)).toEqual(['a', 'b'])
        applyChatWrites(chat, [{ op: 'objRemove', list: 'lore', index: 0 }])
        expect(JSON.parse(JSON.stringify(chat)).localLore.map((row: Entry) => row.id)).toEqual(['b'])
    })
})

describe('module writes (copy-on-write)', () => {
    function moduleOf(extra: Entry = {}): RisuModule {
        return { id: 'M', name: 'm', lorebook: [lore('a'), lore('b'), lore('c')], ...extra } as unknown as RisuModule
    }

    test('T22: the live module, its list and its elements keep identity and bytes; the result is a new slot', () => {
        const live = moduleOf()
        const before = JSON.stringify(live)
        const list = live.lorebook
        const first = list?.[0]
        const next = buildWrittenModule(live, [
            insert(1, lore('x')),
            { op: 'objSet', list: 'lore', index: 0, field: 'content', value: { had: true, value: 'new' } },
            { op: 'objRemove', list: 'lore', index: 2 },
        ], noExtras)
        expect(JSON.stringify(live)).toBe(before)
        expect(live.lorebook).toBe(list)
        expect(list?.[0]).toBe(first)
        expect(next).not.toBe(live)
        expect(next.lorebook).not.toBe(list)
        expect((next.lorebook as unknown as Entry[]).map((row) => row.id)).toEqual(['a', 'x', 'c'])
        expect((next.lorebook as unknown as Entry[])[0].content).toBe('new')
        expect((next.lorebook as unknown as Entry[])[2]).toBe(list?.[2])
    })

    test('elements are copied by identity, not index: a set after an insert and a remove in one batch hits the right row', () => {
        const live = moduleOf()
        const next = buildWrittenModule(live, [
            insert(0, lore('x')),
            { op: 'objRemove', list: 'lore', index: 1 },
            { op: 'objSet', list: 'lore', index: 1, field: 'content', value: { had: true, value: 'one' } },
            { op: 'objSet', list: 'lore', index: 1, field: 'comment', value: { had: true, value: 'two' } },
            { op: 'objSet', list: 'lore', index: 0, field: 'comment', value: { had: false } },
        ], noExtras)
        const rows = next.lorebook as unknown as Entry[]
        expect(rows.map((row) => row.id)).toEqual(['x', 'b', 'c'])
        expect(rows[1]).toMatchObject({ content: 'one', comment: 'two' })
        expect('comment' in rows[0]).toBe(false)
        expect((live.lorebook as unknown as Entry[])[1].content).toBe('c-b')
    })

    test('an absent lorebook takes the first insert as a new array; a repair-needed list (migrate) is editable', () => {
        const bare = moduleOf()
        delete (bare as unknown as Entry).lorebook
        const created = buildWrittenModule(bare, [insert(0, lore('x'))], noExtras)
        expect((created.lorebook as unknown as Entry[]).map((row) => row.id)).toEqual(['x'])
        expect('lorebook' in bare).toBe(false)

        const legacy = moduleOf({ lorebook: [{ key: 'old', content: 'no id, no version' }] })
        const reader = createModuleLiveReader(legacy)
        expect(reader.objList?.('lore')).toHaveLength(1)
        const next = buildWrittenModule(legacy, [{ op: 'objSet', list: 'lore', index: 0, field: 'content', value: { had: true, value: 'fixed' } }], noExtras)
        expect((next.lorebook as unknown as Entry[])[0]).toEqual({ key: 'old', content: 'fixed' })
    })

    test('a repair-needs-ask lorebook (not a list) reads null and is never replaced by a write', () => {
        const ask = moduleOf({ lorebook: {} })
        expect(createModuleLiveReader(ask).objList?.('lore')).toBeNull()
        const next = buildWrittenModule(ask, [insert(0, lore('x')), { op: 'objRemove', list: 'lore', index: 0 }], noExtras)
        expect(next.lorebook).toEqual({})
    })

    test('a stub and a shared id are refused by the module resolve', () => {
        const open = () => 'M'
        DBState.db.modules = [stubModule('M')] as unknown as typeof DBState.db.modules
        expect(resolveLiveTarget(moduleOwnerKey('M'), open)).toEqual({ ok: false, reason: 'gone' })
        DBState.db.modules = [moduleOf(), moduleOf()] as unknown as typeof DBState.db.modules
        expect(resolveLiveTarget(moduleOwnerKey('M'), open)).toEqual({ ok: false, reason: 'duplicate-module-id' })
        DBState.db.modules = [moduleOf()] as unknown as typeof DBState.db.modules
        expect(resolveLiveTarget(moduleOwnerKey('M'), open).ok).toBe(true)
    })
})
