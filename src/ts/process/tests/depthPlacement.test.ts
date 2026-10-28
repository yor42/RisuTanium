import { describe, test, expect } from 'vitest'
import { placeReverseDepth } from '../depthPlacement'

const list = (count: number) => Array.from({ length: count }, (_, i) => `m${i + 1}`)
const at = (depth: number, chat: string) => ({ depth, chat })

describe('placeReverseDepth', () => {
    test('an empty list holds the entries in order, with either tail', () => {
        const entries = [at(1, 'a'), at(5, 'b')]
        expect(placeReverseDepth([], entries, { tail: 0 }).chats).toEqual(['a', 'b'])
        expect(placeReverseDepth([], entries, { tail: 1 }).chats).toEqual(['a', 'b'])
    })

    test('tail 0: exactly N entries follow, and depth 0 is the end', () => {
        const chats = list(4)
        expect(placeReverseDepth(chats, [at(0, 'a')], { tail: 0 }).chats).toEqual(['m1', 'm2', 'm3', 'm4', 'a'])
        expect(placeReverseDepth(chats, [at(1, 'a')], { tail: 0 }).chats).toEqual(['m1', 'm2', 'm3', 'a', 'm4'])
        expect(placeReverseDepth(chats, [at(3, 'a')], { tail: 0 }).chats).toEqual(['m1', 'a', 'm2', 'm3', 'm4'])
        expect(placeReverseDepth(chats, [at(4, 'a')], { tail: 0 }).chats).toEqual(['a', 'm1', 'm2', 'm3', 'm4'])
    })

    test('tail 1: the split last message counts as an entry after the prompt', () => {
        const chats = list(4)
        expect(placeReverseDepth(chats, [at(1, 'a')], { tail: 1 }).chats).toEqual(['m1', 'm2', 'm3', 'm4', 'a'])
        expect(placeReverseDepth(chats, [at(2, 'a')], { tail: 1 }).chats).toEqual(['m1', 'm2', 'm3', 'a', 'm4'])
        expect(placeReverseDepth(chats, [at(4, 'a')], { tail: 1 }).chats).toEqual(['m1', 'a', 'm2', 'm3', 'm4'])
        expect(placeReverseDepth(chats, [at(5, 'a')], { tail: 1 }).chats).toEqual(['a', 'm1', 'm2', 'm3', 'm4'])
    })

    test('tail 1: depth 0 goes to lastChatAppend, in order, and not into the list', () => {
        const result = placeReverseDepth(list(3), [at(0, 'a'), at(1, 'b'), at(0, 'c')], { tail: 1 })
        expect(result.lastChatAppend).toEqual(['a', 'c'])
        expect(result.chats).toEqual(['m1', 'm2', 'm3', 'b'])
    })

    test('tail 0: lastChatAppend stays empty', () => {
        expect(placeReverseDepth(list(3), [at(0, 'a')], { tail: 0 }).lastChatAppend).toEqual([])
    })

    test('each entry keeps its N when entries of different depths are mixed', () => {
        const entries = [at(1, 'a'), at(2, 'b'), at(1, 'c')]
        expect(placeReverseDepth(list(5), entries, { tail: 0 }).chats)
            .toEqual(['m1', 'm2', 'm3', 'b', 'm4', 'a', 'c', 'm5'])
        expect(placeReverseDepth(list(4), entries, { tail: 1 }).chats)
            .toEqual(['m1', 'm2', 'm3', 'b', 'm4', 'a', 'c'])
    })

    test('a negative depth lands at the end of the list', () => {
        expect(placeReverseDepth(list(3), [at(-2, 'a')], { tail: 0 }).chats).toEqual(['m1', 'm2', 'm3', 'a'])
        expect(placeReverseDepth(list(3), [at(-2, 'a')], { tail: 1 }).chats).toEqual(['m1', 'm2', 'm3', 'a'])
    })

    test('a depth far beyond the list is the top', () => {
        expect(placeReverseDepth(list(3), [at(1000, 'a')], { tail: 0 }).chats).toEqual(['a', 'm1', 'm2', 'm3'])
        expect(placeReverseDepth(list(3), [at(1000, 'a')], { tail: 1 }).chats).toEqual(['a', 'm1', 'm2', 'm3'])
    })

    test('a depth that is not a number is the top', () => {
        expect(placeReverseDepth(list(2), [at(NaN, 'a')], { tail: 0 }).chats).toEqual(['a', 'm1', 'm2'])
    })

    test('the input arrays are not modified', () => {
        const chats = list(3)
        const entries = [at(1, 'a'), at(0, 'b')]
        placeReverseDepth(chats, entries, { tail: 1 })
        expect(chats).toEqual(['m1', 'm2', 'm3'])
        expect(entries).toEqual([at(1, 'a'), at(0, 'b')])
    })
})
