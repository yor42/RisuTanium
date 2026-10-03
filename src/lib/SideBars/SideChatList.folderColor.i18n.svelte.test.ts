// @vitest-environment happy-dom

/**
 * The chat-folder colour menu in `SideChatList.svelte` offers the colour names in the UI
 * language and stores the English lower-case colour for the chosen position. An answer that
 * is not the index of a colour (an empty string, an out-of-range or negative index) leaves the
 * folder colour as it was and throws nothing. The language is set before mount and restored
 * to English afterwards.
 *
 * Mounts the REAL `SideChatList.svelte` over a real `$state` character, with the module mocks
 * of `SideChatList.folderDeleteTarget.svelte.test.ts` (same directory). MOCKED: `alertSelect`,
 * which answers from a queue and records what it was offered.
 *
 * Tests whose title starts with `guard:` pass with or without the change.
 * Tests starting `regression reproducer:` fail while the behaviour they name is missing.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database, character } from 'src/ts/storage/database.svelte'

const select = vi.hoisted(() => ({ answers: [] as string[], offers: [] as string[][] }))

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertSelect: async (offered: string[]) => {
            select.offers.push(offered)
            return select.answers.shift() ?? '1'
        },
        alertConfirm: vi.fn(async () => false),
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/characters'), () => ({
    exportChat: vi.fn(),
    importChat: vi.fn(),
    exportAllChats: vi.fn(),
    createNewChat: vi.fn(),
    removeChatConfirmed: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    changeChatTo: vi.fn(),
    createChatCopyName: vi.fn((name: string) => `${name} Copy`),
    reorderChatsKeepingCurrent: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
    sortableOptions: { delay: 300, delayOnTouchOnly: true, filter: '.no-sort', onMove: () => true },
}) as unknown as typeof import('src/ts/util'))

vi.mock('sortablejs/modular/sortable.core.esm.js', () => {
    class Sortable {
        static create() { return new Sortable() }
        destroy() {}
    }
    return { default: Sortable }
})

vi.mock('./Toggles.svelte', () => ({ default: () => {} }))

import { DBState } from 'src/ts/stores.svelte'
import { changeLanguage } from 'src/lang'
import { languageKorean } from 'src/lang/ko'
import SideChatList from './SideChatList.svelte'

const STORED = ['red', 'green', 'blue', 'yellow', 'indigo', 'purple', 'pink', 'default']
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function makeCharacter(color: string): character {
    const chara = $state({
        type: 'character', chaId: 'c0', name: 'c0', chatPage: 0,
        chatFolders: [{ id: 'f0', name: 'F0', folded: false, color }],
        chats: [],
    })
    return chara as unknown as character
}

let mounted: { target: HTMLElement, app: Record<string, unknown> } | null = null

/** Opens the folder's colour menu, answers "change colour", then answers the colour select with `answer`. */
async function pickColor(chara: character, answer: string): Promise<unknown[]> {
    select.answers.push('0', answer)
    DBState.db = { characters: [], personas: [], selectedPersona: 0 } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(SideChatList, { target, props: { chara } }) as unknown as Record<string, unknown>
    mounted = { target, app }
    flushSync()

    const unhandled: unknown[] = []
    const record = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', record)
    try {
        const span = Array.from(target.querySelectorAll('button > span')).find((s) => s.textContent?.trim() === 'F0')!
        ;(span.closest('button')!.querySelector('[role=button]') as HTMLElement).click()
        await sleep(20)
        flushSync()
    } finally {
        process.off('unhandledRejection', record)
    }
    return unhandled
}

beforeEach(() => {
    select.answers.length = 0
    select.offers.length = 0
})

afterEach(async () => {
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
        mounted = null
    }
    changeLanguage('en')
})

describe('chat folder colour select', () => {
    test('regression reproducer: Korean offers the colour names in Korean', async () => {
        changeLanguage('ko')
        await pickColor(makeCharacter('red'), '2')

        const ko = languageKorean.sidebarUi
        expect(select.offers[1]).toEqual([
            ko.folderColorRed,
            ko.folderColorGreen,
            ko.folderColorBlue,
            ko.folderColorYellow,
            ko.folderColorIndigo,
            ko.folderColorPurple,
            ko.folderColorPink,
            ko.folderColorDefault,
        ])
    })

    test('guard: picking a colour in Korean stores the English lower-case colour for that position', async () => {
        changeLanguage('ko')
        const chara = makeCharacter('red')
        await pickColor(chara, '2')
        expect(chara.chatFolders[0].color).toBe('blue')
    })

    test('guard: English offers the English colour names and stores the picked one', async () => {
        const chara = makeCharacter('red')
        await pickColor(chara, '7')
        expect(select.offers[1]).toEqual(STORED)
        expect(chara.chatFolders[0].color).toBe('default')
    })

    test.each([['an empty answer', ''], ['an out-of-range index', '99'], ['a negative index', '-1']])(
        'regression reproducer: %s leaves the folder colour unchanged and throws nothing',
        async (_label, answer) => {
            const chara = makeCharacter('red')
            const unhandled = await pickColor(chara, answer)

            expect(chara.chatFolders[0].color).toBe('red')
            expect(select.offers).toHaveLength(2)
            expect(unhandled).toEqual([])
        },
    )
})