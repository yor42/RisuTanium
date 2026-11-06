// @vitest-environment happy-dom

/**
 * The old sidebar's "Local Toggles" switch with the real engine (CHORE-564, PQ1a): turning it on copies the shared
 * toggle values into the chat, turning it off discards the chat's own values and shows a 10 s Undo row, and the Undo
 * writes through the live owner and chat or is refused with a notice. Mounts the REAL `Toggles.svelte` with the real
 * `chatVar`, `chatToggleScope`, `liveCharacterWrite` and `util`; the stores are plain objects, the save marks are a
 * spy, and the module toggle source, language, icon and custom sidebar are stubbed because they take no part.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { character } from 'src/ts/storage/database.svelte'

const state = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    selected: undefined as undefined | import('svelte/store').Writable<number>,
    mark: vi.fn(),
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable: make } = await import('svelte/store')
    state.selected = make(0)
    return {
        DBState: {
            get db() { return state.db },
        },
        selIdState: { selId: -1 },
        MobileGUI: { subscribe: (run: (value: boolean) => void) => { run(false); return () => {} } },
        selectedCharID: state.selected,
        ReloadGUIPointer: make(0),
    }
})
vi.mock('src/ts/storage/database.svelte', async () => {
    const { get } = await import('svelte/store')
    const current = () => (state.db.characters as { chats: unknown[], chatPage: number }[])[get(state.selected!)]
    return {
        appVer: '1234.5.67',
        getCurrentCharacter: () => current(),
        getCurrentChat: () => current()?.chats[current().chatPage],
        getDatabase: () => state.db,
    }
})
vi.mock('src/ts/globalApi.svelte', () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}))
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: state.mark }))
vi.mock('src/ts/process/modules', () => ({ getModuleToggles: () => '' }))
vi.mock('@lucide/svelte', () => ({ PinIcon: () => {} }))
// Each label key renders as its own name, so the assertions compare keys rather than English text.
vi.mock('src/lang', () => ({ language: new Proxy({}, { get: (_target, key) => String(key) }) }))
vi.mock('./CustomSidebar.svelte', () => ({ default: () => {} }))

import Toggles from './Toggles.svelte'

type Chat = {
    message: { role: string, data: string, chatId?: string }[]
    id?: string
    useLocallySetGlobalVariables?: boolean
    GLGlobalVariables?: Record<string, string>
    alt?: unknown[]
}
type Owner = { chaId: string, name: string, chatPage: number, chats: Chat[], coldstorage?: string, customModuleToggle?: string }

const makeOwner = (chaId: string, chat: Partial<Chat> = {}): Owner => ({
    chaId,
    name: chaId,
    chatPage: 0,
    chats: [{ id: `${chaId}-chat`, message: [{ role: 'user', data: 'hi', chatId: 'm1' }], ...chat }],
})

let mounted: ReturnType<typeof mount> | undefined
let owners: Owner[]
let chatA: Chat

const characters = () => state.db.characters as Owner[]

function mountSidebar(): void {
    const chara = characters()[0] as unknown as character
    mounted = mount(Toggles, { target: document.body, props: { chara } })
    flushSync()
}

const scopeInput = () => {
    const label = Array.from(document.querySelectorAll('label')).find(l => l.textContent?.includes('localToggles'))
    return label?.querySelector('input') as HTMLInputElement
}
const flip = () => { scopeInput().click(); flushSync() }
const undoButton = () => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'chatShellToggleScopeUndo')
const statusText = () => Array.from(document.querySelectorAll('[role="status"]')).map(s => s.textContent?.trim()).join('|')

beforeEach(() => {
    vi.useFakeTimers()
    state.mark.mockReset()
    owners = [makeOwner('char-a'), makeOwner('char-b'), makeOwner('char-c')]
    chatA = owners[0].chats[0]
    state.db = {
        characters: owners,
        globalChatVariables: { toggle_a: '1', toggle_b: 'text', toggle_unlisted: 'z' },
        customPromptTemplateToggle: 'a=Alpha\nb=Beta=text',
        supaModelType: 'none',
        hypaV3: false,
        hanuraiEnable: false,
        hypaMemory: false,
        hypav2: false,
    }
    state.selected!.set(0)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    if (mounted) unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('turning the switch on', () => {
    // regression reproducer B-T1 (PQ1a): base 307076a32 only flips the flag, so no value is copied
    test('copies the current shared toggle values into the chat', () => {
        mountSidebar()

        flip()

        expect(chatA.useLocallySetGlobalVariables).toBe(true)
        expect(chatA.GLGlobalVariables?.toggle_a).toBe('1')
        expect(chatA.GLGlobalVariables?.toggle_b).toBe('text')
    })

    // regression reproducer B-T2: base keeps a stale earlier copy
    test('replaces a stale earlier copy and copies only keys the toggle text lists', () => {
        chatA.GLGlobalVariables = { toggle_a: '0', toggle_x: 'old' }
        mountSidebar()

        flip()

        expect(chatA.GLGlobalVariables).toEqual({ toggle_a: '1', toggle_b: 'text' })
    })

    // B-T7+ (guard by construction): the engine marks the owner
    test('marks the owner for save', () => {
        mountSidebar()

        flip()

        expect(state.mark).toHaveBeenCalledWith('char-a')
    })
})

test('guard: the flip acts on the selected character\'s chat and marks that character', () => {
    state.selected!.set(1)
    mounted = mount(Toggles, { target: document.body, props: { chara: characters()[1] as unknown as character } })
    flushSync()

    flip()

    expect(owners[1].chats[0].GLGlobalVariables).toEqual({ toggle_a: '1', toggle_b: 'text' })
    expect(chatA.GLGlobalVariables).toBeUndefined()
    expect(state.mark).toHaveBeenCalledWith('char-b')
    expect(state.mark).not.toHaveBeenCalledWith('char-a')
})

describe('turning the switch off', () => {
    beforeEach(() => {
        chatA.useLocallySetGlobalVariables = true
        chatA.GLGlobalVariables = { toggle_a: '0', toggle_b: 'mine' }
    })

    // regression reproducer B-T3: base leaves the values in the chat
    test('discards the chat values and clears the flag', () => {
        mountSidebar()

        flip()

        expect(chatA.useLocallySetGlobalVariables).toBe(false)
        expect(chatA.GLGlobalVariables).toEqual({})
        expect(state.mark).toHaveBeenCalledWith('char-a')
    })

    // regression reproducer B-T8 (PQ1a): base has no Undo row
    test('shows an Undo row, and Undo after a selection change restores the chat of the owner it was taken from', () => {
        mountSidebar()
        flip()
        expect(statusText()).toContain('chatShellTogglesDiscarded')
        state.selected!.set(1)
        flushSync()
        state.mark.mockClear()

        const undo = undoButton()
        expect(undo).toBeDefined()
        undo!.click()
        flushSync()

        expect(chatA.useLocallySetGlobalVariables).toBe(true)
        expect(chatA.GLGlobalVariables).toEqual({ toggle_a: '0', toggle_b: 'mine' })
        expect(state.mark).toHaveBeenCalledWith('char-a')
        expect(undoButton()).toBeUndefined()
        expect(owners[1].chats[0].GLGlobalVariables).toBeUndefined()
    })

    // B-T8b (guard by construction): the cold restore copy replaces the element and the selection moves twice
    test('Undo after the owner was replaced by a clone restores the clone\'s chat and leaves the captured object alone', () => {
        mountSidebar()
        flip()
        const clone = structuredClone(owners[0])
        characters()[0] = clone
        state.selected!.set(1)
        state.selected!.set(2)
        flushSync()
        state.mark.mockClear()

        undoButton()!.click()
        flushSync()

        expect(clone.chats[0].useLocallySetGlobalVariables).toBe(true)
        expect(clone.chats[0].GLGlobalVariables).toEqual({ toggle_a: '0', toggle_b: 'mine' })
        expect(chatA.GLGlobalVariables).toEqual({})
        expect(state.mark).toHaveBeenCalledTimes(1)
        expect(state.mark).toHaveBeenCalledWith('char-a')
    })

    // B-T8c (guard by construction): the put-back swap leaves a stub in the slot
    test('Undo after the owner became a stub is refused with a notice, writes nothing and marks nothing', () => {
        mountSidebar()
        flip()
        const stub: Owner = { chaId: 'char-a', name: 'stub', chatPage: 0, coldstorage: 'entry-1', chats: [{ id: 'placeholder', message: [] }] }
        characters()[0] = stub
        const stubBefore = JSON.stringify(stub)
        state.selected!.set(1)
        flushSync()
        state.mark.mockClear()

        undoButton()!.click()
        flushSync()

        expect(statusText()).toContain('chatShellToggleScopeUndoRefused')
        expect(undoButton()).toBeUndefined()
        expect(state.mark).not.toHaveBeenCalled()
        expect(JSON.stringify(stub)).toBe(stubBefore)
        expect(chatA.GLGlobalVariables).toEqual({})
    })

    test('Undo is refused when the chat changed meanwhile', () => {
        mountSidebar()
        flip()
        chatA.message.push({ role: 'user', data: 'later', chatId: 'm2' })
        state.mark.mockClear()

        undoButton()!.click()
        flushSync()

        expect(statusText()).toContain('chatShellToggleScopeUndoRefused')
        expect(chatA.GLGlobalVariables).toEqual({})
        expect(state.mark).not.toHaveBeenCalled()
    })

    test('guard: the Undo row goes away after 10 s', () => {
        mountSidebar()
        flip()

        vi.advanceTimersByTime(9_999)
        flushSync()
        expect(undoButton()).toBeDefined()

        vi.advanceTimersByTime(1)
        flushSync()
        expect(undoButton()).toBeUndefined()
        expect(statusText()).not.toContain('chatShellTogglesDiscarded')
    })

    test('guard: turning the switch on again drops the Undo row', () => {
        mountSidebar()
        flip()
        expect(undoButton()).toBeDefined()

        flip()

        expect(undoButton()).toBeUndefined()
        expect(chatA.useLocallySetGlobalVariables).toBe(true)
        expect(chatA.GLGlobalVariables).toEqual({ toggle_a: '1', toggle_b: 'text' })
    })
})

// CHORE-565 (stage C): the jailbreak and memory rows show and write the chat-only value while the scope is on.
describe('the jailbreak and memory rows follow the chat-only scope', () => {
    const rowInput = (key: string) => {
        const label = Array.from(document.querySelectorAll('label')).find(l => l.textContent?.includes(key))
        return label?.querySelector('input') as HTMLInputElement
    }
    const flipRow = (key: string) => { rowInput(key).click(); flushSync() }
    const ownerA = () => owners[0] as Owner & { supaMemory?: boolean }

    beforeEach(() => {
        state.db.jailbreak = 'JB text'
        state.db.jailbreakToggle = false
        state.db.supaModelType = 'subModel'
        ownerA().supaMemory = false
    })

    // C-T12 regression reproducer: the base binds the row to the global value
    test('with the scope on, the jailbreak row writes the chat value and leaves the global one', () => {
        chatA.useLocallySetGlobalVariables = true
        mountSidebar()

        flipRow('jailbreakToggle')

        expect((chatA as Chat & { scopedJailbreak?: boolean }).scopedJailbreak).toBe(true)
        expect(state.db.jailbreakToggle).toBe(false)
        expect(state.mark).toHaveBeenCalledWith('char-a')
    })

    test('with the scope on, the memory row writes the chat value and leaves the owner\'s', () => {
        chatA.useLocallySetGlobalVariables = true
        mountSidebar()

        flipRow('ToggleSuperMemory')

        expect((chatA as Chat & { scopedMemory?: boolean }).scopedMemory).toBe(true)
        expect(ownerA().supaMemory).toBe(false)
        expect(state.mark).toHaveBeenCalledWith('char-a')
    })

    // C-T12 regression reproducer: the base shows the global value
    test('with the scope on, the rows show the chat values', () => {
        Object.assign(chatA, { useLocallySetGlobalVariables: true, scopedJailbreak: true, scopedMemory: true })
        mountSidebar()

        expect(rowInput('jailbreakToggle').checked).toBe(true)
        expect(rowInput('ToggleSuperMemory').checked).toBe(true)
    })

    test('guard: with the scope off, the rows write the global and the owner values and show them, whatever the chat holds', () => {
        Object.assign(chatA, { scopedJailbreak: true, scopedMemory: true })
        mountSidebar()
        expect(rowInput('jailbreakToggle').checked).toBe(false)
        expect(rowInput('ToggleSuperMemory').checked).toBe(false)

        flipRow('jailbreakToggle')
        flipRow('ToggleSuperMemory')

        expect(state.db.jailbreakToggle).toBe(true)
        expect(ownerA().supaMemory).toBe(true)
        expect((chatA as Chat & { scopedJailbreak?: boolean }).scopedJailbreak).toBe(true)
    })

    // C-T16 (sidebar side): the row acts on the owner's chat, not on another character's
    test('the row writes the chat of its own character', () => {
        Object.assign(owners[1].chats[0], { useLocallySetGlobalVariables: true })
        state.selected!.set(1)
        mounted = mount(Toggles, { target: document.body, props: { chara: characters()[1] as unknown as character } })
        flushSync()

        flipRow('jailbreakToggle')

        expect((owners[1].chats[0] as Chat & { scopedJailbreak?: boolean }).scopedJailbreak).toBe(true)
        expect((chatA as Chat & { scopedJailbreak?: boolean }).scopedJailbreak).toBeUndefined()
        expect(state.mark).toHaveBeenCalledWith('char-b')
    })

    test('turning the scope on copies the effective jailbreak and memory values into the chat', () => {
        state.db.jailbreakToggle = true
        ownerA().supaMemory = false
        mountSidebar()

        flip()

        expect((chatA as Chat & { scopedJailbreak?: boolean }).scopedJailbreak).toBe(true)
        expect((chatA as Chat & { scopedMemory?: boolean }).scopedMemory).toBe(false)
    })

    test('turning the scope off discards the chat values and an Undo brings them back', () => {
        Object.assign(chatA, { useLocallySetGlobalVariables: true, GLGlobalVariables: {}, scopedJailbreak: true, scopedMemory: true })
        mountSidebar()

        flip()
        expect('scopedJailbreak' in chatA).toBe(false)
        expect('scopedMemory' in chatA).toBe(false)

        undoButton()!.click()
        flushSync()

        expect((chatA as Chat & { scopedJailbreak?: boolean }).scopedJailbreak).toBe(true)
        expect((chatA as Chat & { scopedMemory?: boolean }).scopedMemory).toBe(true)
    })
})
