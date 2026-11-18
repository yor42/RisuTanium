// @vitest-environment jsdom
/**
 * The stats line of the This-chat sheet words the age of the last message in the app language, live. REAL: `ThisChatSheet.svelte`,
 * `ShellSheet.svelte`, `appIntl.svelte.ts` (the app language is set through its `setAppLanguage`). MOCKED: as `ThisChatSheet.svelte.test.ts`.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
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

import { setAppLanguage } from '../../ts/appIntl.svelte'

const agoFor = (tag: string | undefined): string => new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }).format(-5, 'minute')

/** Two app languages whose "5 minutes ago" text differs from the host's and from each other. */
function pickLanguages(): [string, string] {
    const host = agoFor(undefined)
    const fit = ['en', 'ko', 'de', 'ja'].filter((tag) => agoFor(tag) !== host)
    const first = fit[0]
    const second = fit.find((tag) => agoFor(tag) !== agoFor(first))
    if (!first || !second) throw new Error('no distinguishable locales on this host')
    return [first, second]
}

beforeEach(() => {
    h.menu.length = 0
    opener = document.createElement('button')
    document.body.appendChild(opener)
    onclose = vi.fn(); onpersona = vi.fn(); onmodules = vi.fn(); onremoved = vi.fn(); confirmDelete = vi.fn(async () => true)
    install({}, {}, { message: [{ role: 'user', data: 'hi', chatId: 'm1', time: Date.now() - 400_000 }, { role: 'char', data: 'yo', chatId: 'm2', time: Date.now() - 330_000 }] })
    view.open = true
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
    setAppLanguage('en')
    vi.restoreAllMocks()
})

describe('the This-chat sheet stats line', () => {
    test('words the last message age in the app language and follows a switch without a remount', async () => {
        const [first, second] = pickLanguages()
        setAppLanguage(first)
        await show()
        const stats = (): string => document.querySelector('[data-part="this-chat-stats"]')!.textContent ?? ''
        expect(stats()).toBe(`stats:2:${agoFor(first)}`)
        setAppLanguage(second)
        flushSync()
        expect(stats()).toBe(`stats:2:${agoFor(second)}`)
    })
})
