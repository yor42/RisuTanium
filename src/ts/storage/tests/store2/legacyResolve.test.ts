/**
 * `resolveLegacyTree`: the four pointer kinds of a legacy tree (character stub,
 * `coldStoragedChats`, chat first-message pointer, `_coldplugin`) resolved
 * through an injected reader into a database the codec encodes. The `.bin`
 * goldens are decoded with today's decoder first; what the resolver must do with
 * an unusable unit is a rule of its own (Report 62 T1), not what today's restore
 * did, so those tests assert the new rule and say so.
 *
 * Tests labelled `new behaviour` assert the resolver's rules, `guard` ones pin a
 * property that must hold before and after a change.
 */
import { describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

import type { Database } from 'src/ts/storage/database.svelte'
import { coldStorageHeader, formatColdStorageLoadError } from 'src/ts/process/coldstorageData'
import { encodeDatabase, StubRefusedError } from 'src/ts/storage/store2/codec'
import { LegacyReadError, resolveLegacyTree } from 'src/ts/storage/store2/legacy/resolve'
import { mergeRetriedColdChatSideFields, type RetryLegacyColdChatSideFields } from 'src/ts/process/coldstorageData'
import { fakeLists, seededEnv } from './codecFixtures'
import {
    ALL_GOLDENS, CHAIN, chainFixture, DEEP, deepChain, encodeAndAssemble, FULL_GOLDENS, ID, loadGolden, MISSING_UNIT_GOLDENS, readerOver, STUB_GOLDENS, unitValue, unitValueOf,
    type Golden, type StoredUnit,
} from './legacyFixtures'

type Obj = Record<string, unknown>

const OPTIONS = { newId: () => 'placeholder-chat-id', now: () => 1_700_000_000_001 }

function chars(db: Database): Obj[] {
    return db.characters as unknown as Obj[]
}

function charOf(db: Database, chaId: string): Obj {
    const found = chars(db).find(c => c.chaId === chaId)
    if (found === undefined) {
        throw new Error(`no character ${chaId}`)
    }
    return found
}

function chatsOf(character: Obj): Obj[] {
    return character.chats as Obj[]
}

function firstMessages(character: Obj): string[] {
    return chatsOf(character).map(chat => ((chat.message as Obj[])[0].data as string))
}

/** The codec needs a preset list; the stub-only goldens carry none. */
function encodable(db: Database): Database {
    return { ...db, botPresets: db.botPresets ?? [] } as Database
}

function withUnits(golden: Golden, extra: Record<string, StoredUnit>): Map<string, StoredUnit> {
    const units = new Map(golden.units)
    for (const [key, unit] of Object.entries(extra)) {
        units.set(key, unit)
    }
    return units
}

describe.each(FULL_GOLDENS)('new behaviour: %s resolves every pointer kind', (file) => {
    test('stub, pointer chats, coldStoragedChats and the plugin value are resolved; nothing is incomplete', async () => {
        const golden = await loadGolden(file)
        const before = structuredClone(golden.tree)
        const reader = readerOver(golden.units)

        const { database, incomplete } = await resolveLegacyTree(golden.tree, reader, OPTIONS)

        expect(incomplete).toEqual([])
        expect(golden.tree).toEqual(before)

        const inline = charOf(database, 'cha-inline')
        const inlineChats = chatsOf(inline)
        const archivedInline = unitValue(golden, ID.inlineChatUnit)
        expect(inlineChats[0].message).toEqual([expect.objectContaining({ data: 'inline hello' })])
        expect(inlineChats[1].message).toEqual(archivedInline.message)
        expect(inlineChats[1].hypaV2Data).toEqual(archivedInline.hypaV2Data)
        expect(inlineChats[1].hypaV3Data).toEqual(archivedInline.hypaV3Data)
        expect(inlineChats[1].scriptstate).toEqual(archivedInline.scriptstate)
        expect(inlineChats[1].localLore).toEqual(archivedInline.localLore)

        const stub = charOf(database, 'cha-stub')
        expect(stub.name).toBe('Stub Bob')
        for (const field of ['coldstorage', 'coldStoragedChats', 'coldVersion', 'coldChatCount']) {
            expect(Object.hasOwn(stub, field)).toBe(false)
        }
        expect(firstMessages(stub)).toEqual(['blob hello', 'archived blob chat'])
        expect(chatsOf(stub)[1].message).toEqual(unitValue(golden, ID.blobChatUnit).message)

        const storage = database.pluginCustomStorage as Obj
        expect(storage._coldplugin).toEqual({ prefs: ID.pluginUnit })
        expect(storage[ID.pluginUnit]).toEqual(unitValueOf(golden, ID.pluginUnit))
    })
})

describe('new behaviour: a resolved pointer chat keeps the messages sent after the pointer', () => {
    test('the unit is present: its messages come first and the tail follows', async () => {
        const golden = await loadGolden('fork-full.bin')
        const inline = chars(golden.tree)[0]
        const withTail = {
            ...golden.tree,
            characters: [{
                ...inline,
                chats: chatsOf(inline).map((chat, index) => index === 1
                    ? { ...chat, message: [...(chat.message as Obj[]), { time: 5, data: 'sent after the pointer', role: 'user' }] }
                    : chat),
            }, ...chars(golden.tree).slice(1)],
        } as unknown as Database

        const { database, incomplete } = await resolveLegacyTree(withTail, readerOver(golden.units), OPTIONS)

        const messages = chatsOf(charOf(database, 'cha-inline'))[1].message as Obj[]
        expect(messages.map(m => m.data)).toEqual(['archived inline chat', 'sent after the pointer'])
        expect(incomplete).toEqual([])
    })
})

describe('new behaviour: a chat whose first message is load-error text', () => {
    const KEY = ID.errorTextUnit

    function errorChatOf(database: Database): Obj {
        return chatsOf(charOf(database, 'cha-inline'))[2]
    }

    test('the unit is present: it resolves as the fork\'s retry does and is not listed', async () => {
        const golden = await loadGolden('upstream-full.bin')
        const inline = chars(golden.tree)[0]
        const liveChat = chatsOf(inline)[2]
        const blob = unitValue(golden, KEY)

        const { database, incomplete } = await resolveLegacyTree(golden.tree, readerOver(golden.units), OPTIONS)

        const chat = errorChatOf(database)
        const side = mergeRetriedColdChatSideFields(
            liveChat as unknown as RetryLegacyColdChatSideFields, blob as unknown as RetryLegacyColdChatSideFields, undefined,
        )
        expect(chat.message).toEqual(blob.message)
        expect(chat.hypaV2Data).toEqual(side.hypaV2Data)
        expect(chat.hypaV3Data).toEqual(side.hypaV3Data)
        expect(chat.scriptstate).toEqual(side.scriptstate)
        expect(chat.localLore).toEqual(side.localLore)
        expect(incomplete).toEqual([])
    })

    test('the messages sent after the error text are kept, and the dropped message\'s memo is stripped from live summaries', async () => {
        const golden = await loadGolden('upstream-full.bin')
        const inline = chars(golden.tree)[0]
        const live = {
            ...chatsOf(inline)[2],
            message: [
                { time: 1, data: formatColdStorageLoadError(KEY), role: 'char', chatId: 'memo-1' },
                { time: 2, data: 'after the error', role: 'user' },
            ],
            hypaV3Data: { summaries: [{ text: 's', chatMemos: ['memo-1', 'memo-2'] }] },
        }
        const tree = { ...golden.tree, characters: [{ ...inline, chats: [chatsOf(inline)[0], chatsOf(inline)[1], live] }, ...chars(golden.tree).slice(1)] } as unknown as Database

        const { database } = await resolveLegacyTree(tree, readerOver(golden.units), OPTIONS)

        const chat = errorChatOf(database)
        expect((chat.message as Obj[]).map(m => m.data)).toEqual(['archived error-text chat', 'after the error'])
        const expected = mergeRetriedColdChatSideFields(
            live as unknown as RetryLegacyColdChatSideFields, unitValue(golden, KEY) as unknown as RetryLegacyColdChatSideFields, 'memo-1',
        )
        expect(chat.hypaV3Data).toEqual(expected.hypaV3Data)
    })

    test.each([
        ['missing', 'missing', undefined],
        ['unparsable', 'invalid', { status: 'unparsable' } as StoredUnit],
        ['not a chat', 'invalid', { status: 'ok', value: { a: 1 } } as StoredUnit],
    ] as const)('the unit is %s: the text and the tail stay and the chat is listed', async (_label, reason, stored) => {
        const golden = await loadGolden('upstream-full.bin')
        const inline = chars(golden.tree)[0]
        const withTail = {
            ...golden.tree,
            characters: [{
                ...inline,
                chats: chatsOf(inline).map((chat, index) => index === 2
                    ? { ...chat, message: [...(chat.message as Obj[]), { time: 5, data: 'after the error', role: 'user' }] }
                    : chat),
            }, ...chars(golden.tree).slice(1)],
        } as unknown as Database
        const units = new Map(golden.units)
        if (stored === undefined) {
            units.delete(KEY)
        } else {
            units.set(KEY, stored)
        }

        const { database, incomplete } = await resolveLegacyTree(withTail, readerOver(units), OPTIONS)

        expect((errorChatOf(database).message as Obj[]).map(m => m.data)).toEqual([formatColdStorageLoadError(KEY), 'after the error'])
        expect(incomplete).toEqual([{ kind: 'chat', chaId: 'cha-inline', name: 'Inline Alice', chatIndex: 2, key: KEY, reason }])
    })

    test.each([['an error status', 'errorKeys'], ['a rejection', 'throwKeys']] as const)('%s while reading its unit aborts the resolve', async (_label, fault) => {
        const golden = await loadGolden('upstream-full.bin')

        const outcome = await resolveLegacyTree(golden.tree, readerOver(golden.units, { [fault]: new Set([KEY]) }), OPTIONS).then(
            () => 'resolved',
            (error: unknown) => error,
        )

        expect(outcome).toBeInstanceOf(LegacyReadError)
        expect((outcome as LegacyReadError).key).toBe(KEY)
    })
})

describe('new behaviour: load-error text that resolves into more load-error text', () => {
    const errorOf = (key: string): string => formatColdStorageLoadError(key)

    /** The deep chain's chat, given a message after the pointer so tail order is visible. */
    function deepWithTail(): Golden {
        const deep = deepChain()
        const unit = deep.units.get(DEEP.stub) as { status: 'ok', value: { character: { chats: Obj[] } } }
        const chat = unit.value.character.chats[0]
        chat.message = [...(chat.message as Obj[]), { time: 9, data: 'tail', role: 'user' }]
        return deep
    }

    function deepChatOf(database: Database): Obj {
        return chatsOf(charOf(database, 'cha-deep'))[0]
    }

    test('a chain of archived chats resolves to its end with nothing listed, and the tail stays last', async () => {
        const deep = deepWithTail()
        const reader = readerOver(deep.units)

        const { database, incomplete } = await resolveLegacyTree(deep.tree, reader, OPTIONS)

        expect((deepChatOf(database).message as Obj[]).map(m => m.data)).toEqual(['the end', 'tail'])
        expect(incomplete).toEqual([])
        expect(reader.reads).toEqual([DEEP.stub, DEEP.chat, DEEP.errorNamed, DEEP.last])
    })

    test('a cycle (a to b to a) terminates, keeps the text it stopped at and lists the chat as invalid', async () => {
        const deep = deepChain()
        const unitOf = (data: string): StoredUnit => ({ status: 'ok', value: { message: [{ time: 1, data, role: 'char' }] } })
        deep.units.set(DEEP.chat, unitOf(errorOf(DEEP.errorNamed)))
        deep.units.set(DEEP.errorNamed, unitOf(errorOf(DEEP.chat)))

        const { database, incomplete } = await resolveLegacyTree(deep.tree, readerOver(deep.units), OPTIONS)

        expect(firstMessages(charOf(database, 'cha-deep'))).toEqual([errorOf(DEEP.chat)])
        expect(incomplete).toEqual([{ kind: 'chat', chaId: 'cha-deep', name: 'Deep', chatIndex: 0, key: DEEP.chat, reason: 'invalid' }])
    })

    test('a unit missing at depth 2 keeps that depth\'s text and tail and is listed as missing', async () => {
        const deep = deepWithTail()
        deep.units.delete(DEEP.last)

        const { database, incomplete } = await resolveLegacyTree(deep.tree, readerOver(deep.units), OPTIONS)

        expect((deepChatOf(database).message as Obj[]).map(m => m.data)).toEqual([errorOf(DEEP.last), 'tail'])
        expect(incomplete).toEqual([{ kind: 'chat', chaId: 'cha-deep', name: 'Deep', chatIndex: 0, key: DEEP.last, reason: 'missing' }])
    })

    test('a unit at depth 2 that starts with a pointer is refused: its own text stays and the chat is listed as invalid', async () => {
        const deep = deepWithTail()
        deep.units.set(DEEP.errorNamed, { status: 'ok', value: { message: [{ time: 1, data: coldStorageHeader + DEEP.last, role: 'char' }] } })

        const { database, incomplete } = await resolveLegacyTree(deep.tree, readerOver(deep.units), OPTIONS)

        expect((deepChatOf(database).message as Obj[]).map(m => m.data)).toEqual([errorOf(DEEP.errorNamed), 'tail'])
        expect(incomplete).toEqual([expect.objectContaining({ kind: 'chat', key: DEEP.errorNamed, reason: 'invalid' })])
    })

    test.each([['an error status', 'errorKeys'], ['a rejection', 'throwKeys']] as const)('%s at depth 2 aborts the resolve', async (_label, fault) => {
        const deep = deepChain()

        const outcome = await resolveLegacyTree(deep.tree, readerOver(deep.units, { [fault]: new Set([DEEP.last]) }), OPTIONS).then(
            () => 'resolved',
            (error: unknown) => error,
        )

        expect(outcome).toBeInstanceOf(LegacyReadError)
        expect((outcome as LegacyReadError).key).toBe(DEEP.last)
    })
})

describe('new behaviour: a load-error chat whose unit is a bare array or has a malformed side field', () => {
    const KEY = ID.errorTextUnit

    async function withLiveSide(): Promise<{ golden: Golden, tree: Database, live: Obj }> {
        const golden = await loadGolden('upstream-full.bin')
        const inline = chars(golden.tree)[0]
        const live = {
            ...chatsOf(inline)[2],
            message: [{ time: 1, data: formatColdStorageLoadError(KEY), role: 'char' }, { time: 2, data: 'after', role: 'user' }],
            hypaV2Data: { chunks: [], mainChunks: [{ id: 'live' }], lastMainChunkID: 1 },
            scriptstate: { live: 1 },
            localLore: [{ key: 'live-lore' }],
        }
        const tree = { ...golden.tree, characters: [{ ...inline, chats: [chatsOf(inline)[0], chatsOf(inline)[1], live] }, ...chars(golden.tree).slice(1)] } as unknown as Database
        return { golden, tree, live }
    }

    test('a bare array restores the messages, leaves the live side fields untouched and is not listed', async () => {
        const { golden, tree, live } = await withLiveSide()
        const units = new Map(golden.units)
        units.set(KEY, { status: 'ok', value: [{ time: 3, data: 'from array', role: 'user' }] })

        const { database, incomplete } = await resolveLegacyTree(tree, readerOver(units), OPTIONS)

        const chat = chatsOf(charOf(database, 'cha-inline'))[2]
        expect((chat.message as Obj[]).map(m => m.data)).toEqual(['from array', 'after'])
        expect(chat.hypaV2Data).toEqual(live.hypaV2Data)
        expect(chat.scriptstate).toEqual(live.scriptstate)
        expect(chat.localLore).toEqual(live.localLore)
        expect(incomplete).toEqual([])
    })

    test('a side field the merge cannot take keeps the text and tail and lists the chat as invalid', async () => {
        const { golden, tree } = await withLiveSide()
        const units = new Map(golden.units)
        units.set(KEY, { status: 'ok', value: { message: [{ time: 3, data: 'never installed', role: 'user' }], localLore: 5 } })

        const { database, incomplete } = await resolveLegacyTree(tree, readerOver(units), OPTIONS)

        expect((chatsOf(charOf(database, 'cha-inline'))[2].message as Obj[]).map(m => m.data)).toEqual([formatColdStorageLoadError(KEY), 'after'])
        expect(incomplete).toEqual([{ kind: 'chat', chaId: 'cha-inline', name: 'Inline Alice', chatIndex: 2, key: KEY, reason: 'invalid' }])
    })
})

describe('new behaviour: a chain of archived chats with several messages and side fields per unit', () => {
    const dataOf = (chat: Obj): unknown[] => (chat.message as Obj[]).map(m => m.data)
    const chainChat = (database: Database): Obj => chatsOf(charOf(database, 'cha-chain'))[0]
    const keysOf = (items: unknown): unknown => JSON.stringify(items)

    test('N1: the messages are deepest unit first with the original tail last, and the side fields accumulate by the merge contract', async () => {
        const chain = chainFixture()
        const reader = readerOver(chain.units)

        const { database, incomplete } = await resolveLegacyTree(chain.tree, reader, OPTIONS)

        const chat = chainChat(database)
        expect(dataOf(chat)).toEqual(['end', 'e2b', 'e1b', 'e1c', 'p2', 't1'])
        expect(chat.localLore).toEqual([{ key: '2-lore' }, { key: '1-lore' }, { key: 'P-lore' }])
        // A key present at every depth resolves to the shallowest value; keys that exist at one depth survive.
        expect(chat.scriptstate).toEqual({ shared: 'P', only2: 1, only1: 1, onlyP: 1 })
        expect(chat.hypaV2Data).toEqual({ chunks: [], mainChunks: [{ id: '2' }], lastMainChunkID: 3 })
        expect((chat.hypaV3Data as Obj).summaries).toEqual([
            { text: 's2', chatMemos: ['memo-2'] },
            { text: 's1', chatMemos: ['memo-y'] },
            { text: 'sP', chatMemos: ['memo-x'] },
        ])
        expect(chat.id).toBe('chat-chain')
        expect(incomplete).toEqual([])
        expect(reader.reads).toEqual([CHAIN.pointer, CHAIN.first, CHAIN.second])
    })

    test('N2: the first step (a pointer) replaces the original chat\'s side fields, so one the unit lacks is cleared and never comes back', async () => {
        const chain = chainFixture({ pointerUnitLacksScriptstate: true })

        const { database } = await resolveLegacyTree(chain.tree, readerOver(chain.units), OPTIONS)

        const chat = chainChat(database)
        expect(chat.scriptstate).toEqual({ shared: '1', only2: 1, only1: 1 })
        expect(Object.hasOwn(chat.scriptstate as Obj, 'orig')).toBe(false)
        expect(keysOf(chat.localLore)).not.toContain('orig-lore')
    })

    test('N3: each step strips the memo of the message it drops, from the summaries accumulated at that step', async () => {
        const chain = chainFixture()

        const { database } = await resolveLegacyTree(chain.tree, readerOver(chain.units), OPTIONS)

        const summaries = keysOf((chainChat(database).hypaV3Data as Obj).summaries) as string
        // memo-P is the pointer unit's dropped message (step 2), memo-1 the first unit's (step 3); memo-orig names no summary of the chain.
        expect(summaries).not.toContain('memo-P')
        expect(summaries).not.toContain('memo-1"')
        expect(summaries).toContain('memo-x')
        expect(summaries).toContain('memo-y')
    })

    test('N4: two chats of one stub unit that point at the same chain both resolve, and the chain is read for each', async () => {
        const chain = chainFixture()
        const copyOf = (id: string): Obj => structuredClone({ ...chain.chat, id })
        const units = new Map(chain.units)
        units.set(CHAIN.stub, { status: 'ok', value: { character: { chaId: 'cha-chain', name: 'Chain', type: 'character', chats: [copyOf('a'), copyOf('b')] } } })
        const tree = {
            botPresets: [],
            characters: [{ chaId: 'cha-chain', name: 'Chain', type: 'character', coldstorage: CHAIN.stub, coldStoragedChats: [], chats: [{ id: 'stub', message: [{ time: 1, data: '', role: 'char' }] }] }],
        } as unknown as Database
        const reader = readerOver(units)

        const { database, incomplete } = await resolveLegacyTree(tree, reader, OPTIONS)

        expect(chatsOf(charOf(database, 'cha-chain')).map(chat => dataOf(chat))).toEqual([
            ['end', 'e2b', 'e1b', 'e1c', 'p2', 't1'],
            ['end', 'e2b', 'e1b', 'e1c', 'p2', 't1'],
        ])
        expect(incomplete).toEqual([])
        expect(reader.reads.filter(key => key === CHAIN.pointer)).toHaveLength(2)
        expect(reader.reads.filter(key => key === CHAIN.second)).toHaveLength(2)
    })

    test('N5: a bare array at the chain\'s end keeps the side fields accumulated before it', async () => {
        const chain = chainFixture({ bareEnd: true })

        const { database, incomplete } = await resolveLegacyTree(chain.tree, readerOver(chain.units), OPTIONS)

        const chat = chainChat(database)
        expect(dataOf(chat)).toEqual(['end', 'e2b', 'e1b', 'e1c', 'p2', 't1'])
        expect(chat.localLore).toEqual([{ key: '1-lore' }, { key: 'P-lore' }])
        expect(chat.scriptstate).toEqual({ shared: 'P', only1: 1, onlyP: 1 })
        expect(chat.hypaV2Data).toEqual({ chunks: [], mainChunks: [{ id: 'P' }], lastMainChunkID: 1 })
        expect((chat.hypaV3Data as Obj).summaries).toEqual([
            { text: 's1', chatMemos: ['memo-1', 'memo-y'] },
            { text: 'sP', chatMemos: ['memo-x'] },
        ])
        expect(incomplete).toEqual([])
    })

    test('N6: a chain whose root is load-error text merges the original chat\'s side fields at its first step', async () => {
        const chain = chainFixture({ root: 'errorText' })

        const { database, incomplete } = await resolveLegacyTree(chain.tree, readerOver(chain.units), OPTIONS)

        const chat = chainChat(database)
        expect(dataOf(chat)).toEqual(['end', 'e2b', 'e1b', 'e1c', 't1'])
        expect(chat.localLore).toEqual([{ key: '2-lore' }, { key: '1-lore' }, { key: 'orig-lore' }])
        expect(chat.scriptstate).toEqual({ shared: 'orig', only2: 1, only1: 1, orig: 1 })
        expect(incomplete).toEqual([])
    })
})

describe.each(STUB_GOLDENS)('new behaviour: %s gives a placeholder named in the incomplete list', (file, reason) => {
    test('one placeholder character with the stub identity and one chat of the load-error text', async () => {
        const golden = await loadGolden(file)

        const { database, incomplete } = await resolveLegacyTree(golden.tree, readerOver(golden.units), OPTIONS)

        // Today's restore installs the stub as stored and asks a question; the rule here is a placeholder.
        expect(chars(database)).toHaveLength(1)
        const placeholder = charOf(database, 'cha-stub')
        expect(placeholder.name).toBe('Stub Bob')
        expect(Object.hasOwn(placeholder, 'coldstorage')).toBe(false)
        expect(chatsOf(placeholder)).toHaveLength(1)
        expect(chatsOf(placeholder)[0]).toMatchObject({ id: 'placeholder-chat-id', message: [{ data: formatColdStorageLoadError(ID.stubBlob), time: 1_700_000_000_001 }] })
        expect(incomplete).toEqual([{ kind: 'character', chaId: 'cha-stub', name: 'Stub Bob', key: ID.stubBlob, reason }])
    })
})

describe('new behaviour: a placeholder keeps what the stub carries', () => {
    test('trashTime, image, lastInteraction and a group member list come from the stub, so a trashed character stays trashed', async () => {
        const golden = await loadGolden('fork-stub-missing-entry.bin')
        const stub = chars(golden.tree)[0]
        const tree = {
            ...golden.tree,
            characters: [{ ...stub, trashTime: 1234, image: 'assets/x.png', lastInteraction: 99 }, { ...stub, chaId: 'cha-group', type: 'group', characters: ['m1', 'm2'], coldstorage: ID.missingChatUnit }],
        } as unknown as Database

        const { database } = await resolveLegacyTree(tree, readerOver(new Map()), OPTIONS)

        expect(chars(database)[0]).toMatchObject({ chaId: 'cha-stub', trashTime: 1234, image: 'assets/x.png', lastInteraction: 99, type: 'character' })
        expect(chars(database)[1]).toMatchObject({ chaId: 'cha-group', type: 'group', characters: ['m1', 'm2'] })
    })

    test('a resolved stub takes its trash state from the stub, not the unit', async () => {
        const golden = await loadGolden('fork-full.bin')
        const trashed = {
            ...golden.tree,
            characters: chars(golden.tree).map(c => c.chaId === 'cha-stub' ? { ...c, trashTime: 777 } : c),
        } as unknown as Database
        const units = withUnits(golden, {
            [ID.stubBlob]: { status: 'ok', value: { character: { ...(unitValue(golden, ID.stubBlob).character as Obj), trashTime: 5 } } },
        })

        const { database } = await resolveLegacyTree(trashed, readerOver(units), OPTIONS)

        expect(charOf(database, 'cha-stub').trashTime).toBe(777)
    })

    test('a truthy coldstorage that is not a unit id is a stub: a placeholder, listed, never an empty inline character', async () => {
        const golden = await loadGolden('fork-stub-missing-entry.bin')
        const tree = { ...golden.tree, characters: [{ ...chars(golden.tree)[0], coldstorage: 42 }] } as unknown as Database
        const reader = readerOver(golden.units)

        const { database, incomplete } = await resolveLegacyTree(tree, reader, OPTIONS)

        expect(Object.hasOwn(charOf(database, 'cha-stub'), 'coldstorage')).toBe(false)
        expect(firstMessages(charOf(database, 'cha-stub'))).toEqual([formatColdStorageLoadError('')])
        expect(incomplete).toEqual([expect.objectContaining({ kind: 'character', chaId: 'cha-stub', reason: 'shape' })])
        expect(reader.reads).toEqual([])
    })

    test('a unit holding another character is a mismatch placeholder', async () => {
        const golden = await loadGolden('fork-full.bin')
        const units = withUnits(golden, {
            [ID.stubBlob]: { status: 'ok', value: { character: { ...(unitValue(golden, ID.stubBlob).character as Obj), chaId: 'someone-else' } } },
        })

        const { incomplete } = await resolveLegacyTree(golden.tree, readerOver(units), OPTIONS)

        expect(incomplete).toEqual([expect.objectContaining({ kind: 'character', chaId: 'cha-stub', reason: 'mismatch' })])
    })
})

describe.each(MISSING_UNIT_GOLDENS)('new behaviour: %s keeps the chat with the load-error text', (file) => {
    test('the pointer is replaced by the load-error text for its key, the tail is kept and the chat is named', async () => {
        const golden = await loadGolden(file)
        const inline = chars(golden.tree)[0]
        const withTail = {
            ...golden.tree,
            characters: [{
                ...inline,
                chats: chatsOf(inline).map((chat, index) => index === 1
                    ? { ...chat, message: [...(chat.message as Obj[]), { time: 5, data: 'after the pointer', role: 'user' }] }
                    : chat),
            }],
        } as unknown as Database

        const { database, incomplete } = await resolveLegacyTree(withTail, readerOver(golden.units), OPTIONS)

        const resolved = charOf(database, 'cha-inline')
        expect(chatsOf(resolved)).toHaveLength(2)
        // Not equality with the golden's pointer chat: a pointer must never reach the codec.
        expect(firstMessages(resolved)[1]).toBe(formatColdStorageLoadError(ID.missingChatUnit))
        expect(firstMessages(resolved)[1].startsWith(coldStorageHeader)).toBe(false)
        expect((chatsOf(resolved)[1].message as Obj[]).map(m => m.data)).toEqual([formatColdStorageLoadError(ID.missingChatUnit), 'after the pointer'])
        expect(incomplete).toEqual([{ kind: 'chat', chaId: 'cha-inline', name: 'Inline Alice', chatIndex: 1, key: ID.missingChatUnit, reason: 'missing' }])
    })
})

describe('new behaviour: an unusable chat unit', () => {
    test('a unit that is not a chat, and a unit whose first message is a pointer again, are invalid and never followed', async () => {
        const golden = await loadGolden('fork-full.bin')
        const nested = { message: [{ time: 1, data: coldStorageHeader + ID.blobChatUnit, role: 'user' }] }
        const units = withUnits(golden, {
            [ID.inlineChatUnit]: { status: 'ok', value: { a: 1 } },
            [ID.blobChatUnit]: { status: 'ok', value: nested },
        })
        const reader = readerOver(units)

        const { database, incomplete } = await resolveLegacyTree(golden.tree, reader, OPTIONS)

        expect(firstMessages(charOf(database, 'cha-inline'))[1]).toBe(formatColdStorageLoadError(ID.inlineChatUnit))
        expect(firstMessages(charOf(database, 'cha-stub'))[1]).toBe(formatColdStorageLoadError(ID.blobChatUnit))
        expect(incomplete.map(item => item.kind === 'chat' ? item.reason : item.kind)).toEqual(['invalid', 'invalid'])
        // The nested pointer's own unit was not chased: the unit that holds it was read once.
        expect(reader.reads.filter(key => key === ID.blobChatUnit)).toHaveLength(1)
    })

    test('an unparsable pointer unit gets the load-error text for its key and the chat is listed as invalid', async () => {
        const golden = await loadGolden('fork-full.bin')
        const units = withUnits(golden, { [ID.inlineChatUnit]: { status: 'unparsable' } })

        const { database, incomplete } = await resolveLegacyTree(golden.tree, readerOver(units), OPTIONS)

        expect(firstMessages(charOf(database, 'cha-inline'))[1]).toBe(formatColdStorageLoadError(ID.inlineChatUnit))
        expect(incomplete).toEqual([expect.objectContaining({ kind: 'chat', key: ID.inlineChatUnit, reason: 'invalid' })])
    })

    test('a load-error chat whose unit starts with a pointer keeps its text and is listed as invalid', async () => {
        const golden = await loadGolden('upstream-full.bin')
        const units = withUnits(golden, { [ID.errorTextUnit]: { status: 'ok', value: { message: [{ time: 1, data: coldStorageHeader + ID.blobChatUnit, role: 'char' }] } } })

        const { database, incomplete } = await resolveLegacyTree(golden.tree, readerOver(units), OPTIONS)

        expect(firstMessages(charOf(database, 'cha-inline'))[2]).toBe(formatColdStorageLoadError(ID.errorTextUnit))
        expect(incomplete).toEqual([expect.objectContaining({ kind: 'chat', key: ID.errorTextUnit, reason: 'invalid' })])
    })
    test('a legacy bare message array is a chat unit and leaves the chat\'s own side fields', async () => {
        const golden = await loadGolden('fork-full.bin')
        const units = withUnits(golden, { [ID.inlineChatUnit]: { status: 'ok', value: [{ time: 1, data: 'bare', role: 'user' }] } })

        const { database } = await resolveLegacyTree(golden.tree, readerOver(units), OPTIONS)

        const chat = chatsOf(charOf(database, 'cha-inline'))[1]
        expect((chat.message as Obj[])[0].data).toBe('bare')
        expect(chat.hypaV3Data).toEqual({ summaries: [] })
    })

    test('an object unit without a side field clears the chat\'s own, as a lazy load does', async () => {
        const golden = await loadGolden('fork-full.bin')
        const units = withUnits(golden, { [ID.inlineChatUnit]: { status: 'ok', value: { message: [{ time: 1, data: 'plain', role: 'user' }] } } })

        const { database } = await resolveLegacyTree(golden.tree, readerOver(units), OPTIONS)

        const chat = chatsOf(charOf(database, 'cha-inline'))[1]
        expect(Object.hasOwn(chat, 'hypaV2Data')).toBe(false)
        expect(Object.hasOwn(chat, 'scriptstate')).toBe(false)
    })
})

describe('new behaviour: plugin storage values', () => {
    test('a mapped unit with no entry keeps the mapping without the value and is named', async () => {
        const golden = await loadGolden('upstream-plugin-object-no-entry.bin')

        const { database, incomplete } = await resolveLegacyTree(golden.tree, readerOver(golden.units), OPTIONS)

        const storage = database.pluginCustomStorage as Obj
        expect(storage._coldplugin).toEqual({ prefs: ID.pluginUnit })
        expect(Object.hasOwn(storage, ID.pluginUnit)).toBe(false)
        expect(incomplete).toEqual([{ kind: 'plugin', slotKey: 'prefs', key: ID.pluginUnit, reason: 'missing' }])
    })

    test('a unit id that is already a plain plugin storage key keeps the plain value, lists the cold value as a collision and does not throw', async () => {
        const golden = await loadGolden('fork-full.bin')
        const tree = {
            ...golden.tree,
            pluginCustomStorage: { ...(golden.tree.pluginCustomStorage as Obj), [ID.pluginUnit]: 'plain value' },
        } as unknown as Database

        const { database, incomplete } = await resolveLegacyTree(tree, readerOver(golden.units), OPTIONS)

        expect((database.pluginCustomStorage as Obj)[ID.pluginUnit]).toBe('plain value')
        expect(incomplete).toEqual([{ kind: 'plugin', slotKey: 'prefs', key: ID.pluginUnit, reason: 'collision' }])
    })

    test('two slots mapped to one unit place its value once and report no collision', async () => {
        const golden = await loadGolden('fork-full.bin')
        const tree = {
            ...golden.tree,
            pluginCustomStorage: { _coldplugin: { a: ID.pluginUnit, b: ID.pluginUnit } },
        } as unknown as Database

        const { database, incomplete } = await resolveLegacyTree(tree, readerOver(golden.units), OPTIONS)

        expect(incomplete).toEqual([])
        expect((database.pluginCustomStorage as Obj)[ID.pluginUnit]).toEqual({ theme: 'dark', count: 3 })
    })

    test('a key that cannot be a storage name is never offered to the reader and counts as missing', async () => {
        const golden = await loadGolden('fork-full.bin')
        const tree = { ...golden.tree, characters: [], pluginCustomStorage: { _coldplugin: { odd: '../not-a-uuid' } } } as unknown as Database
        const reader = readerOver(golden.units)

        const { incomplete } = await resolveLegacyTree(tree, reader, OPTIONS)

        expect(reader.reads).toEqual([])
        expect(incomplete).toEqual([{ kind: 'plugin', slotKey: 'odd', key: '../not-a-uuid', reason: 'missing' }])
    })
})

/**
 * Upstream's plugin storage index in a legacy tree. Tests labelled `reproducer` fail on a resolve that does not convert
 * the index (the pointer then travels as a plain plugin storage key with no value behind it); `guard` ones pin a rule
 * that holds with or without the conversion.
 */
describe('upstream plugin storage index', () => {
    const IDX = {
        index: '00000000-0000-4000-8000-0000000000c1',
        large: '00000000-0000-4000-8000-0000000000c2',
        shadowed: '00000000-0000-4000-8000-0000000000c3',
        kept: '00000000-0000-4000-8000-0000000000c4',
    } as const
    const INDEX_VALUE = {
        type: 'risu-plugin-storage-index',
        version: 1,
        entries: [
            { k: 'textKey', s: '"he said \\"hi\\""' },
            { k: 'objKey', s: '{"theme":"dark","list":[1,2,null]}' },
            { k: 'bigKey', l: IDX.large },
            { k: 'shared', s: '{"from":"index"}' },
        ],
        trash: [{ k: 'trashed', s: '"gone"' }],
    }
    const LARGE_VALUE = { big: ['a', 'b', 'c'] }

    function unitsOf(extra: Record<string, StoredUnit> = {}): Map<string, StoredUnit> {
        return new Map<string, StoredUnit>([
            [IDX.index, { status: 'ok', value: INDEX_VALUE }],
            [IDX.large, { status: 'ok', value: LARGE_VALUE }],
            [IDX.shadowed, { status: 'ok', value: { from: 'fork' } }],
            [IDX.kept, { status: 'ok', value: ['kept'] }],
            ...Object.entries(extra),
        ])
    }

    function treeOf(storage: Obj): Database {
        return { characters: [], pluginCustomStorage: storage } as unknown as Database
    }

    function indexedTree(): Database {
        return treeOf({ _coldpluginIndex: IDX.index, _coldplugin: { shared: IDX.shadowed, kept: IDX.kept } })
    }

    function counterMint(): () => string {
        let next = 0
        return () => `00000000-0000-4000-8000-0000000001${String(next++).padStart(2, '0')}`
    }

    function valuesOf(database: Database): Record<string, unknown> {
        const storage = database.pluginCustomStorage as Obj
        const values: Record<string, unknown> = {}
        for (const [slot, id] of Object.entries(storage._coldplugin as Record<string, string>)) {
            values[slot] = storage[id]
        }
        return values
    }

    async function outcomeOf(promise: Promise<unknown>): Promise<unknown> {
        return promise.then(() => 'resolved', (error: unknown) => error)
    }

    test('reproducer: small entries become units of equal value, a large entry keeps its id, the index wins over the fork map and the pointer is gone', async () => {
        const tree = indexedTree()

        const { database, incomplete } = await resolveLegacyTree(tree, readerOver(unitsOf()), { ...OPTIONS, newUnitId: counterMint() })

        expect(incomplete).toEqual([])
        const storage = database.pluginCustomStorage as Obj
        expect(Object.hasOwn(storage, '_coldpluginIndex')).toBe(false)
        expect(valuesOf(database)).toEqual({
            textKey: 'he said "hi"',
            objKey: { theme: 'dark', list: [1, 2, null] },
            bigKey: LARGE_VALUE,
            shared: { from: 'index' },
            kept: ['kept'],
        })
        const slots = storage._coldplugin as Record<string, string>
        expect(slots.bigKey).toBe(IDX.large)
        expect(slots.kept).toBe(IDX.kept)
        expect(slots.shared).not.toBe(IDX.shadowed)
        expect(Object.hasOwn(storage, 'trashed')).toBe(false)
        expect(Object.values(storage).includes('gone')).toBe(false)
    })

    test('reproducer: the minted units are placed under the injected minter\'s ids, not under the placeholder chat id', async () => {
        const { database } = await resolveLegacyTree(indexedTree(), readerOver(unitsOf()), { ...OPTIONS, newUnitId: counterMint() })

        const slots = (database.pluginCustomStorage as Obj)._coldplugin as Record<string, string>
        expect([slots.textKey, slots.objKey, slots.shared]).toEqual([
            '00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102',
        ])
    })

    test('reproducer: without an injected minter the ids are fresh unit ids even when newId is pinned to a constant', async () => {
        const { database, incomplete } = await resolveLegacyTree(indexedTree(), readerOver(unitsOf()), OPTIONS)

        expect(incomplete).toEqual([])
        const slots = (database.pluginCustomStorage as Obj)._coldplugin as Record<string, string>
        const minted = [slots.textKey, slots.objKey, slots.shared]
        expect(new Set(minted).size).toBe(3)
        for (const id of minted) {
            expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/)
        }
        expect(valuesOf(database).objKey).toEqual({ theme: 'dark', list: [1, 2, null] })
    })

    test('guard: the database is not modified and the original tree keeps the pointer', async () => {
        const tree = indexedTree()
        const before = structuredClone(tree)

        const { database } = await resolveLegacyTree(tree, readerOver(unitsOf()), { ...OPTIONS, newUnitId: counterMint() })

        expect(tree).toEqual(before)
        expect(database.pluginCustomStorage).not.toBe(tree.pluginCustomStorage)
    })

    test('reproducer: the converted tree encodes and assembles back with every value', async () => {
        const { database } = await resolveLegacyTree(indexedTree(), readerOver(unitsOf()), { ...OPTIONS, newUnitId: counterMint() })

        const { assembled } = encodeAndAssemble(encodable(database))

        expect(assembled.pluginCustomStorage ?? {}).toEqual(database.pluginCustomStorage ?? {})
        expect(Object.hasOwn(assembled.pluginCustomStorage ?? {}, '_coldpluginIndex')).toBe(false)
    })

    test.each([['an empty string', ''], ['a number', 7], ['an object', { id: 'x' }]])('guard: a pointer that is %s is no pointer; the resolve neither reads nor lists anything', async (_label, pointer) => {
        const reader = readerOver(unitsOf())
        const tree = treeOf({ _coldpluginIndex: pointer, _coldplugin: { kept: IDX.kept } })

        const { database, incomplete } = await resolveLegacyTree(tree, reader, OPTIONS)

        expect(incomplete).toEqual([])
        expect(reader.reads).toEqual([IDX.kept])
        expect((database.pluginCustomStorage as Obj)._coldpluginIndex).toEqual(pointer)
    })

    test('reproducer: an index unit that is absent is listed once and the pointer is dropped; the fork map stays', async () => {
        const units = unitsOf()
        units.delete(IDX.index)

        const { database, incomplete } = await resolveLegacyTree(indexedTree(), readerOver(units), OPTIONS)

        expect(incomplete).toEqual([{ kind: 'plugin', slotKey: '_coldpluginIndex', key: IDX.index, reason: 'missing' }])
        const storage = database.pluginCustomStorage as Obj
        expect(Object.hasOwn(storage, '_coldpluginIndex')).toBe(false)
        expect(storage._coldplugin).toEqual({ shared: IDX.shadowed, kept: IDX.kept })
        expect(storage[IDX.kept]).toEqual(['kept'])
    })

    test('reproducer: an index unit of another shape is listed like an absent one', async () => {
        const units = unitsOf({ [IDX.index]: { status: 'ok', value: { type: 'something-else' } } })

        const { database, incomplete } = await resolveLegacyTree(indexedTree(), readerOver(units), OPTIONS)

        expect(incomplete).toEqual([{ kind: 'plugin', slotKey: '_coldpluginIndex', key: IDX.index, reason: 'missing' }])
        expect(Object.hasOwn(database.pluginCustomStorage as Obj, '_coldpluginIndex')).toBe(false)
    })

    test('reproducer: a pointer that cannot be a unit id is listed without being offered to the reader', async () => {
        const reader = readerOver(unitsOf())
        const tree = treeOf({ _coldpluginIndex: '../not-a-uuid' })

        const { database, incomplete } = await resolveLegacyTree(tree, reader, OPTIONS)

        expect(reader.reads).toEqual([])
        expect(incomplete).toEqual([{ kind: 'plugin', slotKey: '_coldpluginIndex', key: '../not-a-uuid', reason: 'missing' }])
        expect(Object.hasOwn(database.pluginCustomStorage as Obj, '_coldpluginIndex')).toBe(false)
    })

    test('reproducer: a large entry whose unit is absent keeps its slot and is listed under the plugin key', async () => {
        const units = unitsOf()
        units.delete(IDX.large)

        const { database, incomplete } = await resolveLegacyTree(indexedTree(), readerOver(units), { ...OPTIONS, newUnitId: counterMint() })

        expect(incomplete).toEqual([{ kind: 'plugin', slotKey: 'bigKey', key: IDX.large, reason: 'missing' }])
        const storage = database.pluginCustomStorage as Obj
        expect((storage._coldplugin as Obj).bigKey).toBe(IDX.large)
        expect(Object.hasOwn(storage, IDX.large)).toBe(false)
        expect(valuesOf(database).objKey).toEqual({ theme: 'dark', list: [1, 2, null] })
    })

    test('reproducer: a small entry whose text is not JSON is listed and its key is not mapped to an empty value', async () => {
        const broken = { ...INDEX_VALUE, entries: [{ k: 'badKey', s: '{not json' }, { k: 'bigKey', l: IDX.large }] }
        const units = unitsOf({ [IDX.index]: { status: 'ok', value: broken } })

        const { database, incomplete } = await resolveLegacyTree(indexedTree(), readerOver(units), { ...OPTIONS, newUnitId: counterMint() })

        expect(incomplete).toEqual([{ kind: 'plugin', slotKey: 'badKey', key: IDX.index, reason: 'missing' }])
        const slots = (database.pluginCustomStorage as Obj)._coldplugin as Record<string, string>
        expect(Object.hasOwn(slots, 'badKey')).toBe(false)
    })

    test('reproducer: the same bad small entries are listed identically whatever ids are minted, one item per plugin key', async () => {
        const broken = { ...INDEX_VALUE, entries: [{ k: 'badKey', s: '{not json' }, { k: 'worseKey', s: 'also not json' }] }
        const resolveWith = async (newUnitId: () => string) => {
            const units = unitsOf({ [IDX.index]: { status: 'ok', value: broken } })
            return (await resolveLegacyTree(indexedTree(), readerOver(units), { ...OPTIONS, newUnitId })).incomplete
        }

        const first = await resolveWith(counterMint())
        let offset = 0x900
        const second = await resolveWith(() => `00000000-0000-4000-8000-${(offset++).toString(16).padStart(12, '0')}`)

        expect(first).toEqual([
            { kind: 'plugin', slotKey: 'badKey', key: IDX.index, reason: 'missing' },
            { kind: 'plugin', slotKey: 'worseKey', key: IDX.index, reason: 'missing' },
        ])
        expect(second).toEqual(first)
    })

    test('reproducer: a minted id that is already a plain plugin storage key keeps the plain value and is listed as a collision', async () => {
        const taken = '00000000-0000-4000-8000-000000000100'
        const tree = treeOf({ _coldpluginIndex: IDX.index, [taken]: 'plain value' })

        const { database, incomplete } = await resolveLegacyTree(tree, readerOver(unitsOf()), { ...OPTIONS, newUnitId: counterMint() })

        expect((database.pluginCustomStorage as Obj)[taken]).toBe('plain value')
        expect(incomplete).toEqual([{ kind: 'plugin', slotKey: 'textKey', key: taken, reason: 'collision' }])
    })

    describe('a failed read (a rejection or an error status) aborts the resolve instead of becoming an incomplete item', () => {
        test.each([['an error status', 'errorKeys'], ['a rejection', 'throwKeys']] as const)('reproducer: the index unit read ends in %s', async (_label, fault) => {
            const reader = readerOver(unitsOf(), { [fault]: new Set([IDX.index]) })

            const outcome = await outcomeOf(resolveLegacyTree(indexedTree(), reader, OPTIONS))

            expect(outcome).toBeInstanceOf(LegacyReadError)
            expect((outcome as LegacyReadError).key).toBe(IDX.index)
        })

        test.each([['an error status', 'errorKeys'], ['a rejection', 'throwKeys']] as const)('reproducer: a large unit read ends in %s', async (_label, fault) => {
            const reader = readerOver(unitsOf(), { [fault]: new Set([IDX.large]) })

            const outcome = await outcomeOf(resolveLegacyTree(indexedTree(), reader, { ...OPTIONS, newUnitId: counterMint() }))

            expect(outcome).toBeInstanceOf(LegacyReadError)
            expect((outcome as LegacyReadError).key).toBe(IDX.large)
        })

        test('reproducer: an index unit that is not JSON is damaged content: listed like an absent one, pointer dropped, nothing thrown', async () => {
            const units = unitsOf({ [IDX.index]: { status: 'unparsable' } })

            const { database, incomplete } = await resolveLegacyTree(indexedTree(), readerOver(units), OPTIONS)

            expect(incomplete).toEqual([{ kind: 'plugin', slotKey: '_coldpluginIndex', key: IDX.index, reason: 'missing' }])
            expect(Object.hasOwn(database.pluginCustomStorage as Obj, '_coldpluginIndex')).toBe(false)
        })

        test('reproducer: a large unit that is not JSON is listed under its plugin key like a fork plugin unit, nothing thrown', async () => {
            const units = unitsOf({ [IDX.large]: { status: 'unparsable' } })

            const { database, incomplete } = await resolveLegacyTree(indexedTree(), readerOver(units), { ...OPTIONS, newUnitId: counterMint() })

            expect(incomplete).toEqual([{ kind: 'plugin', slotKey: 'bigKey', key: IDX.large, reason: 'missing' }])
            expect(Object.hasOwn(database.pluginCustomStorage as Obj, IDX.large)).toBe(false)
        })

        test('pin: a unit of the fork\'s own map that is not JSON stays an incomplete item, as before the index existed', async () => {
            const units = unitsOf({ [IDX.kept]: { status: 'unparsable' } })

            const { incomplete } = await resolveLegacyTree(indexedTree(), readerOver(units), { ...OPTIONS, newUnitId: counterMint() })

            expect(incomplete).toEqual([{ kind: 'plugin', slotKey: 'kept', key: IDX.kept, reason: 'missing' }])
        })
    })
})

describe('new behaviour: a read error aborts the whole resolve', () => {
    // The four places a unit is read: a stub's unit, a pointer chat of an inline character, a pointer chat inside a stub's unit and a plugin value.
    const SITES = [
        ['the stub unit', ID.stubBlob],
        ['a pointer chat of an inline character', ID.inlineChatUnit],
        ['a pointer chat inside a stub unit', ID.blobChatUnit],
        ['a plugin value', ID.pluginUnit],
    ] as const

    describe.each([['an error status', 'errorKeys'], ['a rejection', 'throwKeys']] as const)('%s', (_label, fault) => {
        test.each(SITES)('at %s: the resolve rejects with a LegacyReadError naming the unit and returns nothing', async (_site, key) => {
            const golden = await loadGolden('fork-full.bin')
            const reader = readerOver(golden.units, { [fault]: new Set([key]) })

            const outcome = await resolveLegacyTree(golden.tree, reader, OPTIONS).then(
                () => 'resolved',
                (error: unknown) => error,
            )

            expect(outcome).toBeInstanceOf(LegacyReadError)
            expect((outcome as LegacyReadError).key).toBe(key)
        })
    })

    test('an absent unit is not a read error', async () => {
        const golden = await loadGolden('fork-full.bin')
        const units = new Map(golden.units)
        units.delete(ID.inlineChatUnit)

        const { incomplete } = await resolveLegacyTree(golden.tree, readerOver(units), OPTIONS)

        expect(incomplete).toEqual([expect.objectContaining({ kind: 'chat', key: ID.inlineChatUnit, reason: 'missing' })])
    })
})

describe('new behaviour: the resolved trees encode', () => {
    test.each(ALL_GOLDENS)('%s encodes and assembles back equal', async (file) => {
        const golden = await loadGolden(file)

        const { database } = await resolveLegacyTree(golden.tree, readerOver(golden.units), OPTIONS)
        const { assembled } = encodeAndAssemble(encodable(database))

        expect(JSON.parse(JSON.stringify(assembled.characters))).toEqual(JSON.parse(JSON.stringify(database.characters)))
        expect(assembled.pluginCustomStorage ?? {}).toEqual(database.pluginCustomStorage ?? {})
    })

    test.each(ALL_GOLDENS)('guard: %s unresolved is refused by the codec, so a pointer never reaches it', async (file) => {
        const golden = await loadGolden(file)
        const hasPointer = chars(golden.tree).some(c => Boolean(c.coldstorage) || firstMessages(c).some(text => text.startsWith(coldStorageHeader)))
        if (!hasPointer) {
            return
        }

        expect(() => encodeDatabase(encodable(golden.tree), { env: seededEnv(1), lists: fakeLists, seq: 1, createdAt: 1 })).toThrow(StubRefusedError)
    })

    test('ids: the entity id is minted by the codec, never a unit uuid', async () => {
        const golden = await loadGolden('fork-full.bin')
        const { database } = await resolveLegacyTree(golden.tree, readerOver(golden.units), OPTIONS)

        const { tree } = encodeAndAssemble(encodable(database))

        const entityIds = [...tree.index.entities.values()]
        expect(entityIds).toHaveLength(2)
        const unitIds = Object.values(ID) as string[]
        for (const u of entityIds) {
            expect(u).toHaveLength(26)
            expect(unitIds.some(id => u.includes(id.replaceAll('-', '')) || u === id)).toBe(false)
        }
        const shardEntries = (tree.index.objects?.shards ?? []).flatMap(shard => shard.entries)
        expect(shardEntries.map(entry => entry.u).sort()).toEqual([...entityIds].sort())
        expect(JSON.stringify(shardEntries)).not.toContain(ID.stubBlob)
        expect(chars(database).every(c => !Object.hasOwn(c, 'u'))).toBe(true)
    })
})
