/**
 * `chatAltBridge`: the hide and keep rules for the alternatives of a chat, on plain data and on the reactive
 * proxies the live database holds.
 *
 * Test kinds: "guard:" rows pass before and after; every other row pins a rule of the module and fails on the
 * mutant named in its title. The Svelte proxies are the real ones (`$state`), so the aliasing row is evidence of
 * the live-element case.
 */
import { describe, expect, test, vi } from 'vitest'
import {
    captureChatAlt,
    keepCapturedChatAlt,
    keepLiveAlt,
    overwritesPlaceholder,
    placeholderTargets,
    withoutAlt,
    withoutAltChat,
    withoutAltIn,
} from '../chatAltBridge'

type Entry = Record<string, unknown>

const rec = (id: string, p: string | null, a: number): Entry => ({ m: { role: 'char', data: id, chatId: id }, p, a })
const msgs = (...ids: string[]): Entry[] => ids.map((chatId) => ({ role: 'user', data: chatId, chatId }))

function chat(id: string, ids: string[], alt?: Entry[]): Entry {
    return { id, message: msgs(...ids), ...(alt ? { alt } : {}) }
}

function character(chaId: string, chats: Entry[]): Entry {
    return { chaId, chats }
}

describe('hiding', () => {
    test('withoutAltChat, withoutAlt and withoutAltIn delete alt from the copy only', () => {
        const live = character('a', [chat('c', ['m1'], [rec('x', 'm1', 1)])])
        const copy = structuredClone(live)
        withoutAlt(copy as { chats?: { alt?: unknown }[] })
        expect(JSON.stringify(copy)).not.toContain('"alt"')
        expect(JSON.stringify(live)).toContain('"alt"')
        const another = structuredClone(live)
        withoutAltIn([another as { chats?: { alt?: unknown }[] }])
        expect(JSON.stringify(another)).not.toContain('"alt"')
        const single: Entry = chat('c', [], [rec('x', null, 1)])
        withoutAltChat(single)
        expect('alt' in single).toBe(false)
    })
})

describe('keepLiveAlt', () => {
    test('a matched character takes the live alt, the plugin\'s alt is dropped, orphans are re-attached', () => {
        const live = [character('a', [chat('c', ['m1', 'm2'], [rec('x', 'm2', 1)])])]
        const incoming = [character('a', [chat('c', ['m1'], [rec('evil', null, 9)])])]
        keepLiveAlt(live, incoming)
        const kept = (incoming[0].chats as Entry[])[0].alt as Entry[]
        expect(kept).toBe((live[0].chats as Entry[])[0].alt)
        expect(kept[0].p).toBe('m1')
    })

    test('the incoming element can be the live element: the live alt survives (kills delete-before-capture)', () => {
        const state = $state({ characters: [character('a', [chat('c', ['m1'], [rec('x', 'm1', 1)])])] })
        keepLiveAlt(state.characters, [state.characters[0]])
        expect($state.snapshot((state.characters[0].chats as Entry[])[0].alt)).toEqual([rec('x', 'm1', 1)])
    })

    test('guard: a live element and its copy in one incoming list, behind another live character, keep the live alt', () => {
        const live = $state([character('z', []), character('a', [chat('c', ['m1'], [rec('x', 'm1', 1)])])])
        const copyOfA = $state.snapshot(live[1]) as Entry
        expect(() => keepLiveAlt(live, [live[1], copyOfA])).not.toThrow()
        expect($state.snapshot((live[1].chats as Entry[])[0].alt)).toEqual([rec('x', 'm1', 1)])
    })

    test('a character continues the live one with its chaId at another index only when each list holds the id once', () => {
        const live = [character('a', [chat('c', ['m1'], [rec('x', 'm1', 1)])]), character('b', [])]
        const swapped = [character('b', []), character('a', [chat('c', ['m1'])])]
        keepLiveAlt(live, swapped)
        expect((swapped[1].chats as Entry[])[0].alt).toBeDefined()

        const duplicated = [character('a', [chat('c', ['m1'])]), character('a', [chat('c', ['m1'])])]
        keepLiveAlt([character('a', [chat('c', ['m1'], [rec('x', 'm1', 1)])]), character('z', [])], duplicated)
        expect((duplicated[0].chats as Entry[])[0].alt).toBeDefined()
        expect((duplicated[1].chats as Entry[])[0].alt).toBeUndefined()
    })

    test('an incoming character that continues no live character is left as it is, its alt included', () => {
        const crafted = [rec('c1', null, 1)]
        const incoming = [character('new', [chat('n', ['m1'], crafted)])]
        keepLiveAlt([character('a', [chat('c', ['m1'], [rec('x', 'm1', 1)])])], incoming)
        expect((incoming[0].chats as Entry[])[0].alt).toBe(crafted)
    })

    test('a chat left out takes its alt with it; duplicate ids match by index; a leftover goes to the first holder', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const left = [character('a', [chat('c1', ['m1'], [rec('x1', 'm1', 1)]), chat('c2', ['m1'], [rec('x2', 'm1', 1)])])]
        const out = [character('a', [chat('c2', ['m1'])])]
        keepLiveAlt(left, out)
        const only = (out[0].chats as Entry[])[0].alt as Entry[]
        expect((only[0].m as Entry).chatId).toBe('x2')

        const duplicates = [character('a', [chat('d', ['m1'], [rec('y1', 'm1', 1)]), chat('d', ['m1'], [rec('y2', 'm1', 1)])])]
        const reversed = [character('a', [chat('d', ['m1']), chat('d', ['m1'])])]
        keepLiveAlt(duplicates, reversed)
        expect(((reversed[0].chats as Entry[])[0].alt as Entry[])[0].m).toMatchObject({ chatId: 'y1' })
        expect(((reversed[0].chats as Entry[])[1].alt as Entry[])[0].m).toMatchObject({ chatId: 'y2' })

        const moved = [character('a', [chat('e', ['m1'], [rec('z', 'm1', 1)]), chat('f', ['m1'])])]
        const shifted = [character('a', [chat('f', ['m1']), chat('g', ['m1']), chat('e', ['m1']), chat('e', ['m1'])])]
        keepLiveAlt(moved, shifted)
        expect(((shifted[0].chats as Entry[])[2].alt as Entry[])[0].m).toMatchObject({ chatId: 'z' })
        expect((shifted[0].chats as Entry[])[3].alt).toBeUndefined()
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })

    test('an empty incoming path over a non-empty live path keeps no alt', () => {
        const live = [character('a', [chat('c', ['m1'], [rec('x', 'm1', 1)])])]
        const incoming = [character('a', [chat('c', [], [rec('evil', null, 1)])])]
        keepLiveAlt(live, incoming)
        expect('alt' in (incoming[0].chats as Entry[])[0]).toBe(false)
    })

    test('guard: nothing to keep and nothing incoming changes nothing', () => {
        const incoming = [character('a', [chat('c', ['m1'])])]
        keepLiveAlt([character('a', [chat('c', ['m1'])])], incoming)
        expect('alt' in (incoming[0].chats as Entry[])[0]).toBe(false)
        keepLiveAlt(undefined, 'not a list')
    })
})

describe('captureChatAlt and keepCapturedChatAlt', () => {
    test('keeps the captured alt only for the same chat id', () => {
        const capture = captureChatAlt(chat('c', ['m1', 'm2'], [rec('x', 'm2', 1)]))
        const same = chat('c', ['m1'])
        keepCapturedChatAlt(capture, same)
        expect((same.alt as Entry[])[0].p).toBe('m1')
        const other = chat('other', ['m1'], [rec('evil', null, 1)])
        keepCapturedChatAlt(capture, other)
        expect('alt' in other).toBe(false)
    })

    test('a chat with no alt or an empty list captures none', () => {
        expect(captureChatAlt(chat('c', ['m1'])).alt).toBeUndefined()
        expect(captureChatAlt(chat('c', ['m1'], [])).alt).toBeUndefined()
        expect(captureChatAlt(undefined).messageLength).toBe(0)
    })
})

describe('placeholders', () => {
    const stub = { chaId: 'a', coldstorage: 'unit-a', chats: [] }

    test('placeholderTargets lists the full incoming characters whose chaId a placeholder holds', () => {
        expect(placeholderTargets([stub, { chaId: 'b' }], [{ chaId: 'a' }, { chaId: 'a' }, { chaId: 'b' }, stub])).toEqual(['a'])
        expect(placeholderTargets([{ chaId: 'b' }], [{ chaId: 'b' }])).toEqual([])
        expect(placeholderTargets([stub], 'not a list')).toEqual([])
    })

    test('overwritesPlaceholder needs a placeholder, a full incoming and the same chaId', () => {
        expect(overwritesPlaceholder(stub, { chaId: 'a' })).toBe(true)
        expect(overwritesPlaceholder(stub, { chaId: 'b' })).toBe(false)
        expect(overwritesPlaceholder(stub, { chaId: 'a', coldstorage: 'unit-a' })).toBe(false)
        expect(overwritesPlaceholder({ chaId: 'a' }, { chaId: 'a' })).toBe(false)
    })
})
