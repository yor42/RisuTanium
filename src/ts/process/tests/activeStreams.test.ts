import { beforeEach, describe, expect, test, vi } from 'vitest'
import { activeStreamChars, activeStreamOwners, activeStreams, addActiveStream, addReplySpeaker, isActiveStreamReply, noteStreamReceived, noteStreamText, replySpeakerOf, resetActiveStreamsForTest, subscribeStreamChanges, type StreamChange } from 'src/ts/process/activeStreams'

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

describe('the received length of an active stream (T1.12, rule tests: new exports, no pre-fix base)', () => {
    test('is read only when asked for, and falls back to the written length when none was received', () => {
        addActiveStream({ chaId: 'a', replyChatId: 'r1' })
        noteStreamText('r1', 'abc')
        expect(activeStreamChars('a', true)).toBe(3)

        noteStreamReceived('r1', 9)

        expect(activeStreamChars('a')).toBe(3)
        expect(activeStreamChars('a', false)).toBe(3)
        expect(activeStreamChars('a', true)).toBe(9)
    })

    test('a received length alone is not a written count', () => {
        addActiveStream({ chaId: 'a', replyChatId: 'r1' })

        noteStreamReceived('r1', 9)

        expect(activeStreamChars('a')).toBeNull()
        expect(activeStreamChars('a', true)).toBe(9)
    })

    test('of an owner with two streams is the latest one, and an unknown reply changes nothing', () => {
        addActiveStream({ chaId: 'a', replyChatId: 'r1' })
        addActiveStream({ chaId: 'a', replyChatId: 'r2' })

        noteStreamReceived('r1', 4)
        noteStreamReceived('r2', 8)
        noteStreamReceived('missing', 99)

        expect(activeStreamChars('a', true)).toBe(8)
    })

    test('is gone with its stream, and a later stream of the same reply id starts unknown', () => {
        const remove = addActiveStream({ chaId: 'a', replyChatId: 'r1' })
        noteStreamReceived('r1', 5)

        remove()
        expect(activeStreamChars('a', true)).toBeNull()

        addActiveStream({ chaId: 'a', replyChatId: 'r1' })
        expect(activeStreamChars('a', true)).toBeNull()
    })
})

describe('the stream change notes (T1.12, rule tests: new exports, no pre-fix base)', () => {
    test('both notes notify a count change, and only when a stream of that reply matched', () => {
        const heard: StreamChange[] = []
        subscribeStreamChanges((change) => { heard.push(change) })
        addActiveStream({ chaId: 'a', replyChatId: 'r1' })
        expect(heard).toEqual([])

        noteStreamText('r1', 'abc')
        noteStreamReceived('r1', 5)
        expect(heard).toEqual(['count', 'count'])

        noteStreamText('missing', 'abc')
        noteStreamReceived('missing', 5)
        expect(heard).toEqual(['count', 'count'])
    })

    test('a note after the stream was removed notifies nothing', () => {
        const heard: StreamChange[] = []
        subscribeStreamChanges((change) => { heard.push(change) })
        const remove = addActiveStream({ chaId: 'a', replyChatId: 'r1' })
        remove()

        noteStreamText('r1', 'abc')
        noteStreamReceived('r1', 5)

        expect(heard).toEqual([])
    })

    test('a listener stops hearing once it unsubscribed, and others keep hearing', () => {
        const first = vi.fn()
        const second = vi.fn()
        const unsubscribeFirst = subscribeStreamChanges(first)
        subscribeStreamChanges(second)
        addActiveStream({ chaId: 'a', replyChatId: 'r1' })

        noteStreamText('r1', 'a')
        unsubscribeFirst()
        unsubscribeFirst()
        noteStreamText('r1', 'ab')

        expect(first).toHaveBeenCalledTimes(1)
        expect(second).toHaveBeenCalledTimes(2)
    })

    test('a throwing listener is logged, the note still lands and later listeners still hear it', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const later = vi.fn()
        subscribeStreamChanges(() => { throw new Error('listener failed') })
        subscribeStreamChanges(later)
        addActiveStream({ chaId: 'a', replyChatId: 'r1' })

        expect(() => noteStreamText('r1', 'abcd')).not.toThrow()
        expect(() => noteStreamReceived('r1', 9)).not.toThrow()

        expect(error).toHaveBeenCalledTimes(2)
        expect(later).toHaveBeenCalledTimes(2)
        expect(activeStreamChars('a')).toBe(4)
        expect(activeStreamChars('a', true)).toBe(9)
        error.mockRestore()
    })
})

describe('the reply speaker of a group turn (T2.6, rule tests: new exports, no pre-fix base; MC-1502)', () => {
    test('is the member of the latest live turn, and none before any turn', () => {
        expect(replySpeakerOf('g', 'c1')).toBeUndefined()

        addReplySpeaker({ chaId: 'g', chatId: 'c1', memberChaId: 'm1' })
        expect(replySpeakerOf('g', 'c1')).toBe('m1')

        addReplySpeaker({ chaId: 'g', chatId: 'c1', memberChaId: 'm2' })
        expect(replySpeakerOf('g', 'c1')).toBe('m2')
    })

    test('reverts to the earlier turn when the latest one is removed, and removing twice is harmless', () => {
        const removeFirst = addReplySpeaker({ chaId: 'g', chatId: 'c1', memberChaId: 'm1' })
        const removeSecond = addReplySpeaker({ chaId: 'g', chatId: 'c1', memberChaId: 'm2' })

        removeSecond()
        removeSecond()
        expect(replySpeakerOf('g', 'c1')).toBe('m1')

        removeFirst()
        expect(replySpeakerOf('g', 'c1')).toBeUndefined()
    })

    test('names a member only for the chat and the owner it was registered for', () => {
        addReplySpeaker({ chaId: 'g', chatId: 'c1', memberChaId: 'm1' })

        expect(replySpeakerOf('g', 'c2')).toBeUndefined()
        expect(replySpeakerOf('other', 'c1')).toBeUndefined()
    })

    test('notifies a speaker change on add only, never on removal', () => {
        const heard: StreamChange[] = []
        subscribeStreamChanges((change) => { heard.push(change) })

        const remove = addReplySpeaker({ chaId: 'g', chatId: 'c1', memberChaId: 'm1' })
        expect(heard).toEqual(['speaker'])

        remove()
        expect(heard).toEqual(['speaker'])
    })

    test('is not a stream: the stream lists and owners do not show it', () => {
        addReplySpeaker({ chaId: 'g', chatId: 'c1', memberChaId: 'm1' })

        expect(activeStreams()).toEqual([])
        expect(activeStreamOwners().size).toBe(0)
    })

    test('the test reset clears it', () => {
        addReplySpeaker({ chaId: 'g', chatId: 'c1', memberChaId: 'm1' })

        resetActiveStreamsForTest()

        expect(replySpeakerOf('g', 'c1')).toBeUndefined()
    })
})
