/**
 * Unit tests of `src/ts/chatImport.ts`, exercising the pure module directly.
 * Most are specification tests of its exports. The `chatNameFromFile` rows for
 * `.json` names are regression reproducers: a reader that keeps the extension
 * fails them by assertion. Behaviour through `importChat` is tested in
 * `characters.importChat.test.ts`.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    chatNameFromFile,
    detectJsonChatFormat,
    hasOtherReplies,
    parseOobaTimestamp,
    parseTavernSendDate,
    readOobaChat,
    readTavernJsonl,
    tavernMessageName,
    unescapeHtmlEntities,
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
    const count = (...lines: string[]) => readTavernJsonl(lines.join('\n')).swipesNotKept

    test('an accepted line with more than one swipe counts once, with one swipe it does not', () => {
        expect(count(msg('a', { swipes: ['a', 'b', 'c'] }), msg('b', { swipes: ['b', 'x'] }))).toBe(2)
        expect(count(msg('a', { swipes: ['a'] }), msg('b', { swipes: [] }), msg('c'), msg('d', { swipes: 'x' }))).toBe(0)
    })

    test('an empty-shown line counts only when another swipe is non-empty', () => {
        expect(count(msg('', { swipes: ['', 'x'] }), msg('ok'))).toBe(1)
        expect(count(msg({ message: '' }, { swipes: [{ message: 'a' }, { message: 'b' }] }), msg('ok'))).toBe(1)
        expect(count(msg('', { swipes: ['', ''] }), msg('', { swipes: ['x'] }), msg('ok'))).toBe(0)
    })

    test('a skipped line adds nothing to the swipe count', () => {
        const r = readTavernJsonl([msg(5, { swipes: ['a', 'b'] }), '{broken', msg('ok')].join('\n'))
        expect(r.swipesNotKept).toBe(0)
        expect(r.skipped).toBe(2)
    })

    test('hasOtherReplies needs more than one entry and one non-empty reply', () => {
        expect(hasOtherReplies(['', 'x'])).toBe(true)
        expect(hasOtherReplies([{ message: '' }, { message: 'x' }])).toBe(true)
        expect(hasOtherReplies(['', ''])).toBe(false)
        expect(hasOtherReplies(['x'])).toBe(false)
        expect(hasOtherReplies([])).toBe(false)
        expect(hasOtherReplies('xx')).toBe(false)
        expect(hasOtherReplies(undefined)).toBe(false)
        expect(hasOtherReplies([5, null])).toBe(false)
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

    describe('swipesNotKept', () => {
        const versionsOf = (...contents: string[]) => ({ versions: contents.map((content) => ({ content })) })
        const count = (character: unknown, entry: unknown, userEntry?: unknown) =>
            readOobaChat(ooba([['hi', character]], [['hi', 'x']], { assistant_0: entry, user_0: userEntry })).swipesNotKept

        test('a shown reply with more than one version is counted once per row', () => {
            expect(count('yo', versionsOf('yo', 'alt'))).toBe(1)
            const r = readOobaChat(ooba(
                [['a', 'b'], ['c', 'd']],
                [['a', 'b'], ['c', 'd']],
                { assistant_0: versionsOf('b', 'b2'), assistant_1: versionsOf('d', 'd2', 'd3') },
            ))
            expect(r.swipesNotKept).toBe(2)
        })

        test('a shown reply with one version, no versions or malformed versions is not counted', () => {
            expect(count('yo', versionsOf('yo'))).toBe(0)
            expect(count('yo', { versions: 'x' })).toBe(0)
            expect(count('yo', { versions: {} })).toBe(0)
            expect(count('yo', {})).toBe(0)
            expect(count('yo', undefined)).toBe(0)
        })

        test('an empty shown reply is counted only when another version holds text', () => {
            expect(count('', versionsOf('', 'old'))).toBe(1)
            expect(count('', versionsOf('', ''))).toBe(0)
            expect(count('', versionsOf('old'))).toBe(0)
            expect(count('', { versions: 'old' })).toBe(0)
            expect(count('', undefined)).toBe(0)
        })

        test('versions on the user entry are never counted', () => {
            expect(count('yo', undefined, versionsOf('a', 'b', 'c'))).toBe(0)
        })

        test('a non-string character cell is not counted for its versions', () => {
            expect(count(5, versionsOf('a', 'b'))).toBe(0)
        })
    })
})
