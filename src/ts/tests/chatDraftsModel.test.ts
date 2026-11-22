/**
 * The pure rules over the persisted unsent message edits and hint flags: keying, lenient reading, counts for the `.bin`
 * warning, the 200-draft cap, duplicate keys and the reconcile with the profile's characters. PIN: the module is new, so each
 * test names the rule it fixes; its evidence is the mutant it kills.
 */
import { describe, expect, test } from 'vitest'
import { CHAT_DRAFT_CAP, capChatDrafts, chatDraftKey, countChatDrafts, narrowChatDrafts, persistTargetOf, reconcileChatDrafts } from 'src/ts/chatDraftsModel'
import type { ChatDraftEntry, PersistedEditDraft } from 'src/ts/storage/database.svelte'

const BH = '00112233445566778899aabbccddeeff'

function draft(m: string, at: number, extra: Record<string, unknown> = {}): PersistedEditDraft {
    return { m, text: `text ${m}`, bh: BH, at, ...extra }
}

describe('chatDraftKey', () => {
    test('keys by both ids without ambiguity between ("a b", "c") and ("a", "b c")', () => {
        expect(chatDraftKey('a b', 'c')).not.toBe(chatDraftKey('a', 'b c'))
        expect(chatDraftKey('a', 'b')).toBe(chatDraftKey('a', 'b'))
    })
})

describe('narrowChatDrafts', () => {
    test('a value that is not a list reads as nothing', () => {
        for (const value of [undefined, null, 3, 'x', {}, { cha: 'a', chat: 'b' }]) {
            expect(narrowChatDrafts(value)).toEqual([])
        }
    })

    test('an entry without string cha and chat, and a draft without the v1 fields, are dropped; extra keys are kept', () => {
        const kept: ChatDraftEntry = { cha: 'a', chat: 'b', shown: true, drafts: [draft('id:1', 5, { future: { deep: [1] } })], note: 'x' }
        const out = narrowChatDrafts([
            kept,
            { cha: 'a' },
            { chat: 'b' },
            { cha: 1, chat: 'b' },
            'junk',
            null,
            { cha: 'c', chat: 'd', drafts: [{ m: 'id:1', text: 'x', bh: BH }, { m: 1, text: 'x', bh: BH, at: 1 }, { m: 'id:2', text: 'x', bh: BH, at: Number.NaN }, 7, draft('id:3', 9)] },
        ])
        expect(out).toEqual([kept, { cha: 'c', chat: 'd', drafts: [draft('id:3', 9)] }])
    })

    test('a duplicate chat key keeps the newest draft of each message, ORs the flag and takes the other keys from the later copy', () => {
        const out = narrowChatDrafts([
            { cha: 'a', chat: 'b', drafts: [draft('id:1', 10, { v: 'old' }), draft('id:2', 20)], note: 'first', keep: 1 },
            { cha: 'a', chat: 'b', shown: true, drafts: [draft('id:1', 30, { v: 'new' })], note: 'second' },
            { cha: 'a', chat: 'b', shown: false, drafts: [draft('id:2', 5, { v: 'stale' })] },
        ])
        expect(out).toHaveLength(1)
        expect(out[0].shown).toBe(true)
        expect(out[0].note).toBe('second')
        expect(out[0].keep).toBe(1)
        expect(out[0].drafts).toEqual([draft('id:1', 30, { v: 'new' }), draft('id:2', 20)])
    })

    test('a tie on capture time keeps the first copy', () => {
        const out = narrowChatDrafts([{ cha: 'a', chat: 'b', drafts: [draft('id:1', 10, { v: 1 })] }, { cha: 'a', chat: 'b', drafts: [draft('id:1', 10, { v: 2 })] }])
        expect((out[0].drafts ?? [])[0].v).toBe(1)
    })

    test('a flag that is not exactly true is not kept, and the input is never changed', () => {
        const input = [{ cha: 'a', chat: 'b', shown: 'yes', drafts: [draft('id:1', 1)] }]
        const before = JSON.stringify(input)
        const out = narrowChatDrafts(input)
        expect(Object.hasOwn(out[0], 'shown')).toBe(false)
        expect(JSON.stringify(input)).toBe(before)
        expect(out[0]).not.toBe(input[0])
    })
})

describe('countChatDrafts', () => {
    test('counts the drafts and the chats whose flag is set, over what a reader can key', () => {
        expect(countChatDrafts([
            { cha: 'a', chat: 'b', shown: true, drafts: [draft('id:1', 1), draft('id:2', 2)] },
            { cha: 'a', chat: 'c', drafts: [draft('id:1', 3)] },
            { cha: 'a', chat: 'd', shown: true },
            { nothing: true },
        ])).toEqual({ drafts: 3, hintChats: 2 })
    })

    test('nothing, an empty list or unkeyable entries count zero', () => {
        for (const value of [undefined, [], [{ cha: 'a' }], [{ cha: 'a', chat: 'b' }], [{ cha: 'a', chat: 'b', drafts: [{ m: 'x' }] }]]) {
            expect(countChatDrafts(value)).toEqual({ drafts: 0, hintChats: 0 })
        }
    })

    test('a duplicate key is counted once', () => {
        expect(countChatDrafts([{ cha: 'a', chat: 'b', shown: true, drafts: [draft('id:1', 1)] }, { cha: 'a', chat: 'b', shown: true, drafts: [draft('id:1', 2)] }])).toEqual({ drafts: 1, hintChats: 1 })
    })
})

describe('capChatDrafts', () => {
    function many(count: number): ChatDraftEntry[] {
        return Array.from({ length: count }, (_, index) => ({ cha: `c${index % 7}`, chat: `chat${index % 3}`, drafts: [draft(`id:${index}`, 1000 + index)] }))
            .reduce<ChatDraftEntry[]>((all, entry) => {
                const held = all.find((candidate) => candidate.cha === entry.cha && candidate.chat === entry.chat)
                if (held === undefined) {
                    all.push(entry)
                } else {
                    held.drafts = [...(held.drafts ?? []), ...(entry.drafts ?? [])]
                }
                return all
            }, [])
    }

    test('the cap is 200', () => {
        expect(CHAT_DRAFT_CAP).toBe(200)
    })

    test('201 drafts keep the 200 newest and drop the oldest', () => {
        const out = capChatDrafts(many(201))
        const kept = out.flatMap((entry) => (entry.drafts ?? []).map((item) => item.at))
        expect(kept).toHaveLength(200)
        expect(Math.min(...kept)).toBe(1001)
        expect(Math.max(...kept)).toBe(1200)
    })

    test('a flag-only entry is kept and does not count toward the cap; an entry left empty without a flag goes', () => {
        const entries: ChatDraftEntry[] = [
            { cha: 'x', chat: 'flag', shown: true },
            { cha: 'x', chat: 'old', drafts: [draft('id:0', 1)] },
            { cha: 'x', chat: 'empty' },
            { cha: 'y', chat: 'new', drafts: [draft('id:1', 2), draft('id:2', 3)] },
        ]
        const out = capChatDrafts(entries, 2)
        expect(out.map((entry) => entry.chat)).toEqual(['flag', 'new'])
        expect(out[1].drafts).toHaveLength(2)
    })

    test('a tie on capture time is decided by chat key then message key, the later one kept', () => {
        const entries: ChatDraftEntry[] = [
            { cha: 'a', chat: '1', drafts: [draft('id:a', 5), draft('id:b', 5)] },
            { cha: 'b', chat: '1', drafts: [draft('id:a', 5)] },
        ]
        const out = capChatDrafts(entries, 2)
        expect(out.map((entry) => [entry.cha, (entry.drafts ?? []).map((item) => item.m)])).toEqual([['a', ['id:b']], ['b', ['id:a']]])
    })

    test('under the cap the entries are equal and the input is never changed', () => {
        const entries = many(5)
        const before = JSON.stringify(entries)
        expect(capChatDrafts(entries)).toEqual(entries)
        expect(JSON.stringify(entries)).toBe(before)
    })
})

describe('reconcileChatDrafts', () => {
    const entries: ChatDraftEntry[] = [
        { cha: 'live', chat: 'c1', drafts: [draft('id:1', 1)] },
        { cha: 'live', chat: 'gone', drafts: [draft('id:1', 1)] },
        { cha: 'missing', chat: 'c1', shown: true },
        { cha: 'stub', chat: 'unknown-chat', shown: true },
        { cha: 'dup', chat: 'in-second', drafts: [draft('id:1', 1)] },
        { cha: 'dup', chat: 'in-first', drafts: [draft('id:1', 1)] },
        { cha: 'group', chat: 'g1', shown: true },
    ]

    test('keeps the chats the profile has, a cold stub\'s entries, every slot of a shared chaId, and a group\'s chats', () => {
        const kept = reconcileChatDrafts(entries, [
            { chaId: 'live', chats: [{ id: 'c1' }, { id: 'c2' }] },
            { chaId: 'stub', coldstorage: 'uuid', chats: [{ id: 'placeholder' }] },
            { chaId: 'dup', chats: [{ id: 'in-first' }] },
            { chaId: 'dup', chats: [{ id: 'in-second' }] },
            { chaId: 'group', chats: [{ id: 'g1' }] },
        ])
        expect(kept.map((entry) => `${entry.cha}/${entry.chat}`)).toEqual(['live/c1', 'stub/unknown-chat', 'dup/in-second', 'dup/in-first', 'group/g1'])
    })

    test('a trashed slot is a slot: its entries stay (MC-3591); only a character no longer in the list loses them', () => {
        const trashed = { chaId: 'live', trashTime: 123, chats: [{ id: 'c1' }] } as { chaId: string, chats: { id: string }[] }
        expect(reconcileChatDrafts([entries[0]], [trashed])).toEqual([entries[0]])
        expect(reconcileChatDrafts([entries[0]], [])).toEqual([])
    })

    test('slots without a chaId and chats without an id never match an entry', () => {
        expect(reconcileChatDrafts([entries[0]], [{ chats: [{ id: 'c1' }] }, { chaId: 'live', chats: [{}] }])).toEqual([])
    })

    test('returns the input array itself when nothing is dropped', () => {
        const keep = [entries[0]]
        expect(reconcileChatDrafts(keep, [{ chaId: 'live', chats: [{ id: 'c1' }] }])).toBe(keep)
    })
})
describe('persistTargetOf', () => {
    test('T3.11: both ids must be non-empty strings, else the edit stays memory-only', () => {
        expect(persistTargetOf('cha', 'chat')).toEqual({ chaId: 'cha', chatId: 'chat' })
        for (const [chaId, chatId] of [['', 'chat'], ['cha', ''], [undefined, 'chat'], ['cha', undefined], [4, 'chat'], ['cha', null]]) {
            expect(persistTargetOf(chaId, chatId)).toBeUndefined()
        }
    })
})
