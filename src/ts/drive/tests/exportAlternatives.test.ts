// CHORE-478 S1c and MC-774: the strip functions of a `.bin` export, driven by one table of fork-only chat keys. Titles:
// `reproducer` fails when the strip is absent; `guard` passes before and after (or pins a new API) and pins that nothing is
// copied or changed when there is nothing to strip; `diagnostic` pins which values are named.
import { describe, test, expect } from 'vitest'
import { FORK_ONLY_CHAT_KEYS, chatHoldsAlternatives, forkOnlyChatLabels, forkOnlyConfirmKeys, lateForkOnlyChats, withoutColdValueForkOnly, withoutForkOnlyChatData, type ForkOnlyChatLabel } from '../exportAlternatives'

const ALT = [{ m: { time: 2, data: 'x', role: 'char' }, p: null, a: 1 }]

function character(chats: Record<string, unknown>[]): Record<string, unknown> {
    return { chaId: 'c1', name: 'Alice', chats }
}

describe('withoutForkOnlyChatData', () => {
    test('reproducer: a chat with alt comes back without it, the other fields intact, and the input is untouched', () => {
        const input = character([{ name: 'A', message: [1], alt: ALT }, { name: 'B', message: [2] }])
        const snapshot = JSON.stringify(input)

        const out = withoutForkOnlyChatData(input)

        expect(out).not.toBe(input)
        expect(out.chats).toEqual([{ name: 'A', message: [1] }, { name: 'B', message: [2] }])
        expect(JSON.stringify(input)).toBe(snapshot)
    })

    test('guard: a character without alt is returned itself, not a copy', () => {
        const input = character([{ name: 'A', message: [1] }])
        expect(withoutForkOnlyChatData(input)).toBe(input)
        expect(withoutForkOnlyChatData({ name: 'no chats' })).toEqual({ name: 'no chats' })
    })

    test('reproducer: an empty alt list is removed as well', () => {
        const out = withoutForkOnlyChatData(character([{ name: 'A', alt: [] }]))
        expect('alt' in (out.chats as Record<string, unknown>[])[0]).toBe(false)
    })

    test('reproducer: the interrupted flag and the coverage pointer are removed whatever they hold, and the input is untouched', () => {
        const input = character([{
            name: 'A',
            supaMemoryData: 'L\nrest',
            supaMemoryCoveredId: 'not-the-first-line',
            message: [{ data: 'one', interrupted: false }, { data: 'two', interrupted: true }, { data: 'three' }],
        }])
        const snapshot = JSON.stringify(input)

        const out = withoutForkOnlyChatData(input)

        expect(out.chats).toEqual([{ name: 'A', supaMemoryData: 'L\nrest', message: [{ data: 'one' }, { data: 'two' }, { data: 'three' }] }])
        expect(JSON.stringify(input)).toBe(snapshot)
    })

    // G2: the copy shares what it did not change, so a cached value is never touched and a clean store re-encodes alike.
    test('guard (G2): only the changed character, chat and message are copied; clean ones are the same objects', () => {
        const cleanChat = { name: 'Clean', message: [{ data: 'a' }] }
        const dirtyChat = { name: 'Dirty', message: [{ data: 'a' }, { data: 'b', interrupted: true }] }
        const input = character([cleanChat, dirtyChat])

        const out = withoutForkOnlyChatData(input)
        const chats = out.chats as Record<string, unknown>[]

        expect(out).not.toBe(input)
        expect(chats[0]).toBe(cleanChat)
        expect(chats[1]).not.toBe(dirtyChat)
        const messages = chats[1].message as unknown[]
        expect(messages[0]).toBe(dirtyChat.message[0])
        expect(messages[1]).toEqual({ data: 'b' })
        expect('interrupted' in dirtyChat.message[1]).toBe(true)
    })

    test('guard (I3): fields that are not in the table travel', () => {
        const input = character([{
            name: 'A',
            supaMemoryData: 's',
            lastMemory: 'm',
            scriptstate: { x: 1 },
            hypaV3Data: { memories: [] },
            useLocallySetGlobalVariables: true,
            GLGlobalVariables: { v: '1' },
            alt: ALT,
            message: [{ data: 'a', name: 'speaker', chatId: 'id-1', interrupted: true }],
        }])

        const kept = (withoutForkOnlyChatData(input).chats as Record<string, unknown>[])[0]

        expect(Object.keys(kept).sort()).toEqual(['GLGlobalVariables', 'hypaV3Data', 'lastMemory', 'message', 'name', 'scriptstate', 'supaMemoryData', 'useLocallySetGlobalVariables'])
        expect(kept.message).toEqual([{ data: 'a', name: 'speaker', chatId: 'id-1' }])
    })

    test('guard (I3): the table names exactly the fork-only keys', () => {
        expect(FORK_ONLY_CHAT_KEYS.map((row) => `${row.scope}:${row.key}:${row.kind}`)).toEqual([
            'chat:alt:alternatives',
            'message:interrupted:interruptedNote',
            'chat:supaMemoryCoveredId:memoryCoverage',
            'chat:scopedJailbreak:chatJailbreak',
            'chat:scopedMemory:chatMemory',
            'chat:hideNames:hideNames',
            'chat:unseenReply:null',
        ])
    })

    // OQ-R1 (b): the new-reply mark is removed from a `.bin` export and never named, so it adds no warning and no string.
    test.each(['reply', 'error', 'a value of a later build'])('reproducer (P3): unseenReply %j is removed from the exported chat and names nothing', (value) => {
        const input = character([{ name: 'A', unseenReply: value, message: [1] }, { name: 'B', message: [2] }])
        const snapshot = JSON.stringify(input)

        const out = withoutForkOnlyChatData(input)

        expect(out.chats).toEqual([{ name: 'A', message: [1] }, { name: 'B', message: [2] }])
        expect(forkOnlyChatLabels(input)).toEqual([])
        expect(JSON.stringify(input)).toBe(snapshot)
    })

    // C-T11 at the table: a switch is named only while the chat's scope flag is on and the value is a boolean
    test.each([
        { fields: { useLocallySetGlobalVariables: true, scopedJailbreak: true }, kinds: [['chatJailbreak']] },
        { fields: { useLocallySetGlobalVariables: true, scopedMemory: false }, kinds: [['chatMemory']] },
        { fields: { useLocallySetGlobalVariables: true, scopedJailbreak: false, scopedMemory: true, hideNames: true }, kinds: [['chatJailbreak', 'chatMemory', 'hideNames']] },
        { fields: { hideNames: true }, kinds: [['hideNames']] },
        { fields: { hideNames: false }, kinds: [] },
        { fields: { scopedJailbreak: true, scopedMemory: true }, kinds: [] },
        { fields: { useLocallySetGlobalVariables: false, scopedJailbreak: true }, kinds: [] },
        { fields: { useLocallySetGlobalVariables: true, scopedJailbreak: 'yes', scopedMemory: null }, kinds: [] },
    ])('the chat-only switches and hideNames name $kinds for $fields, and are removed either way', ({ fields, kinds }) => {
        const input = character([{ name: 'A', ...fields }])

        expect(forkOnlyChatLabels(input).map((entry) => entry.kinds)).toEqual(kinds)
        const kept = (withoutForkOnlyChatData(input).chats as Record<string, unknown>[])[0]
        for (const key of ['scopedJailbreak', 'scopedMemory', 'hideNames']) {
            expect(key in kept).toBe(false)
        }
        expect('useLocallySetGlobalVariables' in kept).toBe('useLocallySetGlobalVariables' in fields)
    })
})

describe('forkOnlyChatLabels', () => {
    test('names only the chats that hold alternatives, character first', () => {
        const input = character([{ name: 'A', alt: ALT }, { name: 'B', alt: [] }, { name: 'C' }, { alt: ALT }])
        expect(forkOnlyChatLabels(input).map((label) => label.text)).toEqual(['Alice / A', 'Alice / Chat'])
        expect(chatHoldsAlternatives({ alt: [] })).toBe(false)
        expect(chatHoldsAlternatives({ alt: ALT })).toBe(true)
        expect(chatHoldsAlternatives({})).toBe(false)
    })

    test('keys: a chat id is used when there is one, otherwise the position; a character without chaId is keyed by its name', () => {
        const input = character([{ id: 'chat-a', name: 'A', alt: ALT }, { name: 'B', alt: ALT }, { id: '', name: 'C', alt: ALT }])
        expect(forkOnlyChatLabels(input).map((label) => label.key)).toEqual(['c:c1/id:chat-a', 'c:c1/at:1', 'c:c1/at:2'])
        expect(forkOnlyChatLabels({ name: 'Bob', chats: [{ name: 'A', alt: ALT }] }).map((label) => label.key)).toEqual(['?:Bob/at:0'])
    })

    // T80 regression reproducer: the key tells chats apart where the text cannot
    test('reproducer: two characters with equally named chats give two labels with distinct keys and the same text', () => {
        const first = forkOnlyChatLabels({ chaId: 'one', name: 'Alice', chats: [{ name: 'Chat 1', alt: ALT }] })
        const second = forkOnlyChatLabels({ chaId: 'two', name: 'Alice', chats: [{ name: 'Chat 1', alt: ALT }] })
        expect(first[0].text).toBe(second[0].text)
        expect(first[0].key).not.toBe(second[0].key)
        const twin = forkOnlyChatLabels(character([{ name: 'Chat', alt: ALT }, { name: 'Chat', alt: ALT }]))
        expect(twin).toHaveLength(2)
        expect(new Set(twin.map((label) => label.key)).size).toBe(2)
    })

    test('diagnostic (D1): which present values are named, and with which kind', () => {
        const label = (chat: Record<string, unknown>) => forkOnlyChatLabels(character([chat])).map((entry) => entry.kinds)
        // alternatives: an empty list is removed silently
        expect(label({ alt: [] })).toEqual([])
        expect(label({ alt: ALT })).toEqual([['alternatives']])
        // interrupted: only `true`
        expect(label({ message: [{ interrupted: false }, { data: 'x' }] })).toEqual([])
        expect(label({ message: [{ interrupted: false }, { interrupted: true }] })).toEqual([['interruptedNote']])
        // coverage: only while it equals the first line of the summary
        expect(label({ supaMemoryData: 'L\nrest', supaMemoryCoveredId: 'L' })).toEqual([['memoryCoverage']])
        expect(label({ supaMemoryData: 'L', supaMemoryCoveredId: 'L' })).toEqual([['memoryCoverage']])
        expect(label({ supaMemoryData: 'L\nrest', supaMemoryCoveredId: 'other' })).toEqual([])
        expect(label({ supaMemoryCoveredId: 'L' })).toEqual([])
        expect(label({ supaMemoryData: 'L\nrest', supaMemoryCoveredId: 7 })).toEqual([])
        // all kinds on one chat give one label, kinds in table order
        expect(label({ alt: ALT, message: [{ interrupted: true }], supaMemoryData: 'L', supaMemoryCoveredId: 'L' })).toEqual([['alternatives', 'interruptedNote', 'memoryCoverage']])
    })
})

describe('withoutColdValueForkOnly', () => {
    test('reproducer: a character unit and a chat unit lose alt, a copy is returned', () => {
        const unit = { character: character([{ name: 'A', alt: ALT }]) }
        const loose = { message: [1], name: 'Loose', alt: ALT }

        const a = withoutColdValueForkOnly(unit, 'unit-a')
        const b = withoutColdValueForkOnly(loose, 'unit-b')

        expect(JSON.stringify(a.value)).not.toContain('"alt"')
        expect(a.labels).toEqual([{ key: 'c:c1/at:0', text: 'Alice / A', kinds: ['alternatives'] }])
        expect(JSON.stringify(b.value)).not.toContain('"alt"')
        expect(b.labels).toEqual([{ key: 'u:unit-b', text: 'Unknown Character / Loose', kinds: ['alternatives'] }])
        expect('alt' in unit.character.chats[0]).toBe(true)
        expect('alt' in loose).toBe(true)
    })

    test('reproducer (D1): a chat unit loses the interrupted flag of its messages and the coverage pointer, and names both kinds', () => {
        const loose = { message: [{ data: 'a' }, { data: 'b', interrupted: true }], name: 'Loose', supaMemoryData: 'L\nrest', supaMemoryCoveredId: 'L' }

        const out = withoutColdValueForkOnly(loose, 'unit-c')

        expect(out.value).toEqual({ message: [{ data: 'a' }, { data: 'b' }], name: 'Loose', supaMemoryData: 'L\nrest' })
        expect(out.labels).toEqual([{ key: 'u:unit-c', text: 'Unknown Character / Loose', kinds: ['interruptedNote', 'memoryCoverage'] }])
        expect(loose.message[1]).toEqual({ data: 'b', interrupted: true })
        expect(loose.supaMemoryCoveredId).toBe('L')
    })

    test('guard: anything without a table key, and any non-object, is returned itself', () => {
        const plain = { character: character([{ name: 'A' }]) }
        expect(withoutColdValueForkOnly(plain, 'k').value).toBe(plain)
        expect(withoutColdValueForkOnly([1, 2], 'k').value).toEqual([1, 2])
        expect(withoutColdValueForkOnly(null, 'k').labels).toEqual([])
        const cleanUnit = { message: [{ data: 'a' }], name: 'Loose' }
        expect(withoutColdValueForkOnly(cleanUnit, 'k').value).toBe(cleanUnit)
    })

    test('guard: an inert key is removed and the unit is not named', () => {
        const out = withoutColdValueForkOnly({ message: [{ interrupted: false }], name: 'Loose', supaMemoryData: 'L', supaMemoryCoveredId: 'x' }, 'k')
        expect(out.value).toEqual({ message: [{}], name: 'Loose', supaMemoryData: 'L' })
        expect(out.labels).toEqual([])
    })

    test('reproducer (P5): a character unit and a chat unit lose unseenReply, are not named, and the inputs are untouched', () => {
        const unit = { character: character([{ name: 'A', unseenReply: 'reply', message: [1] }]) }
        const loose = { message: [1], name: 'Loose', unseenReply: 'error' }

        const a = withoutColdValueForkOnly(unit, 'unit-a')
        const b = withoutColdValueForkOnly(loose, 'unit-b')

        expect(JSON.stringify(a.value)).not.toContain('unseenReply')
        expect(a.labels).toEqual([])
        expect(b.value).toEqual({ message: [1], name: 'Loose' })
        expect(b.labels).toEqual([])
        expect(unit.character.chats[0].unseenReply).toBe('reply')
        expect(loose.unseenReply).toBe('error')
    })
})

describe('lateForkOnlyChats', () => {
    const label = (key: string, text: string, ...kinds: ForkOnlyChatLabel['kinds']): ForkOnlyChatLabel => ({ key, text, kinds })

    test('diagnostic: a kind is late when its own entry was not confirmed, even on a chat another kind confirmed', () => {
        const confirmed = forkOnlyConfirmKeys([label('k1', 'A / x', 'alternatives')])

        const late = lateForkOnlyChats([label('k1', 'A / x', 'alternatives', 'interruptedNote'), label('k2', 'B / y', 'alternatives')], confirmed)

        expect(late.alternatives).toEqual(['B / y'])
        expect(late.other).toEqual([{ text: 'A / x', kinds: ['interruptedNote'] }])
    })

    test('diagnostic: the same chat and kind from two sources is reported once, and the other kinds of one chat are grouped', () => {
        const late = lateForkOnlyChats([label('k1', 'A / x', 'interruptedNote'), label('k1', 'A / x', 'interruptedNote', 'memoryCoverage')], new Set())

        expect(late).toEqual({ alternatives: [], other: [{ text: 'A / x', kinds: ['interruptedNote', 'memoryCoverage'] }] })
    })

    test('guard: everything confirmed gives nothing late', () => {
        const labels = [label('k1', 'A / x', 'alternatives', 'memoryCoverage')]
        expect(lateForkOnlyChats(labels, forkOnlyConfirmKeys(labels))).toEqual({ alternatives: [], other: [] })
    })
})
