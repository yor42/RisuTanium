/**
 * Unit tests of `src/ts/chatImport.ts`, exercising the pure module directly.
 * Most are specification tests of its exports. The `chatNameFromFile` rows for
 * `.json` names are regression reproducers: a reader that keeps the extension
 * fails them by assertion. Behaviour through `importChat` is tested in
 * `characters.importChat.test.ts`.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Chat } from './storage/database.svelte'
import { isChatAltReadable, siblingsAt, switchTo, treeLeaves } from './process/chatTree'
import { branchPlanOf, branchSummaryOf } from './drive/exportBranches'
import {
    buildTavernTree,
    chatNameFromFile,
    detectJsonChatFormat,
    loadKoboldSettings,
    parseOobaTimestamp,
    parseTavernSendDate,
    readAgnaiChat,
    readCaiTurnsChat,
    readDumperChats,
    readKoboldChat,
    readMorseChats,
    readOobaChat,
    readTavernJsonl,
    tavernMessageName,
    unescapeHtmlEntities,
    type TavernLine,
} from './chatImport'

// Restoring by assignment: deleting TZ does not re-zone Date on every host.
const originalZone = Intl.DateTimeFormat().resolvedOptions().timeZone

const header = JSON.stringify({ user_name: 'U', character_name: 'C', create_date: '2024-01-01', chat_metadata: {} })
const msg = (mes: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ name: 'C', is_user: false, mes, ...extra })

describe('readTavernJsonl (unit)', () => {
    test('a header line is dropped and not counted', () => {
        const r = readTavernJsonl(`${header}\n${msg('a')}\n${msg('b', { is_user: true })}`)
        expect(r.messages).toEqual([{ isUser: false, mes: 'a', name: 'C' }, { isUser: true, mes: 'b', name: 'C' }])
        expect(r.skipped).toBe(0)
    })

    test('a header-less file keeps its first line', () => {
        const r = readTavernJsonl(`${msg('a')}\n${msg('b')}`)
        expect(r.messages.map((m) => m.mes)).toEqual(['a', 'b'])
    })

    test('a first line with header keys and a mes is a message', () => {
        const r = readTavernJsonl(`${msg('a', { user_name: 'U' })}\n${msg('b')}`)
        expect(r.messages.map((m) => m.mes)).toEqual(['a', 'b'])
    })

    test('a header-like line after the first line is not a header', () => {
        const r = readTavernJsonl(`${msg('a')}\n${header}`)
        expect(r.messages).toHaveLength(1)
        expect(r.skipped).toBe(1)
    })

    test('CRLF line endings are accepted', () => {
        const r = readTavernJsonl(`${header}\r\n${msg('a')}\r\n${msg('b')}\r\n`)
        expect(r.messages.map((m) => m.mes)).toEqual(['a', 'b'])
        expect(r.skipped).toBe(0)
    })

    test('blank lines are ignored and not counted, including before the header', () => {
        const r = readTavernJsonl(`\n${header}\n\n  \n${msg('a')}\n`)
        expect(r.messages).toHaveLength(1)
        expect(r.skipped).toBe(0)
    })

    test('an invalid JSON line in the middle is skipped and counted', () => {
        const r = readTavernJsonl(`${header}\n${msg('a')}\n{broken\n${msg('b')}`)
        expect(r.messages.map((m) => m.mes)).toEqual(['a', 'b'])
        expect(r.skipped).toBe(1)
    })

    test('a non-string mes is skipped and counted', () => {
        const r = readTavernJsonl([header, msg(5), msg([1]), msg('ok')].join('\n'))
        expect(r.messages.map((m) => m.mes)).toEqual(['ok'])
        expect(r.skipped).toBe(2)
    })

    test('an empty mes is ignored and not counted', () => {
        const r = readTavernJsonl([header, msg(''), msg('ok')].join('\n'))
        expect(r.messages).toHaveLength(1)
        expect(r.skipped).toBe(0)
    })

    test('array, null and primitive lines are skipped and counted', () => {
        const r = readTavernJsonl([header, '[1,2]', 'null', '7', msg('ok')].join('\n'))
        expect(r.messages).toHaveLength(1)
        expect(r.skipped).toBe(3)
    })

    test('is_user follows truthiness, not strict true', () => {
        const r = readTavernJsonl([msg('a', { is_user: 'true' }), msg('b', { is_user: 1 }), msg('c', { is_user: 0 }), JSON.stringify({ mes: 'd' })].join('\n'))
        expect(r.messages.map((m) => m.isUser)).toEqual([true, true, false, false])
    })

    test('a leading BOM is stripped so the header is recognised', () => {
        const r = readTavernJsonl(`\uFEFF${header}\n${msg('a')}`)
        expect(r.messages).toHaveLength(1)
        expect(r.skipped).toBe(0)
    })

    test('a first line with no mes and no header key is a counted skip', () => {
        const r = readTavernJsonl(`{}\n${msg('a')}`)
        expect(r.messages).toHaveLength(1)
        expect(r.skipped).toBe(1)
    })
})

describe('readTavernJsonl fields (unit)', () => {
    test('a plain line carries exactly isUser and mes', () => {
        const r = readTavernJsonl(JSON.stringify({ is_user: false, mes: 'a' }))
        expect(r.messages).toStrictEqual([{ isUser: false, mes: 'a' }])
    })

    test('send_date, a trimmed name and a strict is_system are read', () => {
        const r = readTavernJsonl([
            msg('a', { send_date: '2024-07-12T01:31:37.123Z', name: '  Narrator ', is_system: true }),
            msg('b', { send_date: 'nonsense', name: '   ', is_system: 'true' }),
            msg('c', { name: 5, is_system: 1 }),
        ].join('\n'))
        expect(r.messages).toStrictEqual([
            { isUser: false, mes: 'a', sendDate: Date.UTC(2024, 6, 12, 1, 31, 37, 123), name: 'Narrator', isSystem: true },
            { isUser: false, mes: 'b' },
            { isUser: false, mes: 'c' },
        ])
        expect(r.skipped).toBe(0)
    })

    test('the header names are returned, only as non-empty strings', () => {
        expect(readTavernJsonl(`${header}\n${msg('a')}`).header).toStrictEqual({ userName: 'U', characterName: 'C' })
        const odd = JSON.stringify({ user_name: '', character_name: 7, chat_metadata: {} })
        expect(readTavernJsonl(`${odd}\n${msg('a')}`).header).toStrictEqual({})
        expect(readTavernJsonl(msg('a')).header).toBeUndefined()
    })

    test('extra, generation and metadata keys are dropped silently', () => {
        const noisy = JSON.stringify({ user_name: 'U', character_name: 'C', chat_metadata: { a: { b: 1 } } })
        const r = readTavernJsonl([noisy, msg('a', { extra: { x: 1 }, gen_started: 'x', gen_finished: 'y' })].join('\n'))
        expect(r.skipped).toBe(0)
        expect(r.swipesNotKept).toBe(0)
        expect(r.messages).toStrictEqual([{ isUser: false, mes: 'a', name: 'C' }])
    })
})

describe('readTavernJsonl Chub mes (unit)', () => {
    test('an object mes with a string message is read as that message', () => {
        const r = readTavernJsonl([msg({ message: 'hi', other: 1 }), msg('b')].join('\n'))
        expect(r.messages.map((m) => m.mes)).toEqual(['hi', 'b'])
        expect(r.skipped).toBe(0)
    })

    test('an object mes with an empty message is ignored and not counted', () => {
        const r = readTavernJsonl([msg({ message: '' }), msg('b')].join('\n'))
        expect(r.messages.map((m) => m.mes)).toEqual(['b'])
        expect(r.skipped).toBe(0)
    })

    test('an object mes without a string message, an array, a number and null are counted skips', () => {
        const r = readTavernJsonl([msg({ other: 1 }), msg({ message: 5 }), msg(['x']), msg(7), msg(null), msg('b')].join('\n'))
        expect(r.messages.map((m) => m.mes)).toEqual(['b'])
        expect(r.skipped).toBe(5)
    })
})

describe('readTavernJsonl swipes (unit)', () => {
    const read = (...lines: string[]) => readTavernJsonl(lines.join('\n'))
    const sent = Date.UTC(2024, 6, 12, 1, 31, 37, 123)

    // Regression reproducer: the base keeps no swipe and counts the line.
    test('R-1: the replies beside the shown one are kept in file order and nothing is counted', () => {
        const r = read(msg('b', { swipes: ['a', 'b', 'c'], swipe_id: 1, swipe_info: [{}, {}, {}] }))
        expect(r.messages).toStrictEqual([{ isUser: false, mes: 'b', name: 'C', swipes: { before: ['a'], after: ['c'] } }])
        expect(r.swipesNotKept).toBe(0)
    })

    // Regression reproducer: the Chub object form.
    test('R-2: Chub object entries are read as their message', () => {
        const r = read(msg({ message: 'a' }, { swipes: [{ message: 'a' }, { message: 'b' }], swipe_id: 0 }))
        expect(r.messages).toStrictEqual([{ isUser: false, mes: 'a', name: 'C', swipes: { before: [], after: ['b'] } }])
        expect(r.swipesNotKept).toBe(0)
    })

    // Regression reproducer: without a swipe_id the text match places the shown reply.
    test('R-3: a missing swipe_id places the shown reply by its text', () => {
        const r = read(msg('b', { swipes: ['a', 'b', 'c'] }))
        expect(r.messages[0].swipes).toStrictEqual({ before: ['a'], after: ['c'] })
    })

    // Regression reproducer: a swipe_id that is no in-range integer is not trusted.
    test.each([-1, 3, 1.5, '2', null])('R-4: swipe_id %j falls back to the text match', (swipeId) => {
        const r = read(msg('z', { swipes: ['x', 'y', 'z'], swipe_id: swipeId }))
        expect(r.messages[0].swipes).toStrictEqual({ before: ['x', 'y'], after: [] })
    })

    // Regression reproducer: a swipe_id whose entry is not the shown reply is not trusted.
    test('R-5: a swipe_id that points at another text puts the shown reply first and loses nothing', () => {
        const r = read(msg('b', { swipes: ['a', 'x', 'c'], swipe_id: 1 }))
        expect(r.messages[0].mes).toBe('b')
        expect(r.messages[0].swipes).toStrictEqual({ before: [], after: ['a', 'x', 'c'] })
    })

    // Regression reproducer: unreadable and empty entries hold no reply.
    test('R-6: empty and unreadable entries are dropped silently', () => {
        const r = read(msg('a', { swipes: ['a', '', 5, null, { x: 1 }, 'c'], swipe_id: 0 }))
        expect(r.messages[0].swipes).toStrictEqual({ before: [], after: ['c'] })
        expect(r.swipesNotKept).toBe(0)
    })

    // Regression reproducer: another swipe with the shown text is a reply of its own.
    test('R-7: other entries equal to the shown reply are kept', () => {
        const r = read(msg('a', { swipes: ['a', 'a', 'b'], swipe_id: 0 }))
        expect(r.messages[0].swipes).toStrictEqual({ before: [], after: ['a', 'b'] })
    })

    // Regression reproducer: a valid swipe_id wins over an earlier copy of the same text.
    test('R-7: a swipe_id pointing at a later copy of the shown reply places it there', () => {
        const r = read(msg('a', { swipes: ['a', 'b', 'a'], swipe_id: 2 }))
        expect(r.messages[0].swipes).toStrictEqual({ before: ['a', 'b'], after: [] })
    })

    // Regression reproducer: the base drops an empty-shown line and counts it.
    test('R-8: an empty shown reply promotes the first kept reply and the rest follow', () => {
        const r = read(msg('', { swipes: ['', 'x', 'y'], swipe_id: 0 }), msg('ok'))
        expect(r.messages.map((m) => m.mes)).toEqual(['x', 'ok'])
        expect(r.messages[0].swipes).toStrictEqual({ before: [], after: ['y'] })
        expect(r.swipesNotKept).toBe(0)
        expect(r.skipped).toBe(0)
    })

    test('R-8: the promotion ignores swipe_id and reads the Chub form', () => {
        const r = read(
            msg('', { swipes: ['', 'x', 'y'], swipe_id: 2 }),
            msg({ message: '' }, { swipes: [{ message: 'a' }, { message: 'b' }] }),
        )
        expect(r.messages.map((m) => m.mes)).toEqual(['x', 'a'])
        expect(r.messages[0].swipes).toStrictEqual({ before: [], after: ['y'] })
        expect(r.messages[1].swipes).toStrictEqual({ before: [], after: ['b'] })
    })

    // Regression reproducer for the empty-entry rule (the base counts `['f', '']`); the rest is a compatibility guard.
    test('R-9: a line without another reply carries no swipes key and is not counted', () => {
        const r = read(
            msg('a'),
            msg('b', { swipes: ['b'] }),
            msg('c', { swipes: [] }),
            msg('d', { swipes: 'x' }),
            msg('e', { swipes: [''] }),
            msg('f', { swipes: ['f', ''] }),
        )
        expect(r.messages.map((m) => m.mes)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
        for (const m of r.messages) {
            expect(m).not.toHaveProperty('swipes')
        }
        expect(r.swipesNotKept).toBe(0)
    })

    test('R-9: a lone entry that differs from the shown reply is a kept reply, and a lone one with an empty shown reply is the message', () => {
        const r = read(msg('a', { swipes: ['x'] }), msg('', { swipes: ['y'] }), msg('', { swipes: ['', ''] }))
        expect(r.messages).toStrictEqual([
            { isUser: false, mes: 'a', name: 'C', swipes: { before: [], after: ['x'] } },
            { isUser: false, mes: 'y', name: 'C' },
        ])
        expect(r.swipesNotKept).toBe(0)
    })

    // Regression reproducer (the base keeps no swipes): swipe_info and extra are never read.
    test('R-10: swipe_info and extra change neither the swipes nor the time', () => {
        const base = { swipes: ['a', 'b', 'c'], swipe_id: 1, send_date: '2024-07-12T01:31:37.123Z' }
        const plain = read(msg('b', base))
        const withInfo = read(msg('b', {
            ...base,
            swipe_info: [
                { send_date: '2020-01-01T00:00:00.000Z', extra: { api: 'x' } },
                { send_date: '2030-01-01T00:00:00.000Z' },
                { send_date: '2031-01-01T00:00:00.000Z' },
            ],
            extra: { y: 1 },
        }))
        expect(withInfo.messages).toStrictEqual(plain.messages)
        expect(withInfo.messages[0].swipes).toStrictEqual({ before: ['a'], after: ['c'] })
        expect(withInfo.messages[0].sendDate).toBe(sent)
        const none = read(msg('a'), msg('b', { extra: { y: 1 }, swipe_info: [{}] }))
        expect(none.messages.map((m) => m.mes)).toEqual(['a', 'b'])
        expect(none.messages[1]).not.toHaveProperty('swipes')
    })

    test('a skipped line adds nothing to the swipe lists or the count', () => {
        const r = readTavernJsonl([msg(5, { swipes: ['a', 'b'] }), '{broken', msg('ok')].join('\n'))
        expect(r.swipesNotKept).toBe(0)
        expect(r.skipped).toBe(2)
        expect(r.messages).toStrictEqual([{ isUser: false, mes: 'ok', name: 'C' }])
    })
})

describe('buildTavernTree (unit)', () => {
    const own = { userName: 'User', characterName: 'Solo' }
    const sent = Date.UTC(2024, 6, 12, 1, 31, 37, 123)
    // The largest time Intl.DateTimeFormat can format.
    const latest = 253402300799999

    const ascending = () => {
        let n = 0
        return () => `id${String(1000 + ++n)}`
    }
    const descending = () => {
        let n = 0
        return () => `id${String(9000 - ++n)}`
    }
    const identity = (text: string) => text
    const line = (mes: string, extra: Partial<TavernLine> = {}): TavernLine => ({ isUser: false, mes, ...extra })
    const chatOf = (built: ReturnType<typeof buildTavernTree>): Chat => {
        const chat = { id: 'chat', name: 'c', note: '', localLore: [], message: built.message } as unknown as Chat
        if(built.alt.length > 0){
            chat.alt = built.alt
        }
        return chat
    }
    const dataAt = (chat: Chat, i: number) => siblingsAt(chat, i).map((m) => m.data)

    // Specification test of the new export (the base has no such export).
    test('S-1: siblings carry millisecond offsets around the shown time, in file order', () => {
        const built = buildTavernTree({
            messages: [line('hi', { isUser: true }), line('b', { sendDate: sent, swipes: { before: ['a'], after: ['c'] } })],
        }, own, identity, ascending())
        const chat = chatOf(built)
        expect(built.message[1].time).toBe(sent)
        expect(built.alt.map((r) => r.m.time)).toEqual([sent - 1, sent + 1])
        expect(dataAt(chat, 1)).toEqual(['a', 'b', 'c'])
        expect(siblingsAt(chat, 1).map((m) => m.time)).toEqual([sent - 1, sent, sent + 1])
    })

    test('S-1: the shown reply first and last of its siblings', () => {
        const first = buildTavernTree({ messages: [line('a', { sendDate: sent, swipes: { before: [], after: ['b', 'c'] } })] }, own, identity, ascending())
        expect(first.alt.map((r) => r.m.time)).toEqual([sent + 1, sent + 2])
        expect(dataAt(chatOf(first), 0)).toEqual(['a', 'b', 'c'])
        const last = buildTavernTree({ messages: [line('c', { sendDate: sent, swipes: { before: ['a', 'b'], after: [] } })] }, own, identity, ascending())
        expect(last.alt.map((r) => r.m.time)).toEqual([sent - 2, sent - 1])
        expect(dataAt(chatOf(last), 0)).toEqual(['a', 'b', 'c'])
    })

    test('S-2: without a time the siblings order by sorted ids, whatever order the ids are drawn in', () => {
        const built = buildTavernTree({
            messages: [line('hi', { isUser: true }), line('b', { swipes: { before: ['a'], after: ['c', 'd'] } })],
        }, own, identity, descending())
        const chat = chatOf(built)
        expect(dataAt(chat, 1)).toEqual(['a', 'b', 'c', 'd'])
        for (const record of built.alt) {
            expect(record.m).not.toHaveProperty('time')
        }
        expect(built.message[1]).not.toHaveProperty('time')
    })

    test('S-3: a time that leaves no room for the offsets is copied and the ids order the siblings', () => {
        const top = buildTavernTree({ messages: [line('a', { sendDate: latest, swipes: { before: [], after: ['b'] } })] }, own, identity, ascending())
        expect(top.alt.map((r) => r.m.time)).toEqual([latest])
        expect(top.message[0].time).toBe(latest)
        expect(dataAt(chatOf(top), 0)).toEqual(['a', 'b'])

        const bottom = buildTavernTree({ messages: [line('c', { sendDate: 1, swipes: { before: ['a', 'b'], after: [] } })] }, own, identity, descending())
        expect(bottom.alt.map((r) => r.m.time)).toEqual([1, 1])
        expect(bottom.message[0].time).toBe(1)
        expect(dataAt(chatOf(bottom), 0)).toEqual(['a', 'b', 'c'])
    })

    test('S-3: offsets that just fit are used, one step further falls back', () => {
        const fits = buildTavernTree({ messages: [line('a', { sendDate: latest - 1, swipes: { before: [], after: ['b'] } })] }, own, identity, descending())
        expect(fits.alt.map((r) => r.m.time)).toEqual([latest])
        const fitsLow = buildTavernTree({ messages: [line('b', { sendDate: 2, swipes: { before: ['a'], after: [] } })] }, own, identity, descending())
        expect(fitsLow.alt.map((r) => r.m.time)).toEqual([1])
        const shortLow = buildTavernTree({ messages: [line('b', { sendDate: 1, swipes: { before: ['a'], after: [] } })] }, own, identity, descending())
        expect(shortLow.alt.map((r) => r.m.time)).toEqual([1])
    })

    test('S-4: records are exactly m, p and a, with unique ids and a readable tree', () => {
        const built = buildTavernTree({
            messages: [
                line('g1', { swipes: { before: [], after: ['g2'] } }),
                line('hi', { isUser: true, name: 'Narrator' }),
                line('b', { sendDate: sent, swipes: { before: ['a'], after: ['c'] } }),
                line('plain'),
                line('y', { isSystem: true, swipes: { before: [], after: ['y2'] } }),
            ],
        }, own, identity, ascending())
        const chat = chatOf(built)
        expect(built.alt).toHaveLength(4)
        for (const record of built.alt) {
            expect(Object.keys(record).sort()).toEqual(['a', 'm', 'p'])
            expect(record.a).toBe(1)
            expect(record.m.chatId).toBeTruthy()
        }
        expect(built.alt.map((r) => r.m.data)).toEqual(['g2', 'a', 'c', 'y2'])
        expect(built.alt[1].m).toStrictEqual({ role: 'char', data: 'a', time: sent - 1, chatId: built.alt[1].m.chatId })
        expect(built.alt.map((r) => r.p)).toEqual([null, built.message[1].chatId, built.message[1].chatId, built.message[3].chatId])
        const ids = [...built.message.map((m) => m.chatId), ...built.alt.map((r) => r.m.chatId)]
        expect(ids.every((id) => typeof id === 'string' && id !== '')).toBe(true)
        expect(new Set(ids).size).toBe(ids.length)
        expect(isChatAltReadable(chat)).toBe(true)
        const tree = treeLeaves(chat)
        expect(tree?.unreachable).toEqual([])
        expect(tree?.leaves).toHaveLength(built.alt.length)
        expect(dataAt(chat, 0)).toEqual(['g1', 'g2'])
        expect(dataAt(chat, 2)).toEqual(['a', 'b', 'c'])
        expect(dataAt(chat, 4)).toEqual(['y', 'y2'])
    })

    test('S-4: a record takes the role, name, disabled flag and formatted text of its line', () => {
        const built = buildTavernTree({
            messages: [line('{{user}} hi', { isUser: true, name: 'Narrator', isSystem: true, swipes: { before: [], after: ['{{user}} yo'] } })],
        }, own, (text) => text.replace('{{user}}', 'User'), ascending())
        expect(built.message[0]).toMatchObject({ role: 'user', data: 'User hi', name: 'Narrator', disabled: true })
        expect(built.alt[0].m).toStrictEqual({ role: 'user', data: 'User yo', name: 'Narrator', disabled: true, chatId: built.alt[0].m.chatId })
    })

    // Compatibility guard (the base has no export): a chat without a kept swipe stays as it is today.
    test('S-5: lines without swipes give no record and no id', () => {
        const built = buildTavernTree({
            messages: [line('hi', { isUser: true }), line('b', { sendDate: sent, name: 'N', isSystem: true })],
        }, own, identity, ascending())
        expect(built.alt).toEqual([])
        expect(built.message).toStrictEqual([
            { role: 'user', data: 'hi' },
            { role: 'char', data: 'b', time: sent, name: 'N', disabled: true },
        ])
        const ooba = buildTavernTree(readOobaChat({ internal: [['hi', 'there']], visible: [['hi', 'there']] }), own, identity, ascending())
        expect(ooba.alt).toEqual([])
        expect(ooba.message.length).toBeGreaterThan(0)
        for (const message of ooba.message) {
            expect(message).not.toHaveProperty('chatId')
        }
    })

    test('S-6: the built chat switches to any sibling and back', () => {
        const built = buildTavernTree({
            messages: [line('hi', { isUser: true }), line('b', { sendDate: sent, swipes: { before: ['a'], after: ['c'] } }), line('next', { isUser: true })],
        }, own, identity, ascending())
        const chat = chatOf(built)
        const shownId = chat.message[1].chatId as string
        const swipeId = siblingsAt(chat, 1)[0].chatId as string
        expect(switchTo(chat, 1, swipeId)).toBe(true)
        expect(chat.message.map((m) => m.data)).toEqual(['hi', 'a'])
        expect(chat.alt?.filter((r) => r.a === 2).map((r) => r.m.data)).toEqual(['b', 'next'])
        expect(switchTo(chat, 1, shownId)).toBe(true)
        expect(chat.message.map((m) => m.data)).toEqual(['hi', 'b', 'next'])
        expect(dataAt(chat, 1)).toEqual(['a', 'b', 'c'])
    })

    // Diagnostic of an unchanged export rule: this change adds no export code.
    test('S-7: at .bin export a character swipe is omitted and a user swipe is one branch chat', () => {
        const built = buildTavernTree({
            messages: [
                line('hi', { isUser: true }),
                line('b', { swipes: { before: ['a'], after: [] } }),
                line('u1', { isUser: true, swipes: { before: ['u0'], after: [] } }),
            ],
        }, own, identity, ascending())
        const chat = chatOf(built)
        const plan = branchPlanOf(chat)
        expect(plan?.kept).toHaveLength(1)
        expect(plan?.omitted).toBe(1)
        const summary = branchSummaryOf(chat)
        expect(summary?.chats).toBe(1)
        expect(summary?.omitted).toBe(1)
    })
})

describe('chatNameFromFile (unit)', () => {
    test('the extension is removed case-insensitively', () => {
        expect(chatNameFromFile('my chat.jsonl')).toBe('my chat')
        expect(chatNameFromFile('CHAT.JSONL')).toBe('CHAT')
        expect(chatNameFromFile('a.b.jsonl')).toBe('a.b')
    })

    test('a name without a dot before jsonl keeps its text', () => {
        expect(chatNameFromFile('chatjsonl')).toBe('chatjsonl')
    })

    test('an empty result falls back to Imported Chat', () => {
        expect(chatNameFromFile('.jsonl')).toBe('Imported Chat')
        expect(chatNameFromFile('  .jsonl')).toBe('Imported Chat')
    })

    test('a .json extension is removed case-insensitively, and only the last one', () => {
        expect(chatNameFromFile('a.json')).toBe('a')
        expect(chatNameFromFile('CHAT.JSON')).toBe('CHAT')
        expect(chatNameFromFile('a.b.json')).toBe('a.b')
        expect(chatNameFromFile('a.json.json')).toBe('a.json')
    })

    test('a .json name with nothing before the dot falls back to Imported Chat', () => {
        expect(chatNameFromFile('.json')).toBe('Imported Chat')
        expect(chatNameFromFile('  .json')).toBe('Imported Chat')
        expect(chatNameFromFile('chatjson')).toBe('chatjson')
    })
})

describe('tavernMessageName (unit)', () => {
    const own = { userName: 'User', characterName: 'Solo' }
    const header = { userName: 'U', characterName: 'C' }
    const name = (isUser: boolean, value: string | undefined, h: typeof header | undefined = header, o = own) =>
        tavernMessageName({ isUser, name: value }, h, o)

    test('another speaker is kept', () => {
        expect(name(false, 'Narrator')).toBe('Narrator')
        expect(name(true, 'Alice')).toBe('Alice')
    })

    test('the app names and the header names are dropped on their own side', () => {
        expect(name(false, 'Solo')).toBeUndefined()
        expect(name(false, 'C')).toBeUndefined()
        expect(name(true, 'User')).toBeUndefined()
        expect(name(true, 'U')).toBeUndefined()
    })

    test('a name matching the other side is kept', () => {
        expect(name(false, 'User')).toBe('User')
        expect(name(false, 'U')).toBe('U')
        expect(name(true, 'Solo')).toBe('Solo')
        expect(name(true, 'C')).toBe('C')
    })

    test('matching is exact and case-sensitive, after trimming every name', () => {
        expect(name(false, 'solo')).toBe('solo')
        expect(name(false, ' Solo ')).toBeUndefined()
        expect(tavernMessageName({ isUser: true, name: 'Bob' }, { userName: ' Bob ' }, { userName: 'x', characterName: 'y' })).toBeUndefined()
        expect(tavernMessageName({ isUser: true, name: 'Bob' }, undefined, { userName: 'Bob ', characterName: 'y' })).toBeUndefined()
        expect(tavernMessageName({ isUser: true, name: ' U ' }, header, { userName: 'x', characterName: 'y' })).toBeUndefined()
    })

    test('a missing header only leaves the app names', () => {
        expect(tavernMessageName({ isUser: false, name: 'C' }, undefined, own)).toBe('C')
        expect(tavernMessageName({ isUser: false, name: 'Solo' }, undefined, own)).toBeUndefined()
    })

    test('an unused header name is an own name', () => {
        const unused = { userName: 'unused', characterName: 'unused' }
        expect(name(false, 'unused', unused)).toBeUndefined()
        expect(name(true, 'unused', unused)).toBeUndefined()
    })

    test('a missing, empty or whitespace name gives no name', () => {
        expect(name(false, undefined)).toBeUndefined()
        expect(name(false, '')).toBeUndefined()
        expect(name(false, '   ')).toBeUndefined()
    })
})

// The local readings (no offset, date only, meridiem) differ between zones and the
// humanized readings do not, so every expectation is a literal UTC instant.
describe.each(['Asia/Seoul', 'America/Los_Angeles'])('parseTavernSendDate in %s (unit)', (zone) => {
    const isSeoul = zone === 'Asia/Seoul'
    beforeEach(() => {
        process.env.TZ = zone
    })
    afterEach(() => {
        process.env.TZ = originalZone
    })

    test('the pinned zone is active', () => {
        expect(new Date(Date.UTC(2024, 6, 12, 0, 0, 0)).getTimezoneOffset()).toBe(isSeoul ? -540 : 420)
    })

    const zoneFree: Array<[string, unknown, number]> = [
        ['ISO with Z and ms', '2024-07-12T01:31:37.123Z', Date.UTC(2024, 6, 12, 1, 31, 37, 123)],
        ['ISO without seconds', '2024-07-12T01:31Z', Date.UTC(2024, 6, 12, 1, 31, 0)],
        ['ISO space separator', '2024-07-12 01:31:37Z', Date.UTC(2024, 6, 12, 1, 31, 37)],
        ['ISO offset +09:00', '2024-07-12T10:31:37+09:00', Date.UTC(2024, 6, 12, 1, 31, 37)],
        ['ISO offset +0900', '2024-07-12T10:31:37+0900', Date.UTC(2024, 6, 12, 1, 31, 37)],
        ['ISO offset +09', '2024-07-12T10:31:37+09', Date.UTC(2024, 6, 12, 1, 31, 37)],
        ['ISO offset -05:30', '2024-07-12T10:31:37-05:30', Date.UTC(2024, 6, 12, 16, 1, 37)],
        ['ISO fraction .1 is 100 ms', '2024-07-12T01:31:37.1Z', Date.UTC(2024, 6, 12, 1, 31, 37, 100)],
        ['ISO fraction .123456 keeps three digits', '2024-07-12T01:31:37.123456Z', Date.UTC(2024, 6, 12, 1, 31, 37, 123)],
        ['ISO leap day', '2024-02-29T00:00:00Z', Date.UTC(2024, 1, 29, 0, 0, 0)],
        ['humanized with ms', '2024-07-12@01h31m37s123ms', Date.UTC(2024, 6, 12, 1, 31, 37, 123)],
        ['humanized without ms', '2024-7-12@01h31m37s', Date.UTC(2024, 6, 12, 1, 31, 37)],
        ['humanized with spaces', '2024-6-5 @14h 56m 50s 682ms', Date.UTC(2024, 5, 5, 14, 56, 50, 682)],
        ['digit string is ms', '1720747897123', 1720747897123],
        ['number is ms', 1720747897123, 1720747897123],
        ['latest accepted ms', 253402300799999, 253402300799999],
        ['earliest accepted ms', 1, 1],
        ['latest accepted ISO', '9999-12-31T23:59:59.999Z', 253402300799999],
    ]
    test.each(zoneFree)('%s', (_label, input, expected) => {
        expect(parseTavernSendDate(input)).toBe(expected)
    })

    const zoned: Array<[string, string, number, number]> = [
        ['ISO local time', '2024-07-12T10:31:37', Date.UTC(2024, 6, 12, 1, 31, 37), Date.UTC(2024, 6, 12, 17, 31, 37)],
        ['ISO date only is local midnight', '2024-07-12', Date.UTC(2024, 6, 11, 15, 0, 0), Date.UTC(2024, 6, 12, 7, 0, 0)],
        ['meridiem pm', 'June 19, 2023 2:20pm', Date.UTC(2023, 5, 19, 5, 20, 0), Date.UTC(2023, 5, 19, 21, 20, 0)],
        ['meridiem capital PM, short month', 'Jun 19, 2023 2:20PM', Date.UTC(2023, 5, 19, 5, 20, 0), Date.UTC(2023, 5, 19, 21, 20, 0)],
        ['meridiem 12am is hour 0', 'June 19, 2023 12:05am', Date.UTC(2023, 5, 18, 15, 5, 0), Date.UTC(2023, 5, 19, 7, 5, 0)],
        ['meridiem 12pm is hour 12', 'June 19, 2023 12:00pm', Date.UTC(2023, 5, 19, 3, 0, 0), Date.UTC(2023, 5, 19, 19, 0, 0)],
    ]
    test.each(zoned)('%s', (_label, input, seoul, losAngeles) => {
        expect(parseTavernSendDate(input)).toBe(isSeoul ? seoul : losAngeles)
    })

    const rejected: Array<[string, unknown]> = [
        ['calendar-invalid 2024-02-30', '2024-02-30'],
        ['calendar-invalid 2023-02-29', '2023-02-29'],
        ['month 13', '2024-13-01'],
        ['hour 24', '2024-07-12T24:00:00Z'],
        ['minute 60', '2024-07-12T10:60:00Z'],
        ['second 60', '2024-07-12T10:00:60Z'],
        ['offset hour 99', '2024-07-12T10:00:00+99'],
        ['trailing junk', '2024-07-12T10:31:37Zjunk'],
        ['leading junk', 'x2024-07-12T10:31:37Z'],
        ['meridiem 13pm', 'June 19, 2023 13:20pm'],
        ['meridiem 0am', 'June 19, 2023 0:20am'],
        ['meridiem minute 60', 'June 19, 2023 2:60pm'],
        ['meridiem day 31 of June', 'June 31, 2023 2:20pm'],
        ['unknown month', 'Smarch 19, 2023 2:20pm'],
        ['humanized hour 25', '2024-07-12@25h31m37s'],
        ['string zero', '0'],
        ['number zero', 0],
        ['empty string', ''],
        ['negative number', -1],
        ['negative string', '-1'],
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['null', null],
        ['undefined', undefined],
        ['object', { a: 1 }],
        ['array', [1]],
        ['boolean', true],
        ['garbage', 'garbage'],
        ['huge digit string', '99999999999999999999'],
        ['beyond Date range', 8.64e15 + 1],
        ['Date range limit', 8.64e15],
        ['1e20', 1e20],
        ['one past year 9999', 253402300800000],
        ['one past year 9999 as digits', '253402300800000'],
        ['ISO instant zero', '1970-01-01T00:00:00Z'],
        ['ISO before 1970', '1969-12-31T23:59:59Z'],
        ['ISO year 0001', '0001-01-01T00:00:00Z'],
        ['ISO past year 9999', '9999-12-31T23:59:59.999-01:00'],
    ]
    test.each(rejected)('%s gives no time', (_label, input) => {
        expect(parseTavernSendDate(input)).toBeUndefined()
    })

    test('every accepted value formats without throwing', () => {
        const inputs = [...zoneFree.map((row) => row[1]), ...zoned.map((row) => row[1])]
        for (const input of inputs) {
            const time = parseTavernSendDate(input)
            expect(time).toBeDefined()
            expect(() => new Intl.DateTimeFormat().format(time)).not.toThrow()
        }
    })

    test('a SillyTavern date in the Ooba form stays unreadable', () => {
        expect(parseTavernSendDate('Oct 24, 2025 13:04')).toBeUndefined()
    })
})

// The expected instants are computed inside each test, after the zone's beforeEach.
describe.each(['Asia/Seoul', 'America/Los_Angeles', 'Etc/GMT+12', 'Pacific/Kiritimati'])('parseOobaTimestamp in %s (unit)', (zone) => {
    beforeEach(() => {
        process.env.TZ = zone
    })
    afterEach(() => {
        process.env.TZ = originalZone
    })

    // [label, input, year, month index, day, hour, minute]
    const accepted: Array<[string, string, number, number, number, number, number]> = [
        ['24-hour morning', 'Oct 24, 2025 01:04', 2025, 9, 24, 1, 4],
        ['24-hour afternoon', 'Oct 24, 2025 13:04', 2025, 9, 24, 13, 4],
        ['single-digit day and hour', 'Oct 4, 2025 0:00', 2025, 9, 4, 0, 0],
        ['zero-padded day as the writer produces it', 'Oct 04, 2025 01:04', 2025, 9, 4, 1, 4],
        ['end of year', 'Dec 31, 2025 23:59', 2025, 11, 31, 23, 59],
        ['leap day', 'Feb 29, 2024 12:00', 2024, 1, 29, 12, 0],
        ['full month name', 'October 24, 2025 01:04', 2025, 9, 24, 1, 4],
        ['surrounding spaces are trimmed', '  Oct 24, 2025 01:04  ', 2025, 9, 24, 1, 4],
    ]
    test.each(accepted)('%s', (_label, input, year, month, day, hour, minute) => {
        expect(parseOobaTimestamp(input)).toBe(new Date(year, month, day, hour, minute).getTime())
    })

    const rejected: Array<[string, unknown]> = [
        ['hour 24', 'Oct 24, 2025 24:00'],
        ['minute 60', 'Oct 24, 2025 01:60'],
        ['calendar-invalid Feb 30', 'Feb 30, 2025 01:04'],
        ['non-leap Feb 29', 'Feb 29, 2025 01:04'],
        ['unknown month', 'Foo 1, 2025 01:04'],
        ['12-hour form', 'Oct 24, 2025 1:04pm'],
        ['with seconds', 'Oct 24, 2025 01:04:05'],
        ['ISO form', '2025-10-24 01:04'],
        ['year 0050 is below the bound', 'Jan 1, 0050 10:00'],
        ['local midnight before 1970 in every zone', 'Dec 31, 1969 00:00'],
        ['empty string', ''],
        ['number', 5],
        ['null', null],
        ['undefined', undefined],
        ['object', { a: 1 }],
        ['double space', 'Oct  24, 2025 01:04'],
    ]
    test.each(rejected)('%s gives no time', (_label, input) => {
        expect(parseOobaTimestamp(input)).toBeUndefined()
    })
})

describe('unescapeHtmlEntities (unit)', () => {
    const decoded: Array<[string, string, string]> = [
        ['hex apostrophe', '&#x27;', "'"],
        ['decimal apostrophe', '&#39;', "'"],
        ['quot', '&quot;', '"'],
        ['apos', '&apos;', "'"],
        ['lt', '&lt;', '<'],
        ['gt', '&gt;', '>'],
        ['amp', '&amp;', '&'],
        ['astral hex code point', '&#x1F600;', '\u{1F600}'],
        ['one pass only: &amp;lt;', '&amp;lt;', '&lt;'],
        ['one pass only: &amp;amp;', '&amp;amp;', '&amp;'],
        ['inside a sentence', 'it&#x27;s &quot;fine&quot; &amp; done', 'it\'s "fine" & done'],
    ]
    test.each(decoded)('%s', (_label, input, expected) => {
        expect(unescapeHtmlEntities(input)).toBe(expected)
    })

    const untouched = ['&nbsp;', '&#0;', '&#xD800;', '&#x110000;', '&#xZZ;', '&bogus;', 'a & b', '&amp', '&AMP;', 'plain']
    test.each(untouched)('%s stays literal', (input) => {
        expect(unescapeHtmlEntities(input)).toBe(input)
    })

    describe('without a DOM', () => {
        afterEach(() => {
            vi.restoreAllMocks()
            vi.unstubAllGlobals()
        })

        test('no element or parser is created', () => {
            const createElement = vi.spyOn(document, 'createElement')
            vi.stubGlobal('DOMParser', vi.fn(function () {
                throw new Error('DOM used')
            }))
            expect(unescapeHtmlEntities('&lt;b&gt; &#x27;')).toBe("<b> '")
            expect(createElement).not.toHaveBeenCalled()
        })
    })
})

describe('detectJsonChatFormat (unit)', () => {
    const rows = [['a', 'b']]

    test('internal with visible, and the legacy data with data_visible, are Ooba', () => {
        expect(detectJsonChatFormat({ internal: rows, visible: rows })).toBe('ooba')
        expect(detectJsonChatFormat({ data: rows, data_visible: rows })).toBe('ooba')
    })

    test('one half of a pair, or a mixed pair, is not Ooba', () => {
        expect(detectJsonChatFormat({})).toBeUndefined()
        expect(detectJsonChatFormat([])).toBeUndefined()
        expect(detectJsonChatFormat('text')).toBeUndefined()
        expect(detectJsonChatFormat(null)).toBeUndefined()
        expect(detectJsonChatFormat({ internal: [['hi', 'there']] })).toBeUndefined()
        expect(detectJsonChatFormat({ visible: rows })).toBeUndefined()
        expect(detectJsonChatFormat({ internal: [['hi', 'there']], visible: 'x' })).toBeUndefined()
        expect(detectJsonChatFormat({ data: rows })).toBeUndefined()
        expect(detectJsonChatFormat({ data_visible: rows })).toBeUndefined()
        expect(detectJsonChatFormat({ internal: rows, data_visible: rows })).toBeUndefined()
        expect(detectJsonChatFormat({ data: rows, visible: rows })).toBeUndefined()
    })

    test('a Risu export type is never detected, even carrying both arrays', () => {
        expect(detectJsonChatFormat({ type: 'risuChat', internal: [], visible: [] })).toBeUndefined()
        expect(detectJsonChatFormat({ type: 'risuChat', internal: rows, visible: rows })).toBeUndefined()
        expect(detectJsonChatFormat({ type: 'risuAllChats', internal: rows, visible: rows })).toBeUndefined()
    })
})

describe('readOobaChat (unit)', () => {
    const marker = '<|BEGIN-VISIBLE-CHAT|>'
    const ooba = (internal: unknown, visible: unknown, metadata?: unknown) => ({ internal, visible, metadata })

    test('an unrecognised value reads as an empty result', () => {
        expect(readOobaChat({})).toEqual({ messages: [], skipped: 0, swipesNotKept: 0 })
        expect(readOobaChat(null)).toEqual({ messages: [], skipped: 0, swipesNotKept: 0 })
    })

    test('the marker row gives only its character message, in file order, with no header', () => {
        const r = readOobaChat(ooba(
            [[marker, 'Hello'], ['hi', 'yo']],
            [['', 'Hello'], ['hi', 'yo']],
        ))
        expect(r.messages).toEqual([
            { isUser: false, mes: 'Hello' },
            { isUser: true, mes: 'hi' },
            { isUser: false, mes: 'yo' },
        ])
        expect(r.skipped).toBe(0)
        expect(r.swipesNotKept).toBe(0)
        expect(r).not.toHaveProperty('header')
    })

    test('the marker is recognised in the internal cell even when visible is not empty', () => {
        const r = readOobaChat(ooba([[marker, 'Hello']], [['shown', 'Hello']]))
        expect(r.messages).toEqual([{ isUser: false, mes: 'Hello' }])
    })

    test('the user text comes from visible and is unescaped; the character text is internal as is', () => {
        const r = readOobaChat(ooba(
            [['INJECTED CONTEXT typed', 'a &amp; b']],
            [['it&#x27;s &quot;ok&quot;', 'ignored']],
        ))
        expect(r.messages).toEqual([
            { isUser: true, mes: 'it\'s "ok"' },
            { isUser: false, mes: 'a &amp; b' },
        ])
    })

    test('an empty, missing or non-string visible user cell falls back to the raw internal text', () => {
        const rows = [['typed &amp; kept', 'r']]
        for(const visible of [[['', 'r']], [], [[]], [[5, 'r']], [null]]){
            const r = readOobaChat(ooba(rows, visible))
            expect(r.messages).toEqual([{ isUser: true, mes: 'typed &amp; kept' }, { isUser: false, mes: 'r' }])
            expect(r.skipped).toBe(0)
        }
    })

    test('an empty internal user cell with an empty visible cell gives no user message and no count', () => {
        const r = readOobaChat(ooba([['', 'r']], [['', 'r']]))
        expect(r.messages).toEqual([{ isUser: false, mes: 'r' }])
        expect(r.skipped).toBe(0)
    })

    test('a user cell that is not a string on either side is only a silent gap when the other cell is empty', () => {
        const r = readOobaChat(ooba([[7, 'r']], [['', 'r']]))
        expect(r.messages).toEqual([{ isUser: false, mes: 'r' }])
        expect(r.skipped).toBe(0)
        const both = readOobaChat(ooba([[7, 'r']], [[8, 'r']]))
        expect(both.messages).toEqual([{ isUser: false, mes: 'r' }])
        expect(both.skipped).toBe(1)
    })

    test('an empty character cell gives no message and no count; a non-string one is counted once', () => {
        const r = readOobaChat(ooba([['hi', ''], ['hi2', 5]], [['hi', ''], ['hi2', 5]]))
        expect(r.messages).toEqual([{ isUser: true, mes: 'hi' }, { isUser: true, mes: 'hi2' }])
        expect(r.skipped).toBe(1)
    })

    test('short, non-array and null rows are counted and valid rows still import', () => {
        const r = readOobaChat(ooba(
            [['x'], 'str', null, ['hi', 'yo']],
            [['x'], 'str', null, ['hi', 'yo']],
        ))
        expect(r.messages).toEqual([{ isUser: true, mes: 'hi' }, { isUser: false, mes: 'yo' }])
        expect(r.skipped).toBe(3)
    })

    test('cells beyond the second are neither read nor counted', () => {
        const r = readOobaChat(ooba([['hi', 'yo', 'extra', 'more']], [['hi', 'yo', 'extra', 'more']]))
        expect(r.messages).toEqual([{ isUser: true, mes: 'hi' }, { isUser: false, mes: 'yo' }])
        expect(r.skipped).toBe(0)
    })

    test('the legacy data and data_visible pair reads the same way', () => {
        const r = readOobaChat({ data: [['hi', 'yo']], data_visible: [['hi', 'yo']] })
        expect(r.messages).toEqual([{ isUser: true, mes: 'hi' }, { isUser: false, mes: 'yo' }])
    })

    test('a file carrying both pairs reads internal and visible', () => {
        const r = readOobaChat({
            internal: [['new', 'newer']],
            visible: [['new', 'newer']],
            data: [['old', 'older']],
            data_visible: [['old', 'older']],
        })
        expect(r.messages.map((m) => m.mes)).toEqual(['new', 'newer'])
    })

    test('metadata timestamps are keyed by the row index, user_ and assistant_ separately', () => {
        const r = readOobaChat(ooba(
            [[marker, 'Hello'], ['hi', 'yo']],
            [['', 'Hello'], ['hi', 'yo']],
            {
                assistant_0: { timestamp: 'Oct 24, 2025 01:04' },
                user_1: { timestamp: 'Oct 24, 2025 01:05' },
                assistant_1: { timestamp: 'Oct 24, 2025 01:06' },
            },
        ))
        expect(r.messages[0].sendDate).toBe(new Date(2025, 9, 24, 1, 4).getTime())
        expect(r.messages[1].sendDate).toBe(new Date(2025, 9, 24, 1, 5).getTime())
        expect(r.messages[2].sendDate).toBe(new Date(2025, 9, 24, 1, 6).getTime())
    })

    test('a missing, malformed or unparseable metadata entry leaves the time out', () => {
        const shapes: unknown[] = [undefined, null, [], 'x', { user_0: 'x', assistant_0: { timestamp: 5 } }, { user_0: { timestamp: 'garbage' } }]
        for(const metadata of shapes){
            const r = readOobaChat(ooba([['hi', 'yo']], [['hi', 'yo']], metadata))
            expect(r.messages).toHaveLength(2)
            expect(r.messages[0]).not.toHaveProperty('sendDate')
            expect(r.messages[1]).not.toHaveProperty('sendDate')
        }
    })

    describe('versions as swipes', () => {
        const versionsOf = (...contents: string[]) => ({ versions: contents.map((content) => ({ content })) })
        const run = (character: unknown, entry: unknown, userEntry?: unknown) =>
            readOobaChat(ooba([['hi', character]], [['hi', 'x']], { assistant_0: entry, user_0: userEntry }))
        const characterLine = (result: ReturnType<typeof readOobaChat>) => result.messages.find((m) => !m.isUser)

        // Regression reproducers: on the base the other versions are only counted, so `swipes` is absent.
        test('the other versions of a shown reply are its swipes, in version order, and nothing is counted', () => {
            const one = run('yo', versionsOf('yo', 'alt'))
            expect(characterLine(one)).toStrictEqual({ isUser: false, mes: 'yo', swipes: { before: [], after: ['alt'] } })
            expect(one.swipesNotKept).toBe(0)
            const r = readOobaChat(ooba(
                [['a', 'b'], ['c', 'd']],
                [['a', 'b'], ['c', 'd']],
                { assistant_0: versionsOf('b', 'b2'), assistant_1: versionsOf('d', 'd2', 'd3') },
            ))
            expect(r.messages.map((m) => m.swipes)).toEqual([undefined, { before: [], after: ['b2'] }, undefined, { before: [], after: ['d2', 'd3'] }])
            expect(r.swipesNotKept).toBe(0)
        })

        test('the shown slot is current_version_index when it holds the cell, else the first equal version, else the shown reply goes first', () => {
            const at = (index: unknown, ...contents: string[]) =>
                characterLine(run('yo', { ...versionsOf(...contents), current_version_index: index }))?.swipes
            expect(at(1, 'a', 'yo')).toEqual({ before: ['a'], after: [] })
            expect(at(2, 'yo', 'x', 'yo')).toEqual({ before: ['yo', 'x'], after: [] })
            expect(at(undefined, 'yo', 'x', 'yo')).toEqual({ before: [], after: ['x', 'yo'] })
            expect(at(0, 'a', 'yo')).toEqual({ before: ['a'], after: [] })
            expect(at(9, 'a', 'yo')).toEqual({ before: ['a'], after: [] })
            expect(at(1, 'a', 'b')).toEqual({ before: [], after: ['a', 'b'] })
        })

        // Compatibility guard (passes before and after): nothing besides the shown reply gives no swipes and no count.
        test('a shown reply with one version, no versions or malformed versions has no swipes', () => {
            for(const entry of [versionsOf('yo'), { versions: 'x' }, { versions: {} }, {}, undefined]){
                const r = run('yo', entry)
                expect(characterLine(r)).toStrictEqual({ isUser: false, mes: 'yo' })
                expect(r.swipesNotKept).toBe(0)
            }
        })

        test('empty and unreadable versions are dropped silently', () => {
            const r = readOobaChat(ooba([['hi', 'yo']], [['hi', 'x']], { assistant_0: { versions: [{ content: '' }, { content: 'yo' }, 5, { content: 7 }, null, { content: 'z' }] } }))
            expect(characterLine(r)?.swipes).toEqual({ before: [], after: ['z'] })
            expect(r.swipesNotKept).toBe(0)
        })

        test('an empty shown reply shows the first kept version and the rest follow', () => {
            const first = run('', versionsOf('', 'old'))
            expect(characterLine(first)).toStrictEqual({ isUser: false, mes: 'old' })
            expect(first.swipesNotKept).toBe(0)
            expect(characterLine(run('', versionsOf('', 'a', 'b')))).toStrictEqual({ isUser: false, mes: 'a', swipes: { before: [], after: ['b'] } })
            expect(characterLine(run('', versionsOf('old')))?.mes).toBe('old')
        })

        // Compatibility guard (passes before and after): no kept version, no line and no count.
        test('an empty shown reply without a kept version gives no line and no count', () => {
            for(const entry of [versionsOf('', ''), { versions: 'old' }, undefined]){
                const r = run('', entry)
                expect(characterLine(r)).toBeUndefined()
                expect(r.swipesNotKept).toBe(0)
            }
        })

        test('a non-string character cell keeps no versions and is counted skipped', () => {
            const r = run(5, versionsOf('a', 'b'))
            expect(characterLine(r)).toBeUndefined()
            expect(r.skipped).toBe(1)
            expect(r.swipesNotKept).toBe(0)
        })

        const userRun = (internal: unknown, visible: unknown, entry: unknown, index?: unknown) =>
            readOobaChat(ooba([[internal, 'r']], [[visible, 'r']], { user_0: entry === undefined ? undefined : { versions: entry, ...(index === undefined ? {} : { current_version_index: index }) } }))
        const userLine = (result: ReturnType<typeof readOobaChat>) => result.messages.find((m) => m.isUser)

        test('versions on the user entry are swipes of the user line, their visible text decoded like the visible cell', () => {
            const r = userRun('hello', 'hello', [{ content: 'hi', visible_content: 'hi' }, { content: 'hello', visible_content: 'hello' }], 1)
            expect(userLine(r)).toStrictEqual({ isUser: true, mes: 'hello', swipes: { before: ['hi'], after: [] } })
            const escaped = userRun('hello', 'hello', [{ content: 'hello', visible_content: 'hello' }, { content: 'it\'s', visible_content: 'it&#x27;s' }], 0)
            expect(userLine(escaped)?.swipes).toEqual({ before: [], after: ['it\'s'] })
            expect(r.swipesNotKept).toBe(0)
        })

        test('a user version without visible text shows its raw internal text, and the slot is matched on the internal cell', () => {
            const r = userRun('INJECTED typed', 'typed', [{ content: 'INJECTED old' }, { content: 'INJECTED typed' }], 1)
            expect(userLine(r)).toStrictEqual({ isUser: true, mes: 'typed', swipes: { before: ['INJECTED old'], after: [] } })
        })

        test('an empty internal user cell never matches a version slot while the shown text is not empty', () => {
            const r = userRun(5, 'typed', [{ content: 'a' }, { content: '' }])
            expect(userLine(r)).toStrictEqual({ isUser: true, mes: 'typed', swipes: { before: [], after: ['a'] } })
        })

        test('an empty user cell with a kept version shows the first kept version', () => {
            const r = userRun('', '', [{ content: '' }, { content: 'old' }, { content: 'older' }])
            expect(userLine(r)).toStrictEqual({ isUser: true, mes: 'old', swipes: { before: [], after: ['older'] } })
            expect(userLine(userRun('', '', [{ content: '' }]))).toBeUndefined()
        })

        // Compatibility guard (passes before and after): the marker row and an unreadable user cell hold no user line.
        test('versions on the marker row or on an unreadable user cell are ignored', () => {
            const marked = readOobaChat(ooba([[marker, 'Hello']], [['', 'Hello']], { user_0: { versions: [{ content: 'a' }, { content: 'b' }] } }))
            expect(marked.messages).toEqual([{ isUser: false, mes: 'Hello' }])
            const unreadable = readOobaChat(ooba([[7, 'r']], [['', 'r']], { user_0: { versions: [{ content: 'a' }, { content: 'b' }] } }))
            expect(unreadable.messages).toEqual([{ isUser: false, mes: 'r' }])
            expect(unreadable.skipped).toBe(0)
        })
    })
})

describe('detectJsonChatFormat Agnai (unit)', () => {
    // Reproducers: a detector without the Agnai branch returns undefined and fails by assertion.
    test('a file with messages that carry a string msg is Agnai, with or without ids', () => {
        expect(detectJsonChatFormat({ name: 'Exported', greeting: 'Hi', messages: [{ _id: 'a1b2c3d4', msg: 'hello', userId: 'u1' }] })).toBe('agnai')
        expect(detectJsonChatFormat({ name: 'Exported', messages: [{ msg: 'old export without ids', characterId: 'imported' }] })).toBe('agnai')
    })

    test('an element without a string msg does not block detection when another has one', () => {
        expect(detectJsonChatFormat({ messages: [5, { msg: 7 }, { msg: 'text' }] })).toBe('agnai')
    })

    // Guards: these pass before and after the Agnai branch exists.
    test('a Risu export type is never detected, even carrying messages', () => {
        expect(detectJsonChatFormat({ type: 'risuChat', messages: [{ msg: 'x' }] })).toBeUndefined()
        expect(detectJsonChatFormat({ type: 'risuAllChats', messages: [{ msg: 'x' }] })).toBeUndefined()
    })

    test('an Ooba pair keeps precedence over a messages array', () => {
        const rows = [['a', 'b']]
        expect(detectJsonChatFormat({ internal: rows, visible: rows, messages: [{ msg: 'x' }] })).toBe('ooba')
    })

    const notAgnai: Array<[string, unknown]> = [
        ['an element with candidates (Lianne)', { messages: [{ msg: 'x', candidates: ['a'] }] }],
        ['candidates on another element', { messages: [{ msg: 'x' }, { candidates: [] }] }],
        ['OpenAI role and content', { messages: [{ role: 'user', content: 'x' }] }],
        ['an empty messages array', { messages: [] }],
        ['messages of non-objects only', { messages: [1, 'a', null, [{ msg: 'x' }]] }],
        ['messages that is not an array', { messages: { msg: 'x' } }],
        ['elements without a string msg', { messages: [{ msg: 5 }, { content: 'x' }] }],
        ['a histories file', { histories: [{ msg: 'x' }] }],
        ['an array', [{ msg: 'x' }]],
        ['a string', 'text'],
        ['null', null],
    ]
    test.each(notAgnai)('%s is not Agnai', (_label, body) => {
        expect(detectJsonChatFormat(body)).toBeUndefined()
    })
})

describe('readAgnaiChat (unit)', () => {
    // The reader specification tests import a function that does not exist on the base, so
    // there they fail at setup, which is not regression evidence. The reproducers are the
    // detection tests above and the importChat tests in characters.importChat.test.ts.
    const stamp = (minute: number) => new Date(Date.UTC(2025, 0, 1, 0, minute)).toISOString()
    const row = (id: string, parent: string | undefined, minute: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
        _id: id, parent, msg: `m-${id}`, createdAt: stamp(minute), characterId: 'imported', ...extra,
    })
    const read = (rows: unknown[]) => readAgnaiChat({ name: 'Exported', messages: rows })
    const texts = (rows: unknown[]) => read(rows).messages.map((m) => m.mes)
    const withLeaf = (rows: Array<Record<string, unknown>>, leaf: unknown) => rows.map((r) => leaf === undefined ? r : { ...r, treeLeafId: leaf })

    // Root r0; a1 under r0; b2 and c3 under a1; d4 under c3 (older tip); e5 under b2 (newest tip).
    const branched = () => [row('r0', undefined, 0), row('a1', 'r0', 1), row('b2', 'a1', 2), row('c3', 'a1', 3), row('d4', 'c3', 4), row('e5', 'b2', 5)]
    // The older branch b2-d4 is abandoned for e5-f6, which grows from the shared ancestor a1.
    const forkAndContinue = () => [row('r0', undefined, 0), row('a1', 'r0', 1), row('b2', 'a1', 2), row('d4', 'b2', 3), row('e5', 'a1', 4), row('f6', 'e5', 5)]

    test('an unrecognised value reads as an empty result without a header', () => {
        for(const value of [undefined, null, 'text', 5, [], {}, { messages: 'x' }, { messages: {} }]){
            const result = readAgnaiChat(value)
            expect(result).toEqual({ messages: [], skipped: 0, swipesNotKept: 0 })
            expect('header' in result).toBe(false)
        }
    })

    test('a file without ids keeps every message in file order and counts nothing', () => {
        const result = read([
            { msg: 'hello', userId: 'u1', characterId: 'imported' },
            { msg: 'first', characterId: 'c-1' },
            { msg: 'second', characterId: 'c-2' },
        ])
        expect(result.messages.map((m) => [m.isUser, m.mes])).toEqual([[true, 'hello'], [false, 'first'], [false, 'second']])
        expect(result.messages.every((m) => m.sendDate === undefined)).toBe(true)
        expect(result.skipped).toBe(0)
        expect(result.swipesNotKept).toBe(0)
        expect('header' in result).toBe(false)
    })

    test('parents that are text prefixes resolve to nothing: every message in file order', () => {
        const rows = ['Once upon a time', 'The knight rode', 'A dragon woke', 'Fire filled the sky'].map((text, index, all) =>
            row(`e1a0000${index}`, index === 0 ? undefined : all[index].slice(0, 8), index, { msg: text }))
        expect(texts(rows)).toEqual(['Once upon a time', 'The knight rode', 'A dragon woke', 'Fire filled the sky'])
        expect(read(rows).swipesNotKept).toBe(0)
    })

    test('one text prefix that equals a real id makes one link and many roots: the newest tip alone is kept', () => {
        const rows = Array.from({ length: 12 }, (_, index) => {
            const text = index === 4 ? 'e1a00002 and more' : `Line ${index} of the story`
            return row(`e1a0000${(index + 1).toString(16)}`, text.slice(0, 8), index, { msg: text })
        })
        const result = read(rows)
        expect(result.messages.map((m) => m.mes)).toEqual(['Line 11 of the story'])
        expect(result.swipesNotKept).toBe(11)
    })

    test('a chain given out of file order is imported in link order', () => {
        const rows = [row('c3', 'b2', 2), row('a1', undefined, 0), row('b2', 'a1', 1)]
        const result = read(rows)
        expect(result.messages.map((m) => m.mes)).toEqual(['m-a1', 'm-b2', 'm-c3'])
        expect(result.swipesNotKept).toBe(0)
    })

    test('a branched file imports the path to the newest tip, keeps a retry sibling as a swipe and counts the rest', () => {
        const result = read(branched())
        expect(result.messages.map((m) => m.mes)).toEqual(['m-r0', 'm-a1', 'm-b2', 'm-e5'])
        expect(result.messages[2].swipes).toEqual({ before: [], after: ['m-c3'] })
        expect(result.swipesNotKept).toBe(1)
        expect(texts([...branched()].reverse())).toEqual(['m-r0', 'm-a1', 'm-b2', 'm-e5'])
        const reversed = read([...branched()].reverse())
        expect(reversed.messages[2].swipes).toEqual({ before: ['m-c3'], after: [] })
        expect(reversed.swipesNotKept).toBe(1)
    })

    test('fork and continue: the newer branch wins, the abandoned first reply is its swipe and its continuation is counted', () => {
        const result = read(withLeaf(forkAndContinue(), 'd4'))
        expect(result.messages.map((m) => m.mes)).toEqual(['m-r0', 'm-a1', 'm-e5', 'm-f6'])
        expect(result.messages[2].swipes).toEqual({ before: ['m-b2'], after: [] })
        expect(result.swipesNotKept).toBe(1)
    })

    test('treeLeafId never changes the result', () => {
        const expected = read(branched())
        for(const leaf of [undefined, 'd4', 'e5', 'a1', 'unknownx', 7, null]){
            expect(read(withLeaf(branched(), leaf))).toEqual(expected)
        }
    })

    test('equal creation times: the later element in the file wins', () => {
        const rows = [row('r0', undefined, 0), row('c3', 'r0', 5), row('b2', 'r0', 5)]
        const result = read(rows)
        expect(result.messages.map((m) => m.mes)).toEqual(['m-r0', 'm-b2'])
        expect(result.messages[1].swipes).toEqual({ before: ['m-c3'], after: [] })
        expect(result.swipesNotKept).toBe(0)
    })

    test('a tip without a readable time makes the greatest file index win', () => {
        const dated = row('x1', 'r0', 9)
        const undated = row('y2', 'r0', 0, { createdAt: 'not a date' })
        const root = row('r0', undefined, 0)
        expect(texts([root, dated, undated])).toEqual(['m-r0', 'm-y2'])
        expect(texts([root, undated, dated])).toEqual(['m-r0', 'm-x1'])
        const result = read([root, undated, dated])
        expect(result.messages[1].swipes).toEqual({ before: ['m-y2'], after: [] })
        expect(result.swipesNotKept).toBe(0)
    })

    test('an orphan subtree is its own component and the newest tip across components wins', () => {
        const main = [row('r0', undefined, 0), row('a1', 'r0', 1), row('b2', 'a1', 2), row('c3', 'b2', 3)]
        const orphanNewer = [row('x9', 'zzzzzzzz', 4), row('y8', 'x9', 5)]
        const newer = read([...main, ...orphanNewer])
        expect(newer.messages.map((m) => m.mes)).toEqual(['m-x9', 'm-y8'])
        expect(newer.swipesNotKept).toBe(4)
        const orphanOlder = [row('x9', 'zzzzzzzz', 1), row('y8', 'x9', 2)]
        const older = read([...main, ...orphanOlder])
        expect(older.messages.map((m) => m.mes)).toEqual(['m-r0', 'm-a1', 'm-b2', 'm-c3'])
        expect(older.swipesNotKept).toBe(2)
    })

    test('a repeated id in a tree is file order with nothing counted', () => {
        const rows = [row('r0', undefined, 0), row('x1', 'r0', 1, { msg: 'first x1' }), row('x1', 'r0', 2, { msg: 'second x1' }), row('c3', 'x1', 3)]
        const result = read(rows)
        expect(result.messages.map((m) => m.mes)).toEqual(['m-r0', 'first x1', 'second x1', 'm-c3'])
        expect(result.swipesNotKept).toBe(0)
    })

    test('a loop is file order with nothing counted, wherever the tips are', () => {
        const pair = [row('A', 'B', 0), row('B', 'A', 1), row('C', undefined, 2)]
        expect(read(pair).messages.map((m) => m.mes)).toEqual(['m-A', 'm-B', 'm-C'])
        expect(read(pair).swipesNotKept).toBe(0)

        const loopWithTips = [row('A', 'B', 0), row('B', 'A', 1), row('C', 'A', 2), row('D', 'A', 3)]
        expect(read(loopWithTips).messages.map((m) => m.mes)).toEqual(['m-A', 'm-B', 'm-C', 'm-D'])
        expect(read(loopWithTips).swipesNotKept).toBe(0)

        const self = [row('S', 'S', 0), row('a1', undefined, 1), row('b2', 'a1', 2)]
        expect(read(self).messages.map((m) => m.mes)).toEqual(['m-S', 'm-a1', 'm-b2'])
        expect(read(self).swipesNotKept).toBe(0)
    })

    test('a skipped element stays in the link map: its children stay linked', () => {
        const rows = [row('a1', undefined, 0), row('b2', 'a1', 1, { msg: 5 }), row('c3', 'b2', 2), row('d4', 'c3', 3)]
        const result = read(rows)
        expect(result.messages.map((m) => m.mes)).toEqual(['m-a1', 'm-c3', 'm-d4'])
        expect(result.skipped).toBe(1)
        expect(result.swipesNotKept).toBe(0)
    })

    test('a skipped element off the path is neither counted as a swipe nor imported', () => {
        const base = [row('r0', undefined, 0), row('a1', 'r0', 1), row('b2', 'r0', 2, { msg: 5 }), row('c3', 'a1', 3)]
        const result = read([...base, null])
        expect(result.messages.map((m) => m.mes)).toEqual(['m-r0', 'm-a1', 'm-c3'])
        expect(result.skipped).toBe(2)
        expect(result.swipesNotKept).toBe(0)

        const longer = read([...base, null, row('d4', 'r0', 4)])
        expect(longer.messages.map((m) => m.mes)).toEqual(['m-r0', 'm-d4'])
        expect(longer.messages[1].swipes).toEqual({ before: ['m-a1'], after: [] })
        expect(longer.skipped).toBe(2)
        expect(longer.swipesNotKept).toBe(1)
    })

    test('an empty msg emits no line, is uncounted and keeps the chain', () => {
        expect(texts([row('a1', undefined, 0), row('b2', 'a1', 1, { msg: '' }), row('c3', 'b2', 2)])).toEqual(['m-a1', 'm-c3'])
        const offPath = read([row('r0', undefined, 0), row('a1', 'r0', 1), row('b2', 'r0', 2, { msg: '' }), row('c3', 'a1', 3), row('d4', 'r0', 4)])
        expect(offPath.messages.map((m) => m.mes)).toEqual(['m-r0', 'm-d4'])
        expect(offPath.messages[1].swipes).toEqual({ before: ['m-a1'], after: [] })
        expect(offPath.swipesNotKept).toBe(1)
        expect(read([row('a1', undefined, 0, { msg: '' }), row('b2', 'a1', 1, { msg: '' })])).toEqual({ messages: [], skipped: 0, swipesNotKept: 0 })
    })

    // Regression reproducer: the siblings follow file order, not creation time.
    test('retry siblings are swipes in file order, whatever their creation times', () => {
        const result = read([row('u0', undefined, 0, { userId: 'u' }), row('b', 'u0', 5), row('c', 'u0', 3)])
        expect(result.messages.map((m) => m.mes)).toEqual(['m-u0', 'm-b'])
        expect(result.messages[1].swipes).toEqual({ before: [], after: ['m-c'] })
        expect(result.swipesNotKept).toBe(0)
    })

    // Compatibility guard (passes before and after): a sibling from another speaker is not a swipe and stays counted.
    test('a sibling from another speaker or another named character stays counted', () => {
        const byUser = read([row('r0', undefined, 0), row('b', 'r0', 5), row('x', 'r0', 3, { userId: 'u1' })])
        expect(byUser.messages[1].swipes).toBeUndefined()
        expect(byUser.swipesNotKept).toBe(1)
        const byName = read([row('r0', undefined, 0), row('b', 'r0', 5), row('y', 'r0', 3, { characterId: 'c-2', name: 'Ann' })])
        expect(byName.messages[1].swipes).toBeUndefined()
        expect(byName.swipesNotKept).toBe(1)
    })

    // Compatibility guard (passes before and after): a path child without a line has no position for its siblings.
    test('a sibling of a path child that has no line stays counted', () => {
        const result = read([row('r0', undefined, 0), row('b', 'r0', 5, { msg: '' }), row('c', 'r0', 3)])
        expect(result.messages.map((m) => m.mes)).toEqual(['m-r0'])
        expect(result.messages[0].swipes).toBeUndefined()
        expect(result.swipesNotKept).toBe(1)
    })

    test('an element that is not an object is skipped in every class', () => {
        const result = read([null, 'text', 4, [], { msg: 'only' }])
        expect(result.messages.map((m) => m.mes)).toEqual(['only'])
        expect(result.skipped).toBe(4)
    })

    test('several characters in a linear chat are all kept', () => {
        const rows = [
            row('a1', undefined, 0, { userId: 'u1', characterId: 'imported' }),
            row('b2', 'a1', 1, { characterId: 'c-1' }),
            row('c3', 'b2', 2, { characterId: 'c-2' }),
            row('d4', 'c3', 3, { userId: 'u1' }),
            row('e5', 'd4', 4, { characterId: 'c-1' }),
        ]
        const result = read(rows)
        expect(result.messages.map((m) => m.mes)).toEqual(['m-a1', 'm-b2', 'm-c3', 'm-d4', 'm-e5'])
        expect(result.swipesNotKept).toBe(0)
    })

    test('speaker and name: userId decides, a user line keeps a name only with a characterId', () => {
        const result = readAgnaiChat({
            name: 'Exported',
            messages: [
                { msg: 'u1', userId: 'U1', characterId: 'imported', name: 'Sam' },
                { msg: 'u2', userId: 'U1', characterId: 'c-2', name: 'Narrator' },
                { msg: 'u3', userId: 'U1', name: 'handle' },
                { msg: 'u4', userId: 'U1', characterId: 'c-2', name: '   ' },
                { msg: 'c1', characterId: 'imported', name: 'Bot' },
                { msg: 'c2', characterId: 'c-2', name: ' Ann ' },
                { msg: 'c3' },
                { msg: 'c4', name: 'Exported' },
            ],
        })
        expect(result.messages.map((m) => [m.mes, m.isUser, m.name])).toEqual([
            ['u1', true, 'Sam'],
            ['u2', true, 'Narrator'],
            ['u3', true, undefined],
            ['u4', true, undefined],
            ['c1', false, undefined],
            ['c2', false, 'Ann'],
            ['c3', false, undefined],
            ['c4', false, 'Exported'],
        ])
        expect('header' in result).toBe(false)
    })

    test('ooc is an ordinary user message and never system', () => {
        const result = readAgnaiChat({ messages: [{ msg: 'a', ooc: true }, { msg: 'b', ooc: true, userId: 'U1' }, { msg: 'c', ooc: false }] })
        expect(result.messages.map((m) => [m.mes, m.isUser])).toEqual([['a', true], ['b', true], ['c', false]])
        expect(result.messages.every((m) => m.isSystem === undefined)).toBe(true)
    })

    test('createdAt becomes sendDate when readable and is absent otherwise', () => {
        const result = read([
            row('a1', undefined, 0, { createdAt: '2025-03-04T05:06:07.000Z' }),
            row('b2', 'a1', 1, { createdAt: 'later' }),
            row('c3', 'b2', 2, { createdAt: '10000-01-01T00:00:00.000Z' }),
        ])
        expect(result.messages.map((m) => m.sendDate)).toEqual([Date.UTC(2025, 2, 4, 5, 6, 7), undefined, undefined])
    })

    describe('large inputs', () => {
        const count = 50000

        test('a chain returns every message with nothing counted', () => {
            const rows = Array.from({ length: count }, (_, index) => row(`n${index}`, index === 0 ? undefined : `n${index - 1}`, index))
            const result = read(rows)
            expect(result.messages).toHaveLength(count)
            expect(result.messages[0].mes).toBe('m-n0')
            expect(result.messages[count - 1].mes).toBe(`m-n${count - 1}`)
            expect(result.swipesNotKept).toBe(0)
        })

        test('a spine with a side tip every ten nodes returns the spine with the side tips as swipes and counts nothing', () => {
            const rows: Array<Record<string, unknown>> = []
            for(let index = 0; index < count; index++){
                rows.push(row(`s${index}`, index === 0 ? undefined : `s${index - 1}`, index + 1))
                if(index % 10 === 0){
                    rows.push(row(`t${index}`, `s${index}`, 0))
                }
            }
            const result = read(rows)
            expect(result.messages).toHaveLength(count)
            expect(result.messages[count - 1].mes).toBe(`m-s${count - 1}`)
            expect(result.messages.filter((m) => m.swipes !== undefined)).toHaveLength(count / 10)
            expect(result.swipesNotKept).toBe(0)
        })

        test('a ring is a loop: file order with nothing counted', () => {
            const rows = Array.from({ length: count }, (_, index) => row(`n${index}`, `n${(index + 1) % count}`, index))
            const result = read(rows)
            expect(result.messages).toHaveLength(count)
            expect(result.messages[0].mes).toBe('m-n0')
            expect(result.messages[count - 1].mes).toBe(`m-n${count - 1}`)
            expect(result.swipesNotKept).toBe(0)
        })
    })
})

describe('detectJsonChatFormat Kobold (unit)', () => {
    // Reproducers: a detector without the Kobold branch returns undefined and fails by assertion.
    test('a prompt string with an actions array is Kobold, even when both are empty', () => {
        expect(detectJsonChatFormat({ prompt: '', actions: [] })).toBe('kobold')
        expect(detectJsonChatFormat({ gamestarted: true, prompt: 'x', actions: ['a'] })).toBe('kobold')
    })

    test('a savedsettings object with an actions array is Kobold without a prompt', () => {
        expect(detectJsonChatFormat({ actions: ['a'], savedsettings: {} })).toBe('kobold')
    })

    // Guards: these pass before and after the Kobold branch exists.
    test('an actions array alone, or a prompt beside a non-array actions, is not Kobold', () => {
        expect(detectJsonChatFormat({ actions: ['a'] })).toBeUndefined()
        expect(detectJsonChatFormat({ prompt: 'x', actions: { 0: 'a' } })).toBeUndefined()
        expect(detectJsonChatFormat({ prompt: 'x' })).toBeUndefined()
        expect(detectJsonChatFormat({ actions: [], savedsettings: null })).toBeUndefined()
        expect(detectJsonChatFormat({ actions: [], savedsettings: [] })).toBeUndefined()
    })

    test('a Risu export type is never detected, even carrying a Kobold shape', () => {
        expect(detectJsonChatFormat({ type: 'risuChat', prompt: 'x', actions: [] })).toBeUndefined()
    })

    test('an Ooba or Agnai shape keeps precedence over a Kobold shape in the same object', () => {
        const rows = [['a', 'b']]
        expect(detectJsonChatFormat({ internal: rows, visible: rows, prompt: 'x', actions: ['a'] })).toBe('ooba')
        expect(detectJsonChatFormat({ messages: [{ msg: 'x' }], prompt: 'x', actions: ['a'] })).toBe('agnai')
    })
})

describe('loadKoboldSettings (unit)', () => {
    const settings = (extra: Record<string, unknown>) => loadKoboldSettings({ opmode: 4, ...extra })

    test('a missing block, a non-object block or an unusable opmode gives no settings', () => {
        for(const raw of [undefined, null, [], 'x', 4, {}, { opmode: 5 }, { opmode: 'x' }, { opmode: 3.5 }, { opmode: true }, { opmode: null }, { opmode: 0 }]){
            expect(loadKoboldSettings(raw)).toBeUndefined()
        }
    })

    test('opmode accepts a number or a numeric string', () => {
        expect(loadKoboldSettings({ opmode: 3 })?.mode).toBe(3)
        expect(loadKoboldSettings({ opmode: '4' })?.mode).toBe(4)
        expect(loadKoboldSettings({ opmode: ' 1 ' })?.mode).toBe(1)
    })

    test('absent keys take Lite\'s defaults', () => {
        const loaded = settings({ instruct_has_markdown: true })
        expect(loaded).toMatchObject({
            userName: 'User',
            opponents: ['KoboldAI'],
            startTag: '{{[INPUT]}}',
            endTag: '{{[OUTPUT]}}',
            systemTag: '{{[SYSTEM]}}',
            startEndTag: '',
            endEndTag: '',
            systemEndTag: '',
        })
    })

    // The loader wraps the start and end tags when instruct_has_newlines is loosely true or neither flag is present.
    const legacyCases: Array<[string, Record<string, unknown>, boolean]> = [
        ['newlines true', { instruct_has_newlines: true, instruct_has_markdown: true }, true],
        ['newlines 1', { instruct_has_newlines: 1, instruct_has_markdown: true }, true],
        ['newlines "1"', { instruct_has_newlines: '1', instruct_has_markdown: true }, true],
        ['newlines false, markdown true', { instruct_has_newlines: false, instruct_has_markdown: true }, false],
        ['newlines false, markdown absent', { instruct_has_newlines: false }, false],
        ['newlines "0"', { instruct_has_newlines: '0' }, false],
        ['newlines "true"', { instruct_has_newlines: 'true', instruct_has_markdown: true }, false],
        ['newlines absent, markdown true', { instruct_has_markdown: true }, false],
        ['newlines absent, markdown false', { instruct_has_markdown: false }, false],
        ['neither flag', {}, true],
        ['both null', { instruct_has_newlines: null, instruct_has_markdown: null }, true],
        ['newlines null, markdown true', { instruct_has_newlines: null, instruct_has_markdown: true }, false],
    ]
    test.each(legacyCases)('legacy condition: %s', (_label, flags, wrapped) => {
        const loaded = settings({ instruct_starttag: 'A', instruct_endtag: 'B', ...flags })
        expect(loaded?.startTag).toBe(wrapped ? '\\nA\\n' : 'A')
        expect(loaded?.endTag).toBe(wrapped ? '\\nB\\n' : 'B')
    })

    test('only the start and end tags are wrapped', () => {
        const loaded = settings({
            instruct_starttag: 'A', instruct_endtag: 'B', instruct_systag: 'S',
            instruct_starttag_end: 'E1', instruct_endtag_end: 'E2', instruct_systag_end: 'E3',
        })
        expect(loaded).toMatchObject({ startTag: '\\nA\\n', endTag: '\\nB\\n', systemTag: 'S', startEndTag: 'E1', endEndTag: 'E2', systemEndTag: 'E3' })
    })

    test('a tag that already holds a backslash-n is not wrapped, and an absent tag is wrapped as its default', () => {
        const loaded = settings({ instruct_starttag: '\\nA', instruct_has_newlines: true })
        expect(loaded?.startTag).toBe('\\nA')
        expect(loaded?.endTag).toBe('\\n{{[OUTPUT]}}\\n')
    })

    test('a non-string tag or name is read as absent', () => {
        const loaded = settings({ instruct_has_markdown: true, instruct_starttag: null, instruct_endtag: 5, chatname: 7, chatopponent: {} })
        expect(loaded).toMatchObject({ startTag: '{{[INPUT]}}', endTag: '{{[OUTPUT]}}', userName: 'User', opponents: ['KoboldAI'] })
    })

    test('names are kept as stored; an empty user name is User', () => {
        expect(settings({ chatname: ' Dana ' })?.userName).toBe(' Dana ')
        expect(settings({ chatname: '' })?.userName).toBe('User')
        expect(settings({ chatopponent: ' Mira ' })?.opponents).toEqual([' Mira '])
    })

    test('a blank opponent declares nobody; a list is split, sanitised and stripped of empty entries', () => {
        expect(settings({ chatopponent: '' })?.opponents).toEqual([])
        expect(settings({ chatopponent: '  ' })?.opponents).toEqual([])
        expect(settings({ chatopponent: '||$||' })?.opponents).toEqual([])
        expect(settings({ chatopponent: 'A\nB' })?.opponents).toEqual(['AB'])
        expect(settings({ chatopponent: ' Mira  K ||$||\nTess\n||$||' })?.opponents).toEqual(['Mira K', 'Tess'])
    })
})

describe('readKoboldChat (unit)', () => {
    // Reproducers: on the base `readKoboldChat` is not exported, so these fail at setup, not by assertion.
    const NLI = '\n{{[INPUT]}}\n'
    const kobold = (savedsettings: unknown, prompt = NLI + 'hi', actions: unknown[] = []) => ({ prompt, actions, savedsettings })

    const modes: Array<[unknown, 'story' | 'settings' | 'instruct' | 'chat']> = [
        [4, 'instruct'], ['4', 'instruct'], [' 4 ', 'instruct'], ['0x4', 'instruct'], [3, 'chat'], ['3', 'chat'],
        [1, 'story'], [2, 'story'], ['2', 'story'],
        [3.5, 'settings'], ['x', 'settings'], ['', 'settings'], [null, 'settings'], [0, 'settings'], [5, 'settings'], [true, 'settings'], [[4], 'settings'], [undefined, 'settings'],
    ]
    test.each(modes)('opmode %j reads as %s', (opmode, expected) => {
        const result = readKoboldChat(kobold({ opmode, instruct_has_markdown: true }))
        if(expected === 'story' || expected === 'settings'){
            expect(result.refusal).toBe(expected)
            expect(result.messages).toEqual([])
        }
        else {
            expect(result.refusal).toBeUndefined()
            expect(result.messages).toEqual(expected === 'instruct' ? [{ isUser: true, mes: 'hi' }] : [{ isUser: false, mes: '{{[INPUT]}}\nhi' }])
        }
    })

    test('the refusal order is empty story, then settings, then mode', () => {
        expect(readKoboldChat({ prompt: ' ', actions: [5] }).refusal).toBe('story')
        expect(readKoboldChat({ prompt: '', actions: [], savedsettings: { opmode: 4 } }).refusal).toBe('story')
        expect(readKoboldChat({ prompt: 'x', actions: [] }).refusal).toBe('settings')
        expect(readKoboldChat({ prompt: 'x', actions: [], savedsettings: { opmode: 1 } }).refusal).toBe('story')
        expect(readKoboldChat({ prompt: 'x', actions: [], savedsettings: { opmode: 9 } }).refusal).toBe('settings')
    })

    test('input that is not Kobold-shaped gives an empty result with no refusal', () => {
        for(const value of [undefined, null, [], 'x', {}, { actions: ['a'] }, { prompt: 'x' }, { prompt: 'x', actions: 'a' }]){
            const result = readKoboldChat(value)
            expect(result).toEqual({ messages: [], skipped: 0, swipesNotKept: 0 })
        }
    })

    test('non-string actions are counted and the other elements still read', () => {
        const result = readKoboldChat(kobold({ opmode: 4, instruct_has_markdown: true }, '', [NLI + 'a', 1, null, {}, [NLI + 'b']]))
        expect(result.messages).toEqual([{ isUser: true, mes: 'a' }])
        expect(result.skipped).toBe(4)
    })

    describe('header', () => {
        const header = (extra: Record<string, unknown>) =>
            readKoboldChat(kobold({ opmode: 3, instruct_has_markdown: true, ...extra }, 'Dana: hi')).header

        test('the effective names are used as stored, padding included', () => {
            expect(header({ chatname: ' Dana ', chatopponent: ' Mira ' })).toEqual({ userName: ' Dana ', characterName: ' Mira ' })
        })

        test('absent keys give Lite\'s defaults', () => {
            expect(header({})).toEqual({ userName: 'User', characterName: 'KoboldAI' })
        })

        test('a blank opponent leaves characterName out and a list gives its first entry', () => {
            expect(header({ chatname: 'Dana', chatopponent: '' })).toEqual({ userName: 'Dana' })
            expect(header({ chatname: 'Dana', chatopponent: '||$||' })).not.toHaveProperty('characterName')
            expect(header({ chatname: 'Dana', chatopponent: 'Mira||$||Tess' })).toEqual({ userName: 'Dana', characterName: 'Mira' })
        })

        // The import trims a stored name again, so only the reader's own output shows whether it trimmed.
        test('a speaker name is returned trimmed, and a whitespace-only name returns none', () => {
            const read = (text: string) => readKoboldChat(kobold({ opmode: 3, instruct_has_markdown: true, chatname: 'Dana', chatopponent: 'Mira' }, text)).messages
            expect(read('\n Tess : hello')).toEqual([{ isUser: false, mes: 'hello', name: 'Tess' }])
            expect(read('\n : x')).toEqual([{ isUser: false, mes: 'x' }])
        })

        test('instruct mode gives no header', () => {
            const result = readKoboldChat(kobold({ opmode: 4, instruct_has_markdown: true }))
            expect(result.header).toBeUndefined()
        })
    })

    describe('picture tokens', () => {
        const strip = (text: string) => readKoboldChat(kobold({ opmode: 3, instruct_has_markdown: true, chatname: 'Dana', chatopponent: 'Mira' }, text))

        test('h, d and p tokens are removed in the bracketed and bare forms; h and d are counted, p is not', () => {
            const result = strip('Mira: x[<|h|a|h|>]y<|d|b|d|>z[<|p|c|p|>]w<|p|d|p|>v')
            expect(result.messages).toEqual([{ isUser: false, mes: 'xyzwv', name: 'Mira' }])
            expect(result.mediaNotKept).toBe(2)
        })

        test('a repeated hash counts each occurrence', () => {
            expect(strip('Mira: [<|h|same|h|>][<|h|same|h|>]t').mediaNotKept).toBe(2)
        })

        test('an unclosed, cross-line or mismatched-letter token stays text and is not counted', () => {
            const text = 'Mira: <|h|abc <|h|x\ny|h|> <|h|z|d|> <|q|w|q|>'
            const result = strip(text)
            expect(result.messages[0].mes).toBe(text.slice('Mira: '.length))
            expect(result.mediaNotKept ?? 0).toBe(0)
        })

        test('a bracket is removed only when both sides hold one', () => {
            expect(strip('Mira: a[<|h|x|h|>b').messages[0].mes).toBe('a[b')
            expect(strip('Mira: a<|h|x|h|>]b').messages[0].mes).toBe('a]b')
        })
    })

    describe('swipes', () => {
        const NLO = '\n{{[OUTPUT]}}\n'
        const settings = { opmode: 4, instruct_has_markdown: true }
        const withBranches = (altbranches: unknown[], actions: string[] = [NLI + 'q', NLO + 'a']) =>
            readKoboldChat({ prompt: '', actions, savedsettings: settings, altbranches })

        test('the first differing message of a branch is a swipe; an equal or prefix branch adds nothing', () => {
            const result = withBranches([['', NLI + 'q'], ['', NLI + 'q', NLO + 'a'], ['', NLI + 'q', NLO + 'other']])
            expect(result.messages[1].swipes).toEqual({ before: [], after: ['other'] })
            expect(result.messages[0].swipes).toBeUndefined()
            expect(result.swipesNotKept).toBe(0)
        })

        test('the null entry marks the shown branch: earlier branches go before the shown reply, later ones after', () => {
            const result = withBranches([['', NLI + 'q', NLO + 'x'], null, ['', NLI + 'q', NLO + 'y']])
            expect(result.messages[1].swipes).toEqual({ before: ['x'], after: ['y'] })
            expect(result.swipesNotKept).toBe(0)
        })

        test('a repeated head at one position is one swipe and the rest of each branch is counted', () => {
            const branch = (tail: string) => ['', NLI + 'q', NLO + 'x', NLI + 'q2', NLO + tail]
            const result = withBranches([branch('r1'), branch('r2')])
            expect(result.messages[1].swipes).toEqual({ before: [], after: ['x'] })
            expect(result.swipesNotKept).toBe(4)
        })

        test('heads with one text at two different positions are both kept: the repeat rule is per position', () => {
            const actions = [NLI + 'q', NLO + 'a', NLI + 'q2', NLO + 'b']
            const result = withBranches([['', NLI + 'q', NLO + 'h'], ['', NLI + 'q', NLO + 'a', NLI + 'q2', NLO + 'h']], actions)
            expect(result.messages[1].swipes).toEqual({ before: [], after: ['h'] })
            expect(result.messages[3].swipes).toEqual({ before: [], after: ['h'] })
            expect(result.swipesNotKept).toBe(0)
        })

        // Compatibility guard (passes before and after): a branch that only extends the shown story has no position to join.
        test('a branch longer than the shown story keeps no swipe and counts its extra messages', () => {
            const result = withBranches([['', NLI + 'q', NLO + 'a', NLI + 'q2', NLO + 'b']])
            expect(result.messages.every((m) => m.swipes === undefined)).toBe(true)
            expect(result.swipesNotKept).toBe(2)
        })

        // Compatibility guard (passes before and after): another speaker's head is not a reply to the shown message.
        test('a head from another speaker is not a swipe and stays counted', () => {
            const result = withBranches([['', NLI + 'q', NLI + 'u']])
            expect(result.messages.every((m) => m.swipes === undefined)).toBe(true)
            expect(result.swipesNotKept).toBe(1)
        })
    })

    test('a 20,000-turn chat reads in file order (an exercise of the line scan, not performance evidence)', () => {
        const lines: string[] = []
        for(let index = 0; index < 20000; index++){
            lines.push(`Dana: u${index}`, `Mira: c${index}`)
        }
        const result = readKoboldChat(kobold({ opmode: 3, instruct_has_markdown: true, chatname: 'Dana', chatopponent: 'Mira' }, lines.join('\n')))
        expect(result.messages).toHaveLength(40000)
        expect(result.messages[0]).toMatchObject({ isUser: true, mes: 'u0' })
        expect(result.messages[39999]).toMatchObject({ isUser: false, mes: 'c19999' })
    })
})

// Character.AI fixtures are built the way the three writers store them: raw turns
// with `author`, `candidates` and `primary_candidate_id` (a human turn carries no
// author name), Morse oldest first, Lianne newest first, the dumper's anonymised
// `{ info, histories }`.
type CaiTurnOptions = {
    id?: string
    human?: boolean | string
    name?: string
    text?: string
    time?: string
    candidates?: Array<Record<string, unknown>>
    primary?: string
}

function caiTurn(options: CaiTurnOptions): Record<string, unknown> {
    const turn: Record<string, unknown> = {
        author: options.human === undefined || options.human === false
            ? { author_id: 'a', is_human: false, ...(options.name === undefined ? {} : { name: options.name }) }
            : { author_id: 'a', is_human: options.human },
        candidates: options.candidates ?? [{ candidate_id: `${options.id ?? 't'}-1`, raw_content: options.text ?? 'x' }],
        primary_candidate_id: options.primary ?? `${options.id ?? 't'}-1`,
    }
    if(options.id !== undefined){
        turn.turn_key = { chat_id: 'chat-1', turn_id: options.id }
    }
    if(options.time !== undefined){
        turn.create_time = options.time
    }
    return turn
}

const caiUser = (text: string, extra: CaiTurnOptions = {}) => caiTurn({ human: true, text, ...extra })
const caiChar = (name: string, text: string, extra: CaiTurnOptions = {}) => caiTurn({ name, text, ...extra })
const caiMorseChat = (turns: unknown[], extra: Record<string, unknown> = {}) => ({ chat_id: 'c', create_time: '2026-01-01T00:00:00Z', turns, ...extra })
const caiMorseEntry = (character: Record<string, unknown>, chats: unknown[]) => ({ character, avatar: null, chats })
const caiMorseFile = (characters: unknown[]) => ({ format: 'morse.cai-export', version: 1, exportedAt: 'x', source: 'x', user: {}, personas: [], characters })
const dumperMsg = (name: string, human: boolean, text: string, extra: Record<string, unknown> = {}) => ({
    text, src: { is_human: human, name: human ? '[NAME_REDACTED]' : name }, ...extra,
})
const dumperFile = (infoName: string | undefined, histories: unknown[][]) => ({
    info: infoName === undefined ? {} : { character: { name: infoName } },
    histories: { histories: histories.map((msgs) => ({ msgs })) },
})

describe('detectJsonChatFormat Character.AI (unit)', () => {
    // Reproducers, this test and the next: on a detector without the CAI branches each fails by assertion
    // (a case returns undefined here, or another format in the next test).
    test('a wrapped Lianne export, a bare turn array, a Morse file and a dumper file are named', () => {
        const turns = [caiChar('Mira', 'hi')]
        expect(detectJsonChatFormat({ chat_id: 'c', exported_at: 'x', message_count: 1, messages: turns })).toBe('cai-turns')
        expect(detectJsonChatFormat(turns)).toBe('cai-turns')
        expect(detectJsonChatFormat(caiMorseFile([]))).toBe('cai-morse')
        expect(detectJsonChatFormat(dumperFile('Mira', [[]]))).toBe('cai-dumper')
    })

    test('a CAI shape beside an Ooba, Agnai or Kobold shape in one object is read as CAI', () => {
        const turns = [caiChar('Mira', 'hi')]
        const rows = [['a', 'b']]
        expect(detectJsonChatFormat({ internal: rows, visible: rows, messages: turns })).toBe('cai-turns')
        expect(detectJsonChatFormat({ messages: [...turns, { msg: 'x' }] })).toBe('cai-turns')
        expect(detectJsonChatFormat({ prompt: 'x', actions: ['a'], messages: turns })).toBe('cai-turns')
        expect(detectJsonChatFormat({ ...caiMorseFile([]), internal: rows, visible: rows, prompt: 'x', actions: [] })).toBe('cai-morse')
        expect(detectJsonChatFormat({ ...dumperFile('Mira', [[]]), prompt: 'x', actions: [] })).toBe('cai-dumper')
    })

    // Guards: these pass before and after the CAI branches exist.
    test('files that only look like CAI stay undetected', () => {
        expect(detectJsonChatFormat({ ...caiMorseFile([]), format: 'morse.export' })).toBeUndefined()
        expect(detectJsonChatFormat({ ...caiMorseFile([]), version: 2 })).toBeUndefined()
        expect(detectJsonChatFormat({ ...caiMorseFile([]), characters: {} })).toBeUndefined()
        expect(detectJsonChatFormat({ histories: [{ msgs: [] }] })).toBeUndefined()
        expect(detectJsonChatFormat({ info: {}, histories: { histories: {} } })).toBeUndefined()
        expect(detectJsonChatFormat([])).toBeUndefined()
        expect(detectJsonChatFormat([{ mes: 'x' }, 4, null])).toBeUndefined()
        expect(detectJsonChatFormat({ messages: [{ candidates: [{ text: 'x' }] }] })).toBeUndefined()
        expect(detectJsonChatFormat({ type: 'risuChat', ...caiMorseFile([]) })).toBeUndefined()
    })

    test('Ooba, Agnai and Kobold files keep their format', () => {
        const rows = [['a', 'b']]
        expect(detectJsonChatFormat({ internal: rows, visible: rows })).toBe('ooba')
        expect(detectJsonChatFormat({ messages: [{ msg: 'x' }] })).toBe('agnai')
        expect(detectJsonChatFormat({ prompt: 'x', actions: ['a'] })).toBe('kobold')
    })
})

// Reader tests: on the base these fail at setup ("is not a function"), so they are specification tests,
// not red-by-assertion reproducers. The integration reproducers are in characters.importChat.test.ts.
describe('readCaiTurnsChat (unit)', () => {
    test('a newest-first file reads oldest first, from a wrapped file and from a bare array', () => {
        const turns = [caiChar('Mira', 'third'), caiUser('second'), caiChar('Mira', 'first')]
        const wrapped = readCaiTurnsChat({ messages: turns })
        expect(wrapped.messages.map((m) => m.mes)).toEqual(['first', 'second', 'third'])
        expect(readCaiTurnsChat(turns).messages.map((m) => m.mes)).toEqual(['first', 'second', 'third'])
    })

    test('the shown reply is the primary candidate and the other candidates are its swipes in array order', () => {
        const turn = caiChar('Mira', '', {
            candidates: [{ candidate_id: 'a', raw_content: 'older' }, { candidate_id: 'b', raw_content: 'shown' }, { candidate_id: 'c', raw_content: 'newer' }],
            primary: 'b',
        })
        const result = readCaiTurnsChat([turn])
        expect(result.messages.map((m) => m.mes)).toEqual(['shown'])
        expect(result.messages[0].swipes).toEqual({ before: ['older'], after: ['newer'] })
        expect(result.swipesNotKept).toBe(0)
    })

    test('a character turn and a human turn keep their other candidates as swipes and count nothing', () => {
        const candidates = [{ candidate_id: 'a', raw_content: 'one' }, { candidate_id: 'b', raw_content: 'two' }, { candidate_id: 'c', raw_content: 'three' }]
        const character = readCaiTurnsChat([caiChar('Mira', '', { candidates, primary: 'a' })])
        expect(character.messages[0].swipes).toEqual({ before: [], after: ['two', 'three'] })
        expect(character.swipesNotKept).toBe(0)
        const human = readCaiTurnsChat([caiUser('', { candidates, primary: 'a' })])
        expect(human.messages.map((m) => [m.isUser, m.mes])).toEqual([[true, 'one']])
        expect(human.messages[0].swipes).toEqual({ before: [], after: ['two', 'three'] })
        expect(human.swipesNotKept).toBe(0)
    })

    test('the shown reply sits at the primary candidate\'s own index even when an earlier candidate has the same text', () => {
        const candidates = [{ candidate_id: 'a', raw_content: 'same' }, { candidate_id: 'b', raw_content: 'same' }, { candidate_id: 'c', raw_content: 'x' }]
        const result = readCaiTurnsChat([caiChar('Mira', '', { candidates, primary: 'b' })])
        expect(result.messages[0]).toMatchObject({ mes: 'same', swipes: { before: ['same'], after: ['x'] } })
    })

    test('a turn with no primary_candidate_id is skipped even when a candidate has no candidate_id', () => {
        const turn = { author: { is_human: false, name: 'Mira' }, candidates: [{ raw_content: 'orphan' }] }
        const result = readCaiTurnsChat([turn, caiChar('Mira', 'ok')])
        expect(result.messages.map((m) => m.mes)).toEqual(['ok'])
        expect(result.skipped).toBe(1)
    })

    test('a blank candidate is dropped silently; an empty shown reply shows the first non-blank candidate', () => {
        const blank = caiChar('Mira', '', { candidates: [{ candidate_id: 'a', raw_content: 'shown' }, { candidate_id: 'b', raw_content: '  ' }], primary: 'a' })
        const blankRead = readCaiTurnsChat([blank])
        expect(blankRead.messages).toStrictEqual([{ isUser: false, mes: 'shown', name: 'Mira' }])
        expect(blankRead.swipesNotKept).toBe(0)
        const emptyShown = caiChar('Mira', '', { candidates: [{ candidate_id: 'a', raw_content: '' }, { candidate_id: 'b', raw_content: 'other' }], primary: 'a' })
        const result = readCaiTurnsChat([emptyShown])
        expect(result.messages).toStrictEqual([{ isUser: false, mes: 'other', name: 'Mira' }])
        expect(result.swipesNotKept).toBe(0)
        expect(result.skipped).toBe(0)
        const several = caiChar('Mira', '', { candidates: [{ candidate_id: 'a', raw_content: ' ' }, { candidate_id: 'b', raw_content: 'x' }, { candidate_id: 'c', raw_content: 'y' }], primary: 'a' })
        expect(readCaiTurnsChat([several]).messages[0]).toMatchObject({ mes: 'x', swipes: { before: [], after: ['y'] } })
    })

    test('every kept candidate that carries a picture is counted, a blank one is not a kept candidate', () => {
        const turn = caiChar('Mira', '', {
            candidates: [
                { candidate_id: 'a', raw_content: 'x', tti_image_rel_path: 'img/1.png' },
                { candidate_id: 'b', raw_content: 'y', tti_image_rel_path: 'img/2.png' },
                { candidate_id: 'c', raw_content: '  ', tti_image_rel_path: 'img/3.png' },
            ],
            primary: 'a',
        })
        expect(readCaiTurnsChat([turn]).mediaNotKept).toBe(2)
    })

    test('a turn without a matching primary, without candidates or a non-object counts as skipped', () => {
        const noPrimary = caiChar('Mira', 'x', { primary: 'nope' })
        const noText = caiChar('Mira', '', { candidates: [{ candidate_id: 'a', raw_content: 4 }], primary: 'a' })
        const result = readCaiTurnsChat([noPrimary, noText, { author: {} }, 'x', caiChar('Mira', 'ok')])
        expect(result.messages.map((m) => m.mes)).toEqual(['ok'])
        expect(result.skipped).toBe(4)
    })

    // Kills a truthy test of `is_human`: the string 'false' is truthy but is not the boolean true.
    test('only the boolean true makes a user line; a string flag, a missing author or a missing flag is a character line', () => {
        const result = readCaiTurnsChat([
            caiTurn({ human: 'false', text: 'string' }),
            { candidates: [{ candidate_id: 'a', raw_content: 'noauthor' }], primary_candidate_id: 'a' },
            { author: {}, candidates: [{ candidate_id: 'a', raw_content: 'noflag' }], primary_candidate_id: 'a' },
            caiUser('real'),
        ])
        expect(result.messages.map((m) => [m.isUser, m.mes])).toEqual([[true, 'real'], [false, 'noflag'], [false, 'noauthor'], [false, 'string']])
    })

    test('a turn id already read is skipped and a turn without an id is never deduplicated', () => {
        const turns = [caiChar('Mira', 'newest', { id: 'k3' }), caiChar('Mira', 'dup-later-page', { id: 'k2' }), caiChar('Mira', 'dup', { id: 'k2' }), caiUser('noid'), caiUser('noid'), caiChar('Mira', 'first', { id: 'k1' })]
        const result = readCaiTurnsChat(turns)
        expect(result.messages.map((m) => m.mes)).toEqual(['first', 'noid', 'noid', 'dup', 'newest'])
    })

    test('the turn time is kept, a bad one leaves the message without a time', () => {
        const result = readCaiTurnsChat([caiChar('Mira', 'b', { time: 'garbage' }), caiUser('a', { time: '2026-07-25T12:58:03.123456+00:00' })])
        expect(result.messages[0].sendDate).toBe(Date.UTC(2026, 6, 25, 12, 58, 3, 123))
        expect(result.messages[1].sendDate).toBeUndefined()
    })

    // Kills a missing header: with it, the first speaker's name is dropped and a second bot keeps its name.
    test('user lines carry no name, the header holds the first character name, another bot keeps its name through tavernMessageName', () => {
        const result = readCaiTurnsChat([caiChar('Zed', 'z'), caiUser('u'), caiChar('Mira', 'greeting')])
        expect(result.header).toEqual({ characterName: 'Mira' })
        expect(result.messages.map((m) => m.name)).toEqual(['Mira', undefined, 'Zed'])
        const own = { userName: 'Dana', characterName: 'Rex' }
        expect(result.messages.map((m) => tavernMessageName(m, result.header, own))).toEqual([undefined, undefined, 'Zed'])
    })

    test('markdown stays and a picture path on the shown candidate is counted while the text is kept', () => {
        const picture = caiChar('Mira', '', { candidates: [{ candidate_id: 'a', raw_content: '*waves* hi', tti_image_rel_path: 'img/1.png' }], primary: 'a' })
        const plain = caiChar('Mira', '', { candidates: [{ candidate_id: 'a', raw_content: 'no pic', tti_image_rel_path: '' }], primary: 'a' })
        const result = readCaiTurnsChat([picture, plain])
        expect(result.messages.map((m) => m.mes)).toEqual(['no pic', '*waves* hi'])
        expect(result.mediaNotKept).toBe(1)
        expect(readCaiTurnsChat([plain]).mediaNotKept).toBeUndefined()
    })
})

describe('readCaiTurnsChat user lines (unit)', () => {
    // The writers store no human author name; if one is present it is not a display name and is never read.
    test('a human turn keeps no name even when its author carries one', () => {
        const human = { author: { is_human: true, name: 'Dana' }, candidates: [{ candidate_id: 'a', raw_content: 'hi' }], primary_candidate_id: 'a' }
        const result = readCaiTurnsChat([human])
        expect(result.messages).toEqual([{ isUser: true, mes: 'hi' }])
    })
})

describe('readMorseChats (unit)', () => {
    const hello = [caiChar('Mira', 'hello'), caiUser('hi')]

    test('turns keep the file order and are not deduplicated, and the entry name is the header', () => {
        const file = caiMorseFile([caiMorseEntry({ name: ' Mira ' }, [caiMorseChat([caiChar('Mira', 'a', { id: 'k' }), caiUser('b'), caiChar('Mira', 'a2', { id: 'k' })])])])
        const read = readMorseChats(file, 'Whoever')
        expect(read.chats).toHaveLength(1)
        expect(read.chats[0].messages.map((m) => m.mes)).toEqual(['a', 'b', 'a2'])
        expect(read.chats[0].header).toEqual({ characterName: 'Mira' })
    })

    test('a file holding one chat is imported whatever the open character is called', () => {
        const read = readMorseChats(caiMorseFile([caiMorseEntry({ name: 'Mira' }, [caiMorseChat(hello)])]), 'Dana')
        expect(read).toMatchObject({ total: 1, leftOut: 0, names: ['Mira'] })
        expect(read.chats).toHaveLength(1)
    })

    test('several chats are matched by the trimmed, case-sensitive character name, in file order', () => {
        const file = caiMorseFile([
            caiMorseEntry({ name: 'Mira' }, [caiMorseChat([caiChar('Mira', 'm1')]), caiMorseChat([caiChar('Mira', 'm2')])]),
            caiMorseEntry({ name: 'Dana' }, [caiMorseChat([caiChar('Dana', 'd1')])]),
        ])
        const read = readMorseChats(file, ' Mira ')
        expect(read.chats.map((c) => c.messages[0].mes)).toEqual(['m1', 'm2'])
        expect(read).toMatchObject({ total: 3, leftOut: 1, names: ['Mira', 'Dana'] })
        const wrongCase = readMorseChats(file, 'mira')
        expect(wrongCase.chats).toEqual([])
        expect(wrongCase).toMatchObject({ total: 3, leftOut: 3 })
    })

    test('the name falls back to participant__name; an entry with neither is unnamed and is left out of a multi-chat file', () => {
        const file = caiMorseFile([
            caiMorseEntry({ participant__name: ' Mira ' }, [caiMorseChat([caiChar('Mira', 'p')])]),
            caiMorseEntry({ name: '  ' }, [caiMorseChat([caiChar('Mira', 'blank')])]),
            caiMorseEntry({}, [caiMorseChat([caiChar('Mira', 'none')])]),
        ])
        const read = readMorseChats(file, 'Mira')
        expect(read.chats.map((c) => c.messages[0].mes)).toEqual(['p'])
        expect(read).toMatchObject({ total: 3, leftOut: 2, names: ['Mira'] })
        expect(readMorseChats(caiMorseFile([
            caiMorseEntry({}, [caiMorseChat([caiChar('A', 'a')])]),
            caiMorseEntry({}, [caiMorseChat([caiChar('B', 'b')])]),
        ]), 'Mira')).toMatchObject({ chats: [], total: 2, leftOut: 2, names: [] })
    })

    // Chats without a message are neither counted nor left out, so one readable chat plus empty ones is a one-chat file.
    test('chats with no importable message are not counted: one readable chat beside empty ones imports whatever the open name', () => {
        const file = caiMorseFile([
            caiMorseEntry({ name: 'Mira' }, [caiMorseChat(hello), caiMorseChat([])]),
            caiMorseEntry({ name: 'Dana' }, [caiMorseChat([caiUser('')]), caiMorseChat([caiChar('Dana', 'x', { primary: 'nope' })])]),
        ])
        const read = readMorseChats(file, 'Zed')
        expect(read).toMatchObject({ total: 1, leftOut: 0, names: ['Mira'] })
        expect(read.chats).toHaveLength(1)
        expect(readMorseChats(caiMorseFile([caiMorseEntry({ name: 'Mira' }, [caiMorseChat([])])]), 'Mira')).toMatchObject({ chats: [], total: 0 })
    })

    test('the memory box is counted for imported chats only, and only when it holds text', () => {
        const file = caiMorseFile([
            caiMorseEntry({ name: 'Mira' }, [
                caiMorseChat(hello, { memory: 'Dana likes tea' }),
                caiMorseChat(hello, { memory: '   ' }),
                caiMorseChat(hello, { memory: 7 }),
                caiMorseChat(hello),
            ]),
            caiMorseEntry({ name: 'Dana' }, [caiMorseChat(hello, { memory: 'not imported' })]),
        ])
        expect(readMorseChats(file, 'Mira').memoryNotKept).toBe(1)
        expect(readMorseChats(file, 'Dana').memoryNotKept).toBe(1)
        expect(readMorseChats(file, 'Zed').memoryNotKept).toBe(0)
    })

    test('entries that are not objects, and chats without a turns array, are not chats', () => {
        const file = caiMorseFile([4, null, { character: { name: 'Mira' }, chats: 'x' }, caiMorseEntry({ name: 'Mira' }, [null, { turns: 'x' }, caiMorseChat(hello)])])
        expect(readMorseChats(file, 'Mira')).toMatchObject({ total: 1, leftOut: 0 })
    })
})

describe('readDumperChats (unit)', () => {
    const history = [dumperMsg('Mira', false, 'greeting'), dumperMsg('Mira', true, 'hi')]

    // Kills a reader that insists on a name match for a one-chat file: the open name differs from info.character.name.
    test('DU1: a file with one chat is imported although the open character has another name', () => {
        const read = readDumperChats(dumperFile('Mira', [history]), 'Dana')
        expect(read).toMatchObject({ total: 1, leftOut: 0, names: ['Mira'] })
        expect(read.chats).toHaveLength(1)
        expect(read.chats[0].header).toEqual({ characterName: 'Mira' })
    })

    test('several histories are all or nothing on info.character.name, even when a bot src.name equals the open name', () => {
        const file = dumperFile('Mira', [history, [dumperMsg('Dana', false, 'x')]])
        const match = readDumperChats(file, ' Mira ')
        expect(match.chats).toHaveLength(2)
        expect(match).toMatchObject({ total: 2, leftOut: 0 })
        const refused = readDumperChats(file, 'Dana')
        expect(refused.chats).toEqual([])
        expect(refused).toMatchObject({ total: 2, leftOut: 2, names: ['Mira'] })
        expect(readDumperChats(dumperFile(undefined, [history, history]), 'Mira')).toMatchObject({ chats: [], total: 2, names: [] })
    })

    test('histories with no importable message are not counted', () => {
        const read = readDumperChats(dumperFile('Mira', [[], history, [dumperMsg('Mira', false, '')]]), 'Zed')
        expect(read).toMatchObject({ total: 1, leftOut: 0 })
        expect(read.chats).toHaveLength(1)
        expect(readDumperChats(dumperFile('Mira', [[]]), 'Mira')).toMatchObject({ chats: [], total: 0 })
    })

    test('the stored order is kept, human lines carry no name, bot names are trimmed and no time is read', () => {
        const read = readDumperChats(dumperFile('Mira', [[dumperMsg(' Mira ', false, 'one'), dumperMsg('', true, 'two'), dumperMsg('Zed', false, 'three')]]), 'Mira')
        const lines = read.chats[0].messages
        expect(lines.map((m) => [m.isUser, m.mes, m.name, m.sendDate])).toEqual([
            [false, 'one', 'Mira', undefined],
            [true, 'two', undefined, undefined],
            [false, 'three', 'Zed', undefined],
        ])
    })

    test('the redaction token becomes the user placeholder in every message', () => {
        const read = readDumperChats(dumperFile('Mira', [[
            dumperMsg('Mira', false, 'Hello [NAME_IN_MESSAGE_REDACTED], [NAME_IN_MESSAGE_REDACTED]!'),
            dumperMsg('Mira', true, 'I am [NAME_IN_MESSAGE_REDACTED]'),
        ]]), 'Mira')
        expect(read.chats[0].messages.map((m) => m.mes)).toEqual(['Hello {{user}}, {{user}}!', 'I am {{user}}'])
    })

    test('the alternates after a message of the same side are its swipes in stored order; an alternate after another side counts once per run', () => {
        const alt = (text: string) => dumperMsg('Mira', false, text, { is_alternative: true })
        const read = readDumperChats(dumperFile('Mira', [[
            dumperMsg('Mira', false, 'shown'), alt('a1'), alt('a2'), alt('a3'),
            dumperMsg('Mira', true, 'reply'), alt('a4'), alt('a5'), alt('  '),
        ]]), 'Mira')
        const lines = read.chats[0].messages
        expect(lines.map((m) => m.mes)).toEqual(['shown', 'reply'])
        expect(lines[0].swipes).toEqual({ before: [], after: ['a1', 'a2', 'a3'] })
        expect(lines[1].swipes).toBeUndefined()
        expect(read.chats[0].swipesNotKept).toBe(1)
    })

    test('human alternates are swipes of the human message before them; one after a character message counts once', () => {
        const alt = (human: boolean, text: string) => dumperMsg('Mira', human, text, { is_alternative: true })
        const own = readDumperChats(dumperFile('Mira', [[dumperMsg('Mira', true, 'q'), alt(true, 'q2'), alt(true, 'q3')]]), 'Mira')
        expect(own.chats[0].messages[0]).toMatchObject({ isUser: true, mes: 'q', swipes: { before: [], after: ['q2', 'q3'] } })
        expect(own.chats[0].swipesNotKept).toBe(0)
        const read = readDumperChats(dumperFile('Mira', [[dumperMsg('Mira', false, 'shown'), alt(true, 'h1'), alt(true, 'h2')]]), 'Mira')
        expect(read.chats[0].messages[0].swipes).toBeUndefined()
        expect(read.chats[0].swipesNotKept).toBe(1)
        const mixed = readDumperChats(dumperFile('Mira', [[dumperMsg('Mira', false, 'shown'), alt(false, 'a1'), alt(true, 'h1'), alt(false, 'a2')]]), 'Mira')
        expect(mixed.chats[0].messages[0].swipes).toEqual({ before: [], after: ['a1', 'a2'] })
        expect(mixed.chats[0].swipesNotKept).toBe(1)
    })

    // A shown message starts a new run, so a later unkept run counts again and the notice does not undercount.
    test('two unkept runs separated by a shown message count twice', () => {
        const alt = (human: boolean, text: string) => dumperMsg('Mira', human, text, { is_alternative: true })
        const read = readDumperChats(dumperFile('Mira', [[
            dumperMsg('Mira', false, 'shown'), alt(true, 'h1'), dumperMsg('Mira', true, 'q'), alt(false, 'c1'),
        ]]), 'Mira')
        expect(read.chats[0].messages.map((m) => m.mes)).toEqual(['shown', 'q'])
        expect(read.chats[0].messages.every((m) => m.swipes === undefined)).toBe(true)
        expect(read.chats[0].swipesNotKept).toBe(2)
    })

    test('an alternate attaches by side only: a different source name still joins and the message keeps its own name', () => {
        const read = readDumperChats(dumperFile('Mira', [[
            dumperMsg('Mira', false, 'shown'), dumperMsg('Other', false, 'a1', { is_alternative: true }),
        ]]), 'Mira')
        expect(read.chats[0].messages).toStrictEqual([{ isUser: false, mes: 'shown', name: 'Mira', swipes: { before: [], after: ['a1'] } }])
        expect(read.chats[0].swipesNotKept).toBe(0)
    })

    test('the redaction token is replaced in an alternate', () => {
        const read = readDumperChats(dumperFile('Mira', [[
            dumperMsg('Mira', false, 'shown'), dumperMsg('Mira', false, 'Hi [NAME_IN_MESSAGE_REDACTED]', { is_alternative: true }),
        ]]), 'Mira')
        expect(read.chats[0].messages[0].swipes).toEqual({ before: [], after: ['Hi {{user}}'] })
    })

    test('a blank message with same-side alternates takes the first alternate as its message', () => {
        const alt = (text: string) => dumperMsg('Mira', false, text, { is_alternative: true })
        const read = readDumperChats(dumperFile('Mira', [[dumperMsg('Mira', false, '  '), alt('x'), alt('y')]]), 'Mira')
        expect(read.chats).toHaveLength(1)
        expect(read.chats[0].messages).toStrictEqual([{ isUser: false, mes: 'x', name: 'Mira', swipes: { before: [], after: ['y'] } }])
        expect(read.chats[0].swipesNotKept).toBe(0)
    })

    test('an alternate with no message before it is not kept and counts once per run', () => {
        const alt = (human: boolean, text: string) => dumperMsg('Mira', human, text, { is_alternative: true })
        const read = readDumperChats(dumperFile('Mira', [[alt(true, 'h0'), alt(true, 'h1'), dumperMsg('Mira', false, 'shown')]]), 'Mira')
        expect(read.chats[0].messages).toStrictEqual([{ isUser: false, mes: 'shown', name: 'Mira' }])
        expect(read.chats[0].swipesNotKept).toBe(1)
    })

    // Kills a truthy test of `src.is_human`: the string 'false' is truthy but is not the boolean true.
    test('only the boolean true makes a user line in a dumper history', () => {
        const odd = { text: 'string flag', src: { is_human: 'false', name: 'Mira' } }
        const read = readDumperChats(dumperFile('Mira', [[odd, dumperMsg('Mira', true, 'real')]]), 'Mira')
        expect(read.chats[0].messages.map((m) => [m.isUser, m.mes])).toEqual([[false, 'string flag'], [true, 'real']])
    })

    test('a message that is not an object ends the run: the next alternate has no message before it and counts', () => {
        const alt = (text: string) => dumperMsg('Mira', false, text, { is_alternative: true })
        const read = readDumperChats(dumperFile('Mira', [[dumperMsg('Mira', false, 'shown'), alt('a1'), 'x', alt('a2')]]), 'Mira')
        expect(read.chats[0].messages[0].swipes).toEqual({ before: [], after: ['a1'] })
        expect(read.chats[0].swipesNotKept).toBe(1)
        expect(read.chats[0].skipped).toBe(1)
    })

    test('a message without a string text, and entries that are not objects, count as skipped', () => {
        const read = readDumperChats(dumperFile('Mira', [[dumperMsg('Mira', false, 'ok'), { src: { is_human: false } }, 'x', null]]), 'Mira')
        expect(read.chats[0].messages.map((m) => m.mes)).toEqual(['ok'])
        expect(read.chats[0].skipped).toBe(3)
    })
})

describe('swipes of each reader through buildTavernTree (unit)', () => {
    const own = { userName: 'User', characterName: 'Solo' }
    const NLI = '\n{{[INPUT]}}\n'
    const NLO = '\n{{[OUTPUT]}}\n'
    const instruct = { opmode: 4, instruct_has_markdown: true }
    const ids = () => {
        let n = 0
        return () => `id${String(1000 + ++n)}`
    }
    const candidates = [{ candidate_id: 'a', raw_content: 'one' }, { candidate_id: 'b', raw_content: 'two' }]

    // One file per format that holds an alternative, and the same file without it.
    const formats: Array<[string, () => ReturnType<typeof readOobaChat>, () => ReturnType<typeof readOobaChat>]> = [
        ['Ooba', () => readOobaChat({
            internal: [['hi', 'yo'], ['more', 'end']],
            visible: [['hi', 'yo'], ['more', 'end']],
            metadata: { assistant_0: { versions: [{ content: 'old' }, { content: 'yo' }], current_version_index: 1 } },
        }), () => readOobaChat({ internal: [['hi', 'yo'], ['more', 'end']], visible: [['hi', 'yo'], ['more', 'end']] })],
        ['Agnai', () => readAgnaiChat({ messages: [
            { _id: 'a1', msg: 'hello', userId: 'u' },
            { _id: 'b2', parent: 'a1', msg: 'one', characterId: 'imported' },
            { _id: 'c3', parent: 'a1', msg: 'two', characterId: 'imported' },
        ] }), () => readAgnaiChat({ messages: [
            { _id: 'a1', msg: 'hello', userId: 'u' },
            { _id: 'b2', parent: 'a1', msg: 'one', characterId: 'imported' },
        ] })],
        ['Kobold', () => readKoboldChat({ prompt: '', actions: [NLI + 'q', NLO + 'a'], savedsettings: instruct, altbranches: [['', NLI + 'q', NLO + 'x']] }),
            () => readKoboldChat({ prompt: '', actions: [NLI + 'q', NLO + 'a'], savedsettings: instruct })],
        ['Lianne', () => readCaiTurnsChat([caiUser('next'), caiChar('Mira', '', { candidates, primary: 'a' })]),
            () => readCaiTurnsChat([caiUser('next'), caiChar('Mira', 'one')])],
        ['Morse', () => readMorseChats(caiMorseFile([caiMorseEntry({ name: 'Mira' }, [caiMorseChat([caiChar('Mira', '', { candidates, primary: 'a' }), caiUser('next')])])]), 'Mira').chats[0],
            () => readMorseChats(caiMorseFile([caiMorseEntry({ name: 'Mira' }, [caiMorseChat([caiChar('Mira', 'one'), caiUser('next')])])]), 'Mira').chats[0]],
        ['Dumper', () => readDumperChats(dumperFile('Mira', [[
            dumperMsg('Mira', false, 'shown'), dumperMsg('Mira', false, 'a1', { is_alternative: true }), dumperMsg('Mira', true, 'next'),
        ]]), 'Mira').chats[0], () => readDumperChats(dumperFile('Mira', [[dumperMsg('Mira', false, 'shown'), dumperMsg('Mira', true, 'next')]]), 'Mira').chats[0]],
    ]

    // Regression reproducers: on the base no reader fills `swipes`, so no sibling exists to switch to.
    test.each(formats)('%s: the kept alternative is a sibling the tree switches to and back from', (_label, withSwipe) => {
        const result = withSwipe()
        const position = result.messages.findIndex((m) => m.swipes !== undefined)
        expect(position).toBeGreaterThanOrEqual(0)
        const built = buildTavernTree(result, own, (text) => text, ids())
        const chat = { id: 'chat', name: 'c', note: '', localLore: [], message: built.message, alt: built.alt } as unknown as Chat
        expect(isChatAltReadable(chat)).toBe(true)
        expect(treeLeaves(chat)?.unreachable).toEqual([])
        const before = chat.message.map((m) => m.data)
        const shownId = chat.message[position].chatId as string
        const siblings = siblingsAt(chat, position)
        expect(siblings.length).toBeGreaterThan(1)
        const other = siblings.find((m) => m.chatId !== shownId)?.chatId as string
        expect(switchTo(chat, position, other)).toBe(true)
        expect(chat.message[position].chatId).toBe(other)
        expect(switchTo(chat, position, shownId)).toBe(true)
        expect(chat.message.map((m) => m.data)).toEqual(before)
    })

    // Compatibility guard (passes before and after): a file without an alternative gives a plain path.
    test.each(formats)('%s: a file without an alternative gives no record and no chatId', (_label, _withSwipe, plain) => {
        const built = buildTavernTree(plain(), own, (text) => text, ids())
        expect(built.alt).toEqual([])
        for(const message of built.message){
            expect(message).not.toHaveProperty('chatId')
        }
    })

    // Diagnostic of an unchanged export rule: a human CAI candidate swipe is one branch chat at .bin export.
    test('a human CAI candidate swipe becomes one branch chat at export', () => {
        const result = readCaiTurnsChat([caiUser('', { candidates, primary: 'a' }), caiChar('Mira', 'hi')])
        const built = buildTavernTree(result, own, (text) => text, ids())
        const chat = { id: 'chat', name: 'c', note: '', localLore: [], message: built.message, alt: built.alt } as unknown as Chat
        expect(branchSummaryOf(chat)?.chats).toBe(1)
    })
})

describe('Character.AI readers on large input (unit)', () => {
    test('a 200,000-turn Lianne file reads in full (an exercise of the single pass, not performance evidence)', () => {
        const turns: unknown[] = []
        for(let index = 0; index < 200000; index++){
            turns.push(index % 2 === 0 ? caiChar('Mira', `c${index}`, { id: `k${index}` }) : caiUser(`u${index}`, { id: `k${index}` }))
        }
        const result = readCaiTurnsChat(turns)
        expect(result.messages).toHaveLength(200000)
        expect(result.messages[0].mes).toBe('u199999')
    })
})
