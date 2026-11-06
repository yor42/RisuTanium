// @vitest-environment jsdom
/**
 * The This-chat sheet (CHORE-564/565 surface, UI-S1b stage F1): title block, rows, scope switch, jailbreak and memory
 * switches, close-first rows and the delete row. Guards by construction: the component is new. Mounts the REAL
 * ThisChatSheet, ShellSheet and ToggleScopeSwitch with the real engine; the stores are plain objects, the save marks
 * and the module-level actions (`removeChatConfirmed`, `exportChat`, the alerts) are spies.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { Chat } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    mark: vi.fn(),
    removeChat: vi.fn(),
    exportChat: vi.fn(),
    alertError: vi.fn(),
    hypa2: vi.fn(),
    menu: [] as { id: string, name: string, icon: string, iconType: string, callback: () => void }[],
    order: [] as string[],
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return {
        DBState: { get db() { return h.db } },
        selIdState: { selId: 0 },
        selectedCharID: store(0),
        additionalChatMenu: h.menu,
        settingsOpen: store(false),
        hypaV3ModalOpen: store(false),
    }
})
vi.mock('src/ts/storage/database.svelte', () => ({ appVer: '1', getCurrentCharacter: () => undefined, getCurrentChat: () => undefined, getDatabase: () => h.db }))
vi.mock('src/ts/globalApi.svelte', () => ({ aiWatermarkingLawApplies: () => false, getFileSrc: () => Promise.resolve(''), readImage: () => Promise.resolve(undefined) }))
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: (chaId: string) => h.mark(chaId) }))
vi.mock('../../ts/storage/characterSaveMarks', () => ({ markCharacterForSave: (chaId: string) => h.mark(chaId) }))
vi.mock('src/ts/process/modules', () => ({ getModuleToggles: () => '' }))
vi.mock('../../ts/characters', () => ({ removeChatConfirmed: (...args: unknown[]) => h.removeChat(...args), exportChat: (page: number) => { h.order.push('export'); return h.exportChat(page) } }))
vi.mock('../../ts/alert', () => ({ alertError: (text: string) => h.alertError(text), showHypaV2Alert: () => h.hypa2() }))
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
import { additionalChatMenu, hypaV3ModalOpen, settingsOpen } from 'src/ts/stores.svelte'
import { get } from 'svelte/store'

type Owner = { chaId: string, name: string, type: 'character', chatPage: number, chats: Chat[], supaMemory?: boolean, customModuleToggle?: string, coldstorage?: string }

const makeChat = (extra: Partial<Chat> = {}): Chat => ({
    message: [{ role: 'user', data: 'hi', chatId: 'm1', time: 1_000 }, { role: 'char', data: 'yo', chatId: 'm2', time: 2_000 }],
    note: '',
    name: 'Harbour night',
    localLore: [],
    id: 'chat-1',
    ...extra,
}) as Chat

let mounted: ReturnType<typeof mount> | undefined
let owner: Owner
let chat: Chat
let opener: HTMLButtonElement
const view = $state({ open: true })
let onclose: Mock<() => void>
let onpersona: Mock<(opener: HTMLElement) => void>
let onmodules: Mock<() => void>
let onremoved: Mock<() => void>
let confirmDelete: Mock<(request: { chat: Chat, busy: boolean }, trigger: HTMLElement | null) => Promise<boolean>>

function install(extraDb: Record<string, unknown> = {}, ownerExtra: Partial<Owner> = {}, chatExtra: Partial<Chat> = {}): void {
    chat = makeChat(chatExtra)
    owner = { chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, chats: [chat, makeChat({ id: 'chat-2', name: 'Other' })], ...ownerExtra }
    h.db = {
        characters: [owner], username: 'User', personas: [], selectedPersona: 0, jailbreak: '', jailbreakToggle: false,
        promptTemplate: undefined, supaModelType: 'none', hanuraiEnable: false, hypav2: false, hypaV3: false, hypaMemory: false,
        showMenuHypaMemoryModal: false, customPromptTemplateToggle: '', globalChatVariables: {}, ...extraDb,
    }
}

async function show(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(ThisChatSheet, {
        target,
        props: {
            get open() { return view.open },
            opener,
            background: [],
            target: { owner: owner as never, chat },
            confirmDelete,
            onpersona,
            onmodules,
            onremoved,
            onclose: () => { onclose(); view.open = false },
        },
    })
    flushSync()
    await tick()
    return target
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="this-chat-${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="this-chat-${name}"]`))

beforeEach(() => {
    h.mark.mockReset()
    h.removeChat.mockReset()
    h.exportChat.mockReset()
    h.alertError.mockReset()
    h.hypa2.mockReset()
    h.menu.length = 0
    h.order.length = 0
    view.open = true
    onclose = vi.fn(() => { h.order.push('close') })
    onpersona = vi.fn()
    onmodules = vi.fn(() => { h.order.push('modules') })
    onremoved = vi.fn()
    confirmDelete = vi.fn(async () => true)
    opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    install()
    settingsOpen.set(false)
    hypaV3ModalOpen.set(false)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

describe('S1 open and title block', () => {
    test('the sheet is a dialog named after the sheet, and focus starts on the title, not in a field', async () => {
        await show()
        const dialog = document.querySelector('[role="dialog"]')!
        expect(dialog.getAttribute('aria-label')).toBe('chatShellThisChat')
        const title = part('title')!
        expect(title.tagName).toBe('H2')
        expect(title.textContent).toBe('Harbour night')
        expect(document.activeElement).toBe(title)
        expect(document.activeElement?.matches('input, textarea')).toBe(false)
    })

    test('the stats line counts the messages and names the last message\'s time', async () => {
        await show()
        expect(part('stats')!.textContent).toMatch(/^stats:2:/)
    })

    test('a chat without messages says 0 and no time', async () => {
        install({}, {}, { message: [] })
        await show()
        expect(part('stats')!.textContent).toMatch(/^stats:0:/)
    })

    test('closing returns focus to the opener', async () => {
        await show()
        view.open = false
        flushSync()
        await tick()
        expect(document.activeElement).toBe(opener)
    })
})

describe('persona, modules and hide names', () => {
    test('the persona row shows the user name when none is bound, and the bound persona\'s name otherwise', async () => {
        await show()
        expect(part('persona')!.textContent).toContain('User')
    })

    test('a bound persona is named on the row', async () => {
        install({ personas: [{ id: 'p1', name: 'Captain' }] }, {}, { bindedPersona: 'p1' })
        await show()
        expect(part('persona')!.textContent).toContain('Captain')
    })

    test('the persona row opens the persona sheet from itself', async () => {
        await show()
        part('persona')!.click()
        expect(onpersona).toHaveBeenCalledWith(part('persona'))
        expect(part('persona')!.getAttribute('aria-haspopup')).toBe('dialog')
    })

    test('the modules row shows the count and closes the sheet before opening the module list', async () => {
        install({}, {}, { modules: ['a', 'b'] })
        await show()
        expect(part('modules')!.textContent).toContain('2')
        part('modules')!.click()
        await tick()
        expect(h.order).toEqual(['close', 'modules'])
    })

    test('the modules row makes the chat\'s module list exist before the list opens', async () => {
        await show()
        part('modules')!.click()
        await tick()
        expect(chat.modules).toEqual([])
    })

    test('the hide-names switch writes the flag to the chat and marks the owner; off removes the key', async () => {
        await show()
        const toggle = part('hide-names') as HTMLInputElement
        expect(toggle.checked).toBe(false)
        toggle.click()
        flushSync()
        expect(chat.hideNames).toBe(true)
        expect(h.mark).toHaveBeenCalledWith('char-a')
        expect((part('hide-names') as HTMLInputElement).checked).toBe(true)
        toggle.click()
        flushSync()
        expect('hideNames' in chat).toBe(false)
    })
})

describe('jailbreak and memory switches', () => {
    test('the jailbreak row is absent when the prompt has no jailbreak, present when it has one', async () => {
        await show()
        expect(part('jailbreak')).toBeNull()
        await unmount(mounted!)
        mounted = undefined
        document.body.innerHTML = ''
        opener = document.createElement('button')
        document.body.appendChild(opener)
        install({ jailbreak: 'text' })
        view.open = true
        await show()
        expect(part('jailbreak')).not.toBeNull()
    })

    // X2: an unscoped chat writes the global value; a scoped chat writes its own and leaves the global one alone.
    test('unscoped, the jailbreak switch writes the global value', async () => {
        install({ jailbreak: 'text' })
        await show()
        ;(part('jailbreak') as HTMLInputElement).click()
        flushSync()
        expect(h.db.jailbreakToggle).toBe(true)
        expect(chat.scopedJailbreak).toBeUndefined()
    })

    test('scoped, the jailbreak switch writes the chat\'s own value, leaves the global one and marks the owner', async () => {
        install({ jailbreak: 'text', jailbreakToggle: false }, {}, { useLocallySetGlobalVariables: true, scopedJailbreak: false })
        await show()
        const toggle = part('jailbreak') as HTMLInputElement
        expect(toggle.checked).toBe(false)
        toggle.click()
        flushSync()
        expect(chat.scopedJailbreak).toBe(true)
        expect(h.db.jailbreakToggle).toBe(false)
        expect(h.mark).toHaveBeenCalledWith('char-a')
        expect((part('jailbreak') as HTMLInputElement).checked).toBe(true)
    })

    test('the memory row needs a memory type; unscoped it writes the owner, scoped the chat', async () => {
        await show()
        expect(part('memory')).toBeNull()
        await unmount(mounted!)
        mounted = undefined
        document.body.innerHTML = ''
        opener = document.createElement('button')
        document.body.appendChild(opener)
        install({ hypaV3: true }, { supaMemory: false })
        view.open = true
        await show()
        ;(part('memory') as HTMLInputElement).click()
        flushSync()
        expect(owner.supaMemory).toBe(true)
        expect(chat.scopedMemory).toBeUndefined()
    })

    test('scoped, the memory switch writes the chat\'s own value and leaves the owner\'s', async () => {
        install({ hypaV3: true }, { supaMemory: false }, { useLocallySetGlobalVariables: true, scopedMemory: false })
        await show()
        ;(part('memory') as HTMLInputElement).click()
        flushSync()
        expect(chat.scopedMemory).toBe(true)
        expect(owner.supaMemory).toBe(false)
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('the memory view row follows the menu rule and closes the sheet before opening the view', async () => {
        install({ hypaV3: true, showMenuHypaMemoryModal: true })
        await show()
        part('memory-view')!.click()
        await tick()
        expect(get(hypaV3ModalOpen)).toBe(true)
        expect(h.order[0]).toBe('close')
    })

    test('the memory view row is absent while the menu setting is off', async () => {
        install({ hypaV3: true, showMenuHypaMemoryModal: false })
        await show()
        expect(part('memory-view')).toBeNull()
    })

    test('with the older memory the view row creates the chat\'s data and opens the old view', async () => {
        install({ hypav2: true, supaModelType: 'distilbart', showMenuHypaMemoryModal: true })
        await show()
        part('memory-view')!.click()
        await tick()
        expect(h.hypa2).toHaveBeenCalledTimes(1)
        expect(chat.hypaV2Data).toEqual({ lastMainChunkID: 0, mainChunks: [], chunks: [] })
    })
})

describe('scope switch (X-S1: copies the toggles, the jailbreak and the memory switches)', () => {
    test('turning it on copies the values in force into the chat', async () => {
        install({ jailbreak: 'text', jailbreakToggle: true, hypaV3: true, customPromptTemplateToggle: 'a=Alpha', globalChatVariables: { toggle_a: '1' } }, { supaMemory: true })
        await show()
        const input = document.querySelector<HTMLInputElement>('input[role="switch"][aria-describedby^="toggle-scope-note"]')!
        input.click()
        flushSync()
        expect(chat.useLocallySetGlobalVariables).toBe(true)
        expect(chat.GLGlobalVariables).toEqual({ toggle_a: '1' })
        expect(chat.scopedJailbreak).toBe(true)
        expect(chat.scopedMemory).toBe(true)
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })
})

describe('close-first rows', () => {
    test('All settings closes the sheet and then opens the settings', async () => {
        await show()
        part('all-settings')!.click()
        expect(onclose).toHaveBeenCalledTimes(1)
        expect(get(settingsOpen)).toBe(false)
        await tick()
        expect(get(settingsOpen)).toBe(true)
    })

    test('a plugin row closes the sheet and then runs the plugin\'s callback', async () => {
        h.menu.push({ id: 'p', name: 'Plug', icon: '', iconType: 'plain', callback: () => { h.order.push('plugin') } })
        await show()
        const rows = parts('plugin')
        expect(rows).toHaveLength(1)
        expect(rows[0].textContent).toContain('Plug')
        rows[0].click()
        await tick()
        expect(h.order).toEqual(['close', 'plugin'])
    })

    test('no plugin rows without plugin menu items', async () => {
        await show()
        expect(parts('plugin')).toHaveLength(0)
    })

    test('Export closes the sheet and then exports this chat by its page', async () => {
        await show()
        part('export')!.click()
        await tick()
        expect(h.order).toEqual(['close', 'export'])
        expect(h.exportChat).toHaveBeenCalledWith(0)
    })

    test('the rows that stay open keep the sheet open', async () => {
        await show()
        part('persona')!.click()
        ;(part('hide-names') as HTMLInputElement).click()
        flushSync()
        expect(onclose).not.toHaveBeenCalled()
    })
})

describe('Delete (PQ8a)', () => {
    test('with several chats the row hands the confirmation to removeChatConfirmed, with the delete button as the trigger', async () => {
        h.removeChat.mockImplementation(async (_owner: unknown, _chat: unknown, confirm: (request: { chat: Chat, busy: boolean }) => Promise<boolean>) => {
            await confirm({ chat, busy: true })
            return false
        })
        await show()
        part('delete')!.click()
        await tick()
        expect(h.removeChat).toHaveBeenCalledTimes(1)
        expect(h.removeChat.mock.calls[0][0]).toBe(owner)
        expect(h.removeChat.mock.calls[0][1]).toBe(chat)
        expect(confirmDelete).toHaveBeenCalledWith({ chat, busy: true }, part('delete'))
    })

    test('a removed chat reports to onremoved; a refused removal does not', async () => {
        h.removeChat.mockResolvedValueOnce(true)
        await show()
        part('delete')!.click()
        await vi.waitFor(() => expect(onremoved).toHaveBeenCalledTimes(1))
        h.removeChat.mockResolvedValueOnce(false)
        part('delete')!.click()
        await tick()
        await tick()
        expect(onremoved).toHaveBeenCalledTimes(1)
    })

    test('on a sole chat the row is aria-disabled, described by the reason, and never calls removeChatConfirmed', async () => {
        install({}, {})
        owner.chats.length = 1
        await show()
        const button = part('delete')!
        expect(button.getAttribute('aria-disabled')).toBe('true')
        const reason = document.getElementById(button.getAttribute('aria-describedby')!)
        expect(reason?.textContent).toBe('ONLY-ONE')
        button.click()
        await tick()
        expect(h.removeChat).not.toHaveBeenCalled()
        expect(confirmDelete).not.toHaveBeenCalled()
    })

    test('with several chats the row is not disabled and carries no reason', async () => {
        await show()
        expect(part('delete')!.getAttribute('aria-disabled')).toBeNull()
        expect(part('delete-reason')).toBeNull()
    })

    test('the delete row flushes a pending note first, while the chat still exists', async () => {
        h.removeChat.mockImplementation(async () => {
            h.order.push(`note:${chat.note}`)
            return false
        })
        await show()
        const note = part('note') as HTMLTextAreaElement
        note.value = 'keep this'
        note.dispatchEvent(new Event('input', { bubbles: true }))
        part('delete')!.click()
        await tick()
        expect(h.order).toEqual(['note:keep this'])
    })
})

describe('rename (S3)', () => {
    async function startRename(): Promise<HTMLInputElement> {
        part('rename')!.click()
        flushSync()
        await tick()
        return part('name-input') as HTMLInputElement
    }

    test('Rename swaps the title for an input holding the name, focused', async () => {
        await show()
        const input = await startRename()
        expect(input.value).toBe('Harbour night')
        expect(document.activeElement).toBe(input)
        expect(part('title')).toBeNull()
    })

    test('Enter commits the trimmed name and marks the owner', async () => {
        await show()
        const input = await startRename()
        input.value = '  Quiet dawn '
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        flushSync()
        await tick()
        expect(chat.name).toBe('Quiet dawn')
        expect(h.mark).toHaveBeenCalledWith('char-a')
        expect(part('title')!.textContent).toBe('Quiet dawn')
    })

    test('blur commits', async () => {
        await show()
        const input = await startRename()
        input.value = 'By blur'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.blur()
        flushSync()
        await tick()
        expect(chat.name).toBe('By blur')
    })

    test('an empty name reverts and writes nothing', async () => {
        await show()
        const input = await startRename()
        input.value = '   '
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        flushSync()
        await tick()
        expect(chat.name).toBe('Harbour night')
        expect(h.mark).not.toHaveBeenCalled()
        expect(part('title')!.textContent).toBe('Harbour night')
    })

    test('Escape reverts the rename and leaves the sheet open', async () => {
        await show()
        const input = await startRename()
        input.value = 'Never saved'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        flushSync()
        await tick()
        expect(chat.name).toBe('Harbour night')
        expect(onclose).not.toHaveBeenCalled()
        expect(part('name-input')).toBeNull()
        expect(document.activeElement).toBe(part('rename'))
    })
})

describe('Escape in the note field', () => {
    test('the first Escape leaves the field and keeps the sheet; the next closes it', async () => {
        await show()
        const note = part('note') as HTMLTextAreaElement
        note.focus()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        flushSync()
        expect(onclose).not.toHaveBeenCalled()
        expect(document.activeElement).not.toBe(note)
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        flushSync()
        expect(onclose).toHaveBeenCalledTimes(1)
    })
})
