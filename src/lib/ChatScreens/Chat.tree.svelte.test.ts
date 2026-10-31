// @vitest-environment happy-dom

/**
 * The chat-tree controls of the REAL `Chat.svelte`: the sibling arrows and counter, the styling of the
 * arrow that will generate a new reply, the end control, the Branch button and the busy state.
 *
 * Invariants pinned here: a row shows arrows when it is the last row or has siblings, and a counter only
 * under Swipe with more than one sibling; only the last row, with no later sibling and a reroll base,
 * styles its forward arrow as generating; every control renders disabled while a generation or a composer
 * action runs; Branch is disabled on the last message, with or without a sibling view; the end control
 * shows only on the last row while records follow it; the first-message card and a row mounted without the
 * tree handlers keep their own behavior.
 *
 * Test kinds: every row except the two "guard:" rows is a new-rule guard (the controls do not exist before
 * this change); the "guard:" rows are compatibility guards that pass before and after.
 */

import { flushSync, mount, unmount, type ComponentProps } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
        CurrentTriggerIdStore: writable(null),
        popupStore: { children: null, mouseX: 0, mouseY: 0, openId: 0 },
        HideIconStore: writable(false),
        createSimpleCharacter: vi.fn(() => null),
        bookmarkListOpen: writable(false),
        ScrollToMessageStore: { value: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiLawApplies: vi.fn(() => false),
    changeChatTo: vi.fn(),
    foldChatToMessage: vi.fn(),
    getFileSrc: vi.fn(async () => ''),
    createChatCopyName: vi.fn((name: string) => `${name} Branch`),
    downloadFile: vi.fn(),
    fetchNative: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => null),
    getCurrentChat: vi.fn(() => null),
    setCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

interface PendingConfirm {
    message: string
    resolve: (answer: boolean) => void
}

interface PendingSelect {
    choices: string[]
    question: string | undefined
    resolve: (answer: string) => void
}

const prompts = vi.hoisted(() => ({
    confirms: [] as PendingConfirm[],
    selects: [] as PendingSelect[],
}))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn((message: string) => new Promise<boolean>((resolve) => {
        prompts.confirms.push({ message, resolve })
    })),
    alertSelect: vi.fn((choices: string[], question?: string) => new Promise<string>((resolve) => {
        prompts.selects.push({ choices, question, resolve })
    })),
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertRequestData: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    ParseMarkdown: vi.fn(async (text: string) => text),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    getLLMCache: vi.fn(async () => null),
    setLLMCache: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaButtonTrigger: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/scriptings'))

vi.mock(import('src/ts/process/scripts'), () => ({
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/triggers'), () => ({
    runTrigger: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/triggers'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    ColorSchemeTypeStore: writable('dark'),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ shortName: 'test-model' })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/util'), () => ({
    capitalize: vi.fn((s: string) => s),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    sleep: vi.fn(async () => {}),
    findCharacterbyId: vi.fn(() => null),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

// Neither is exercised by the delete flow.
vi.mock('./ChatBody.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))


vi.mock(import('src/ts/tokenizer'), async (importOriginal) => ({
    ...(await importOriginal()),
    tokenize: async (text: string) => Math.ceil(text.length / 4),
}) as unknown as typeof import('src/ts/tokenizer'))
vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: vi.fn(async () => ({ type: 'success', result: 'SUMMARY' })),
}) as unknown as typeof import('src/ts/process/request/request'))
vi.mock(import('src/ts/process/memory/hypamemory'), () => ({
    HypaProcesser: class {
        oaikey = ''
        vectors: unknown[] = []
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))

//#endregion

import { DBState, popupStore, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import { treeView } from 'src/ts/process/chatTreeView'
import { accessibilitySettingsItems } from 'src/ts/setting/accessibilitySettingsData'
import Chat from './Chat.svelte'
import PopupList from '../UI/PopupList.svelte'

//#region fixtures

interface FixtureMessage {
    role: 'user' | 'char'
    data: string
    chatId: string
    time: number
}

interface FixtureAlt {
    m: FixtureMessage
    p: string | null
    a: number
}

interface FixtureChat {
    id: string
    message: FixtureMessage[]
    alt?: FixtureAlt[]
    bookmarks: string[]
    bookmarkNames: Record<string, string>
}

interface FixtureCharacter {
    chaId: string
    type: string
    ttsMode: string
    chatPage: number
    chats: FixtureChat[]
}

const message = (id: string, role: 'user' | 'char', time: number): FixtureMessage => ({ role, data: `data-${id}`, chatId: id, time })
const record = (id: string, role: 'user' | 'char', time: number, p: string | null, a = 1): FixtureAlt => ({ m: message(id, role, time), p, a })

/** Three messages u1, c2, u3 and, when asked, further messages after them. */
function pathOf(...ids: Array<[string, 'user' | 'char', number]>): FixtureMessage[] {
    return ids.map(([id, role, time]) => message(id, role, time))
}

function baseDb(overrides: Record<string, unknown> = {}) {
    return {
        askRemoval: true,
        instantRemove: false,
        translatorType: 'none',
        translateBeforeHTMLFormatting: false,
        legacyTranslation: false,
        requestInfoInsideChat: false,
        clickToEdit: false,
        zoomsize: 100,
        lineHeight: 1.25,
        enableBlockPartialEdit: false,
        enableDragPartialEdit: false,
        useChatCopy: false,
        translator: '',
        swipe: true,
        showFirstMessagePages: true,
        enableBookmark: false,
        iconsize: 100,
        memoryLimitThickness: 2,
        theme: 'default',
        guiHTML: '',
        roundIcons: false,
        ...overrides,
    }
}

function setup(path: FixtureMessage[], alt: FixtureAlt[] | undefined, db: Record<string, unknown> = {}): FixtureChat {
    DBState.db = baseDb(db) as never
    const chat: FixtureChat = { id: 'chat-a', message: path, bookmarks: [], bookmarkNames: {} }
    if (alt) {
        chat.alt = alt
    }
    DBState.db.characters = [{ chaId: 'char-a', type: 'character', ttsMode: 'none', chatPage: 0, chats: [chat] }] as never
    selIdState.selId = 0
    return (DBState.db.characters as unknown as FixtureCharacter[])[0].chats[0]
}

const busy = $state({ value: false })
const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

interface RowHooks {
    onStep: Mock<NonNullable<ComponentProps<typeof Chat>['onStep']>>
    onBranch: Mock<NonNullable<ComponentProps<typeof Chat>['onBranch']>>
}

/** Mounts the row at `idx` the way `Chats` does: its mount-time id, the shared view, the busy getter. */
function mountRow(chat: FixtureChat, idx: number, extra: Partial<ComponentProps<typeof Chat>> = {}): { root: HTMLElement } & RowHooks {
    const hooks: RowHooks = { onStep: vi.fn<NonNullable<ComponentProps<typeof Chat>['onStep']>>(), onBranch: vi.fn<NonNullable<ComponentProps<typeof Chat>['onBranch']>>() }
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(Chat, {
        target,
        props: {
            idx,
            message: chat.message[idx].data,
            isLastMemory: false,
            rerollIcon: 'dynamic',
            expectedId: chat.message[idx].chatId,
            onStep: hooks.onStep,
            onBranch: hooks.onBranch,
            getTreeView: () => treeView(chat as never),
            getBusy: () => busy.value,
            ...extra,
        },
    }))
    flushSync()
    return { root: target, ...hooks }
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10))
    flushSync()
}

/** The Branch button lives in the message's popup menu. */
async function branchButtonOf(root: HTMLElement): Promise<HTMLButtonElement> {
    root.querySelector<HTMLButtonElement>('.button-icon-menu')!.click()
    await settle()
    const popupTarget = document.createElement('div')
    document.body.appendChild(popupTarget)
    mountedTargets.push(popupTarget)
    mountedInstances.push(mount(PopupList, { target: popupTarget, props: {} }))
    flushSync()
    const icon = popupTarget.querySelector('svg.lucide-split')
    expect(icon, 'the branch icon').not.toBeNull()
    return icon!.closest('button')!
}

const back = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.button-icon-unreroll')
const forward = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.button-icon-reroll')
const endControl = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.button-icon-end-control')
const counter = (root: HTMLElement) => Array.from(root.querySelectorAll('span')).find((span) => span.children.length === 0 && /^\d+\/\d+$/.test(span.textContent?.trim() ?? ''))

const emptyDb = DBState.db

beforeEach(() => {
    window.innerWidth = 1024
    selectedCharID.set(0)
    busy.value = false
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    DBState.db = emptyDb
    vi.clearAllMocks()
})

//#endregion

/** u1, c2 (shown, time 3) with the sibling c1 (time 2) before it, then u3 and c4 (time 5) with the sibling c0 (time 4) before it. */
function twoSiblingChat(db: Record<string, unknown> = {}): FixtureChat {
    return setup(
        pathOf(['u1', 'user', 1], ['c2', 'char', 3], ['u3', 'user', 6], ['c4', 'char', 7]),
        [record('c1', 'char', 2, 'u1'), record('c0', 'char', 5, 'u3', 2)],
        db,
    )
}

describe('the counter', () => {
    test('Swipe on: sibling 2 of 2 on a non-last row renders 2/2 in the first-message counter style', () => {
        const chat = twoSiblingChat()
        const { root } = mountRow(chat, 1)
        const shown = counter(root)
        expect(shown?.textContent?.trim()).toBe('2/2')
        expect(shown?.className).toContain('text-xs')
        expect(shown?.className).toContain('text-textcolor2')
    })

    test('a position without siblings renders no counter and no arrows', () => {
        const chat = twoSiblingChat()
        const { root } = mountRow(chat, 0)
        expect(counter(root)).toBeUndefined()
        expect(back(root)).toBeNull()
        expect(forward(root)).toBeNull()
    })

    test('Swipe off: no counter anywhere, a non-last row with siblings still shows arrows', () => {
        const chat = twoSiblingChat({ swipe: false })
        const row = mountRow(chat, 1)
        expect(counter(row.root)).toBeUndefined()
        expect(back(row.root)).not.toBeNull()
        expect(forward(row.root)).not.toBeNull()
        const last = mountRow(chat, 3)
        expect(counter(last.root)).toBeUndefined()
    })
})

describe('the arrows', () => {
    test('a non-last row with siblings: back is enabled at 2/2, forward is disabled at the last sibling, and a press names the row', () => {
        const chat = twoSiblingChat()
        const { root, onStep } = mountRow(chat, 1)
        expect(back(root)!.disabled).toBe(false)
        expect(forward(root)!.disabled).toBe(true)
        back(root)!.click()
        expect(onStep).toHaveBeenCalledWith(1, 'c2', 'back')
    })

    test('a non-last row at the first of its siblings: back is disabled and forward steps', () => {
        const chat = setup(
            pathOf(['u1', 'user', 1], ['c1', 'char', 2], ['u3', 'user', 6], ['c4', 'char', 7]),
            [record('c2', 'char', 3, 'u1')],
        )
        const { root, onStep } = mountRow(chat, 1)
        expect(back(root)!.disabled).toBe(true)
        expect(forward(root)!.disabled).toBe(false)
        forward(root)!.click()
        expect(onStep).toHaveBeenCalledWith(1, 'c1', 'forward')
    })

    test('the last row always shows both arrows; back is disabled without an earlier sibling', () => {
        const chat = setup(pathOf(['u1', 'user', 1], ['c2', 'char', 3]), undefined)
        const { root } = mountRow(chat, 1)
        expect(back(root)!.disabled).toBe(true)
        expect(forward(root)!.disabled).toBe(false)
        expect(counter(root)).toBeUndefined()
    })

    test('the arrows do not carry the hover-only class', () => {
        const chat = setup(pathOf(['u1', 'user', 1], ['c2', 'char', 3]), undefined)
        const { root } = mountRow(chat, 1)
        expect(back(root)!.classList.contains('dyna-icon')).toBe(false)
        expect(forward(root)!.classList.contains('dyna-icon')).toBe(false)
    })
})

describe('the generating arrow', () => {
    test('only the last row, with no later sibling, styles forward and marks it', () => {
        const chat = setup(pathOf(['u1', 'user', 1], ['c2', 'char', 3]), [record('c1', 'char', 2, 'u1')])
        const { root } = mountRow(chat, 1)
        expect(forward(root)!.classList.contains('text-draculared')).toBe(true)
        expect(forward(root)!.getAttribute('data-generates')).toBe('true')
        expect(forward(root)!.disabled).toBe(false)
    })

    test('the last row with a later sibling steps instead: no styling, no mark', () => {
        const chat = setup(pathOf(['u1', 'user', 1], ['c1', 'char', 2]), [record('c2', 'char', 3, 'u1')])
        const { root } = mountRow(chat, 1)
        expect(forward(root)!.classList.contains('text-draculared')).toBe(false)
        expect(forward(root)!.hasAttribute('data-generates')).toBe(false)
        expect(forward(root)!.disabled).toBe(false)
    })

    test('a non-last row never carries the styling', () => {
        const chat = twoSiblingChat()
        const { root } = mountRow(chat, 1)
        expect(forward(root)!.classList.contains('text-draculared')).toBe(false)
        expect(forward(root)!.hasAttribute('data-generates')).toBe(false)
    })

    test('with no reroll base and no later sibling forward is disabled and unstyled', () => {
        const chat = setup([message('c1', 'char', 2)], undefined)
        const { root } = mountRow(chat, 0)
        expect(forward(root)!.disabled).toBe(true)
        expect(forward(root)!.classList.contains('text-draculared')).toBe(false)
        expect(forward(root)!.hasAttribute('data-generates')).toBe(false)
    })

    test('Swipe off: the single refresh icon carries the styling when it will generate', () => {
        const chat = setup(pathOf(['u1', 'user', 1], ['c2', 'char', 3]), undefined, { swipe: false })
        const { root } = mountRow(chat, 1)
        expect(back(root)).toBeNull()
        expect(forward(root)!.querySelector('svg.lucide-refresh-ccw')).not.toBeNull()
        expect(forward(root)!.classList.contains('text-draculared')).toBe(true)
    })
})

describe('busy', () => {
    test('arrows, the end control and Branch render disabled while busy and enabled after', async () => {
        const chat = setup(
            pathOf(['u1', 'user', 1], ['c2', 'char', 3], ['u3', 'user', 6]),
            [record('c1', 'char', 2, 'u1'), record('x4', 'char', 7, 'u3')],
        )
        const middle = mountRow(chat, 1)
        const last = mountRow(chat, 2)
        const branch = await branchButtonOf(middle.root)
        expect(back(middle.root)!.disabled).toBe(false)
        expect(endControl(last.root)!.disabled).toBe(false)
        expect(branch.disabled).toBe(false)

        busy.value = true
        flushSync()
        expect(back(middle.root)!.disabled).toBe(true)
        expect(forward(middle.root)!.disabled).toBe(true)
        expect(endControl(last.root)!.disabled).toBe(true)
        expect(branch.disabled).toBe(true)

        busy.value = false
        flushSync()
        expect(back(middle.root)!.disabled).toBe(false)
        expect(endControl(last.root)!.disabled).toBe(false)
        expect(branch.disabled).toBe(false)
    })
})

describe('Branch', () => {
    test('is disabled on the last row and enabled on an earlier one, which presses with its id', async () => {
        const chat = setup(pathOf(['u1', 'user', 1], ['c2', 'char', 3]), undefined)
        const first = mountRow(chat, 0)
        const last = mountRow(chat, 1)
        const earlier = await branchButtonOf(first.root)
        const lastButton = await branchButtonOf(last.root)
        expect(lastButton.disabled).toBe(true)
        expect(earlier.disabled).toBe(false)
        earlier.click()
        await settle()
        expect(first.onBranch).toHaveBeenCalledWith(0, 'u1')
        expect(last.onBranch).not.toHaveBeenCalled()
    })

    test('a row mounted without a view (a bookmarked row) disables Branch from the live length', async () => {
        const chat = setup(pathOf(['u1', 'user', 1], ['c2', 'char', 3]), undefined)
        const lastRow = mountRow(chat, 1, { getTreeView: undefined, onStep: undefined, rerollIcon: false })
        const earlierRow = mountRow(chat, 0, { getTreeView: undefined, onStep: undefined, rerollIcon: false })
        expect((await branchButtonOf(lastRow.root)).disabled).toBe(true)
        expect((await branchButtonOf(earlierRow.root)).disabled).toBe(false)
        expect(back(earlierRow.root)).toBeNull()
    })

    test('the settings list no longer offers a folder per branch', () => {
        expect(accessibilitySettingsItems.some((item) => item.id === 'acc.createFolderOnBranch')).toBe(false)
        expect(accessibilitySettingsItems.some((item) => ('bindKey' in item) && item.bindKey === 'createFolderOnBranch')).toBe(false)
    })
})

describe('the end control', () => {
    function endingChat(db: Record<string, unknown> = {}): FixtureChat {
        return setup(
            pathOf(['u1', 'user', 1], ['c2', 'char', 3]),
            [record('x3', 'user', 4, 'c2'), record('x5', 'user', 5, 'c2', 2)],
            db,
        )
    }

    test('shows on the last row only when the path ends with side children, with their count under Swipe', () => {
        const chat = endingChat()
        const first = mountRow(chat, 0)
        const last = mountRow(chat, 1)
        expect(endControl(first.root)).toBeNull()
        expect(endControl(last.root)).not.toBeNull()
        expect(endControl(last.root)!.textContent?.trim()).toBe('2')
    })

    test('a press steps back at the end position with the last message id', () => {
        const chat = endingChat()
        const last = mountRow(chat, 1)
        endControl(last.root)!.click()
        expect(last.onStep).toHaveBeenCalledWith(2, 'c2', 'back')
    })

    test('Swipe off: the control shows without a count', () => {
        const chat = endingChat({ swipe: false })
        const last = mountRow(chat, 1)
        expect(endControl(last.root)).not.toBeNull()
        expect(endControl(last.root)!.textContent?.trim()).toBe('')
    })

    test('is gone when no record follows the last message', () => {
        const chat = setup(pathOf(['u1', 'user', 1], ['c2', 'char', 3]), [record('c1', 'char', 2, 'u1')])
        const last = mountRow(chat, 1)
        expect(endControl(last.root)).toBeNull()
    })

    test('is gone once the path continues', () => {
        const chat = endingChat()
        const last = mountRow(chat, 1)
        expect(endControl(last.root)).not.toBeNull()
        chat.message.push(message('u9', 'user', 9))
        flushSync()
        expect(endControl(last.root)).toBeNull()
    })
})

describe('guards for the other mounts of Chat', () => {
    test('guard: the first-message card keeps its arrows, counter and own handlers', () => {
        const chat = setup([], undefined)
        const onReroll = vi.fn()
        const unReroll = vi.fn()
        const target = document.createElement('div')
        document.body.appendChild(target)
        mountedTargets.push(target)
        mountedInstances.push(mount(Chat, {
            target,
            props: { idx: -1, message: 'hello', isLastMemory: false, firstMessage: true, altGreeting: true, rerollIcon: 'dynamic', currentPage: 2, totalPages: 3, onReroll, unReroll, onStep: vi.fn(), getTreeView: () => treeView(chat as never) },
        }))
        flushSync()
        expect(counter(target)?.textContent?.trim()).toBe('2/3')
        back(target)!.click()
        forward(target)!.click()
        expect(unReroll).toHaveBeenCalledTimes(1)
        expect(onReroll).toHaveBeenCalledTimes(1)
        expect(back(target)!.disabled).toBe(false)
        expect(forward(target)!.disabled).toBe(false)
    })

    test('guard: a row mounted with the old reroll handlers only keeps calling them', () => {
        const chat = setup(pathOf(['u1', 'user', 1], ['c2', 'char', 3]), undefined)
        const onReroll = vi.fn()
        const unReroll = vi.fn()
        const target = document.createElement('div')
        document.body.appendChild(target)
        mountedTargets.push(target)
        mountedInstances.push(mount(Chat, {
            target,
            props: { idx: 1, message: chat.message[1].data, isLastMemory: false, rerollIcon: 'dynamic', onReroll, unReroll },
        }))
        flushSync()
        back(target)!.click()
        forward(target)!.click()
        expect(unReroll).toHaveBeenCalledTimes(1)
        expect(onReroll).toHaveBeenCalledTimes(1)
    })
})
