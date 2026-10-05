/**
 * The `changeChatTo` GUI-pointer fan-out fix.
 *
 * Pins four things, all against the REAL, unmocked
 * `src/ts/globalApi.svelte.ts` -- the module-mock set below is copied
 * verbatim from `src/ts/globalApi.saveSequence.svelte.test.ts` (itself
 * trimmed from `src/ts/globalApiFileCacheAv3.svelte.test.ts`), the
 * established precedent for loading this module for real in a test.
 *
 * 1. Ordering inside `changeChatTo`: write `chatPage`, call the real
 *    `flushSync()`, THEN bump `ReloadGUIPointer`. Proven with a REAL `$effect`
 *    (via `$effect.root`) that depends on `chatPage`, not with a spy that
 *    merely records whether `flushSync` was called -- a spy could be
 *    satisfied by calling `flushSync()` in the wrong place. The effect can
 *    only have run by the time `ReloadGUIPointer`'s subscriber fires if a
 *    real, synchronous flush happened first: `$state` writes only schedule
 *    their effect flush on a microtask, and this assertion runs synchronously
 *    right after `changeChatTo()` returns, before any microtask drains.
 * 2. Existing behaviour that must not regress: a number index or a resolvable
 *    string chat id writes `chatPage` and bumps; an unresolvable string id
 *    returns early without writing `chatPage` and without bumping.
 * 3. The reorder target helper `resolveReorderedChatIndex`. Signature:
 *    `resolveReorderedChatIndex(oldChats: Chat[], newChats: Chat[], currentPage: number): number`.
 *    Exported from `src/ts/globalApi.svelte.ts`, next to `changeChatTo`.
 * 4. The `reorderChatsKeepingCurrent` seam that the two `SideChatList.svelte`
 *    drag-reorder handlers must call: resolve the target against the OLD
 *    chats, assign the new chats array, THEN call `changeChatTo`. Proven with
 *    a REAL `$effect` that samples `chara.chats[chara.chatPage]` on every run
 *    during `changeChatTo`'s internal `flushSync()`, not only against the
 *    settled end state, which cannot tell the correct order apart from the
 *    reverted one (see the `describe` block below for why).
 */
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach } from 'vitest'

//#region module mocks -- copied verbatim from globalApi.saveSequence.svelte.test.ts

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        loadedStore: writable(false),
        LoadingStatusState: { text: '' },
        ReloadGUIPointer: writable(0),
        bodyIntercepterStore: writable(null),
        savingStoppedReason: writable(null),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => {}),
    sleepForever: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => {}),
}))

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async () => { },
                    close: async () => { },
                }),
            },
        }),
    },
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0, Download: 1 },
    writeFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        getItem = vi.fn(async (_key: string) => null as unknown)
        setItem = vi.fn(async () => null)
        keys = vi.fn(async () => [] as string[])
        removeItem = vi.fn(async () => {})
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

//#endregion

import { changeChatTo, resolveReorderedChatIndex, reorderChatsKeepingCurrent } from 'src/ts/globalApi.svelte'
import { DBState, selIdState, ReloadGUIPointer } from 'src/ts/stores.svelte'
import { getCurrentCharacter } from 'src/ts/storage/database.svelte'
import type { Chat } from 'src/ts/storage/database.svelte'

const mockedGetCurrentCharacter = getCurrentCharacter as unknown as ReturnType<typeof vi.fn>

function makeChat(id: string): Chat {
    return { id } as unknown as Chat
}

function resetDb(chatCount = 3, chatPage = 0) {
    const chats = Array.from({ length: chatCount }, (_, i) => makeChat(`chat-${i}`))
    DBState.db = {
        characters: [
            { chaId: 'char-0', chatPage, chats },
        ],
    } as unknown as typeof DBState.db
    selIdState.selId = 0
}

beforeEach(() => {
    resetDb()
    mockedGetCurrentCharacter.mockReset()
})

describe('changeChatTo ordering', () => {
    test('writes chatPage, flushes real pending effects, and only then bumps ReloadGUIPointer -- not merely "flushSync was called"', () => {
        const order: string[] = []

        // A REAL effect that depends on chatPage. $state writes only schedule
        // their effect flush on a microtask, so this can only have logged
        // 'chatPage-effect' by the time we check `order`, synchronously right
        // after changeChatTo() returns, if changeChatTo() itself performed a
        // real, synchronous flush between the chatPage write and the bump.
        const cleanup = $effect.root(() => {
            $effect(() => {
                void DBState.db.characters?.[0]?.chatPage
                order.push('chatPage-effect')
            })
        })
        flushSync() // drain the initial run so it doesn't pollute the log below
        order.length = 0

        const unsubscribe = ReloadGUIPointer.subscribe(() => {
            order.push('bump')
        })
        order.length = 0 // drain the immediate call svelte/store makes on subscribe

        changeChatTo(1)

        // Today: chatPage is written, then ReloadGUIPointer.set() fires its
        // subscriber SYNCHRONOUSLY (svelte/store contract) with no flush in
        // between, so the chatPage effect -- still only microtask-scheduled
        // -- has not run yet. order is ['bump'], and this fails.
        // After the fix: changeChatTo() calls the real flushSync() between
        // the write and the bump, so the chatPage effect has already run.
        expect(order).toEqual(['chatPage-effect', 'bump'])

        unsubscribe()
        cleanup()
    })
})

describe('changeChatTo existing behaviour that must not regress', () => {
    test('a number index writes chatPage and bumps ReloadGUIPointer', () => {
        const bump = vi.fn()
        const unsubscribe = ReloadGUIPointer.subscribe(bump)
        bump.mockClear()

        changeChatTo(2)

        expect(DBState.db.characters[0].chatPage).toBe(2)
        expect(bump).toHaveBeenCalledTimes(1)
        unsubscribe()
    })

    test('a resolvable string chat id resolves via getCurrentCharacter, writes chatPage and bumps', () => {
        mockedGetCurrentCharacter.mockReturnValue({
            chats: [makeChat('chat-0'), makeChat('chat-1'), makeChat('chat-2')],
        })
        const bump = vi.fn()
        const unsubscribe = ReloadGUIPointer.subscribe(bump)
        bump.mockClear()

        changeChatTo('chat-2')

        expect(DBState.db.characters[0].chatPage).toBe(2)
        expect(bump).toHaveBeenCalledTimes(1)
        unsubscribe()
    })

    test('a numeric -1 returns early: chatPage is not written and ReloadGUIPointer is not bumped', () => {
        const before = DBState.db.characters[0].chatPage
        const bump = vi.fn()
        const unsubscribe = ReloadGUIPointer.subscribe(bump)
        bump.mockClear()

        changeChatTo(-1)

        expect(DBState.db.characters[0].chatPage).toBe(before)
        expect(bump).not.toHaveBeenCalled()
        unsubscribe()
    })

    test('an unresolvable string id returns early: chatPage is not written and ReloadGUIPointer is not bumped', () => {
        mockedGetCurrentCharacter.mockReturnValue({
            chats: [makeChat('chat-0'), makeChat('chat-1')],
        })
        const before = DBState.db.characters[0].chatPage
        const bump = vi.fn()
        const unsubscribe = ReloadGUIPointer.subscribe(bump)
        bump.mockClear()

        changeChatTo('does-not-exist')

        expect(DBState.db.characters[0].chatPage).toBe(before)
        expect(bump).not.toHaveBeenCalled()
        unsubscribe()
    })
})

describe('resolveReorderedChatIndex (helper)', () => {
    test('returns the index of the SAME chat object in the reordered array, not the old page index read against the new array', () => {
        const chatA = makeChat('a')
        const chatB = makeChat('b')
        const chatC = makeChat('c')
        const oldChats = [chatA, chatB, chatC]
        // A genuine permutation: chatB (old index 1) moves to new index 2.
        const newChats = [chatC, chatA, chatB]
        const currentPage = 1 // chatB, in oldChats

        const result = resolveReorderedChatIndex(oldChats, newChats, currentPage)

        expect(result).toBe(2) // chatB's real position in newChats

        // The wrong, naive approach this helper must not reduce to: reading
        // the OLD page index straight against the NEW array lands on a
        // different chat object entirely for this permutation.
        expect(newChats[currentPage]).not.toBe(chatB)
        expect(newChats[currentPage]).toBe(chatA)
        expect(result).not.toBe(currentPage)
    })

    test('returns the new index even when every chat moves (full reversal)', () => {
        const chatA = makeChat('a')
        const chatB = makeChat('b')
        const chatC = makeChat('c')
        const oldChats = [chatA, chatB, chatC]
        const newChats = [chatC, chatB, chatA]

        expect(resolveReorderedChatIndex(oldChats, newChats, 0)).toBe(2) // chatA: 0 -> 2
        expect(resolveReorderedChatIndex(oldChats, newChats, 1)).toBe(1) // chatB: unmoved
        expect(resolveReorderedChatIndex(oldChats, newChats, 2)).toBe(0) // chatC: 2 -> 0
    })

    test('returns -1 when the current chat is absent from the new array', () => {
        const chatA = makeChat('a')
        const chatB = makeChat('b')
        const oldChats = [chatA, chatB]
        const newChats = [chatA] // chatB was removed by the reorder/delete

        const result = resolveReorderedChatIndex(oldChats, newChats, 1)

        expect(result).toBe(-1)
    })

    test('a no-op reorder (identical array) returns the same index', () => {
        const chatA = makeChat('a')
        const chatB = makeChat('b')
        const oldChats = [chatA, chatB]
        const newChats = [chatA, chatB]

        expect(resolveReorderedChatIndex(oldChats, newChats, 1)).toBe(1)
    })
})

describe('reorderChatsKeepingCurrent (the two SideChatList drag-reorder handlers)', () => {
    /**
     * The seam the two `onEnd` handlers in SideChatList.svelte must call:
     * compute the target against the OLD `chara.chats`, THEN assign
     * `chara.chats = newChats`, THEN call `changeChatTo(target)`.
     *
     * An end-state assertion alone cannot distinguish the correct order from
     * the old, reverted order ("changeChatTo(target); chara.chats =
     * newChats"): both orders leave `chara.chats === newChats` and
     * `chatPage === target` once every write has settled, so a test that
     * only checks the final snapshot cannot tell them apart. The difference
     * is only observable WHILE `changeChatTo`'s internal `flushSync()` is
     * draining pending effects: a real `$effect` records, on every run,
     * whether `chara.chats[chara.chatPage]` still points at the chat object
     * the user was on before the reorder. Under the correct order that pair
     * is consistent on every sample. Under the reverted order,
     * `changeChatTo`'s flush runs while `chara.chats` is still the OLD
     * array, indexed by a page number that was computed for the NEW array,
     * so the sampled pair is briefly wrong.
     */
    test('the chat the user was on stays selected on every effect run sampled during the flush, not only at the end', () => {
        resetDb()
        const chara = DBState.db.characters[0]
        chara.chats = [makeChat('a'), makeChat('b'), makeChat('c')]
        chara.chatPage = 1 // the user is on chat "b"

        // Read the elements back OUT of chara.chats, exactly as
        // SideChatList.svelte's onEnd handlers build `newChats` (they push
        // `chara.chats[idx]`, never a freshly-constructed literal). Once
        // `chara.chats` is reactive state, `chara.chats[i]` returns Svelte's
        // proxy for that element, not the raw object literal -- so the
        // permuted array must reuse THESE references for identity-based
        // lookups (`resolveReorderedChatIndex`'s `indexOf`) to work at all,
        // matching production.
        const [readA, readB, readC] = chara.chats

        // Captured the way a caller would: "the chat object I was on",
        // before the reorder touches anything.
        const currentChat = chara.chats[chara.chatPage]
        expect(currentChat).toBe(readB)

        // A genuine permutation: chat "b" moves from old index 1 to new index 2.
        const newChats = [readC, readA, readB]

        let sawInconsistentPair = false
        const samples: Array<{ page: number; atPage: unknown }> = []
        const cleanup = $effect.root(() => {
            $effect(() => {
                const chats = chara.chats
                const page = chara.chatPage
                const atPage = chats?.[page]
                samples.push({ page, atPage })
                if (atPage !== undefined && atPage !== currentChat) {
                    sawInconsistentPair = true
                }
            })
        })
        flushSync() // drain the effect's initial run (chats/page not yet touched: consistent)
        sawInconsistentPair = false
        samples.length = 0

        reorderChatsKeepingCurrent(chara, newChats, 1)
        // Snapshot the sample count HERE, before the test's own trailing
        // flush below. `changeChatTo`'s internal `flushSync()` runs the
        // effect above synchronously inside `reorderChatsKeepingCurrent`,
        // so every sample that lands in this window was taken during the
        // seam this test exists to watch. Without this check, an edit that
        // stopped the observer effect from re-running during that flush
        // (e.g. by making it depend on nothing `changeChatTo` touches)
        // would leave `sawInconsistentPair` at its initial `false` and this
        // test -- which carries the entire ordering contract, the only
        // test that would catch an implementation that calls `changeChatTo`
        // before assigning `chara.chats = newChats` -- would pass for the
        // wrong reason.
        const samplesDuringSeam = samples.length
        flushSync() // drain anything reorderChatsKeepingCurrent scheduled but didn't itself flush

        expect(samplesDuringSeam).toBeGreaterThan(0)
        expect(sawInconsistentPair).toBe(false)

        // End-state pins too (necessary but, per the comment above, not
        // sufficient on their own to distinguish the two orderings). Compare
        // by id, not `toBe`: reassigning a plain array into reactive $state
        // wraps it in a fresh proxy each time, so the array reference itself
        // is never `===` to the plain array literal that was assigned, even
        // though it holds the same (already-proxied) elements.
        expect(chara.chats.map((c) => c.id)).toEqual(newChats.map((c) => c.id))
        expect(chara.chats[chara.chatPage]).toBe(currentChat)
        expect(chara.chatPage).toBe(2) // "b"'s real position in newChats

        cleanup()
    })

    test('computes the target against the OLD chats, not the new array indexed by the old page number', () => {
        // This alone is an end-state check, which is enough to catch a
        // target-computation bug (resolving against newChats/newChats) even
        // without sampling mid-flush, because that bug lands on the WRONG
        // final chat, not merely a transient one.
        resetDb()
        const chara = DBState.db.characters[0]
        chara.chats = [makeChat('a'), makeChat('b'), makeChat('c')]
        chara.chatPage = 1 // the user is on chat "b"

        const [readA, readB, readC] = chara.chats
        const currentChat = chara.chats[chara.chatPage]
        const newChats = [readC, readA, readB] // "b": old index 1 -> new index 2

        reorderChatsKeepingCurrent(chara, newChats, 1)
        flushSync()

        expect(chara.chats.map((c) => c.id)).toEqual(newChats.map((c) => c.id))
        expect(chara.chatPage).toBe(2)
        expect(chara.chats[chara.chatPage]).toBe(currentChat)
        // The wrong result a "resolve against newChats twice" bug would
        // produce: reading the OLD page index straight against newChats
        // lands on "a", not "b".
        expect(chara.chats[chara.chatPage]).not.toBe(readA)
    })

    test('a no-op reorder (identical array) never observes an inconsistent pair either', () => {
        resetDb()
        const chara = DBState.db.characters[0]
        chara.chats = [makeChat('a'), makeChat('b')]
        chara.chatPage = 1

        const [readA, readB] = chara.chats
        const currentChat = chara.chats[chara.chatPage]
        const newChats = [readA, readB] // same order, new array identity

        let sawInconsistentPair = false
        const cleanup = $effect.root(() => {
            $effect(() => {
                const chats = chara.chats
                const page = chara.chatPage
                const atPage = chats?.[page]
                if (atPage !== undefined && atPage !== currentChat) {
                    sawInconsistentPair = true
                }
            })
        })
        flushSync()
        sawInconsistentPair = false

        reorderChatsKeepingCurrent(chara, newChats, 1)
        flushSync()

        expect(sawInconsistentPair).toBe(false)
        expect(chara.chatPage).toBe(1)

        cleanup()
    })
})
