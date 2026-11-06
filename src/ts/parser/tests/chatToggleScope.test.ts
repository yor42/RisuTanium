import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat } from 'src/ts/storage/database.svelte'

/**
 * The chat-only toggle scope engine (CHORE-564, stage B). Every case below is a guard by construction: the module is
 * new, so the base cannot run it; its red proof is the mutants in the stage report. The real `liveCharacterWrite`
 * and the real `chatVar` run; the save marks are a spy, and the stores are plain objects.
 */

//#region module mocks

const h = vi.hoisted(() => ({
    mark: vi.fn(),
    moduleToggles: '',
    db: {
        characters: [] as unknown[],
        globalChatVariables: {} as Record<string, string>,
        customPromptTemplateToggle: '',
        jailbreakToggle: false,
    },
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => undefined,
    getCurrentChat: () => undefined,
    getDatabase: () => ({}),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: h.mark,
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

vi.mock(import('src/ts/process/modules'), () => ({
    getModuleToggles: () => h.moduleToggles,
}) as unknown as typeof import('src/ts/process/modules'))

//#endregion

import {
    chatToggleValue,
    currentScopeKeys,
    disableChatScope,
    effectiveJailbreak,
    effectiveMemory,
    enableChatScope,
    restoreChatScope,
    revertChatJailbreak,
    revertChatMemory,
    toggleScopeKeys,
    useSharedToggleValue,
    writeChatJailbreak,
    writeChatMemory,
    writeChatToggle,
} from 'src/ts/parser/chatToggleScope'
import { getGlobalChatVar } from 'src/ts/parser/chatVar.svelte'
import { createRunSubject, originOf } from 'src/ts/process/chatOrigin'
import { detachTail, switchTo } from 'src/ts/process/chatTree'

type Owner = { chaId: string, name: string, chats: Chat[], customModuleToggle?: string, coldstorage?: string, supaMemory?: boolean }

const makeChat = (extra: Partial<Chat> = {}): Chat => ({
    message: [{ role: 'user', data: 'hi', chatId: 'm1' }, { role: 'char', data: 'yo', chatId: 'm2' }],
    note: '',
    name: 'chat',
    localLore: [],
    id: 'chat-1',
    ...extra,
}) as Chat

let owner: Owner
let chat: Chat

beforeEach(() => {
    h.mark.mockReset()
    h.moduleToggles = ''
    h.db.customPromptTemplateToggle = ''
    h.db.globalChatVariables = {}
    h.db.jailbreakToggle = false
    chat = makeChat()
    owner = { chaId: 'char-a', name: 'A', chats: [chat] }
    h.db.characters = [owner]
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('toggleScopeKeys', () => {
    // B-T5: guard by construction (toggle text)
    test('every value row gives its toggle_ key; groups flatten and captions, dividers and group markers are skipped', () => {
        const text = [
            'a=Alpha',
            'b=Beta=select=x,y',
            'g=Group=group',
            'c=Gamma=text',
            'g=Group=groupEnd',
            'cap=A caption=caption',
            'div=Rule=divider',
            'f=Field=textarea',
        ].join('\n')

        expect(toggleScopeKeys(text)).toEqual(['toggle_a', 'toggle_b', 'toggle_c', 'toggle_f'])
    })

    test('a key listed twice is listed once, and empty text gives nothing', () => {
        expect(toggleScopeKeys('a=Alpha\nb=Beta\na=Again')).toEqual(['toggle_a', 'toggle_b'])
        expect(toggleScopeKeys('')).toEqual([])
    })
})

describe('currentScopeKeys', () => {
    test('the prompt template, the modules and the owner are one key set', () => {
        h.db.customPromptTemplateToggle = 'p=Prompt'
        h.moduleToggles = '\nm=Module\n'
        owner.customModuleToggle = 'c=Character'

        expect(currentScopeKeys(owner)).toEqual(['toggle_p', 'toggle_m', 'toggle_c'])
    })

    test('an owner without a toggle text of its own contributes nothing', () => {
        h.db.customPromptTemplateToggle = 'p=Prompt'

        expect(currentScopeKeys(owner)).toEqual(['toggle_p'])
    })
})

describe('enableChatScope', () => {
    // B-T4 (S1)
    test('copies exactly the keys the shared map defines, replaces any stale map, sets the flag, and marks the owner', () => {
        chat.GLGlobalVariables = { toggle_a: '0', toggle_x: 'stale' }
        h.db.globalChatVariables = { toggle_a: '1', toggle_b: '2', toggle_other: 'z' }

        const landed = enableChatScope({ chaId: 'char-a', chat }, ['toggle_a', 'toggle_b', 'toggle_c'], h.db.globalChatVariables)

        expect(landed).toBe(true)
        expect(chat.useLocallySetGlobalVariables).toBe(true)
        expect(chat.GLGlobalVariables).toEqual({ toggle_a: '1', toggle_b: '2' })
        expect(h.mark).toHaveBeenCalledTimes(1)
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('the copy is a new object: a later shared edit does not reach the chat', () => {
        h.db.globalChatVariables = { toggle_a: '1' }
        enableChatScope({ chaId: 'char-a', chat }, ['toggle_a'], h.db.globalChatVariables)

        h.db.globalChatVariables.toggle_a = '0'

        expect(chat.GLGlobalVariables).toEqual({ toggle_a: '1' })
    })

    test('a scope that is already on is left alone and not marked', () => {
        chat.useLocallySetGlobalVariables = true
        chat.GLGlobalVariables = { toggle_a: 'mine' }

        expect(enableChatScope({ chaId: 'char-a', chat }, ['toggle_a'], { toggle_a: '1' })).toBe(false)

        expect(chat.GLGlobalVariables).toEqual({ toggle_a: 'mine' })
        expect(h.mark).not.toHaveBeenCalled()
    })
})

describe('disableChatScope and restoreChatScope', () => {
    const scoped = () => {
        chat.useLocallySetGlobalVariables = true
        chat.GLGlobalVariables = { toggle_a: '1', toggle_b: 'text' }
    }

    // B-T4 (S2)
    test('disable discards the chat values, clears the flag, marks the owner, and returns the snapshot', () => {
        scoped()

        const snap = disableChatScope({ chaId: 'char-a', chat })

        expect(snap).not.toBeNull()
        expect(chat.useLocallySetGlobalVariables).toBe(false)
        expect(chat.GLGlobalVariables).toEqual({})
        expect(h.mark).toHaveBeenCalledTimes(1)
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('disable on a chat whose scope is off does nothing and marks nothing', () => {
        expect(disableChatScope({ chaId: 'char-a', chat })).toBeNull()
        expect(h.mark).not.toHaveBeenCalled()
    })

    test('restore brings the values and the flag back and marks the owner', () => {
        scoped()
        const snap = disableChatScope({ chaId: 'char-a', chat })!
        h.mark.mockClear()

        expect(restoreChatScope({ chaId: 'char-a', chat }, snap)).toBe(true)

        expect(chat.useLocallySetGlobalVariables).toBe(true)
        expect(chat.GLGlobalVariables).toEqual({ toggle_a: '1', toggle_b: 'text' })
        expect(h.mark).toHaveBeenCalledTimes(1)
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('a restored map is a copy: editing it does not change the snapshot, so a second restore is exact', () => {
        scoped()
        const snap = disableChatScope({ chaId: 'char-a', chat })!
        restoreChatScope({ chaId: 'char-a', chat }, snap)
        chat.GLGlobalVariables!.toggle_a = 'edited'
        chat.useLocallySetGlobalVariables = false

        expect(restoreChatScope({ chaId: 'char-a', chat }, snap)).toBe(true)
        expect(chat.GLGlobalVariables).toEqual({ toggle_a: '1', toggle_b: 'text' })
    })

    test('a chat that held the flag without a map restores to no map', () => {
        chat.useLocallySetGlobalVariables = true
        const snap = disableChatScope({ chaId: 'char-a', chat })!

        expect(restoreChatScope({ chaId: 'char-a', chat }, snap)).toBe(true)

        expect(chat.GLGlobalVariables).toBeUndefined()
    })

    describe('refusals change nothing and mark nothing', () => {
        const refused = (mutate: () => void) => {
            scoped()
            const snap = disableChatScope({ chaId: 'char-a', chat })!
            h.mark.mockClear()
            mutate()
            const before = JSON.stringify(h.db.characters)

            expect(restoreChatScope({ chaId: 'char-a', chat }, snap)).toBe(false)

            expect(JSON.stringify(h.db.characters)).toBe(before)
            expect(h.mark).not.toHaveBeenCalled()
        }

        test('the flag is on again', () => refused(() => { chat.useLocallySetGlobalVariables = true }))
        test('a message was added', () => refused(() => { chat.message.push({ role: 'user', data: 'more', chatId: 'm3' }) }))
        test('the last message was replaced', () => refused(() => { chat.message[1] = { role: 'char', data: 'other', chatId: 'm9' } }))
        test('an alternative was added', () => refused(() => {
            chat.alt = [{ m: { role: 'char', data: 'x', chatId: 'a1' }, p: 'm1', a: 1 }]
        }))
        test('the chat is no longer in its owner', () => refused(() => { owner.chats = [] }))
        test('the owner was removed', () => refused(() => { h.db.characters = [] }))
        test('the owner became a stub', () => refused(() => { owner.coldstorage = 'entry-1' }))
    })

    // B-T8b: the owner element is replaced by a clone (the cold restore copy)
    test('an owner replaced by a clone is restored through the chat id; the captured object is untouched', () => {
        scoped()
        const snap = disableChatScope({ chaId: 'char-a', chat })!
        const clone = structuredClone(owner)
        h.db.characters = [clone]
        h.mark.mockClear()

        expect(restoreChatScope({ chaId: 'char-a', chat }, snap)).toBe(true)

        expect(clone.chats[0].useLocallySetGlobalVariables).toBe(true)
        expect(clone.chats[0].GLGlobalVariables).toEqual({ toggle_a: '1', toggle_b: 'text' })
        expect(chat.GLGlobalVariables).toEqual({})
        expect(h.mark).toHaveBeenCalledTimes(1)
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })
})

describe('chat toggle accessors act on the given chat, never the selection (S4)', () => {
    // B-T9
    test('scoped: the given chat changes; the shared map and every other chat do not; an id-less chat is fine', () => {
        const idless = makeChat({ useLocallySetGlobalVariables: true })
        delete idless.id
        const other = makeChat({ id: 'other' })
        owner.chats = [idless, other]
        h.db.globalChatVariables = { toggle_a: 'shared' }

        expect(() => writeChatToggle(owner, idless, 'toggle_a', '1')).not.toThrow()

        expect(idless.GLGlobalVariables).toEqual({ toggle_a: '1' })
        expect(h.db.globalChatVariables).toEqual({ toggle_a: 'shared' })
        expect(other.GLGlobalVariables).toBeUndefined()
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('unscoped: the shared value is written and the chat\'s local key is removed', () => {
        const duplicate = makeChat({ GLGlobalVariables: { toggle_a: 'local', toggle_b: 'keep' } })
        owner.chats = [duplicate, makeChat()]

        writeChatToggle(owner, duplicate, 'toggle_a', '1')

        expect(h.db.globalChatVariables).toEqual({ toggle_a: '1' })
        expect(duplicate.GLGlobalVariables).toEqual({ toggle_b: 'keep' })
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('useSharedToggleValue removes the chat\'s own key and marks the owner', () => {
        const target = makeChat({ useLocallySetGlobalVariables: true, GLGlobalVariables: { toggle_a: 'local', toggle_b: 'keep' } })

        useSharedToggleValue(owner, target, 'toggle_a')

        expect(target.GLGlobalVariables).toEqual({ toggle_b: 'keep' })
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    // X4: compatibility guard against getGlobalChatVar's rule through a real run subject
    test.each([
        { local: undefined, shared: undefined },
        { local: undefined, shared: '1' },
        { local: '0', shared: '1' },
        { local: 'null', shared: '1' },
        { local: '', shared: '1' },
        { local: 'text', shared: undefined },
        { local: 'null', shared: undefined },
    ])('chatToggleValue equals getGlobalChatVar for local $local and shared $shared', ({ local, shared }) => {
        const target = makeChat({ GLGlobalVariables: local === undefined ? undefined : { toggle_a: local } })
        owner.chats = [target]
        h.db.globalChatVariables = shared === undefined ? {} : { toggle_a: shared }
        const origin = originOf(owner as never, target)!
        const subject = createRunSubject(origin)

        expect(chatToggleValue(target, 'toggle_a')).toBe(getGlobalChatVar('toggle_a', subject))
    })
})

//#region CHORE-565: the chat-only jailbreak and memory switches (stage C). All guards by construction: the functions are new.

describe('effectiveJailbreak and effectiveMemory (I1)', () => {
    test.each([
        { flag: true, own: true, global: false, expected: true },
        { flag: true, own: false, global: true, expected: false },
        { flag: true, own: undefined, global: true, expected: true },
        { flag: true, own: undefined, global: false, expected: false },
        { flag: false, own: true, global: false, expected: false },
        { flag: false, own: false, global: true, expected: true },
        { flag: undefined, own: false, global: true, expected: true },
        { flag: true, own: 'true', global: false, expected: false },
        { flag: true, own: null, global: true, expected: true },
    ])('jailbreak: flag $flag, own $own, global $global gives $expected', ({ flag, own, global, expected }) => {
        h.db.jailbreakToggle = global
        const target = makeChat({ useLocallySetGlobalVariables: flag, scopedJailbreak: own } as Partial<Chat>)

        expect(effectiveJailbreak(target)).toBe(expected)
        expect(effectiveJailbreak(target, { jailbreakToggle: global })).toBe(expected)
    })

    // C-T6b (X-I9): a gone subject gives no chat; the global value decides and nothing throws
    test('a missing chat reads the database value, and a given database is the one read', () => {
        h.db.jailbreakToggle = true
        expect(effectiveJailbreak(undefined)).toBe(true)
        expect(effectiveJailbreak(undefined, { jailbreakToggle: false })).toBe(false)
    })

    test.each([
        { flag: true, own: true, owner: false, expected: true },
        { flag: true, own: false, owner: true, expected: false },
        { flag: true, own: undefined, owner: true, expected: true },
        { flag: true, own: undefined, owner: undefined, expected: false },
        { flag: false, own: true, owner: false, expected: false },
        { flag: false, own: false, owner: true, expected: true },
        { flag: true, own: 1, owner: false, expected: false },
    ])('memory: flag $flag, own $own, owner $owner gives $expected', ({ flag, own, owner: ownerValue, expected }) => {
        const target = makeChat({ useLocallySetGlobalVariables: flag, scopedMemory: own } as Partial<Chat>)

        expect(effectiveMemory({ supaMemory: ownerValue }, target)).toBe(expected)
    })

    test('memory with no chat reads the owner', () => {
        expect(effectiveMemory({ supaMemory: true }, undefined)).toBe(true)
        expect(effectiveMemory({ supaMemory: false }, undefined)).toBe(false)
    })
})

describe('the scope-aware setters (S5, C-T16)', () => {
    test('scoped jailbreak: the given chat changes; the global value and the selection do not; the owner is marked', () => {
        h.db.jailbreakToggle = false
        const other = makeChat({ id: 'other' })
        const target = makeChat({ useLocallySetGlobalVariables: true })
        owner.chats = [other, target]

        writeChatJailbreak(owner, target, true)

        expect(target.scopedJailbreak).toBe(true)
        expect(h.db.jailbreakToggle).toBe(false)
        expect(other.scopedJailbreak).toBeUndefined()
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('unscoped jailbreak: the global value is written and the chat is left alone', () => {
        const target = makeChat({ scopedJailbreak: false } as Partial<Chat>)

        writeChatJailbreak(owner, target, true)

        expect(h.db.jailbreakToggle).toBe(true)
        expect(target.scopedJailbreak).toBe(false)
    })

    test('scoped memory writes the chat; unscoped memory writes the owner; both mark the owner', () => {
        const scoped = makeChat({ useLocallySetGlobalVariables: true })
        owner.supaMemory = false

        writeChatMemory(owner, scoped, true)
        expect(scoped.scopedMemory).toBe(true)
        expect(owner.supaMemory).toBe(false)

        const plain = makeChat()
        writeChatMemory(owner, plain, true)
        expect(owner.supaMemory).toBe(true)
        expect(plain.scopedMemory).toBeUndefined()
        expect(h.mark).toHaveBeenCalledTimes(2)
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('a revert deletes the chat\'s own value so the shared one shows, and marks the owner; nothing to revert marks nothing', () => {
        const target = makeChat({ useLocallySetGlobalVariables: true, scopedJailbreak: true, scopedMemory: false } as Partial<Chat>)
        h.db.jailbreakToggle = false

        revertChatJailbreak(owner, target)
        revertChatMemory(owner, target)

        expect('scopedJailbreak' in target).toBe(false)
        expect('scopedMemory' in target).toBe(false)
        expect(effectiveJailbreak(target)).toBe(false)
        expect(h.mark).toHaveBeenCalledTimes(2)

        h.mark.mockClear()
        revertChatJailbreak(owner, target)
        expect(h.mark).not.toHaveBeenCalled()
    })
})

describe('enable and disable carry the chat-only jailbreak and memory switches (I3)', () => {
    const parkedMemory = (target: Chat): unknown[] => (target.alt ?? []).map((record) => record.mem?.scopedMemory)
    const withParked = (value: unknown): Chat => makeChat({
        alt: [
            { m: { role: 'char', data: 'x', chatId: 'a1' }, p: 'm1', a: 1, mem: { scopedMemory: value } },
            { m: { role: 'char', data: 'y', chatId: 'a2' }, p: 'm1', a: 2 },
            { m: { role: 'char', data: 'z', chatId: 'a3' }, p: 'm1', a: 3, mem: { supaMemoryData: null } },
        ],
    } as Partial<Chat>)

    test('enable copies the effective jailbreak and memory values into the chat', () => {
        enableChatScope({ chaId: 'char-a', chat }, [], {}, { jailbreak: true, memory: false })

        expect(chat.scopedJailbreak).toBe(true)
        expect(chat.scopedMemory).toBe(false)
        expect(chat.useLocallySetGlobalVariables).toBe(true)
    })

    test('enable without effective values copies none', () => {
        enableChatScope({ chaId: 'char-a', chat }, [], {})

        expect('scopedJailbreak' in chat).toBe(false)
        expect('scopedMemory' in chat).toBe(false)
    })

    test('enable without effective values removes a stale own switch, so it cannot go live later', () => {
        chat.scopedJailbreak = true
        chat.scopedMemory = false

        enableChatScope({ chaId: 'char-a', chat }, [], {})

        expect('scopedJailbreak' in chat).toBe(false)
        expect('scopedMemory' in chat).toBe(false)
    })

    test('enable removes a stale parked value from every readable alternative; records without one are untouched', () => {
        chat = withParked(true)
        const before = JSON.stringify(chat.alt)

        enableChatScope({ chaId: 'char-a', chat }, [], {}, { jailbreak: false, memory: true })

        expect(parkedMemory(chat)).toEqual([undefined, undefined, undefined])
        expect(chat.alt![0].mem).toEqual({})
        expect(chat.alt![2].mem).toEqual({ supaMemoryData: null })
        expect(JSON.stringify(chat.alt)).not.toBe(before)
    })

    // C-T8 ext. (MC22): the walk deletes the key; a null would delete the copied value on the next sibling switch
    test('the copied memory value survives a sibling switch and the return', () => {
        chat = makeChat({ message: [{ role: 'user', data: 'r', chatId: 'r' }, { role: 'char', data: 'a', chatId: 'a' }] })
        chat.alt = [{ m: { role: 'char', data: 's', chatId: 's' }, p: 'r', a: 1, mem: { scopedMemory: true } }]

        enableChatScope({ chaId: 'char-a', chat }, [], {}, { jailbreak: false, memory: false })
        expect(chat.scopedMemory).toBe(false)

        expect(switchTo(chat, 1, 's')).toBe(true)
        expect(chat.scopedMemory).toBe(false)
        expect(switchTo(chat, 1, 'a')).toBe(true)
        expect(chat.scopedMemory).toBe(false)
    })

    test('disable leaves no live and no parked value and an Undo brings both back', () => {
        chat = withParked(false)
        owner.chats = [chat]
        chat.useLocallySetGlobalVariables = true
        chat.GLGlobalVariables = { toggle_a: '1' }
        chat.scopedJailbreak = true
        chat.scopedMemory = true

        const snap = disableChatScope({ chaId: 'char-a', chat })!

        expect('scopedJailbreak' in chat).toBe(false)
        expect('scopedMemory' in chat).toBe(false)
        expect(parkedMemory(chat)).toEqual([undefined, undefined, undefined])
        expect(effectiveMemory({ supaMemory: false }, chat)).toBe(false)

        h.mark.mockClear()
        expect(restoreChatScope({ chaId: 'char-a', chat }, snap)).toBe(true)

        expect(chat.scopedJailbreak).toBe(true)
        expect(chat.scopedMemory).toBe(true)
        expect(parkedMemory(chat)).toEqual([false, undefined, undefined])
        expect(h.mark).toHaveBeenCalledTimes(1)
    })

    // A sibling switch and the return reorder `alt` while message count, last chatId and alt count stay the same
    test('an Undo after a branch round trip puts each parked value back on its own branch', () => {
        chat = makeChat({ message: [{ role: 'user', data: 'r', chatId: 'r' }, { role: 'char', data: 'x', chatId: 'x' }] })
        chat.alt = [
            { m: { role: 'char', data: 's1', chatId: 's1' }, p: 'r', a: 1, mem: { scopedMemory: false } },
            { m: { role: 'char', data: 's2', chatId: 's2' }, p: 'r', a: 2, mem: { scopedMemory: true } },
        ]
        owner.chats = [chat]
        chat.useLocallySetGlobalVariables = true
        chat.scopedMemory = true
        const snap = disableChatScope({ chaId: 'char-a', chat })!

        expect(switchTo(chat, 1, 's1')).toBe(true)
        expect(switchTo(chat, 1, 'x')).toBe(true)
        expect(chat.alt!.map((record) => record.m.chatId)).toEqual(['s2', 's1'])

        expect(restoreChatScope({ chaId: 'char-a', chat }, snap)).toBe(true)

        const parkedById = (id: string): unknown => chat.alt!.find((record) => record.m.chatId === id)?.mem?.scopedMemory
        expect(parkedById('s1')).toBe(false)
        expect(parkedById('s2')).toBe(true)
    })

    // The restore finds the parked values by the chatId of their record, not by object: the clone has new record objects
    test('an Undo on an owner replaced by a clone restores the parked values on the clone\'s records', () => {
        chat = withParked(false)
        owner.chats = [chat]
        chat.useLocallySetGlobalVariables = true
        chat.scopedMemory = true
        const snap = disableChatScope({ chaId: 'char-a', chat })!
        const clone = structuredClone(owner)
        h.db.characters = [clone]

        expect(restoreChatScope({ chaId: 'char-a', chat }, snap)).toBe(true)

        expect(clone.chats[0].scopedMemory).toBe(true)
        expect(parkedMemory(clone.chats[0])).toEqual([false, undefined, undefined])
        expect(parkedMemory(chat)).toEqual([undefined, undefined, undefined])
    })

    test('a chat that never held the values restores to a chat that holds none', () => {
        chat.useLocallySetGlobalVariables = true
        const snap = disableChatScope({ chaId: 'char-a', chat })!

        restoreChatScope({ chaId: 'char-a', chat }, snap)

        expect('scopedJailbreak' in chat).toBe(false)
        expect('scopedMemory' in chat).toBe(false)
    })

    // C-T17 (X-I6, X-I7): an `alt` the tree cannot read is never interpreted or written
    test('an unreadable alt is left as it is while the chat fields still apply', () => {
        const unreadable = [null, { m: { role: 'char', data: 'x', chatId: 'a1' }, p: 'm1', a: 1, mem: { scopedMemory: true } }]
        chat = makeChat({ alt: unreadable } as unknown as Partial<Chat>)
        const clone = structuredClone(unreadable)

        expect(() => enableChatScope({ chaId: 'char-a', chat }, [], {}, { jailbreak: true, memory: true })).not.toThrow()
        expect(chat.scopedJailbreak).toBe(true)
        expect(chat.alt).toEqual(clone)

        const snap = disableChatScope({ chaId: 'char-a', chat })
        expect(snap).not.toBeNull()
        expect('scopedMemory' in chat).toBe(false)
        expect(chat.alt).toEqual(clone)
    })

    test('a branch switch after a disable keeps no live value from the departed branch', () => {
        chat = makeChat({ message: [{ role: 'user', data: 'r', chatId: 'r' }, { role: 'char', data: 'a', chatId: 'a' }] })
        chat.useLocallySetGlobalVariables = true
        chat.scopedMemory = true
        detachTail(chat, 1)
        expect(chat.alt![0].mem?.scopedMemory).toBe(true)

        disableChatScope({ chaId: 'char-a', chat })

        expect(chat.alt![0].mem && 'scopedMemory' in chat.alt![0].mem).toBe(false)
        expect(switchTo(chat, 1, 'a')).toBe(true)
        expect('scopedMemory' in chat).toBe(false)
    })
})

//#endregion
