/**
 * S2-U1: the summary a `.bin` export hands to the leave-out sheet. Post-fix guard (new module): the labels are literals
 * shaped like the ones `exportForkOnlyLabels` returns, so only the counting and ordering rules are exercised.
 */
import { describe, expect, test } from 'vitest'
import { binLeaveOutSummary, type BinLeaveOutInput } from 'src/ts/drive/binLeaveOut'
import type { ForkOnlyChatLabel, ForkOnlyKind } from 'src/ts/drive/exportAlternatives'

function label(key: string, kinds: ForkOnlyKind[], branches?: ForkOnlyChatLabel['branches']): ForkOnlyChatLabel {
    return { key, text: `Char / ${key}`, kinds, ...(branches !== undefined ? { branches } : {}) }
}

const NONE: BinLeaveOutInput = { chats: [], taskPresets: [], themePacks: [], usageStats: false }

describe('binLeaveOutSummary', () => {
    test('nothing to leave out gives an empty list', () => {
        expect(binLeaveOutSummary(NONE)).toEqual([])
    })

    test('every kind present is listed in the order the per-kind prompts ask them, with its count', () => {
        const summary = binLeaveOutSummary({
            chats: [label('a', ['alternatives'], { chats: 2, omitted: 1, bytes: 10 }), label('b', ['interruptedNote', 'hideNames'])],
            taskPresets: ['One', 'Two'],
            themePacks: ['Pack'],
            usageStats: true,
        })
        expect(summary.map((entry) => entry.kind)).toEqual(['alternatives', 'forkChatData', 'taskPresets', 'themePacks', 'usageStats'])
        expect(summary.map((entry) => entry.count)).toEqual([1, 1, 2, 1, 1])
        const forkChat = summary[1]
        expect(forkChat.kind === 'forkChatData' && forkChat.kinds).toEqual(['interruptedNote', 'hideNames'])
    })

    test('a chat that holds only alternatives counts under alternatives alone', () => {
        const summary = binLeaveOutSummary({ ...NONE, chats: [label('a', ['alternatives'])] })
        expect(summary.map((entry) => entry.kind)).toEqual(['alternatives'])
    })

    test('a chat that holds alternatives and another kind counts under both, as the two prompts counted it', () => {
        const summary = binLeaveOutSummary({ ...NONE, chats: [label('a', ['alternatives', 'hideNames'])] })
        expect(summary.map((entry) => [entry.kind, entry.count])).toEqual([['alternatives', 1], ['forkChatData', 1]])
        const forkChat = summary[1]
        expect(forkChat.kind === 'forkChatData' && forkChat.kinds).toEqual(['hideNames'])
    })

    test('the kinds of the fork-data entry follow the table order, not the order the chats list them', () => {
        const summary = binLeaveOutSummary({ ...NONE, chats: [label('a', ['hideNames']), label('b', ['memoryCoverage']), label('c', ['interruptedNote'])] })
        const forkChat = summary[0]
        expect(forkChat.kind === 'forkChatData' && forkChat.kinds).toEqual(['interruptedNote', 'memoryCoverage', 'hideNames'])
    })

    test('usage statistics appear only when the profile holds some', () => {
        expect(binLeaveOutSummary({ ...NONE, usageStats: true })).toEqual([{ kind: 'usageStats', count: 1 }])
        expect(binLeaveOutSummary({ ...NONE, usageStats: false })).toEqual([])
    })

    test('the extra chats written add up over the chats that hold alternatives', () => {
        const summary = binLeaveOutSummary({
            ...NONE,
            chats: [label('a', ['alternatives'], { chats: 2, omitted: 0, bytes: null }), label('b', ['alternatives']), label('c', ['alternatives'], { chats: 3, omitted: 1, bytes: 5 })],
        })
        const alternatives = summary[0]
        expect(alternatives.kind === 'alternatives' && alternatives.branchChats).toBe(5)
        expect(alternatives.kind === 'alternatives' && alternatives.count).toBe(3)
    })

    test('the input is not changed', () => {
        const input: BinLeaveOutInput = { chats: [label('a', ['alternatives', 'hideNames'])], taskPresets: ['One'], themePacks: [], usageStats: false }
        const before = JSON.stringify(input)
        binLeaveOutSummary(input)
        expect(JSON.stringify(input)).toBe(before)
    })
})
