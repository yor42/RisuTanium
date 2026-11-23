/**
 * Specifies the origin module's in-flight registry: `isWriting` counts a
 * registration for its owner and, for a group, for its member too;
 * `hasWorkIn` and `stopWorkIn` match the owner only; `end()` is idempotent.
 */
import { flushSync } from 'svelte'
import { describe, test, expect, vi, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat } from '../../storage/database.svelte'

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as unknown as typeof import('../../stores.svelte')
})

import { DBState, selectedCharID } from '../../stores.svelte'
import { beginWork, isWriting, registerWork, hasWorkIn, stopWorkIn, stopAllReplyWork, hasAnyWork, isWorkInProgress, isGeneratingIn, generatingChatIdsIn, stopRepliesOf, isBusyIn, isShownChat, type WorkHandle } from '../chatOrigin'

type CharacterFixture = Database['characters'][number]

function makeChat(id: string | undefined): Chat {
    return { id, message: [], note: '', name: '', localLore: [] } as Chat
}

function makeCharacter(chaId: string, chats: Chat[]): CharacterFixture {
    return {
        chaId, name: 'Character', type: 'character', chatPage: 0, chats,
        firstMessage: '', desc: '', notes: '', chatFolders: [], viewScreen: 'none',
        bias: [], emotionImages: [], globalLore: [],
    } as unknown as CharacterFixture
}

function makeGroup(chaId: string, chats: Chat[], memberChaIds: string[]): CharacterFixture {
    return {
        chaId, type: 'group', image: '', firstMessage: '', chats, chatFolders: [], chatPage: 0,
        name: 'Group', viewScreen: 'multiple', characters: memberChaIds, characterTalks: [], characterActive: [],
        globalLore: [], autoMode: false, useCharacterLore: false, emotionImages: [], customscript: [],
    } as unknown as CharacterFixture
}

function installDb(characters: CharacterFixture[]): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: characters.map((c) => (c as { chaId: string }).chaId),
        characters,
    } as unknown as Database
}

// Specification: the origin module has no earlier version to fail against,
// so these tests pin its contract rather than prove a fix.
describe('the in-flight registry is counted, and end() is idempotent', () => {
    test('isWriting is true for the chat and the character while registered, and false after end', () => {
        installDb([makeCharacter('char-a', [makeChat('chat-a')])])
        const owner = DBState.db.characters[0]
        const handle = beginWork(owner, (owner as unknown as { chats: Chat[] }).chats[0])!

        expect(isWriting({ chaId: 'char-a' })).toBe(true)
        expect(isWriting({ chaId: 'char-a', chatId: 'chat-a' })).toBe(true)

        handle.end()

        expect(isWriting({ chaId: 'char-a' })).toBe(false)
        expect(isWriting({ chaId: 'char-a', chatId: 'chat-a' })).toBe(false)
    })

    test('calling end twice is harmless', () => {
        installDb([makeCharacter('char-a', [makeChat('chat-a')])])
        const owner = DBState.db.characters[0]
        const handle = beginWork(owner, (owner as unknown as { chats: Chat[] }).chats[0])!

        handle.end()
        expect(() => handle.end()).not.toThrow()
        expect(isWriting({ chaId: 'char-a' })).toBe(false)
    })

    test('two registrations need two ends', () => {
        installDb([makeCharacter('char-a', [makeChat('chat-a')])])
        const owner = DBState.db.characters[0]
        const chat = (owner as unknown as { chats: Chat[] }).chats[0]
        const handle1 = beginWork(owner, chat)!
        const handle2 = beginWork(owner, chat)!

        handle1.end()
        expect(isWriting({ chaId: 'char-a' })).toBe(true)

        handle2.end()
        expect(isWriting({ chaId: 'char-a' })).toBe(false)
    })

    test('a group registration counts for both the owner and the member', () => {
        installDb([
            makeGroup('group-1', [makeChat('chat-1')], ['member-a']),
            makeCharacter('member-a', [makeChat('member-a-chat')]),
        ])
        const owner = DBState.db.characters[0]
        const member = DBState.db.characters[1]
        const handle = beginWork(owner, (owner as unknown as { chats: Chat[] }).chats[0], member)!

        expect(isWriting({ chaId: 'group-1' })).toBe(true)
        expect(isWriting({ chaId: 'member-a' })).toBe(true)

        handle.end()

        expect(isWriting({ chaId: 'group-1' })).toBe(false)
        expect(isWriting({ chaId: 'member-a' })).toBe(false)
    })
})

// Specification: the origin module has no earlier version to fail against,
// so these tests pin its contract rather than prove a fix.
describe('a registration ended in a finally leaves nothing registered, even if the work throws', () => {
    test('work that throws, with end() in a finally, leaves nothing registered', () => {
        installDb([makeCharacter('char-a', [makeChat('chat-a')])])
        const owner = DBState.db.characters[0]

        expect(() => {
            const handle = beginWork(owner, (owner as unknown as { chats: Chat[] }).chats[0])!
            try {
                throw new Error('boom')
            } finally {
                handle.end()
            }
        }).toThrow('boom')

        expect(isWriting({ chaId: 'char-a' })).toBe(false)
    })
})

const openHandles: WorkHandle[] = []

/** Registers a unit of work that `afterEach` ends even when the test fails. */
function open(handle: WorkHandle): WorkHandle {
    openHandles.push(handle)
    return handle
}

afterEach(() => {
    for (const handle of openHandles.splice(0)) {
        handle.end()
    }
})

// Specification tests: they pin the contract of stopWorkIn.
describe('stopWorkIn calls each matching registration\'s stop once', () => {
    test('a stop runs once per matching registration, and a second stopWorkIn does nothing', () => {
        const stopOne = vi.fn()
        const stopTwo = vi.fn()
        const stopOther = vi.fn()
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, stopOne))
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, stopTwo))
        open(registerWork({ chaId: 'char-b', chatId: 'chat-b' }, stopOther))

        stopWorkIn({ chaId: 'char-a', chatId: 'chat-a' })
        stopWorkIn({ chaId: 'char-a', chatId: 'chat-a' })

        expect(stopOne).toHaveBeenCalledTimes(1)
        expect(stopTwo).toHaveBeenCalledTimes(1)
        expect(stopOther).not.toHaveBeenCalled()
    })

    test('a stop after end() does nothing', () => {
        const stop = vi.fn()
        const handle = open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, stop))

        handle.end()
        stopWorkIn({ chaId: 'char-a', chatId: 'chat-a' })

        expect(stop).not.toHaveBeenCalled()
    })

    test('a stop given to beginWork is the one stopWorkIn calls', () => {
        installDb([makeCharacter('char-a', [makeChat('chat-a')])])
        const owner = DBState.db.characters[0]
        const stop = vi.fn()
        open(beginWork(owner, (owner as unknown as { chats: Chat[] }).chats[0], undefined, stop)!)

        stopWorkIn({ chaId: 'char-a' })

        expect(stop).toHaveBeenCalledTimes(1)
    })

    test('a registration with no stop is left registered and stopWorkIn does not throw', () => {
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }))

        expect(() => stopWorkIn({ chaId: 'char-a' })).not.toThrow()
        expect(hasWorkIn({ chaId: 'char-a' })).toBe(true)
    })

    test('a stop that ends its own registration neither skips a sibling nor makes anything run twice', () => {
        const stopSibling = vi.fn()
        let selfHandle: WorkHandle | undefined
        const stopSelf = vi.fn(() => { selfHandle?.end() })
        selfHandle = open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, stopSelf))
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, stopSibling))
        const stopThird = vi.fn()
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, stopThird))

        stopWorkIn({ chaId: 'char-a', chatId: 'chat-a' })

        expect(stopSelf).toHaveBeenCalledTimes(1)
        expect(stopSibling).toHaveBeenCalledTimes(1)
        expect(stopThird).toHaveBeenCalledTimes(1)

        stopWorkIn({ chaId: 'char-a', chatId: 'chat-a' })

        expect(stopSelf).toHaveBeenCalledTimes(1)
        expect(stopSibling).toHaveBeenCalledTimes(1)
        expect(stopThird).toHaveBeenCalledTimes(1)
    })

    test('a stop that ends a later matching registration keeps that registration\'s stop from running', () => {
        const stopLater = vi.fn()
        let laterHandle: WorkHandle | undefined
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, () => { laterHandle?.end() }))
        laterHandle = open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, stopLater))

        stopWorkIn({ chaId: 'char-a' })

        expect(stopLater).not.toHaveBeenCalled()
    })

    test('a stop that throws is logged and does not keep the others from running', () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        const stopAfter = vi.fn()
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, () => { throw new Error('stop failed') }))
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, stopAfter))

        try {
            expect(() => stopWorkIn({ chaId: 'char-a' })).not.toThrow()
            expect(stopAfter).toHaveBeenCalledTimes(1)
            expect(logged).toHaveBeenCalledTimes(1)
        } finally {
            logged.mockRestore()
        }
    })
})

// Specification tests: they pin the contract of stopAllReplyWork (stop-all, MC-3309, MC-3743).
describe('stopAllReplyWork stops every reply and preview registration', () => {
    test('R3: reply and preview stops run once whatever the chat, work and ended registrations are left alone, and a repeat or a later stopWorkIn does nothing', () => {
        const stopA = vi.fn()
        const stopP = vi.fn()
        const stopW = vi.fn()
        const stopEnded = vi.fn()
        const stopS2 = vi.fn()
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, stopA, 'reply'))
        open(registerWork({ chaId: 'char-b', chatId: 'chat-b' }, stopP, 'preview'))
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, stopW))
        // A registration that ended before the stop is no longer registered, so its stop is never called.
        registerWork({ chaId: 'char-c', chatId: 'chat-c' }, stopEnded, 'reply').end()
        // S1 ends its own registration from inside its stop, and S2 is the very next registration after it: a loop
        // over the live registry instead of a snapshot would skip S2.
        let s1Handle: WorkHandle | undefined
        const stopS1 = vi.fn(() => { s1Handle?.end() })
        s1Handle = open(registerWork({ chaId: 'char-d', chatId: 'chat-d' }, stopS1, 'reply'))
        open(registerWork({ chaId: 'char-e', chatId: 'chat-e' }, stopS2, 'reply'))

        stopAllReplyWork()

        expect(stopA).toHaveBeenCalledTimes(1)
        expect(stopP).toHaveBeenCalledTimes(1)
        expect(stopS1).toHaveBeenCalledTimes(1)
        expect(stopS2).toHaveBeenCalledTimes(1)
        expect(stopW).not.toHaveBeenCalled()
        expect(stopEnded).not.toHaveBeenCalled()

        stopAllReplyWork()
        stopWorkIn({ chaId: 'char-a', chatId: 'chat-a' })

        expect(stopA).toHaveBeenCalledTimes(1)
        expect(stopP).toHaveBeenCalledTimes(1)
        expect(stopS1).toHaveBeenCalledTimes(1)
        expect(stopS2).toHaveBeenCalledTimes(1)
        expect(stopW).toHaveBeenCalledTimes(1)
    })

    test('R13: a stop that throws is logged and does not keep the next from running', () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        const stopAfter = vi.fn()
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, () => { throw new Error('stop failed') }, 'reply'))
        open(registerWork({ chaId: 'char-b', chatId: 'chat-b' }, stopAfter, 'reply'))

        try {
            expect(() => stopAllReplyWork()).not.toThrow()
            expect(stopAfter).toHaveBeenCalledTimes(1)
            expect(logged).toHaveBeenCalledTimes(1)
        } finally {
            logged.mockRestore()
        }
    })
})

// Specification tests: they pin the contract of the owner-only query hasWorkIn and of stopWorkIn's matching.
describe('hasWorkIn and stopWorkIn match by owner and chat, not by member', () => {
    test('a registration that only matches as a member is ignored by the owner-only query and by stopWorkIn', () => {
        installDb([
            makeGroup('group-1', [makeChat('chat-1')], ['member-a']),
            makeCharacter('member-a', [makeChat('member-a-chat')]),
        ])
        const owner = DBState.db.characters[0]
        const member = DBState.db.characters[1]
        const stop = vi.fn()
        open(beginWork(owner, (owner as unknown as { chats: Chat[] }).chats[0], member, stop)!)

        expect(isWriting({ chaId: 'member-a' })).toBe(true)
        expect(hasWorkIn({ chaId: 'member-a' })).toBe(false)
        expect(hasWorkIn({ chaId: 'member-a', chatId: 'chat-1' })).toBe(false)
        stopWorkIn({ chaId: 'member-a' })
        expect(stop).not.toHaveBeenCalled()

        expect(hasWorkIn({ chaId: 'group-1' })).toBe(true)
        expect(hasWorkIn({ chaId: 'group-1', chatId: 'chat-1' })).toBe(true)
        stopWorkIn({ chaId: 'group-1' })
        expect(stop).toHaveBeenCalledTimes(1)
    })

    test('a chat query ignores another chat of the same owner, and a character query matches both', () => {
        const stopA = vi.fn()
        const stopB = vi.fn()
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, stopA))
        open(registerWork({ chaId: 'char-a', chatId: 'chat-b' }, stopB))

        expect(hasWorkIn({ chaId: 'char-a', chatId: 'chat-a' })).toBe(true)
        expect(hasWorkIn({ chaId: 'char-a', chatId: 'chat-c' })).toBe(false)
        expect(hasWorkIn({ chaId: 'char-a' })).toBe(true)

        stopWorkIn({ chaId: 'char-a', chatId: 'chat-a' })
        expect(stopA).toHaveBeenCalledTimes(1)
        expect(stopB).not.toHaveBeenCalled()

        stopWorkIn({ chaId: 'char-a' })
        expect(stopA).toHaveBeenCalledTimes(1)
        expect(stopB).toHaveBeenCalledTimes(1)
    })

    test('a query for another character finds nothing', () => {
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, vi.fn()))

        expect(hasWorkIn({ chaId: 'char-b' })).toBe(false)
    })
})

// Specification tests (new API, no earlier version to fail against): a registration's kind decides
// which of the two reactive queries counts it, and the match is by owner.
describe('isGeneratingIn and isBusyIn count registrations by kind', () => {
    test('T9: a reply counts for both queries, a preview for isBusyIn only, other work for neither', () => {
        const reply = open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, undefined, 'reply'))
        expect(isGeneratingIn({ chaId: 'char-a', chatId: 'chat-a' })).toBe(true)
        expect(isBusyIn({ chaId: 'char-a', chatId: 'chat-a' })).toBe(true)
        reply.end()
        expect(isGeneratingIn({ chaId: 'char-a', chatId: 'chat-a' })).toBe(false)
        expect(isBusyIn({ chaId: 'char-a', chatId: 'chat-a' })).toBe(false)

        const preview = open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, undefined, 'preview'))
        expect(isGeneratingIn({ chaId: 'char-a', chatId: 'chat-a' })).toBe(false)
        expect(isBusyIn({ chaId: 'char-a', chatId: 'chat-a' })).toBe(true)
        preview.end()

        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }))
        expect(isGeneratingIn({ chaId: 'char-a', chatId: 'chat-a' })).toBe(false)
        expect(isBusyIn({ chaId: 'char-a', chatId: 'chat-a' })).toBe(false)
        expect(hasWorkIn({ chaId: 'char-a', chatId: 'chat-a' })).toBe(true)
    })

    test('T9: another chat of the same character, and another character, are not counted', () => {
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, undefined, 'reply'))

        expect(isGeneratingIn({ chaId: 'char-a' })).toBe(true)
        expect(isGeneratingIn({ chaId: 'char-a', chatId: 'chat-b' })).toBe(false)
        expect(isGeneratingIn({ chaId: 'char-b', chatId: 'chat-a' })).toBe(false)
    })

    test('generatingChatIdsIn lists the distinct chats of the owner that write a reply, and no preview or plain work', () => {
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, undefined, 'reply'))
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, undefined, 'reply'))
        open(registerWork({ chaId: 'char-a', chatId: 'chat-b' }, undefined, 'reply'))
        open(registerWork({ chaId: 'char-a', chatId: 'chat-p' }, undefined, 'preview'))
        open(registerWork({ chaId: 'char-a', chatId: 'chat-w' }))
        open(registerWork({ chaId: 'char-b', chatId: 'chat-z' }, undefined, 'reply'))

        expect(generatingChatIdsIn('char-a').sort()).toEqual(['chat-a', 'chat-b'])
        expect(generatingChatIdsIn('char-b')).toEqual(['chat-z'])
        expect(generatingChatIdsIn('char-none')).toEqual([])
    })

    test('stopRepliesOf stops each writing chat of the owner once, and no preview, plain work or other owner', () => {
        const stops = { a: vi.fn(), a2: vi.fn(), b: vi.fn(), preview: vi.fn(), plain: vi.fn(), other: vi.fn() }
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, stops.a, 'reply'))
        open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, stops.a2, 'reply'))
        open(registerWork({ chaId: 'char-a', chatId: 'chat-b' }, stops.b, 'reply'))
        open(registerWork({ chaId: 'char-a', chatId: 'chat-p' }, stops.preview, 'preview'))
        open(registerWork({ chaId: 'char-a', chatId: 'chat-w' }, stops.plain))
        open(registerWork({ chaId: 'char-b', chatId: 'chat-z' }, stops.other, 'reply'))

        stopRepliesOf('char-a')
        stopRepliesOf('char-a')

        expect([stops.a, stops.a2, stops.b].map((stop) => stop.mock.calls.length)).toEqual([1, 1, 1])
        expect([stops.preview, stops.plain, stops.other].map((stop) => stop.mock.calls.length)).toEqual([0, 0, 0])
    })

    test('generatingChatIdsIn lists a group turn for the group, never for the member it speaks as', () => {
        installDb([
            makeGroup('group-1', [makeChat('chat-1')], ['member-a']),
            makeCharacter('member-a', [makeChat('member-a-chat')]),
        ])
        const owner = DBState.db.characters[0]
        const member = DBState.db.characters[1]
        open(beginWork(owner, (owner as unknown as { chats: Chat[] }).chats[0], member, undefined, 'reply')!)

        expect(generatingChatIdsIn('group-1')).toEqual(['chat-1'])
        expect(generatingChatIdsIn('member-a')).toEqual([])
    })

    test('T9: a group turn counts for the group owner, never for the member it speaks as', () => {
        installDb([
            makeGroup('group-1', [makeChat('chat-1')], ['member-a']),
            makeCharacter('member-a', [makeChat('member-a-chat')]),
        ])
        const owner = DBState.db.characters[0]
        const member = DBState.db.characters[1]
        open(beginWork(owner, (owner as unknown as { chats: Chat[] }).chats[0], member, undefined, 'reply')!)

        expect(isGeneratingIn({ chaId: 'group-1', chatId: 'chat-1' })).toBe(true)
        expect(isGeneratingIn({ chaId: 'member-a' })).toBe(false)
        expect(isGeneratingIn({ chaId: 'member-a', chatId: 'member-a-chat' })).toBe(false)
    })

    test('T9: the kind survives a throw through end() in a finally, and a stop that ends the unit', () => {
        let handle: WorkHandle | undefined
        expect(() => {
            handle = registerWork({ chaId: 'char-a', chatId: 'chat-a' }, undefined, 'reply')
            try {
                expect(isGeneratingIn({ chaId: 'char-a' })).toBe(true)
                throw new Error('boom')
            } finally {
                handle.end()
            }
        }).toThrow('boom')
        expect(isGeneratingIn({ chaId: 'char-a' })).toBe(false)

        const stopped = open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, () => { stopped.end() }, 'reply'))
        stopWorkIn({ chaId: 'char-a', chatId: 'chat-a' })
        expect(isGeneratingIn({ chaId: 'char-a' })).toBe(false)
    })

    test('T9c: isBusyIn and isGeneratingIn re-run an effect when a unit begins and when it ends', () => {
        const seen: Array<[boolean, boolean]> = []
        const stopEffect = $effect.root(() => {
            $effect(() => {
                seen.push([isBusyIn({ chaId: 'char-a', chatId: 'chat-a' }), isGeneratingIn({ chaId: 'char-a', chatId: 'chat-a' })])
            })
        })
        flushSync()
        expect(seen).toEqual([[false, false]])

        const handle = open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }, undefined, 'reply'))
        flushSync()
        expect(seen.at(-1)).toEqual([true, true])

        handle.end()
        flushSync()
        expect(seen.at(-1)).toEqual([false, false])
        stopEffect()
    })

    test('T9c: a take, tree or command registration does not re-run the effect', () => {
        let runs = 0
        const stopEffect = $effect.root(() => {
            $effect(() => {
                void isBusyIn({ chaId: 'char-a', chatId: 'chat-a' })
                runs++
            })
        })
        flushSync()
        const before = runs

        const handle = open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }))
        flushSync()
        handle.end()
        flushSync()

        expect(runs).toBe(before)
        stopEffect()
    })

    test('T9b: a reply started inside an effect does not subscribe that effect to the version', () => {
        let runs = 0
        let handle: WorkHandle | undefined
        const stopEffect = $effect.root(() => {
            $effect(() => {
                runs++
                handle = registerWork({ chaId: 'char-a', chatId: 'chat-a' }, undefined, 'reply')
            })
        })
        flushSync()
        if (handle) open(handle)

        expect(runs).toBe(1)
        expect(isGeneratingIn({ chaId: 'char-a' })).toBe(true)
        stopEffect()
    })
})

describe('isShownChat names the chat on screen', () => {
    test('it is true for the selected character\'s open chat only', () => {
        installDb([
            makeCharacter('char-a', [makeChat('chat-a'), makeChat('chat-b')]),
            makeCharacter('char-b', [makeChat('chat-c')]),
        ])
        selectedCharID.set(0)

        expect(isShownChat({ chaId: 'char-a', chatId: 'chat-a' })).toBe(true)
        expect(isShownChat({ chaId: 'char-a', chatId: 'chat-b' })).toBe(false)
        expect(isShownChat({ chaId: 'char-b', chatId: 'chat-c' })).toBe(false)
        selectedCharID.set(-1)
        expect(isShownChat({ chaId: 'char-a', chatId: 'chat-a' })).toBe(false)
    })
})

describe('hasAnyWork and isWorkInProgress follow the registry', () => {
    test('both are true while any unit is registered, whatever chat it is bound to, and false once every unit has ended', () => {
        expect(hasAnyWork()).toBe(false)
        expect(isWorkInProgress()).toBe(false)

        const first = open(registerWork({ chaId: 'char-a', chatId: 'chat-a' }))
        const second = open(registerWork({ chaId: 'char-b', chatId: 'chat-b' }))
        expect(hasAnyWork()).toBe(true)
        expect(isWorkInProgress()).toBe(true)

        first.end()
        expect(hasAnyWork()).toBe(true)

        second.end()
        expect(hasAnyWork()).toBe(false)
        expect(isWorkInProgress()).toBe(false)
    })
})
