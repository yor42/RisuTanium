// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { addActiveStream, noteStreamText, resetActiveStreamsForTest } from '../process/activeStreams'
import { streamTextHold, type StreamTextHoldParams } from './streamTextHold'

const origin = { chaId: 'cha-1', chatId: 'chat-1' }

function ring(params: StreamTextHoldParams) {
    const node = document.createElement('div')
    document.body.appendChild(node)
    const action = streamTextHold(node, params)
    return { node, action }
}

beforeEach(() => {
    resetActiveStreamsForTest()
})

afterEach(() => {
    document.body.replaceChildren()
})

describe('the hold sheet', () => {
    test('importing the module adopts the rule that pauses a latched ring', () => {
        const sheet = document.head.querySelector('style[data-risu-sheet="stream-text-hold"]')
        expect(sheet).not.toBeNull()
        const css = sheet!.textContent ?? ''
        expect(css).toContain('.loadmove[data-still]')
        expect(css).toMatch(/animation-play-state:\s*paused\s*!important/)
    })
})

describe('the ring latch', () => {
    test('a stream that has written nothing does not latch, a zero-length write does not, the first text does', () => {
        const { node } = ring({ origin })
        addActiveStream({ ...origin, replyChatId: 'r1' })
        expect(node.hasAttribute('data-still')).toBe(false)
        noteStreamText('r1', '')
        expect(node.hasAttribute('data-still')).toBe(false)
        noteStreamText('r1', 'Hi')
        expect(node.hasAttribute('data-still')).toBe(true)
    })

    test('a ring mounted after the first text latches at once', () => {
        addActiveStream({ ...origin, replyChatId: 'r1' })
        noteStreamText('r1', 'Hi')
        const { node } = ring({ origin })
        expect(node.hasAttribute('data-still')).toBe(true)
    })

    test('the latch stays when the stream is removed, and a ring made afterwards is not latched', () => {
        const { node } = ring({ origin })
        const remove = addActiveStream({ ...origin, replyChatId: 'r1' })
        noteStreamText('r1', 'Hi')
        expect(node.hasAttribute('data-still')).toBe(true)
        remove()
        expect(node.hasAttribute('data-still')).toBe(true)
        expect(ring({ origin }).node.hasAttribute('data-still')).toBe(false)
    })

    test('a stream of another chat or owner does not latch', () => {
        const { node } = ring({ origin })
        addActiveStream({ chaId: origin.chaId, chatId: 'chat-2', replyChatId: 'r1' })
        addActiveStream({ chaId: 'cha-2', chatId: origin.chatId, replyChatId: 'r2' })
        noteStreamText('r1', 'Hi')
        noteStreamText('r2', 'Hi')
        expect(node.hasAttribute('data-still')).toBe(false)
    })

    test('a ring for another origin starts over and checks that origin', () => {
        const { node, action } = ring({ origin })
        addActiveStream({ ...origin, replyChatId: 'r1' })
        noteStreamText('r1', 'Hi')
        expect(node.hasAttribute('data-still')).toBe(true)

        action.update({ origin: { chaId: 'cha-1', chatId: 'chat-2' } })
        expect(node.hasAttribute('data-still')).toBe(false)

        addActiveStream({ chaId: 'cha-1', chatId: 'chat-2', replyChatId: 'r2' })
        noteStreamText('r2', 'Hi')
        expect(node.hasAttribute('data-still')).toBe(true)

        action.update({ origin: { chaId: 'cha-1', chatId: 'chat-2' } })
        expect(node.hasAttribute('data-still')).toBe(true)
    })

    test('a null or undefined origin never latches and never throws', () => {
        addActiveStream({ ...origin, replyChatId: 'r1' })
        noteStreamText('r1', 'Hi')
        for (const missing of [null, undefined]) {
            const { node, action } = ring({ origin: missing })
            expect(node.hasAttribute('data-still')).toBe(false)
            expect(() => noteStreamText('r1', 'Hi again')).not.toThrow()
            expect(() => action.update({ origin: missing })).not.toThrow()
            expect(node.hasAttribute('data-still')).toBe(false)
        }
    })

    test('a destroyed ring hears no more stream changes', () => {
        const { node, action } = ring({ origin })
        action.destroy()
        addActiveStream({ ...origin, replyChatId: 'r1' })
        noteStreamText('r1', 'Hi')
        expect(node.hasAttribute('data-still')).toBe(false)
    })
})
