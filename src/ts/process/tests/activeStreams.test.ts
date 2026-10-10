import { beforeEach, describe, expect, test } from 'vitest'
import { activeStreams, addActiveStream, isActiveStreamReply, resetActiveStreamsForTest } from 'src/ts/process/activeStreams'

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
})
