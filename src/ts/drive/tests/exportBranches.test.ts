// CHORE-478 S5 (B1-B24): the pure translation of alternatives into upstream Branch chats. Trees are produced by the
// engine (`detachTail`, `switchTo`) so parked memory is what the app writes; a fixture marked "hand-built" models a shape
// no current producer writes (an older build or an import). Titles: `guard` pins a rule this stage adds.
import { describe, expect, test } from 'vitest'
import type { Chat, ChatAlt, Message } from '../../storage/database.svelte'
import { detachTail, siblingsAt, switchTo } from '../../process/chatTree'
import { forkOnlyChatLabels, forkOnlyKindsOf, withoutForkOnlyChatData, type ForkOnlyKind } from '../exportAlternatives'
import {
    branchChatLabels,
    branchChatsOf,
    branchMarkerData,
    branchPlanOf,
    branchSummaryOf,
    expandBranchChats,
    lateBranchLabels,
} from '../exportBranches'

function msg(chatId: string, role: 'user' | 'char' = 'char', data: string = `data ${chatId}`): Message {
    return { role, data, chatId }
}

function chatOf(path: Message[], fields: Partial<Chat> = {}): Chat {
    return { message: path, note: '', name: 'Chat', localLore: [], id: 'chat-1', ...fields }
}

function characterOf(chats: Chat[]): { chaId: string, name: string, chatPage: number, chats: Chat[] } {
    return { chaId: 'c1', name: 'Alice', chatPage: 0, chats }
}

function counter(): () => string {
    let n = 0
    return () => `id-${++n}`
}

function idsOf(chat: Chat): (string | undefined)[] {
    return chat.message.map((m) => m.chatId)
}

function markerOf(chat: Chat): Message {
    return chat.message[chat.message.length - 1]
}

function partsOf(chat: Chat): string[] {
    return markerOf(chat).data.split('::')
}

function branchesOf(chat: Chat, taken: Set<string> = new Set([chat.name]), newId: () => string = counter()): Chat[] {
    return branchChatsOf(chat, chat.id ?? 'chat-1', taken, newId)
}

/** u1 c2 u3 c4 is cut at u3 and continued with u5 c6; c6 is then rerolled. One continued branch, one reroll. */
function branchedChat(fields: Partial<Chat> = {}): Chat {
    const chat = chatOf([msg('u1', 'user'), msg('c2'), msg('u3', 'user'), msg('c4')], fields)
    expect(detachTail(chat, 2)).toBe(true)
    chat.message.push(msg('u5', 'user'), msg('c6'))
    expect(detachTail(chat, 3)).toBe(true)
    chat.message.push(msg('c6b'))
    return chat
}

/** The live branch state as a later edit would leave it: every source of memory holds a value unique to step `n`. */
function setLive(chat: Chat, n: number, coveredId: string): void {
    chat.scriptstate = { step: `s${n}` }
    chat.lastMemory = `lm${n}`
    chat.supaMemoryData = `${coveredId}\nsum${n}`
    chat.supaMemoryCoveredId = coveredId
    chat.hypaV3Data = { summaries: [{ text: `h${n}`, chatMemos: [coveredId], isImportant: false }] }
}

/**
 * Run a1 a2 a3 departs and returns, a2 a3 branch off a1, and a1 is switched away. The leaf a3 has the chain a1 a2 a3, its
 * own run head is a2, and the head of the chain (a1) holds a different parked state.
 */
function nestedChat(): Chat {
    const chat = chatOf([msg('u1', 'user'), msg('c2'), msg('a1', 'user'), msg('a2'), msg('a3', 'user')])
    setLive(chat, 1, 'a1')
    expect(detachTail(chat, 2)).toBe(true)
    chat.message.push(msg('x1', 'user'), msg('x2'))
    setLive(chat, 2, 'x1')
    expect(switchTo(chat, 2, 'a1')).toBe(true)
    setLive(chat, 3, 'a1')
    expect(detachTail(chat, 3)).toBe(true)
    chat.message.push(msg('y1', 'user'), msg('y2'))
    setLive(chat, 4, 'y1')
    expect(switchTo(chat, 2, 'x1')).toBe(true)
    return chat
}

function parkedOf(chat: Chat, chatId: string): NonNullable<ChatAlt['mem']> {
    const mem = chat.alt?.find((record) => record.m.chatId === chatId)?.mem
    if (mem === undefined) {
        throw new Error(`no parked state on ${chatId}`)
    }
    return mem
}

function branchHolding(chats: readonly Chat[], chatId: string): Chat {
    const found = chats.find((chat) => chat.message.some((m) => m.chatId === chatId))
    if (found === undefined) {
        throw new Error(`no branch chat holds ${chatId}`)
    }
    return found
}

describe('branch chats of one chat', () => {
    test('B1 guard: a continued branch becomes one chat of prefix, chain and marker, appended after the existing chats', () => {
        const chat = branchedChat()
        const input = characterOf([chat, chatOf([msg('o1', 'user')], { id: 'chat-2', name: 'Other' })])
        const newId = counter()
        const expanded = expandBranchChats(input, () => true, newId)

        expect(expanded.character.chats).toHaveLength(3)
        expect(expanded.character.chats[0]).toBe(chat)
        expect(expanded.character.chatPage).toBe(0)
        expect(expanded.parents).toEqual([0])
        const branch = expanded.character.chats[2]
        expect(idsOf(branch).slice(0, -1)).toEqual(['u1', 'c2', 'u3', 'c4'])
        expect(markerOf(branch)).toEqual({ role: 'char', data: branchMarkerData('chat-1', 'Chat', 'c2'), isComment: true, disabled: true, chatId: expect.any(String) })
        expect(branch.name).toBe('Chat (Branch)')
        expect(branch.alt).toBeUndefined()
        expect(branch.id).toMatch(/^id-/)
        expect(partsOf(branch)).toEqual(['{{specialcomment', 'branchedfrom', 'chat-1', 'Chat', 'c2', '}}'])
    })

    test('B2 guard: only a chain holding a message of the user becomes a chat', () => {
        const reroll = chatOf([msg('u1', 'user'), msg('c2')])
        expect(detachTail(reroll, 1)).toBe(true)
        reroll.message.push(msg('c2b'))
        expect(branchPlanOf(reroll)).toEqual({ kept: [], omitted: 1 })

        const group = chatOf([msg('u1', 'user'), msg('cA'), msg('cB')])
        expect(detachTail(group, 1)).toBe(true)
        group.message.push(msg('cA2'), msg('cB2'))
        expect(branchPlanOf(group)).toEqual({ kept: [], omitted: 1 })

        const pair = chatOf([msg('u1', 'user'), msg('c2'), msg('u3', 'user'), msg('c4')])
        expect(detachTail(pair, 2)).toBe(true)
        pair.message.push(msg('u5', 'user'))
        expect(branchPlanOf(pair)?.kept).toHaveLength(1)
        expect(idsOf(branchesOf(pair)[0])).toEqual(['u1', 'c2', 'u3', 'c4', expect.any(String)])

        const lone = chatOf([msg('u1', 'user'), msg('c2'), msg('u3', 'user')])
        expect(detachTail(lone, 2)).toBe(true)
        lone.message.push(msg('u4', 'user'))
        expect(idsOf(branchesOf(lone)[0])).toEqual(['u1', 'c2', 'u3', expect.any(String)])

        // a reroll leaf inside a branch that holds a message of the user is exported as its own chat
        const inside = chatOf([msg('u1', 'user'), msg('c2'), msg('u3', 'user'), msg('c4'), msg('u5', 'user'), msg('c6')])
        expect(detachTail(inside, 2)).toBe(true)
        inside.message.push(msg('v1', 'user'), msg('v2'))
        expect(switchTo(inside, 2, 'u3')).toBe(true)
        expect(detachTail(inside, 5)).toBe(true)
        inside.message.push(msg('c6b'))
        expect(switchTo(inside, 2, 'v1')).toBe(true)
        const plan = branchPlanOf(inside)
        expect(plan?.kept).toHaveLength(2)
        expect(plan?.omitted).toBe(0)
        expect(branchesOf(inside).map((chat) => chat.message[chat.message.length - 2].chatId).sort()).toEqual(['c6', 'c6b'])
    })

    test('B3 guard: a nested leaf holds the whole chain and the memory parked on its own run head', () => {
        const chat = nestedChat()
        const branch = branchHolding(branchesOf(chat), 'a3')
        expect(idsOf(branch).slice(0, -1)).toEqual(['u1', 'c2', 'a1', 'a2', 'a3'])
        expect(branch.scriptstate).toEqual({ step: 's3' })
        expect(branch.lastMemory).toBe('lm3')
        expect(branch.supaMemoryData).toBe('a1\nsum3')
        expect(branch.hypaV3Data?.summaries.map((s) => s.text)).toEqual(['h3'])
        // not the live state (step 2) and not the state parked on the chain head a1 (step 4)
        expect(chat.scriptstate).toEqual({ step: 's2' })
        expect(parkedOf(chat, 'a1').scriptstate).toEqual({ step: 's4' })
        expect(branchHolding(branchesOf(chat), 'y2').scriptstate).toEqual({ step: 's4' })
    })

    test('B4 guard: a chain cut at the first message has an empty prefix and no branch point', () => {
        const chat = chatOf([msg('u1', 'user'), msg('c2')])
        expect(detachTail(chat, 0)).toBe(true)
        chat.message.push(msg('n1', 'user'))
        const branch = branchesOf(chat)[0]
        expect(idsOf(branch).slice(0, -1)).toEqual(['u1', 'c2'])
        expect(partsOf(branch)[4]).toBe('')
    })

    test('B5 guard: duplicate ids and cycles are counted exactly and never throw', () => {
        // hand-built (older build/import shape): a duplicated id, a follower of it, and a cycle
        const chat = chatOf([msg('u1', 'user')], {
            alt: [
                { m: msg('d'), p: 'u1', a: 1 },
                { m: msg('d'), p: 'u1', a: 1 },
                { m: msg('after', 'user'), p: 'd', a: 2 },
                { m: msg('A'), p: 'B', a: 3 },
                { m: msg('B'), p: 'A', a: 3 },
            ],
        })
        expect(branchSummaryOf(chat)).toMatchObject({ chats: 1, omitted: 3 })
        expect(idsOf(branchesOf(chat)[0])).toEqual(['u1', 'd', 'after', expect.any(String)])
    })

    test('B6 guard: an alt that cannot be read is never interpreted', () => {
        // hand-built (older build/import shape): an unreadable alt
        const chat = chatOf([msg('u1', 'user')])
        Object.assign(chat, { alt: 'text' })
        const input = characterOf([chat])
        expect(branchesOf(chat)).toEqual([])
        expect(branchPlanOf(chat)).toBeNull()
        expect(branchSummaryOf(chat)).toBeNull()
        const expanded = expandBranchChats(input, () => true, counter())
        expect(expanded.character).toBe(input)
        expect(expanded.parents).toEqual([])
    })

    test('B7 guard: parked memory is a copy of the run head, differs from the live state, and drops a pair that is not on the branch', () => {
        const chat = nestedChat()
        const parked = parkedOf(chat, 'a2')
        const branch = branchHolding(branchesOf(chat), 'a3')
        expect(branch.hypaV3Data).toEqual(parked.hypaV3Data)
        expect(branch.hypaV3Data).not.toBe(parked.hypaV3Data)
        expect(branch.scriptstate).toEqual(parked.scriptstate)
        expect(branch.scriptstate).not.toBe(parked.scriptstate)
        expect(branch.lastMemory).toBe(parked.lastMemory)
        expect('hypaV2Data' in branch).toBe(false)
        expect(branch.hypaV3Data).not.toEqual(chat.hypaV3Data)

        const off = chatOf([msg('u1', 'user'), msg('c2'), msg('u3', 'user'), msg('c4')])
        setLive(off, 1, 'zzz')
        expect(detachTail(off, 2)).toBe(true)
        off.message.push(msg('u5', 'user'))
        const dropped = branchesOf(off)[0]
        expect('supaMemoryData' in dropped).toBe(false)
        expect('supaMemoryCoveredId' in dropped).toBe(false)
        expect(dropped.scriptstate).toEqual({ step: 's1' })
    })

    test('B8 guard: without a parked record the live memory is trimmed to the branch', () => {
        const chat = chatOf([msg('u1', 'user'), msg('c2'), msg('u3', 'user'), msg('c4')])
        expect(detachTail(chat, 2)).toBe(true)
        chat.message.push(msg('u5', 'user'), msg('c6'))
        // hand-built (older build/import shape): a record that carries no parked state
        delete chat.alt?.[0].mem
        chat.hypaV3Data = {
            summaries: [
                { text: 'keep', chatMemos: ['u1', 'c2'], isImportant: false },
                { text: 'drop', chatMemos: ['u5'], isImportant: false },
            ],
        }
        chat.lastMemory = 'u5'
        chat.scriptstate = { live: 'kept' }
        const branch = branchesOf(chat)[0]
        expect(branch.hypaV3Data?.summaries.map((s) => s.text)).toEqual(['keep'])
        expect('lastMemory' in branch).toBe(false)
        expect(branch.scriptstate).toEqual({ live: 'kept' })
        expect(branch.scriptstate).not.toBe(chat.scriptstate)
    })
})

describe('names, fields and order', () => {
    test('B9 guard: names follow "Name (Branch)", skip names in use and stay unique across leaves and parents', () => {
        const chat = chatOf([msg('u1', 'user'), msg('c2'), msg('u3', 'user'), msg('c4')])
        expect(detachTail(chat, 2)).toBe(true)
        chat.message.push(msg('u5', 'user'), msg('c6'))
        expect(detachTail(chat, 2)).toBe(true)
        chat.message.push(msg('u7', 'user'), msg('c8'))

        const taken = characterOf([chat, chatOf([msg('o')], { id: 'o', name: 'Chat (Branch)' })])
        const names = expandBranchChats(taken, () => true, counter()).character.chats.slice(2).map((c) => c.name)
        expect(names).toEqual(['Chat (Branch 2)', 'Chat (Branch 3)'])

        const child = branchedChat({ name: 'Chat (Branch 2)' })
        expect(expandBranchChats(characterOf([child]), () => true, counter()).character.chats[1].name).toBe('Chat (Branch)')

        const second = branchedChat({ id: 'chat-2', name: 'B' })
        const first = branchedChat({ id: 'chat-1', name: 'A' })
        const both = expandBranchChats(characterOf([first, second]), () => true, counter()).character.chats
        expect(both.slice(2).map((c) => c.name)).toEqual(['A (Branch)', 'B (Branch)'])
        expect(new Set(both.map((c) => c.name)).size).toBe(both.length)

        for (const name of [7, undefined]) {
            const odd = branchedChat()
            Object.assign(odd, { name })
            const branch = expandBranchChats(characterOf([odd]), () => true, counter()).character.chats[1]
            expect(branch.name).toBe(' (Branch)')
            expect(partsOf(branch)[3]).toBe('')
        }
    })

    test('B10 guard: the parent fields are kept except the ones that must not follow, and bookmarks keep what the chat holds', () => {
        const chat = branchedChat({
            note: 'a note',
            modules: ['m1'],
            fmIndex: 2,
            bindedPersona: 'persona',
            lastDate: 5,
            useLocallySetGlobalVariables: true,
            GLGlobalVariables: { k: 'v' },
            onboardingDone: true,
            folderId: 'folder',
            suggestMessages: ['s'],
            isStreaming: true,
            bookmarks: ['c2', 'u3', 'u5', 'c6'],
            bookmarkNames: { c2: 'two', u3: 'three', u5: 'five' },
        })
        const branch = branchesOf(chat, new Set(['Chat']), () => 'fresh-id')[0]
        expect('alt' in branch).toBe(false)
        expect('folderId' in branch).toBe(false)
        expect('suggestMessages' in branch).toBe(false)
        expect('isStreaming' in branch).toBe(false)
        expect(branch).toMatchObject({
            note: 'a note',
            modules: ['m1'],
            fmIndex: 2,
            bindedPersona: 'persona',
            lastDate: 5,
            useLocallySetGlobalVariables: true,
            GLGlobalVariables: { k: 'v' },
            onboardingDone: true,
            id: 'fresh-id',
        })
        expect(branch.bookmarks).toEqual(['c2', 'u3'])
        expect(branch.bookmarkNames).toEqual({ c2: 'two', u3: 'three' })
    })

    test('B11 guard: branches come out by branch point, then departure stamp, then list position', () => {
        const chat = chatOf([msg('u1', 'user'), msg('c2'), msg('u3', 'user'), msg('c4')])
        expect(detachTail(chat, 0)).toBe(true)
        chat.message.push(msg('p1', 'user'), msg('p2'), msg('p3', 'user'), msg('p4'))
        expect(detachTail(chat, 2)).toBe(true)
        chat.message.push(msg('p5', 'user'), msg('p6'), msg('p7', 'user'), msg('p8'))
        expect(detachTail(chat, 3)).toBe(true)
        const tails = branchesOf(chat).map((branch) => branch.message[branch.message.length - 2].chatId)
        expect(tails).toEqual(['c4', 'p4', 'p8'])

        // hand-built (older build/import shape): a later attach with the lower stamp, and two leaves with the same attach and stamp
        const odd = chatOf([msg('m1', 'user'), msg('m2'), msg('m3', 'user')], {
            alt: [
                { m: msg('late', 'user'), p: 'm3', a: 1 },
                { m: msg('early', 'user'), p: 'm1', a: 9 },
                { m: msg('tieB', 'user'), p: 'm2', a: 4 },
                { m: msg('tieA', 'user'), p: 'm2', a: 4 },
            ],
        })
        const order = branchesOf(odd).map((branch) => branch.message[branch.message.length - 2].chatId)
        expect(order).toEqual(['early', 'tieB', 'tieA', 'late'])
    })

    test('B12 guard: an id-less parent gets an id on its copy only, and an id the marker cannot carry reads as empty', () => {
        const chat = branchedChat()
        delete chat.id
        const input = characterOf([chat])
        const expanded = expandBranchChats(input, () => true, counter())
        const parent = expanded.character.chats[0]
        const branch = expanded.character.chats[1]
        expect(chat.id).toBeUndefined()
        expect(parent).not.toBe(chat)
        expect(parent.id).toBe('id-1')
        expect(partsOf(branch)[2]).toBe(parent.id)
        expect(markerOf(branch).data).toBe(branchMarkerData(parent.id, 'Chat', 'c2'))

        const hostile = branchedChat({ id: 'a:b' })
        hostile.message[1].chatId = 'x{y'
        for (const record of hostile.alt ?? []) {
            if (record.p === 'c2') {
                record.p = 'x{y'
            }
        }
        const parts = partsOf(branchesOf(hostile)[0])
        expect(parts).toHaveLength(6)
        expect(parts[2]).toBe('')
        expect(parts[3]).toBe('Chat')
        expect(parts[4]).toBe('')
    })

    test('B13 guard: the same input and ids give the same chats', () => {
        const run = () => JSON.stringify(expandBranchChats(characterOf([nestedChat()]), () => true, counter()).character)
        expect(run()).toBe(run())
    })

    test('B14 guard: the input is not changed and the result has a new chat list', () => {
        const input = characterOf([nestedChat()])
        const before = JSON.stringify(input)
        const expanded = expandBranchChats(input, () => true, counter())
        expect(JSON.stringify(input)).toBe(before)
        expect(expanded.character.chats).not.toBe(input.chats)
        expect(input.chats).toHaveLength(1)
    })

    test('B15 guard: nothing to add returns the input itself', () => {
        const rerolls = chatOf([msg('u1', 'user'), msg('c2')])
        expect(detachTail(rerolls, 1)).toBe(true)
        rerolls.message.push(msg('c2b'))
        const cases = [
            characterOf([chatOf([msg('u1', 'user')])]),
            characterOf([chatOf([msg('u1', 'user')], { alt: [] })]),
            characterOf([rerolls]),
            characterOf([branchedChat()]),
        ]
        cases.forEach((input, n) => {
            const expanded = expandBranchChats(input, () => n !== 3, counter())
            expect(expanded.character).toBe(input)
            expect(expanded.parents).toEqual([])
        })
    })
})

describe('the estimate and the labels', () => {
    function actualBytes(input: ReturnType<typeof characterOf>): number {
        const stripped = withoutForkOnlyChatData(expandBranchChats(input, () => true, counter()).character)
        return stripped.chats.slice(input.chats.length).reduce((sum, chat) => sum + new TextEncoder().encode(JSON.stringify(chat)).length, 0)
    }

    test('B16 guard: the counts equal the builder and the bytes follow the encoded chats, parked and trimmed', () => {
        const big = (id: string, role: 'user' | 'char') => msg(id, role, `${id} ${'x'.repeat(20000)}`)
        const parked = chatOf([big('u1', 'user'), big('c2', 'char'), big('u3', 'user'), big('c4', 'char')])
        setLive(parked, 1, 'u3')
        expect(detachTail(parked, 2)).toBe(true)
        parked.message.push(big('u5', 'user'), big('c6', 'char'))
        const trimmed = chatOf([big('u1', 'user'), big('c2', 'char'), big('u3', 'user'), big('c4', 'char')], { note: 'n'.repeat(3000) })
        expect(detachTail(trimmed, 2)).toBe(true)
        trimmed.message.push(big('u5', 'user'))
        // hand-built (older build/import shape): a record that carries no parked state
        delete trimmed.alt?.[0].mem
        trimmed.hypaV3Data = { summaries: [{ text: 't'.repeat(2000), chatMemos: ['u1'], isImportant: false }] }
        for (const chat of [parked, trimmed]) {
            const input = characterOf([chat])
            const summary = branchSummaryOf(chat)
            expect(summary?.chats).toBe(branchesOf(chat).length)
            const actual = actualBytes(input)
            expect(summary?.bytes).not.toBeNull()
            expect(Math.abs((summary?.bytes ?? 0) - actual)).toBeLessThanOrEqual(actual * 0.02 + 256 * (summary?.chats ?? 0))
            expect(summary?.bytes ?? 0).toBeGreaterThan(60000)
        }
    })

    test('B16b guard: the bytes count the parked memory when it is as large as the messages', () => {
        const chat = chatOf([msg('u1', 'user'), msg('c2'), msg('u3', 'user'), msg('c4')])
        chat.hypaV3Data = { summaries: [{ text: 'h'.repeat(30000), chatMemos: ['u1'], isImportant: false }] }
        expect(detachTail(chat, 2)).toBe(true)
        chat.message.push(msg('u5', 'user'))
        const summary = branchSummaryOf(chat)
        const actual = actualBytes(characterOf([chat]))
        expect(actual).toBeGreaterThan(30000)
        expect(summary?.bytes).not.toBeNull()
        expect(Math.abs((summary?.bytes ?? 0) - actual)).toBeLessThanOrEqual(actual * 0.02 + 256 * (summary?.chats ?? 0))
    })

    test('B17 guard: an old marker in the prefix stays as it is and the new marker is last', () => {
        const oldMarker: Message = {
            role: 'char',
            data: '{{specialcomment::branchedfrom::' + 'old-parent' + '::' + 'Old Name' + '::' + 'm0' + '::}}',
            isComment: true,
            disabled: true,
            chatId: 'old-marker',
        }
        const chat = chatOf([msg('m0', 'user'), oldMarker, msg('u3', 'user'), msg('c4')])
        expect(detachTail(chat, 2)).toBe(true)
        chat.message.push(msg('u5', 'user'))
        const branch = branchesOf(chat)[0]
        expect(branch.message[1]).toBe(oldMarker)
        expect(markerOf(branch).data).toBe(branchMarkerData('chat-1', 'Chat', 'old-marker'))
        const plain = chatOf([msg('m0', 'user'), oldMarker])
        const input = characterOf([plain])
        expect(expandBranchChats(input, () => true, counter()).character).toBe(input)
    })

    test('B18 guard: a group chat keeps who says each message, and the marker is a character message', () => {
        const saying = (m: Message, who: string): Message => ({ ...m, saying: who })
        const chat = chatOf([msg('u1', 'user'), saying(msg('c2'), 'charA'), msg('u3', 'user'), saying(msg('c4'), 'charB')])
        expect(detachTail(chat, 2)).toBe(true)
        chat.message.push(msg('u5', 'user'))
        const branch = branchesOf(chat)[0]
        expect(branch.message.map((m) => m.saying)).toEqual([undefined, 'charA', undefined, 'charB', undefined])
        expect(markerOf(branch).role).toBe('char')
    })

    test('B20 guard: the summary names the fork-only kinds the kept branch chats carry', () => {
        const kindsOf = (chat: Chat): ForkOnlyKind[] => branchSummaryOf(chat)?.kinds ?? []

        const interrupted = chatOf([msg('u1', 'user'), msg('c2'), msg('u3', 'user'), { ...msg('c4'), interrupted: true }])
        expect(detachTail(interrupted, 2)).toBe(true)
        interrupted.message.push(msg('u5', 'user'))
        expect(kindsOf(interrupted)).toEqual(['interruptedNote'])

        const coverage = chatOf([msg('u1', 'user'), msg('c2'), msg('u3', 'user'), msg('c4')])
        coverage.supaMemoryData = 'u3\nsummary'
        coverage.supaMemoryCoveredId = 'u3'
        expect(detachTail(coverage, 2)).toBe(true)
        coverage.message.push(msg('u5', 'user'))
        expect(coverage.supaMemoryData).toBeUndefined()
        expect(kindsOf(coverage)).toEqual(['memoryCoverage'])

        const scoped = (flag: boolean): Chat => {
            const chat = chatOf([msg('u1', 'user'), msg('c2'), msg('u3', 'user'), msg('c4')], { useLocallySetGlobalVariables: flag, scopedMemory: true })
            expect(detachTail(chat, 2)).toBe(true)
            chat.message.push(msg('u5', 'user'))
            delete chat.scopedMemory
            return chat
        }
        expect(kindsOf(scoped(true))).toEqual(['chatMemory'])
        expect(kindsOf(scoped(false))).toEqual([])

        const leftOut = chatOf([msg('u1', 'user'), msg('c2'), msg('u3', 'user'), msg('c4')])
        expect(detachTail(leftOut, 2)).toBe(true)
        leftOut.message.push(msg('u5', 'user'), { ...msg('c6'), interrupted: true })
        expect(detachTail(leftOut, 3)).toBe(true)
        leftOut.message.push(msg('c6b'))
        expect(branchSummaryOf(leftOut)).toMatchObject({ chats: 1, omitted: 1, kinds: [] })

        const offBranch = chatOf([msg('u1', 'user'), msg('c2'), msg('u3', 'user'), msg('c4')])
        offBranch.supaMemoryData = 'zzz\nsummary'
        offBranch.supaMemoryCoveredId = 'zzz'
        expect(detachTail(offBranch, 2)).toBe(true)
        offBranch.message.push(msg('u5', 'user'))
        expect(kindsOf(offBranch)).toEqual([])
    })

    test('B21 guard: the label of an expanded chat names what the alternatives become, in the table order', () => {
        const chat = branchedChat({ hideNames: true })
        const kept = chat.alt?.find((record) => record.m.chatId === 'c4')
        if (kept === undefined) {
            throw new Error('the fixture holds no c4 record')
        }
        kept.m.interrupted = true
        const character = characterOf([chat])
        const plain = forkOnlyChatLabels(character)
        const labels = branchChatLabels(character, () => true)
        expect(labels).toHaveLength(1)
        expect(labels[0].key).toBe(plain[0].key)
        expect(labels[0].text).toBe(plain[0].text)
        expect(labels[0].kinds).toEqual(['alternatives', 'interruptedNote', 'hideNames'])
        expect(labels[0].branches).toEqual({ chats: 1, omitted: 1, bytes: expect.any(Number) })
        expect(branchChatLabels(character, () => false)).toEqual(plain)

        const unreadable = chatOf([msg('u1', 'user')])
        Object.assign(unreadable, { alt: 'text' })
        const labelOfUnreadable = branchChatLabels(characterOf([unreadable]), () => true)
        expect(labelOfUnreadable).toHaveLength(1)
        expect('branches' in labelOfUnreadable[0]).toBe(false)
    })

    test('B24 guard: a message that cannot be measured makes the size unknown and nothing else', () => {
        const chat = branchedChat()
        Object.assign(chat.message[0], { big: 10n })
        const summary = branchSummaryOf(chat)
        expect(summary).toMatchObject({ chats: 1, omitted: 1, bytes: null })
        expect(() => expandBranchChats(characterOf([chat]), () => true, counter())).not.toThrow()
    })
})

function mulberry32(seed: number): () => number {
    let state = seed
    return () => {
        state = (state + 0x6d2b79f5) | 0
        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** A tree made only by the engine's own operations, with interrupted marks and parked or live memory in the way. */
function randomChat(seed: number, steps: number): Chat {
    const random = mulberry32(seed)
    let n = 0
    const next = (): Message => {
        n++
        return msg(`m${n}`, random() < 0.5 ? 'user' : 'char')
    }
    const chat = chatOf([next(), next()], { useLocallySetGlobalVariables: random() < 0.5 })
    const anyId = (): string => {
        const all = [...chat.message, ...(chat.alt ?? []).map((record) => record.m)]
        return all[Math.floor(random() * all.length)].chatId ?? 'none'
    }
    for (let step = 0; step < steps; step++) {
        const roll = random()
        if (roll < 0.25) {
            const mark = chat.message[Math.floor(random() * chat.message.length)]
            if (mark !== undefined && mark.role === 'char') {
                mark.interrupted = true
            }
        } else if (roll < 0.45) {
            const covered = anyId()
            setLive(chat, step, covered)
            chat.scopedMemory = random() < 0.5
            if (random() < 0.3) {
                delete chat.scopedMemory
            }
        } else if (roll < 0.65 || chat.message.length === 0) {
            chat.message.push(next(), ...(random() < 0.5 ? [next()] : []))
        } else if (roll < 0.85) {
            detachTail(chat, Math.floor(random() * chat.message.length))
        } else {
            const i = Math.floor(random() * (chat.message.length + 1))
            const others = siblingsAt(chat, i).filter((m) => m.chatId !== chat.message[i]?.chatId)
            if (others.length > 0) {
                switchTo(chat, i, others[Math.floor(random() * others.length)].chatId ?? '')
            }
        }
    }
    return chat
}

interface OracleLeaf {
    attachAt: number
    chain: string[]
}

/** Every leaf with its chain of ids, walking each record's parent by the owner rule without `altTreeIndex`. */
function oracleLeaves(chat: Chat): OracleLeaf[] {
    const alt = chat.alt ?? []
    const owner = (p: string | null): { attachAt: number, parent: number | null } => {
        if (p === null) {
            return { attachAt: -1, parent: null }
        }
        const onPath = chat.message.findIndex((m) => m.chatId === p)
        if (onPath !== -1) {
            return { attachAt: onPath, parent: null }
        }
        const holder = alt.findIndex((r) => r.m.chatId === p)
        return holder === -1 ? { attachAt: -1, parent: null } : { attachAt: -2, parent: holder }
    }
    const followed = new Set<number>()
    for (const record of alt) {
        const o = owner(record.p)
        if (o.parent !== null) {
            followed.add(o.parent)
        }
    }
    const leaves: OracleLeaf[] = []
    alt.forEach((_record, leaf) => {
        if (followed.has(leaf)) {
            return
        }
        const chain: string[] = []
        let at = leaf
        let attachAt = -1
        for (;;) {
            chain.unshift(alt[at].m.chatId ?? '')
            const o = owner(alt[at].p)
            if (o.parent === null) {
                attachAt = o.attachAt
                break
            }
            at = o.parent
        }
        leaves.push({ attachAt, chain })
    })
    return leaves
}

function hasKey(value: unknown, key: string): boolean {
    if (Array.isArray(value)) {
        return value.some((item) => hasKey(item, key))
    }
    if (typeof value === 'object' && value !== null) {
        return Object.entries(value).some(([k, item]) => k === key || hasKey(item, key))
    }
    return false
}

describe('over engine-made trees', () => {
    test('B19 guard: one chat per leaf holding a user message, each prefix + parent-linked chain + marker, no alt or mem', () => {
        let built = 0
        for (let seed = 1; seed <= 60; seed++) {
            const chat = randomChat(seed, 25)
            const roles = new Map<string, string>([...(chat.alt ?? []).map((r): [string, string] => [r.m.chatId ?? '', r.m.role])])
            const expected = oracleLeaves(chat)
                .filter((leaf) => leaf.chain.some((id) => roles.get(id) === 'user'))
                .map((leaf) => [...chat.message.slice(0, leaf.attachAt + 1).map((m) => m.chatId), ...leaf.chain].join(','))
                .sort()
            const branches = branchesOf(chat)
            const actual = branches.map((branch) => branch.message.slice(0, -1).map((m) => m.chatId).join(',')).sort()
            expect(actual, `seed ${seed}`).toEqual(expected)
            expect(branchSummaryOf(chat)?.chats, `seed ${seed}`).toBe(expected.length)
            for (const branch of branches) {
                expect(hasKey(branch, 'alt') || hasKey(branch, 'mem'), `seed ${seed}`).toBe(false)
                expect(markerOf(branch).disabled, `seed ${seed}`).toBe(true)
            }
            built += branches.length
        }
        expect(built).toBeGreaterThan(40)
    })

    test('B23 guard: the kinds the summary names are exactly what the written chats carry beyond the parent', () => {
        let withKinds = 0
        for (let seed = 1; seed <= 60; seed++) {
            const chat = randomChat(seed, 30)
            const summary = branchSummaryOf(chat)
            const builtKinds = new Set(branchesOf(chat).flatMap((branch) => forkOnlyKindsOf(branch)))
            const parentKinds = new Set(forkOnlyKindsOf(chat))
            const allowed = new Set([...parentKinds, ...(summary?.kinds ?? [])])
            allowed.delete('alternatives')
            for (const kind of builtKinds) {
                expect(allowed.has(kind), `seed ${seed} ${kind}`).toBe(true)
            }
            for (const kind of summary?.kinds ?? []) {
                expect(builtKinds.has(kind), `seed ${seed} ${kind}`).toBe(true)
            }

            const character = characterOf([chat])
            const early = branchChatLabels(character, () => true).map((label) => [label.key, label.kinds])
            const late = lateBranchLabels(character, expandBranchChats(character, () => true, counter())).map((label) => [label.key, label.kinds])
            expect(late, `seed ${seed}`).toEqual(early)
            withKinds += (summary?.kinds.length ?? 0) > 0 ? 1 : 0
        }
        expect(withKinds).toBeGreaterThan(5)
    })
})
