// @vitest-environment happy-dom

/**
 * The chat-only scope switch of the new shell (CHORE-564, stage B): accessible name and notes, the copy on / discard
 * off flips through the engine, and an Undo row that is a polite status, keeps focus on the switch and writes only
 * through the live owner and chat. Guards by construction: the component is new. Mounts the REAL component with the
 * real engine; the stores are plain objects and the save marks are a spy.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat } from 'src/ts/storage/database.svelte'

const state = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    mark: vi.fn(),
    moduleToggles: '',
}))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: {
        get db() { return state.db },
    },
    selIdState: { selId: -1 },
    selectedCharID: writable(0),
}))
vi.mock('src/ts/storage/database.svelte', () => ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => undefined,
    getCurrentChat: () => undefined,
    getDatabase: () => state.db,
}))
vi.mock('src/ts/globalApi.svelte', () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}))
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: state.mark }))
vi.mock('src/ts/process/modules', () => ({ getModuleToggles: () => state.moduleToggles }))
// Each label key renders as its own name, so the assertions compare keys rather than English text.
vi.mock('src/lang', () => ({ language: new Proxy({}, { get: (_target, key) => String(key) }) }))

import ToggleScopeSwitch from './ToggleScopeSwitch.svelte'

type Owner = { chaId: string, name: string, chats: Chat[], customModuleToggle?: string, coldstorage?: string }

let mounted: ReturnType<typeof mount> | undefined
let owner: Owner
let chat: Chat

const makeChat = (extra: Partial<Chat> = {}): Chat => ({
    message: [{ role: 'user', data: 'hi', chatId: 'm1' }],
    note: '',
    name: 'chat',
    localLore: [],
    id: 'chat-1',
    ...extra,
}) as Chat

function mountSwitch(undoMs?: number): void {
    mounted = mount(ToggleScopeSwitch, { target: document.body, props: { owner, chat, undoMs } })
    flushSync()
}

const input = () => document.querySelector('input[role="switch"]') as HTMLInputElement
const undoButton = () => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'chatShellToggleScopeUndo')
const status = () => document.querySelector('[role="status"]')
const flip = () => { input().focus(); input().click(); flushSync() }

beforeEach(() => {
    vi.useFakeTimers()
    state.mark.mockReset()
    state.moduleToggles = ''
    chat = makeChat()
    owner = { chaId: 'char-a', name: 'A', chats: [chat] }
    state.db = {
        characters: [owner],
        globalChatVariables: { toggle_a: '1', toggle_b: 'text' },
        customPromptTemplateToggle: 'a=Alpha\nb=Beta=text',
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    if (mounted) unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('markup', () => {
    // B-T7
    test('a labelled switch with the off note as its description; the chat\'s flag decides the state', () => {
        mountSwitch()

        expect(input().checked).toBe(false)
        expect(document.body.textContent).toContain('chatShellToggleScopeLabel')
        const described = document.getElementById(input().getAttribute('aria-describedby')!)
        expect(described?.textContent).toContain('chatShellToggleScopeNoteOff')
    })

    test('a scoped chat shows checked, the on note and the inherit hint', () => {
        chat.useLocallySetGlobalVariables = true
        mountSwitch()

        expect(input().checked).toBe(true)
        const described = document.getElementById(input().getAttribute('aria-describedby')!)
        expect(described?.textContent).toContain('chatShellToggleScopeNoteOn')
        expect(described?.textContent).toContain('chatShellToggleScopeInherit')
    })

    test('no Undo row and no status text before a flip', () => {
        mountSwitch()
        expect(undoButton()).toBeUndefined()
        expect(status()?.textContent?.trim() ?? '').toBe('')
    })
})

describe('flipping', () => {
    test('on copies the shared values for the listed keys and marks the owner', () => {
        state.db.globalChatVariables = { toggle_a: '1', toggle_b: 'text', toggle_unlisted: 'z' }
        mountSwitch()

        flip()

        expect(chat.useLocallySetGlobalVariables).toBe(true)
        expect(chat.GLGlobalVariables).toEqual({ toggle_a: '1', toggle_b: 'text' })
        expect(state.mark).toHaveBeenCalledWith('char-a')
        expect(input().checked).toBe(true)
        expect(document.activeElement).toBe(input())
    })

    test('off discards, announces it in a polite status with an Undo button, and keeps focus on the switch', () => {
        chat.useLocallySetGlobalVariables = true
        chat.GLGlobalVariables = { toggle_a: '0' }
        mountSwitch()

        flip()

        expect(chat.GLGlobalVariables).toEqual({})
        expect(chat.useLocallySetGlobalVariables).toBe(false)
        expect(status()).not.toBeNull()
        expect(status()?.textContent).toContain('chatShellTogglesDiscarded')
        expect(undoButton()).toBeDefined()
        expect(document.activeElement).toBe(input())
    })

    test('the Undo row lasts undoMs and then goes away', () => {
        chat.useLocallySetGlobalVariables = true
        mountSwitch(6000)
        flip()

        vi.advanceTimersByTime(5_999)
        flushSync()
        expect(undoButton()).toBeDefined()

        vi.advanceTimersByTime(1)
        flushSync()
        expect(undoButton()).toBeUndefined()
        expect(status()?.textContent?.trim() ?? '').toBe('')
    })

    test('the Undo row defaults to 6 s', () => {
        chat.useLocallySetGlobalVariables = true
        mountSwitch()
        flip()

        vi.advanceTimersByTime(5_999)
        flushSync()
        expect(undoButton()).toBeDefined()
        vi.advanceTimersByTime(1)
        flushSync()
        expect(undoButton()).toBeUndefined()
    })
})

describe('Undo', () => {
    const scopedThenDiscarded = () => {
        chat.useLocallySetGlobalVariables = true
        chat.GLGlobalVariables = { toggle_a: '0', toggle_b: 'mine' }
        mountSwitch()
        flip()
        state.mark.mockClear()
    }

    test('restores the values, checks the switch again and returns focus to it', () => {
        scopedThenDiscarded()
        undoButton()!.focus()

        undoButton()!.click()
        flushSync()

        expect(chat.useLocallySetGlobalVariables).toBe(true)
        expect(chat.GLGlobalVariables).toEqual({ toggle_a: '0', toggle_b: 'mine' })
        expect(input().checked).toBe(true)
        expect(state.mark).toHaveBeenCalledWith('char-a')
        expect(undoButton()).toBeUndefined()
        expect(document.activeElement).toBe(input())
    })

    // B-T8d (guard by construction): the chat object was replaced in the owner after the flip
    test('after the chat was replaced in its owner it restores the live chat through restoreChatScope', () => {
        scopedThenDiscarded()
        const live = structuredClone(owner.chats[0])
        owner.chats[0] = live

        undoButton()!.click()
        flushSync()

        expect(live.useLocallySetGlobalVariables).toBe(true)
        expect(live.GLGlobalVariables).toEqual({ toggle_a: '0', toggle_b: 'mine' })
        expect(chat.GLGlobalVariables).toEqual({})
        expect(state.mark).toHaveBeenCalledTimes(1)
        expect(state.mark).toHaveBeenCalledWith('char-a')
    })

    test('after the owner became a stub it is refused with a notice for the rest of the row time', () => {
        scopedThenDiscarded()
        owner.coldstorage = 'entry-1'

        undoButton()!.click()
        flushSync()

        expect(status()?.textContent).toContain('chatShellToggleScopeUndoRefused')
        expect(undoButton()).toBeUndefined()
        expect(chat.GLGlobalVariables).toEqual({})
        expect(state.mark).not.toHaveBeenCalled()

        vi.advanceTimersByTime(6_000)
        flushSync()
        expect(status()?.textContent?.trim() ?? '').toBe('')
    })

    test('after the chat changed it is refused and nothing is written', () => {
        scopedThenDiscarded()
        chat.message.push({ role: 'char', data: 'later', chatId: 'm2' })

        undoButton()!.click()
        flushSync()

        expect(status()?.textContent).toContain('chatShellToggleScopeUndoRefused')
        expect(chat.GLGlobalVariables).toEqual({})
        expect(state.mark).not.toHaveBeenCalled()
    })

    test('turning the switch on again drops the row, so a late Undo cannot overwrite the new copy', () => {
        scopedThenDiscarded()

        flip()

        expect(undoButton()).toBeUndefined()
        expect(chat.GLGlobalVariables).toEqual({ toggle_a: '1', toggle_b: 'text' })
    })
})
