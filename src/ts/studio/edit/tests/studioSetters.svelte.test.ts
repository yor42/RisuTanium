// @vitest-environment jsdom
// The setter half of a Studio write, without the service: the guards in their fixed order, the live
// reader, the op builders and the functions handed to writeLive*. The marks and the history around
// them are tested through the service in ownerHistory.svelte.test.ts.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { characterOwnerKey, chatOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { commitStep, createModelState, deriveRestoreWrites, emptyRecord, planReplay } from 'src/ts/studio/history/historyModel'
import { listFingerprintOf } from 'src/ts/studio/history/listFingerprint'
import type { Chat, character } from 'src/ts/storage/database.svelte'
import {
    applyCharacterWrites,
    applyChatWrites,
    buildFieldEdit,
    buildGreetingAdd,
    buildGreetingDelete,
    buildGreetingEdit,
    createLiveReader,
    isRestrictedChaId,
    resolveLiveTarget,
    uniqueChatById,
    type LiveTarget,
} from '../studioSetters'

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
    }
})

interface LiveChat {
    id?: string
    note: string
    fmIndex?: number
}

interface LiveCharacter {
    chaId: string
    type?: string
    license?: string
    coldstorage?: string
    desc: string
    hideChatIcon?: boolean
    alternateGreetings: string[]
    chats: LiveChat[]
    chatPage: number
}

function makeCharacter(chaId: string, overrides: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId,
        desc: 'd0',
        alternateGreetings: ['g0', 'g1', 'g2'],
        chats: [{ id: 'c1', note: 'n0', fmIndex: 2 }],
        chatPage: 0,
        ...overrides,
    }
}

function put(...characters: LiveCharacter[]): void {
    DBState.db.characters = characters as unknown as typeof DBState.db.characters
}

const A = characterOwnerKey('A')

function targetOf(live: LiveCharacter, chat: LiveChat | null = null): LiveTarget {
    return { character: live as unknown as character, chat: chat as unknown as Chat | null }
}

beforeEach(() => {
    resetStudioScreenForTests()
    put(makeCharacter('A'))
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    resetStudioScreenForTests()
})

describe('resolveLiveTarget: the guards in their fixed order', () => {
    test('a clean selected character resolves; a chat owner resolves its chat by id', () => {
        expect(resolveLiveTarget(A)).toMatchObject({ ok: true, target: { chat: null } })
        const chat = resolveLiveTarget(chatOwnerKey('A', 'c1'))
        expect(chat.ok).toBe(true)
        expect(chat.ok && chat.target.chat?.note).toBe('n0')
    })

    test('each refusal wins over every later one', () => {
        // Not selected, duplicated, a group, private, archived, no chat: all at once.
        put(
            makeCharacter('A', { type: 'group', license: 'private', coldstorage: 'x', chats: [{ id: 'd', note: '' }, { id: 'd', note: '' }] }),
            makeCharacter('A'),
        )
        studioScreen.chaId = 'other'
        const chat = chatOwnerKey('A', 'd')
        expect(resolveLiveTarget(chat)).toEqual({ ok: false, reason: 'not-selected' })
        studioScreen.chaId = 'A'
        expect(resolveLiveTarget(chat)).toEqual({ ok: false, reason: 'duplicate-id' })
        put(makeCharacter('A', { type: 'group', license: 'private', coldstorage: 'x', chats: [{ id: 'd', note: '' }, { id: 'd', note: '' }] }))
        expect(resolveLiveTarget(chat)).toEqual({ ok: false, reason: 'group' })
        put(makeCharacter('A', { license: 'private', coldstorage: 'x', chats: [{ id: 'd', note: '' }, { id: 'd', note: '' }] }))
        expect(resolveLiveTarget(chat)).toEqual({ ok: false, reason: 'restricted' })
        put(makeCharacter('A', { coldstorage: 'x', chats: [{ id: 'd', note: '' }, { id: 'd', note: '' }] }))
        expect(resolveLiveTarget(chat)).toEqual({ ok: false, reason: 'gone' })
        put(makeCharacter('A', { chats: [{ id: 'd', note: '' }, { id: 'd', note: '' }] }))
        expect(resolveLiveTarget(chat)).toEqual({ ok: false, reason: 'no-unique-chat' })
    })

    test('T-SM4: a chaId held twice is refused, whichever holder is selected', () => {
        put(makeCharacter('A'), makeCharacter('A', { desc: 'the second holder' }))
        expect(resolveLiveTarget(A)).toEqual({ ok: false, reason: 'duplicate-id' })
        selIdState.selId = 1
        expect(resolveLiveTarget(A)).toEqual({ ok: false, reason: 'duplicate-id' })
    })

    test('an owner key that names no id, and a chat without an id, resolve to nothing', () => {
        expect(resolveLiveTarget(chatOwnerKey('A', ''))).toEqual({ ok: false, reason: 'gone' })
        put(makeCharacter('A', { chats: [{ note: 'no id' }] }))
        expect(resolveLiveTarget(chatOwnerKey('A', 'anything'))).toEqual({ ok: false, reason: 'no-unique-chat' })
    })

    test('isRestrictedChaId: private and group, never a missing character', () => {
        expect(isRestrictedChaId('A')).toBe(false)
        put(makeCharacter('A', { license: 'private' }))
        expect(isRestrictedChaId('A')).toBe(true)
        put(makeCharacter('A', { type: 'group' }))
        expect(isRestrictedChaId('A')).toBe(true)
        expect(isRestrictedChaId('missing')).toBe(false)
    })

    test('uniqueChatById needs one match and a non-empty id', () => {
        const chats = [{ id: 'a', note: '' }, { id: 'a', note: '' }, { id: 'b', note: '' }] as unknown as Chat[]
        expect(uniqueChatById(chats, 'a')).toBeNull()
        expect(uniqueChatById(chats, 'b')).toBe(chats[2])
        expect(uniqueChatById(chats, '')).toBeNull()
        expect(uniqueChatById(undefined, 'b')).toBeNull()
    })
})

describe('the live reader', () => {
    test('reads present and absent fields, the greeting list and a chat\'s fmIndex by unique id', () => {
        const live = makeCharacter('A', { chats: [{ id: 'one', note: 'n', fmIndex: 3 }, { id: 'dup', note: '' }, { id: 'dup', note: '' }] })
        const reader = createLiveReader(targetOf(live, live.chats[0]))
        expect(reader.field('desc')).toEqual({ had: true, value: 'd0' })
        expect(reader.field('hideChatIcon')).toEqual({ had: false })
        expect(reader.field('note')).toEqual({ had: true, value: 'n' })
        expect(reader.greetings()).toEqual(['g0', 'g1', 'g2'])
        expect(reader.fmIndex('one')).toEqual({ had: true, value: 3 })
        expect(reader.fmIndex('dup')).toBeNull()
        expect(reader.fmIndex('missing')).toBeNull()
    })

    test('a character without a greeting list reads as null', () => {
        const live = makeCharacter('A')
        delete (live as Partial<LiveCharacter>).alternateGreetings
        expect(createLiveReader(targetOf(live)).greetings()).toBeNull()
    })
})

describe('the op builders', () => {
    test('a field edit records the before and the after; an unchanged or mistyped value builds nothing', () => {
        const reader = createLiveReader(targetOf(makeCharacter('A')))
        const built = buildFieldEdit('desc', 'new', reader)
        expect(built).toMatchObject({
            ok: true,
            coalesceKey: 'desc',
            ops: [{ op: 'set', path: 'desc', before: { had: true, value: 'd0' }, after: { had: true, value: 'new' } }],
        })
        expect(buildFieldEdit('desc', 'd0', reader)).toEqual({ ok: false, reason: 'unchanged' })
        expect(buildFieldEdit('desc', true, reader)).toEqual({ ok: false, reason: 'precondition' })
        expect(buildFieldEdit('hideChatIcon', 'yes', reader)).toEqual({ ok: false, reason: 'precondition' })
        const absent = buildFieldEdit('hideChatIcon', false, reader)
        expect(absent).toMatchObject({ ok: true, ops: [{ before: { had: false }, after: { had: true, value: false } }] })
    })

    test('greeting add appends an empty one; edit keys its coalescing by index; both refuse out of range', () => {
        const reader = createLiveReader(targetOf(makeCharacter('A')))
        expect(buildGreetingAdd(reader)).toMatchObject({ ok: true, ops: [{ op: 'listInsert', index: 3, value: '' }], coalesceKey: null })
        expect(buildGreetingEdit(1, 'x', reader)).toMatchObject({ ok: true, coalesceKey: 'alternateGreetings:1' })
        expect(buildGreetingEdit(1, 'g1', reader)).toEqual({ ok: false, reason: 'unchanged' })
        expect(buildGreetingEdit(7, 'x', reader)).toEqual({ ok: false, reason: 'precondition' })
    })

    test('T56d a built greeting add commits a fingerprint, and its undo next to an equal neighbour applies', () => {
        const live = makeCharacter('A', { alternateGreetings: ['', 'g'] })
        const reader = createLiveReader(targetOf(live))
        const built = buildGreetingAdd(reader)
        if (built.ok === false) throw new Error('the add must build')
        const greetingsBefore = [...live.alternateGreetings]
        live.alternateGreetings.push('')
        const state = commitStep(createModelState(emptyRecord(characterOwnerKey('A'), 0)), {
            id: 'p:1',
            at: 1,
            visitId: 'v1',
            label: built.label,
            ops: built.ops,
            restoreWrites: deriveRestoreWrites(built.ops, greetingsBefore),
            coalesceKey: built.coalesceKey,
            replacesRestore: true,
        })
        expect(state.record.done[0].listFingerprint).toStrictEqual({
            before: listFingerprintOf(['', 'g']),
            after: listFingerprintOf(['', 'g', '']),
        })
        const plan = planReplay(state.record, 'undo', createLiveReader(targetOf(live)))
        expect(plan.ok).toBe(true)
    })

    test('a delete carries the fmIndex side op: by chat id when unique, by page index when not', () => {
        const live = makeCharacter('A')
        const unique = buildGreetingDelete(1, 'd1', targetOf(live), createLiveReader(targetOf(live)))
        expect(unique).toMatchObject({
            ok: true,
            pageFm: false,
            ops: [
                { op: 'listRemove', index: 1, value: 'g1', deletedId: 'd1' },
                { op: 'chatFm', chatId: 'c1', before: { had: true, value: 2 }, after: { had: true, value: -1 } },
            ],
            writes: [{ op: 'listRemove', index: 1 }, { op: 'chatFm', chatId: 'c1', value: { had: true, value: -1 } }],
        })

        const idless = makeCharacter('A', { chats: [{ note: '', fmIndex: 1 }] })
        const byIndex = buildGreetingDelete(0, 'd2', targetOf(idless), createLiveReader(targetOf(idless)))
        expect(byIndex).toMatchObject({ ok: true, pageFm: true, ops: [{ op: 'listRemove' }, { op: 'chatFm', chatId: null }] })
        expect(byIndex.ok && byIndex.writes).toEqual([{ op: 'listRemove', index: 0 }])

        const chatless = makeCharacter('A', { chats: [] })
        const noChat = buildGreetingDelete(0, 'd3', targetOf(chatless), createLiveReader(targetOf(chatless)))
        expect(noChat).toMatchObject({ ok: true, pageFm: false, ops: [{ op: 'listRemove' }] })
        expect(buildGreetingDelete(9, 'd4', targetOf(live), createLiveReader(targetOf(live)))).toEqual({ ok: false, reason: 'precondition' })
    })
})

describe('the write functions', () => {
    test('a field set to absent deletes the key; it never assigns false or undefined', () => {
        const live = makeCharacter('A', { hideChatIcon: true })
        applyCharacterWrites(live as unknown as character, [{ op: 'set', path: 'hideChatIcon', value: { had: false } }], false)
        expect('hideChatIcon' in live).toBe(false)
        applyCharacterWrites(live as unknown as character, [{ op: 'set', path: 'hideChatIcon', value: { had: true, value: false } }], false)
        expect(live.hideChatIcon).toBe(false)
    })

    test('list writes run in order; chatFm acts on the unique chat; pageFm acts on the context chat', () => {
        const live = makeCharacter('A', { chats: [{ id: 'c1', note: '', fmIndex: 4 }, { note: '', fmIndex: 1 }], chatPage: 1 })
        applyCharacterWrites(
            live as unknown as character,
            [
                { op: 'listRemove', index: 0 },
                { op: 'listInsert', index: 1, value: 'new' },
                { op: 'listSet', index: 0, value: 'g1!' },
                { op: 'chatFm', chatId: 'c1', value: { had: false } },
                { op: 'chatFm', chatId: 'gone', value: { had: true, value: 9 } },
            ],
            true,
        )
        expect(live.alternateGreetings).toEqual(['g1!', 'new', 'g2'])
        expect('fmIndex' in live.chats[0]).toBe(false)
        expect(live.chats[1].fmIndex).toBe(-1)
    })

    test('a group is never written', () => {
        const group = { type: 'group', chaId: 'G', alternateGreetings: ['g'] }
        applyCharacterWrites(group as unknown as character, [{ op: 'listInsert', index: 0, value: 'x' }], false)
        expect(group.alternateGreetings).toEqual(['g'])
    })

    test('a chat write sets only note', () => {
        const chat: LiveChat = { id: 'c1', note: 'n0', fmIndex: 2 }
        applyChatWrites(chat as unknown as Chat, [
            { op: 'set', path: 'desc', value: { had: true, value: 'no' } },
            { op: 'set', path: 'note', value: { had: true, value: 'n1' } },
            { op: 'listInsert', index: 0, value: 'no' },
        ])
        expect(chat).toEqual({ id: 'c1', note: 'n1', fmIndex: 2 })
    })
})
