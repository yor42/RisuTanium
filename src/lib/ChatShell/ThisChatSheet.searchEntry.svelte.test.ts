// @vitest-environment jsdom
/**
 * The "Search in chat" entry of the This-chat sheet (MC-1763): it sits in the first group with the jump entry, closes the sheet and then
 * asks the shell to open search on the opener the sheet had. The row is absent when the shell cannot open search, and the group is absent
 * when the shell offers neither entry. REAL: `ThisChatSheet.svelte` and `ShellSheet.svelte`. MOCKED: the stores, the database module,
 * alerts and the character actions, as in the other ThisChatSheet tests.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
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
let opener: HTMLButtonElement
let onsearch: Mock<(opener: HTMLElement | null) => void>
let onjumpsheet: Mock<(opener: HTMLElement | null) => void>
let order: string[]
const view = $state({ open: true })

async function show(entries: { search: boolean, jump: boolean }): Promise<void> {
    const chat = makeChat({ useLocallySetGlobalVariables: true })
    const owner: Owner = { chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, chats: [chat, makeChat({ id: 'chat-2', name: 'Other' })] }
    h.db = {
        characters: [owner], username: 'User', personas: [], selectedPersona: 0, jailbreak: 'text', jailbreakToggle: false,
        promptTemplate: undefined, supaModelType: 'none', hanuraiEnable: false, hypav2: false, hypaV3: true, hypaMemory: false,
        showMenuHypaMemoryModal: true, customPromptTemplateToggle: '', globalChatVariables: {},
    }
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
            onjumpsheet: entries.jump ? onjumpsheet : undefined,
            onsearch: entries.search ? onsearch : undefined,
            onremoved: vi.fn(),
            onclose: () => { order.push('close'); view.open = false },
        },
    })
    flushSync()
    await tick()
}

const entry = () => document.querySelector<HTMLButtonElement>('[data-part="this-chat-search"]')
const groups = () => [...document.querySelectorAll<HTMLElement>('[data-part="this-chat-group"]')]

beforeEach(() => {
    view.open = true
    order = []
    opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    onsearch = vi.fn<(opener: HTMLElement | null) => void>(() => { order.push('search') })
    onjumpsheet = vi.fn<(opener: HTMLElement | null) => void>(() => { order.push('jump') })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

describe('the Search in chat entry of the This-chat sheet', () => {
    test('B2d-7: it sits in the first group, right after the jump entry and before the persona group', async () => {
        await show({ search: true, jump: true })
        const first = groups()[0]
        const search = entry()!
        const jump = document.querySelector<HTMLElement>('[data-part="this-chat-jump"]')!
        expect(search.closest('[data-part="this-chat-group"]')).toBe(first)
        expect(jump.closest('[data-part="this-chat-group"]')).toBe(first)
        expect(jump.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        const persona = document.querySelector('[data-part="this-chat-persona"]')!
        expect(search.compareDocumentPosition(persona) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(first.querySelector('[data-part="this-chat-persona"]')).toBeNull()
        expect(search.textContent).toBe('chatShellSearchInChat')
    })
    test('B2d-7: the first group is not named after the jump sheet, as it also holds the search entry', async () => {
        await show({ search: true, jump: true })
        const label = groups()[0].getAttribute('aria-label')
        expect(label).not.toBe('chatShellJumpSheet')
        expect(label).toBe('chatShellThisChat')
    })
    test('B2d-7: a tap closes the sheet first and then asks for search, handing over the opener; the jump entry is not asked', async () => {
        await show({ search: true, jump: true })
        entry()!.click()
        expect(order).toEqual(['close'])
        await tick()
        expect(order).toEqual(['close', 'search'])
        expect(onsearch).toHaveBeenCalledExactlyOnceWith(opener)
        expect(onjumpsheet).not.toHaveBeenCalled()
    })
    test('B2d-7: search alone still draws the first group, and without a handler the entry is not drawn', async () => {
        await show({ search: true, jump: false })
        expect(groups()[0].contains(entry())).toBe(true)
        expect(document.querySelector('[data-part="this-chat-jump"]')).toBeNull()
        await unmount(mounted!)
        mounted = undefined
        document.body.innerHTML = ''
        view.open = true
        await show({ search: false, jump: true })
        expect(entry()).toBeNull()
        expect(document.querySelector('[data-part="this-chat-jump"]')).not.toBeNull()
    })
})
