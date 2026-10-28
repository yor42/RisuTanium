/**
 * Unit tests of `readTavernJsonl` (`src/ts/chatImport.ts`). They exercise the
 * new pure module directly and are not regression reproducers; the reproducers
 * run through `importChat` in `characters.importChat.test.ts`.
 */
import { describe, test, expect } from 'vitest'
import { readTavernJsonl } from './chatImport'

const header = JSON.stringify({ user_name: 'U', character_name: 'C', create_date: '2024-01-01', chat_metadata: {} })
const msg = (mes: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ name: 'C', is_user: false, mes, ...extra })

describe('readTavernJsonl (unit)', () => {
    test('a header line is dropped and not counted', () => {
        const r = readTavernJsonl(`${header}\n${msg('a')}\n${msg('b', { is_user: true })}`)
        expect(r.messages).toEqual([{ isUser: false, mes: 'a' }, { isUser: true, mes: 'b' }])
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
        const r = readTavernJsonl([header, msg({ message: 'x' }), msg(5), msg('ok')].join('\n'))
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
