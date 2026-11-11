import { beforeEach, describe, expect, test } from 'vitest'
import { activeStreamChars, activeStreamOwners, activeStreams, addActiveStream, isActiveStreamReply, noteStreamText, resetActiveStreamsForTest } from 'src/ts/process/activeStreams'

beforeEach(() => {
    resetActiveStreamsForTest()
})

describe('the active-stream registry', () => {
    test('holds a stream until it is removed, and removing twice is harmless', () => {
        const remove = addActiveStream({ chaId: 'a', replyChatId: 'r1' })
        expect(activeStreams()).toEqual([{ chaId: 'a', replyChatId: 'r1' }])
        expect(isActiveStreamReply('r1')).toBe(true)

        remove()
        remove()

        expect(activeStreams()).toEqual([])
        expect(isActiveStreamReply('r1')).toBe(false)
    })

    test('keeps sequential and overlapping streams of one character apart', () => {
        const removeFirst = addActiveStream({ chaId: 'a', replyChatId: 'r1' })
        const removeSecond = addActiveStream({ chaId: 'a', replyChatId: 'r2' })

        removeFirst()

        expect(activeStreams().map((entry) => entry.replyChatId)).toEqual(['r2'])
        removeSecond()
        expect(activeStreams()).toEqual([])
    })

    test('an undefined chat id is never an active reply', () => {
        addActiveStream({ chaId: 'a', replyChatId: 'r1' })

        expect(isActiveStreamReply(undefined)).toBe(false)
    })

    test('carries the group member when there is one', () => {
        addActiveStream({ chaId: 'group', memberChaId: 'member', replyChatId: 'r1' })

        expect(activeStreams()).toEqual([{ chaId: 'group', memberChaId: 'member', replyChatId: 'r1' }])
    })

    test('the owner set holds owner chaIds only, is live, and keeps an owner while another of its streams remains', () => {
        const removeFirst = addActiveStream({ chaId: 'group-a', memberChaId: 'member-m', replyChatId: 'r1' })
        const removeSecond = addActiveStream({ chaId: 'group-a', replyChatId: 'r2' })
        const removeOther = addActiveStream({ chaId: 'char-b', replyChatId: 'r3' })

        expect([...activeStreamOwners()].sort()).toEqual(['char-b', 'group-a'])
        expect(activeStreamOwners().has('member-m')).toBe(false)
        removeFirst()
        expect(activeStreamOwners().has('group-a')).toBe(true)
        removeSecond()
        removeOther()
        expect(activeStreamOwners().size).toBe(0)
    })
})

describe('the reply text length of an active stream', () => {
    // NC: new API with no pre-fix base.
    test('is unknown until a text is noted, then the length of the latest text', () => {
        addActiveStream({ chaId: 'a', replyChatId: 'r1' })
        expect(activeStreamChars('a')).toBeNull()

        noteStreamText('r1', 'hello')
        expect(activeStreamChars('a')).toBe(5)
        noteStreamText('r1', 'hello world')
        expect(activeStreamChars('a')).toBe(11)
    })

    test('belongs to the stream of that reply, and an unknown reply changes nothing', () => {
        addActiveStream({ chaId: 'a', replyChatId: 'r1' })
        addActiveStream({ chaId: 'b', replyChatId: 'r2' })

        noteStreamText('r2', 'abc')
        noteStreamText('missing', 'abcdefgh')

        expect(activeStreamChars('a')).toBeNull()
        expect(activeStreamChars('b')).toBe(3)
        expect(activeStreamChars('missing')).toBeNull()
    })

    test('of an owner with two streams is the latest one that has a count', () => {
        addActiveStream({ chaId: 'a', replyChatId: 'r1' })
        addActiveStream({ chaId: 'a', replyChatId: 'r2' })
        noteStreamText('r1', 'ab')
        noteStreamText('r2', 'abcd')

        expect(activeStreamChars('a')).toBe(4)
    })

    test('is gone with its stream, and a later stream of the same reply id starts unknown', () => {
        const remove = addActiveStream({ chaId: 'a', replyChatId: 'r1' })
        noteStreamText('r1', 'abc')

        remove()
        expect(activeStreamChars('a')).toBeNull()

        addActiveStream({ chaId: 'a', replyChatId: 'r1' })
        expect(activeStreamChars('a')).toBeNull()
    })

    test('does not change what the registry lists', () => {
        addActiveStream({ chaId: 'a', replyChatId: 'r1' })
        noteStreamText('r1', 'abc')

        expect(activeStreams()).toEqual([{ chaId: 'a', replyChatId: 'r1' }])
    })
})
