// @vitest-environment jsdom
/**
 * The jailbreak, memory and hide-names switches of the This-chat sheet carry aria-label equal to their row text.
 * REAL: ThisChatSheet, ShellSheet and ToggleScopeSwitch. MOCKED: stores, save marks and module-level actions, as the
 * sibling ThisChatSheet test does.
 * Excluded from the field assertion, with the reason: the author-note textarea is wrapped by its label and the rename
 * field carries only aria-label; neither is in the A3c plan list (they are reported as follow-ups).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat } from 'src/ts/storage/database.svelte'
import { controls, controlName } from '../a11yNames.test-helpers'

const h = vi.hoisted(() => ({ db: {} as Record<string, unknown> }))

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

function install(chatExtra: Partial<Chat> = {}): void {
    chat = makeChat(chatExtra)
    owner = { chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, chats: [chat], supaMemory: true }
    h.db = {
        characters: [owner], username: 'User', personas: [], selectedPersona: 0, jailbreak: 'text', jailbreakToggle: false,
        promptTemplate: undefined, supaModelType: 'none', hanuraiEnable: false, hypav2: false, hypaV3: true, hypaMemory: false,
        showMenuHypaMemoryModal: false, customPromptTemplateToggle: '', globalChatVariables: {},
    }
}

async function show(): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = mount(ThisChatSheet, {
        target,
        props: { open: true, opener, background: [], target: { owner: owner as never, chat }, confirmDelete: vi.fn(async () => true), onpersona: vi.fn(), onmodules: vi.fn(), onremoved: vi.fn(), onclose: vi.fn() },
    })
    flushSync()
    await tick()
}

const part = (name: string) => document.querySelector<HTMLInputElement>(`[data-part="this-chat-${name}"]`)

beforeEach(() => {
    opener = document.createElement('button')
    document.body.appendChild(opener)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

describe('ThisChatSheet form control names', () => {
    test('unscoped: the hide-names switch carries aria-label equal to its row text', async () => {
        install()
        await show()
        expect(part('hide-names')!.getAttribute('aria-label')).toBe('chatShellHideNames')
        expect(part('hide-names')!.hasAttribute('aria-labelledby')).toBe(false)
    })

    test('scoped: the jailbreak, memory and hide-names switches carry aria-label equal to their row text', async () => {
        install({ useLocallySetGlobalVariables: true })
        await show()
        expect(part('jailbreak')!.getAttribute('aria-label')).toBe('jailbreakToggle')
        expect(part('memory')!.getAttribute('aria-label')).toBe('ToggleHypaMemory')
        expect(part('hide-names')!.getAttribute('aria-label')).toBe('chatShellHideNames')
        const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
        expect(boxes.length).toBeGreaterThanOrEqual(4)
        expect(boxes.map((box) => controlName(box)).filter((name) => name === '')).toEqual([])
        const unnamed = controls(document.body, { fields: true }).filter((el) => controlName(el) === '' && el !== opener && !el.matches('[data-part="this-chat-note"], [data-part="this-chat-name-input"]'))
        expect(unnamed).toEqual([])
    })
})
