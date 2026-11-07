// @vitest-environment jsdom
/**
 * The Studio row of the This-chat sheet. Switch off: the sheet is as before (compatibility guard).
 * Switch on: the row closes the sheet first, then opens the bound character at its basic info.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({ db: {} as Record<string, unknown>, order: [] as string[] }))
const selection = vi.hoisted(() => ({ selId: 0 }))
const MobileGUI = vi.hoisted(() => ({ store: null as null | { set: (value: boolean) => void } }))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    const gui = store(false)
    MobileGUI.store = gui
    return {
        DBState: { get db() { return h.db } },
        selIdState: selection,
        selectedCharID: store(0),
        additionalChatMenu: [],
        settingsOpen: store(false),
        hypaV3ModalOpen: store(false),
        MobileGUI: gui,
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
import { resetStudioScreenForTests, studioScreen } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { studioOpen } from '../../ts/studio/studioOpen'

type Owner = { chaId: string, name: string, type: 'character', chatPage: number, chats: Chat[] }

let mounted: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined
let owner: Owner
let opener: HTMLButtonElement
const view = $state({ open: true })

function makeChat(id: string): Chat {
    return { message: [{ role: 'user', data: 'hi', chatId: 'm1', time: 1_000 }], note: '', name: id, localLore: [], id } as Chat
}

async function show(): Promise<void> {
    const chat = owner.chats[0]
    host = document.createElement('div')
    document.body.appendChild(host)
    mounted = mount(ThisChatSheet, {
        target: host,
        props: {
            get open() { return view.open },
            opener,
            background: [],
            target: { owner: owner as never, chat },
            confirmDelete: async () => true,
            onpersona: vi.fn(),
            onmodules: vi.fn(),
            onremoved: vi.fn(),
            onclose: () => { h.order.push(`close:${get(studioOpen)}`); view.open = false },
        },
    })
    flushSync()
    await tick()
}

const row = () => document.querySelector<HTMLElement>('[data-part="this-chat-studio"]')

beforeEach(() => {
    h.order.length = 0
    localStorage.clear()
    resetStudioScreenForTests()
    view.open = true
    owner = { chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, chats: [makeChat('chat-1'), makeChat('chat-2')] }
    h.db = {
        characters: [owner], username: 'User', personas: [], selectedPersona: 0, jailbreak: '', jailbreakToggle: false,
        promptTemplate: undefined, supaModelType: 'none', hanuraiEnable: false, hypav2: false, hypaV3: false, hypaMemory: false,
        showMenuHypaMemoryModal: false, customPromptTemplateToggle: '', globalChatVariables: {},
    }
    selection.selId = 0
    MobileGUI.store?.set(false)
    setStudioEnabled(false)
    opener = document.createElement('button')
    document.body.appendChild(opener)
})

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    host?.remove()
    opener.remove()
    resetStudioScreenForTests()
    setStudioEnabled(false)
    localStorage.clear()
})

describe('2l switch off', () => {
    test('the sheet has no Studio row', async () => {
        await show()
        expect(document.querySelector('[data-part="this-chat-modules"]')).not.toBeNull()
        expect(row()).toBeNull()
    })
})

describe('2m switch on', () => {
    test('the row sits after Modules, closes the sheet first and opens the character at basic info', async () => {
        setStudioEnabled(true)
        await show()
        const studio = row()
        expect(studio).not.toBeNull()
        expect(studio?.previousElementSibling).toBe(document.querySelector('[data-part="this-chat-modules"]'))

        studio?.click()
        await tick()
        await tick()
        expect(h.order).toEqual(['close:false'])
        expect(get(studioOpen)).toBe(true)
        expect(studioScreen.chaId).toBe('char-a')
        expect(studioScreen.target).toEqual({ owner: { type: 'character', id: 'char-a' }, kind: 'basic', from: 'chat' })
        expect(studioScreen.opener?.element).toBe(opener)
    })

    test('no row under the Beta Mobile GUI, and it returns when that turns off', async () => {
        setStudioEnabled(true)
        MobileGUI.store?.set(true)
        await show()
        expect(row()).toBeNull()
        MobileGUI.store?.set(false)
        flushSync()
        expect(row()).not.toBeNull()
    })
})
