// @vitest-environment jsdom
/**
 * The This-chat sheet's deferred writers (S2, S3, X-I8, PQ9a): the author note autosaves 600 ms after the last key and
 * is flushed on blur, Escape, close and chat switch; the note and the rename land on the chat that was open, on the
 * live owner with a save mark, or are refused visibly (`chatShellEditNotSaved` through the error alert, no "Saved").
 * Guards by construction: the writers are new. Fixtures: the clone models the cold restore copy (same `chaId`, same chat
 * ids, new objects); the stub is the `residency.stubFor` shape (`coldstorage` set, one placeholder chat with a fresh id).
 */
import { flushSync, mount, unmount } from 'svelte'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    mark: vi.fn(),
    alertError: vi.fn(),
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return {
        DBState: { get db() { return h.db } },
        selIdState: { selId: 0 },
        selectedCharID: store(0),
        additionalChatMenu: [],
        settingsOpen: store(false),
        hypaV3ModalOpen: store(false),
    }
})
vi.mock('src/ts/storage/database.svelte', () => ({ appVer: '1', getCurrentCharacter: () => undefined, getCurrentChat: () => undefined, getDatabase: () => h.db }))
vi.mock('src/ts/globalApi.svelte', () => ({ aiWatermarkingLawApplies: () => false, getFileSrc: () => Promise.resolve(''), readImage: () => Promise.resolve(undefined) }))
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: (chaId: string) => h.mark(chaId) }))
vi.mock('../../ts/storage/characterSaveMarks', () => ({ markCharacterForSave: (chaId: string) => h.mark(chaId) }))
vi.mock('src/ts/process/modules', () => ({ getModuleToggles: () => '' }))
vi.mock('../../ts/characters', () => ({ removeChatConfirmed: vi.fn(), exportChat: vi.fn() }))
vi.mock('../../ts/alert', () => ({ alertError: (text: string) => h.alertError(text), showHypaV2Alert: vi.fn() }))
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => ({}) }))
const languageMock = vi.hoisted(() => {
    const fns: Record<string, unknown> = {
        chatShellChatStats: (n: number, time: string) => `stats:${n}:${time}`,
        chatShellDeleteChatConfirm: (name: string, n: number) => `confirm:${name}:${n}`,
    }
    return { language: new Proxy({ errors: { onlyOneChat: 'ONLY-ONE' } } as Record<string, unknown>, { get: (target, key) => key in target ? target[key as string] : key in fns ? fns[key as string] : String(key) }) }
})
vi.mock('src/lang', () => languageMock)
vi.mock('../../lang', () => languageMock)

import ThisChatSheet from './ThisChatSheet.svelte'

type OwnerFixture = { chaId: string, name: string, type: 'character', chatPage: number, chats: Chat[], coldstorage?: string }

const makeChat = (extra: Partial<Chat> = {}): Chat => ({
    message: [{ role: 'user', data: 'hi', chatId: 'm1', time: 1_000 }],
    note: '',
    name: 'Harbour night',
    localLore: [],
    id: 'chat-1',
    ...extra,
}) as Chat

let mounted: ReturnType<typeof mount> | undefined
let owner: OwnerFixture
let chat: Chat
let opener: HTMLButtonElement
const view = $state({ open: true })
const onclose = vi.fn()

function install(): void {
    chat = makeChat()
    owner = { chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, chats: [chat, makeChat({ id: 'chat-2', name: 'Other' })] }
    h.db = { characters: [owner], username: 'User', personas: [], selectedPersona: 0, jailbreak: '', jailbreakToggle: false, supaModelType: 'none', hypav2: false, hypaV3: false, customPromptTemplateToggle: '', globalChatVariables: {} }
}

async function show(): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(ThisChatSheet, {
        target,
        props: {
            get open() { return view.open },
            opener,
            background: [],
            target: { owner: owner as never, chat },
            confirmDelete: vi.fn(async () => true),
            onpersona: vi.fn(),
            onmodules: vi.fn(),
            onremoved: vi.fn(),
            onclose: () => { onclose(); view.open = false },
        },
    })
    flushSync()
    await tickFake()
}

const note = () => document.querySelector<HTMLTextAreaElement>('[data-part="this-chat-note"]')!
const status = () => document.querySelector<HTMLElement>('[data-part="this-chat-status"]')!

function type(value: string): void {
    note().focus()
    note().value = value
    note().dispatchEvent(new Event('input', { bubbles: true }))
}

async function close(): Promise<void> {
    view.open = false
    flushSync()
    await tickFake()
}

/** The owner element is replaced by a structured clone: same chaId, same chat ids, new objects. */
function swapForClone(): OwnerFixture {
    const clone = structuredClone(owner)
    ;(h.db.characters as OwnerFixture[])[0] = clone
    return clone
}

/** The owner element is replaced by the archived stub: `coldstorage` set, one placeholder chat with a fresh id. */
function swapForStub(): OwnerFixture {
    const stub: OwnerFixture = { chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, coldstorage: 'unit', chats: [makeChat({ id: 'placeholder', name: '' })] }
    ;(h.db.characters as OwnerFixture[])[0] = stub
    return stub
}

beforeEach(() => {
    vi.useFakeTimers()
    h.mark.mockReset()
    h.alertError.mockReset()
    onclose.mockReset()
    view.open = true
    opener = document.createElement('button')
    document.body.appendChild(opener)
    install()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('S2 note autosave and flush', () => {
    test('the note is written 600 ms after the last key, not before, and says Saved', async () => {
        await show()
        type('a')
        vi.advanceTimersByTime(599)
        expect(chat.note).toBe('')
        type('ab')
        vi.advanceTimersByTime(599)
        expect(chat.note).toBe('')
        vi.advanceTimersByTime(1)
        flushSync()
        expect(chat.note).toBe('ab')
        expect(h.mark).toHaveBeenCalledTimes(1)
        expect(h.mark).toHaveBeenCalledWith('char-a')
        expect(status().textContent).toContain('chatShellSaved')
        expect(status().getAttribute('role')).toBe('status')
    })

    test('the saved text goes away again', async () => {
        await show()
        type('x')
        vi.advanceTimersByTime(600)
        flushSync()
        expect(status().textContent).toContain('chatShellSaved')
        vi.advanceTimersByTime(5_000)
        flushSync()
        expect(status().textContent).not.toContain('chatShellSaved')
    })

    test('the field shows the chat\'s note when the sheet opens', async () => {
        install()
        chat.note = 'existing note'
        await show()
        expect(note().value).toBe('existing note')
    })

    test('blur flushes at once', async () => {
        await show()
        type('on blur')
        note().blur()
        flushSync()
        expect(chat.note).toBe('on blur')
        vi.advanceTimersByTime(1_000)
        expect(h.mark).toHaveBeenCalledTimes(1)
    })

    test('Escape in the field flushes and leaves the field', async () => {
        await show()
        type('by escape')
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        flushSync()
        expect(chat.note).toBe('by escape')
        expect(onclose).not.toHaveBeenCalled()
    })

    test('closing the sheet flushes a pending note', async () => {
        await show()
        type('pending')
        expect(chat.note).toBe('')
        await close()
        expect(chat.note).toBe('pending')
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('unmounting the sheet flushes a pending note', async () => {
        await show()
        type('pending at destroy')
        await unmount(mounted!)
        mounted = undefined
        expect(chat.note).toBe('pending at destroy')
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('an untouched field writes and marks nothing, whatever closes the sheet', async () => {
        await show()
        note().focus()
        note().blur()
        await close()
        vi.advanceTimersByTime(2_000)
        expect(h.mark).not.toHaveBeenCalled()
    })

    test('a flush after the timer already wrote the note does not write twice', async () => {
        await show()
        type('once')
        vi.advanceTimersByTime(600)
        note().blur()
        await close()
        expect(h.mark).toHaveBeenCalledTimes(1)
    })

    test('(G6) a focused, edited note whose sheet is removed by the block commits once, with no window error and no alert', async () => {
        await show()
        type('typed before removal')
        expect(document.activeElement).toBe(note())

        // Chromium blurs a focused node, with blur and focusout, while it is still attached and before it is removed.
        const errors: string[] = []
        const record = (event: ErrorEvent) => { event.preventDefault(); errors.push(String(event.error?.message ?? event.message)) }
        window.addEventListener('error', record)
        const originalRemove = Element.prototype.remove
        vi.spyOn(Element.prototype, 'remove').mockImplementation(function (this: Element) {
            const active = this.ownerDocument.activeElement
            if (active && this.contains(active)) (active as HTMLElement).blur()
            originalRemove.call(this)
        })
        try {
            await close()
            vi.advanceTimersByTime(2_000)
            flushSync()
        } finally {
            window.removeEventListener('error', record)
        }

        expect(errors).toEqual([])
        expect(chat.note).toBe('typed before removal')
        expect(h.mark).toHaveBeenCalledTimes(1)
        expect(h.mark).toHaveBeenCalledWith('char-a')
        expect(h.alertError).not.toHaveBeenCalled()
    })

    test('the next opening starts from the chat\'s note, not from the last draft', async () => {
        await show()
        type('first')
        await close()
        view.open = true
        flushSync()
        await tickFake()
        expect(note().value).toBe('first')
        type('second')
        await close()
        expect(chat.note).toBe('second')
    })
})

describe('X-I8 deferred writers land on the live chat or are refused visibly', () => {
    test('after the owner is replaced by a clone the idle write lands on the clone\'s chat and marks', async () => {
        await show()
        const clone = swapForClone()
        type('clone idle')
        vi.advanceTimersByTime(600)
        flushSync()
        expect(clone.chats[0].note).toBe('clone idle')
        expect(chat.note).toBe('')
        expect(h.mark).toHaveBeenCalledWith('char-a')
        expect(status().textContent).toContain('chatShellSaved')
        expect(h.alertError).not.toHaveBeenCalled()
    })

    test('after a clone swap the close flush lands on the clone\'s chat', async () => {
        await show()
        type('clone flush')
        const clone = swapForClone()
        await close()
        expect(clone.chats[0].note).toBe('clone flush')
        expect(chat.note).toBe('')
    })

    test('after a clone swap the rename commit lands on the clone\'s chat', async () => {
        await show()
        const clone = swapForClone()
        document.querySelector<HTMLElement>('[data-part="this-chat-rename"]')!.click()
        flushSync()
        await tickFake()
        const input = document.querySelector<HTMLInputElement>('[data-part="this-chat-name-input"]')!
        input.value = 'On the clone'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        flushSync()
        expect(clone.chats[0].name).toBe('On the clone')
        expect(chat.name).toBe('Harbour night')
    })

    test('after a stub swap the idle write is refused: no write, no mark, no Saved, the notice through the error alert', async () => {
        await show()
        const stub = swapForStub()
        type('lost')
        vi.advanceTimersByTime(600)
        flushSync()
        expect(h.mark).not.toHaveBeenCalled()
        expect(stub.chats[0].note).toBe('')
        expect(chat.note).toBe('')
        expect(status().textContent).not.toContain('chatShellSaved')
        expect(h.alertError).toHaveBeenCalledTimes(1)
        expect(h.alertError).toHaveBeenCalledWith('chatShellEditNotSaved')
    })

    test('after a stub swap the close flush is refused with the same notice', async () => {
        await show()
        type('lost at close')
        swapForStub()
        await close()
        expect(h.mark).not.toHaveBeenCalled()
        expect(h.alertError).toHaveBeenCalledWith('chatShellEditNotSaved')
    })

    test('after a stub swap the rename is refused with the same notice', async () => {
        await show()
        swapForStub()
        document.querySelector<HTMLElement>('[data-part="this-chat-rename"]')!.click()
        flushSync()
        await tickFake()
        const input = document.querySelector<HTMLInputElement>('[data-part="this-chat-name-input"]')!
        input.value = 'Lost'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        flushSync()
        expect(h.mark).not.toHaveBeenCalled()
        expect(h.alertError).toHaveBeenCalledWith('chatShellEditNotSaved')
        expect(chat.name).toBe('Harbour night')
    })

    test('after the owner was removed the write is refused', async () => {
        await show()
        h.db.characters = []
        type('nobody home')
        vi.advanceTimersByTime(600)
        flushSync()
        expect(h.alertError).toHaveBeenCalledWith('chatShellEditNotSaved')
        expect(h.mark).not.toHaveBeenCalled()
    })

    test('a refused note stays in the field, so the user can still copy it out', async () => {
        await show()
        swapForStub()
        type('kept in the field')
        vi.advanceTimersByTime(600)
        flushSync()
        expect(note().value).toBe('kept in the field')
    })
})
