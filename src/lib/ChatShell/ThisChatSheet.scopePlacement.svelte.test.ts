// @vitest-environment jsdom
/**
 * Placement of the jailbreak and memory rows in the This-chat sheet (DD-086): while the chat-only scope is on they sit in
 * the first "This chat" group, after the scope switch, and neither the character heading nor the all-chats heading
 * carries them; with the scope off they stay under the character and all-chats headings. The placement follows a flip of
 * the scope switch inside the open sheet in both directions, with a chat object that is not reactive. Regression
 * reproducers for the scope-on cases; the scope-off case is a compatibility guard that passes before and after.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
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
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../../ts/storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('src/ts/process/modules', () => ({ getModuleToggles: () => '' }))
vi.mock('../../ts/characters', () => ({ removeChatConfirmed: vi.fn(), exportChat: vi.fn() }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), showHypaV2Alert: vi.fn() }))
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

type Owner = { chaId: string, name: string, type: 'character', chatPage: number, chats: Chat[] }

const makeChat = (extra: Partial<Chat> = {}): Chat => ({
    message: [{ role: 'user', data: 'hi', chatId: 'm1', time: 1_000 }],
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

function install(extraDb: Record<string, unknown> = {}, chatExtra: Partial<Chat> = {}): void {
    chat = makeChat(chatExtra)
    owner = { chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, chats: [chat, makeChat({ id: 'chat-2', name: 'Other' })] }
    h.db = {
        characters: [owner], username: 'User', personas: [], selectedPersona: 0, jailbreak: 'text', jailbreakToggle: false,
        promptTemplate: undefined, supaModelType: 'none', hanuraiEnable: false, hypav2: false, hypaV3: true, hypaMemory: false,
        showMenuHypaMemoryModal: true, customPromptTemplateToggle: '', globalChatVariables: {}, ...extraDb,
    }
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
            onclose: () => { view.open = false },
        },
    })
    flushSync()
    await tick()
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="this-chat-${name}"]`)
const groupOf = (name: string) => part(name)?.closest<HTMLElement>('[data-part="this-chat-group"]') ?? null
const firstGroup = () => document.querySelector<HTMLElement>('[data-part="this-chat-group"]')
const characterHeading = () => document.getElementById('this-chat-scope-character')
const allHeading = () => document.getElementById('this-chat-scope-all')
const scopeSwitch = () => document.querySelector<HTMLInputElement>('input[role="switch"][aria-describedby^="toggle-scope-note"]')!

function flip(): void {
    scopeSwitch().click()
    flushSync()
}

function expectInFirstGroup(names: string[]): void {
    for (const name of names) {
        expect(part(name), name).not.toBeNull()
        expect(groupOf(name), name).toBe(firstGroup())
    }
}

function expectUnderHeadings(): void {
    expect(groupOf('memory')?.getAttribute('aria-labelledby')).toBe('this-chat-scope-character')
    expect(groupOf('memory-view')?.getAttribute('aria-labelledby')).toBe('this-chat-scope-character')
    expect(groupOf('jailbreak')?.getAttribute('aria-labelledby')).toBe('this-chat-scope-all')
    expect(characterHeading()).not.toBeNull()
}

beforeEach(() => {
    view.open = true
    opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    install()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

describe('jailbreak and memory placement follows the chat-only scope', () => {
    test('scope off: memory and its view sit under the character heading, jailbreak under the all-chats heading', async () => {
        await show()
        expectUnderHeadings()
        expect(groupOf('memory')).not.toBe(firstGroup())
        expect(groupOf('jailbreak')).not.toBe(firstGroup())
    })

    test('scope on at open: jailbreak, memory and the memory view sit in the first group, after the scope switch', async () => {
        install({}, { useLocallySetGlobalVariables: true })
        await show()
        expectInFirstGroup(['jailbreak', 'memory', 'memory-view'])
        const first = firstGroup()!
        expect(first.getAttribute('aria-label')).toBe('chatShellThisChat')
        const order = Array.from(first.querySelectorAll<HTMLElement>('[data-part="toggle-scope-switch"], [data-part="this-chat-jailbreak"], [data-part="this-chat-memory"], [data-part="this-chat-memory-view"]'))
        expect(order.map((el) => el.getAttribute('data-part'))).toEqual(['toggle-scope-switch', 'this-chat-jailbreak', 'this-chat-memory', 'this-chat-memory-view'])
    })

    test('scope on: no empty character heading, and the all-chats section keeps its all settings button', async () => {
        install({}, { useLocallySetGlobalVariables: true })
        await show()
        expect(characterHeading()).toBeNull()
        expect(allHeading()).not.toBeNull()
        const all = part('all-settings')!
        expect(all.closest('[data-part="this-chat-group"]')?.getAttribute('aria-labelledby')).toBe('this-chat-scope-all')
        expect(groupOf('jailbreak')).toBe(firstGroup())
    })

    test('scope on: memory keeps its real type label', async () => {
        install({ hypaV3: true }, { useLocallySetGlobalVariables: true })
        await show()
        expect(part('memory')!.closest('label')!.textContent).toContain('ToggleHypaMemory')
    })

    test('scope on: the existing visibility conditions still apply', async () => {
        install({ jailbreak: '', supaModelType: 'none', hypaV3: false, hypav2: false, hanuraiEnable: false }, { useLocallySetGlobalVariables: true })
        await show()
        expect(part('jailbreak')).toBeNull()
        expect(part('memory')).toBeNull()
        expect(part('memory-view')).toBeNull()
        expect(characterHeading()).toBeNull()
        expect(allHeading()).not.toBeNull()
        expect(part('all-settings')).not.toBeNull()
    })

    test('scope on, memory view hidden: memory row still moves, no memory view button', async () => {
        install({ showMenuHypaMemoryModal: false }, { useLocallySetGlobalVariables: true })
        await show()
        expectInFirstGroup(['jailbreak', 'memory'])
        expect(part('memory-view')).toBeNull()
    })

    test('flipping the switch on in the open sheet moves the rows into the first group, and flipping it off moves them back', async () => {
        await show()
        expectUnderHeadings()

        flip()
        expect(chat.useLocallySetGlobalVariables).toBe(true)
        expectInFirstGroup(['jailbreak', 'memory', 'memory-view'])
        expect(characterHeading()).toBeNull()

        flip()
        expect(chat.useLocallySetGlobalVariables).toBe(false)
        expectUnderHeadings()
    })

    test('the Undo after turning the scope off moves the rows into the first group again', async () => {
        install({}, { useLocallySetGlobalVariables: true })
        await show()
        flip()
        expectUnderHeadings()
        const undo = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-part="toggle-scope-switch"] button')).find((button) => button.textContent === 'chatShellToggleScopeUndo')!
        undo.click()
        flushSync()
        expect(chat.useLocallySetGlobalVariables).toBe(true)
        expectInFirstGroup(['jailbreak', 'memory', 'memory-view'])
        expect(characterHeading()).toBeNull()
    })
})
