/**
 * `chatOpen.ts`: the one place the new shell's lists open a chat, and the
 * owner lookups behind it.
 *
 * Invariants exercised here:
 * - `openChatOf` opens by identity in the SELECTED owner only; any other
 *   owner, or a chat that is not in the owner's list, calls nothing.
 * - `selectedOwner()` follows the reactive selection mirror, so a derivation
 *   over it re-runs on a switch with no database write.
 * - `selectedLiveOwner` accepts only the first holder of a `chaId` that is
 *   also the selected, unarchived slot.
 * - `keepChatPageOf` moves `chatPage` for any owner and never opens or bumps.
 */
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { Database, Chat } from '../storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((v) => { selIdState.selId = v })
    return {
        DBState: state,
        selectedCharID,
        selIdState,
    } as unknown as typeof import('src/ts/stores.svelte')
})

const changeChatToMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { DBState, selIdState } = await import('src/ts/stores.svelte')
    return {
        changeChatTo: (i: number) => {
            changeChatToMock(i)
            DBState.db.characters[selIdState.selId].chatPage = i
        },
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

import { DBState, selectedCharID, selIdState } from 'src/ts/stores.svelte'
import { selectedOwner, selectedLiveOwner, openChatOf, keepChatPageOf } from './chatOpen'

type Entry = Database['characters'][number]

function chat(name: string, id?: string): Chat {
    return { ...(id ? { id } : {}), name, message: [], note: '', localLore: [] } as unknown as Chat
}

function owner(chaId: string, chats: Chat[], extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: chaId, chats, chatPage: 0, ...extra } as unknown as Entry
}

function install(characters: Entry[]): Entry[] {
    DBState.db = { characters } as unknown as Database
    return DBState.db.characters
}

beforeEach(() => {
    changeChatToMock.mockReset()
    selectedCharID.set(-1)
})

describe('chatOpen', () => {
    test('diagnostic: the selection mirror follows the store', () => {
        selectedCharID.set(1)
        expect(selIdState.selId).toBe(1)
    })

    test('TO1: the selected owner opens the chat by identity, with one call', () => {
        const [a] = install([owner('a', [chat('one', 'dup'), chat('two', 'dup'), chat('three')])])
        selectedCharID.set(0)

        const outcome = openChatOf(a, a.chats[1])

        expect(outcome).toBe('opened')
        expect(changeChatToMock).toHaveBeenCalledTimes(1)
        expect(changeChatToMock).toHaveBeenCalledWith(1)
        expect(a.chatPage).toBe(1)
    })

    test('TO2: an owner that is not selected is refused, with no call and no chatPage change', () => {
        const [a, b] = install([owner('a', [chat('a1'), chat('a2')]), owner('b', [chat('b1'), chat('b2')], { chatPage: 1 })])
        selectedCharID.set(1)

        const outcome = openChatOf(a, a.chats[1])

        expect(outcome).toBe('not-selected')
        expect(changeChatToMock).not.toHaveBeenCalled()
        expect(a.chatPage).toBe(0)
        expect(b.chatPage).toBe(1)
    })

    test('TO3: a raw chat object that is not in the list is missing, a read-back chat opens', () => {
        const [a] = install([owner('a', [chat('one')])])
        selectedCharID.set(0)
        const raw = chat('inserted')
        a.chats.unshift(raw)

        expect(openChatOf(a, raw)).toBe('missing')
        expect(changeChatToMock).not.toHaveBeenCalled()

        expect(openChatOf(a, a.chats[0])).toBe('opened')
        expect(changeChatToMock).toHaveBeenCalledWith(0)
    })

    test('TO3: a chat of another owner is missing', () => {
        const [a, b] = install([owner('a', [chat('a1')]), owner('b', [chat('b1')])])
        selectedCharID.set(0)

        expect(openChatOf(a, b.chats[0])).toBe('missing')
        expect(changeChatToMock).not.toHaveBeenCalled()
    })

    test('TO4: only the first holder of a chaId that is also selected and warm is a live owner', () => {
        const characters = install([
            owner('shared', [chat('first')]),
            owner('shared', [chat('second')]),
            owner('cold', [chat('stub')], { coldstorage: 'unit-cold' }),
        ])

        selectedCharID.set(0)
        expect(selectedLiveOwner('shared')).toBe(characters[0])

        selectedCharID.set(1)
        expect(selectedLiveOwner('shared')).toBeNull()

        selectedCharID.set(2)
        expect(selectedLiveOwner('cold')).toBeNull()

        selectedCharID.set(0)
        expect(selectedLiveOwner('nobody')).toBeNull()
        expect(selectedLiveOwner('cold')).toBeNull()
    })

    test('TO5: keepChatPageOf writes the index for any owner without opening', () => {
        const [a, b] = install([owner('a', [chat('a1'), chat('a2'), chat('a3')]), owner('b', [chat('b1')])])
        selectedCharID.set(1)

        expect(keepChatPageOf(a, a.chats[2])).toBe(true)

        expect(a.chatPage).toBe(2)
        expect(b.chatPage).toBe(0)
        expect(changeChatToMock).not.toHaveBeenCalled()
    })

    test('TO5: keepChatPageOf with a chat that is not in the list changes nothing', () => {
        const [a] = install([owner('a', [chat('a1'), chat('a2')], { chatPage: 1 })])

        expect(keepChatPageOf(a, chat('stranger'))).toBe(false)

        expect(a.chatPage).toBe(1)
        expect(changeChatToMock).not.toHaveBeenCalled()
    })

    test('TO6: an effect over selectedOwner re-runs on a switch with no database write', () => {
        const [a, b] = install([owner('a', [chat('a1')]), owner('b', [chat('b1')])])
        selectedCharID.set(0)
        const seen: Array<Entry | undefined> = []
        const stop = $effect.root(() => {
            $effect(() => {
                seen.push(selectedOwner())
            })
        })
        flushSync()
        expect(seen.at(-1)).toBe(a)

        selectedCharID.set(1)
        flushSync()

        expect(seen.at(-1)).toBe(b)
        stop()
    })

    test('selectedOwner is undefined with no selection', () => {
        install([owner('a', [chat('a1')])])
        selectedCharID.set(-1)

        expect(selectedOwner()).toBeUndefined()
    })
})
