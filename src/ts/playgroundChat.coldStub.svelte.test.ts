/**
 * `openPlaygroundChat` (`src/ts/playgroundChat.ts`) when the `§playground`
 * utility character is archived: a placeholder (the "stub") in
 * `DBState.db.characters` whose full data lives in a cold-storage unit.
 *
 * Invariants exercised here:
 * - An archived `§playground` is restored from its unit before the Playground
 *   chat opens: the slot then holds the unit's character with its chats kept,
 *   as the utility bot named 'assistant' with the '{{none}}' greeting, it is
 *   selected, and the Playground view is on its chat page.
 * - When the unit cannot be read the stub is left exactly as it was, nothing
 *   is selected, the Playground view does not move to its chat page, and the
 *   user is told once, by name.
 * - A restore that ends with a placeholder still holding the slot (the slot
 *   points at another unit than the one read) is a failure like an unreadable
 *   unit: the placeholder is never written or selected and the user is told.
 *   A restore that ends with no `§playground` in the list at all opens a blank one.
 * - A `§playground` that is already full, or absent, is opened directly.
 *
 * Every cold-storage read goes through the mocked `readColdStorageItem`. This
 * file drives the REAL `src/ts/playgroundChat.ts`, `src/ts/characters.ts` and
 * the cold-character modules, with the import set of
 * `characters.coldRestore.svelte.test.ts`.
 */
import { get, writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import type { Database, character } from './storage/database.svelte'

//#region module mocks -- the import set of characters.coldRestore.svelte.test.ts

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
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        PlaygroundStore: writable(0),
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(null),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    changeChatTo: vi.fn(),
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
    getFileSrc: vi.fn(),
    requiresFullEncoderReload: { state: false },
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertAddCharacter: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertMd: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('src/ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => liveDBState.db),
        setDatabase: vi.fn((db: Database) => { liveDBState.db = db }),
        presetTemplate: { name: 'test-preset' },
        saveImage: vi.fn(),
        defaultSdDataFunc: vi.fn(() => ({})),
        getCharacterByIndex: vi.fn((index: number) => liveDBState.db.characters?.[index]),
        setCharacterByIndex: vi.fn((index: number, char: unknown) => {
            liveDBState.db.characters[index] = char as never
        }),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

// `findCharacterIndexbyId` is faithful to production: the index of the first
// character holding the id, or -1.
vi.mock(import('src/ts/util'), async () => {
    const { DBState: liveDBState } = await import('src/ts/stores.svelte')
    return {
        checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
        findCharacterbyId: vi.fn(),
        findCharacterIndexbyId: vi.fn((id: string) => liveDBState.db.characters.findIndex((c) => c.chaId === id)),
        getUserName: vi.fn(() => 'User'),
        selectMultipleFile: vi.fn(),
        selectSingleFile: vi.fn(),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/media'), () => ({
    getImageType: vi.fn(),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn((cha: unknown) => cha),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    parseMarkdownSafe: vi.fn(),
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('src/ts/pngChunk'))

const readColdStorageItemMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: readColdStorageItemMock,
    getColdStorageItem: async (key: string) => {
        const result = await readColdStorageItemMock(key)
        return result?.status === 'ok' ? result.value : null
    },
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

//#endregion

import { DBState, PlaygroundStore, selectedCharID } from 'src/ts/stores.svelte'
import { alertError, alertNormal, alertToast, alertMd } from 'src/ts/alert'
import { buildColdStub } from 'src/ts/process/tests/coldStubFixture'
import { language } from 'src/lang'
import { openPlaygroundChat } from './playgroundChat'

//#region fixtures and helpers

type Slot = Database['characters'][number]

const PLAYGROUND = '§playground'

function fullCharacter(chaId: string, extra: Record<string, unknown> = {}): character {
    return {
        type: 'character',
        name: `${chaId} name`,
        image: '',
        chaId,
        chatPage: 0,
        firstMsgIndex: 0,
        firstMessage: `${chaId} greeting`,
        creatorNotes: '',
        lastInteraction: 1,
        desc: `${chaId} description`,
        globalLore: [],
        newGenData: true,
        utilityBot: false,
        chats: [{ id: `${chaId}-chat`, message: [{ role: 'user', data: 'Hi', time: 1 }], note: '', name: 'Chat 1', localLore: [] }],
        ...extra,
    } as unknown as character
}

function asSlot(value: character): Slot {
    return value as unknown as Slot
}

/**
 * An archived copy of `source` as the character list holds it: the stub
 * builder's fields, with the collections a loaded list entry always carries
 * defaulted to empty, so formatting the stub is possible but reads no data.
 */
function stubOf(source: character, key: string): Slot {
    return asSlot({ ...buildColdStub(source, key, []), globalLore: [] } as unknown as character)
}

function installDb(characters: Slot[]): void {
    DBState.db = { characters } as unknown as Database
}

function slot(index: number): character {
    return DBState.db.characters[index] as unknown as character
}

function ok(restored: character) {
    return { status: 'ok', value: { character: restored } }
}

function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

function shownAlerts(): string[] {
    return [alertError, alertNormal, alertToast, alertMd].flatMap((fn) => vi.mocked(fn).mock.calls.map((args) => String(args[0])))
}

let consoleErrorSpy: MockInstance<typeof console.error>

beforeEach(() => {
    readColdStorageItemMock.mockReset()
    for (const fn of [alertError, alertNormal, alertToast, alertMd]) {
        vi.mocked(fn).mockClear()
    }
    selectedCharID.set(-1)
    PlaygroundStore.set(0)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    consoleErrorSpy.mockRestore()
})

//#endregion

describe('openPlaygroundChat on an archived §playground', () => {
    test('restores the unit\'s character with its chats, makes it the utility bot, selects it and opens the chat page', async () => {
        const unit = fullCharacter(PLAYGROUND, {
            name: 'Playground from the unit',
            desc: 'description from the unit',
            chats: [
                { id: 'chat-one', message: [{ role: 'user', data: 'first', time: 1 }], note: '', name: 'One', localLore: [] },
                { id: 'chat-two', message: [{ role: 'user', data: 'second', time: 1 }], note: '', name: 'Two', localLore: [] },
            ],
        })
        installDb([asSlot(fullCharacter('other')), stubOf(unit, 'unit-playground')])
        readColdStorageItemMock.mockResolvedValue(ok(unit))

        await openPlaygroundChat()

        const restored = slot(1)
        expect(restored.coldstorage).toBeUndefined()
        expect(restored.desc).toBe('description from the unit')
        expect(restored.chats.map((c) => c.id)).toEqual(['chat-one', 'chat-two'])
        expect(restored.chats[1].message[0].data).toBe('second')
        expect(restored.utilityBot).toBe(true)
        expect(restored.name).toBe('assistant')
        expect(restored.firstMessage).toBe('{{none}}')
        expect(get(selectedCharID)).toBe(1)
        expect(get(PlaygroundStore)).toBe(2)
        expect(shownAlerts()).toEqual([])
    })

    test.each([
        ['a missing unit', { status: 'missing' }],
        ['an unreadable unit', { status: 'error', error: new Error('disk unavailable') }],
    ] as const)('%s leaves the stub exactly as it was, selects nothing, keeps the Playground view where it was, and shows one alert naming it', async (_label, item) => {
        const unit = fullCharacter(PLAYGROUND)
        const stub = stubOf(unit, 'unit-playground')
        ;(stub as unknown as character).name = 'Playground Archive'
        installDb([asSlot(fullCharacter('other')), stub])
        selectedCharID.set(0)
        const before = JSON.stringify(DBState.db.characters[1])
        readColdStorageItemMock.mockResolvedValue(item)

        await openPlaygroundChat()

        expect(JSON.stringify(DBState.db.characters[1])).toBe(before)
        expect(slot(1).coldstorage).toBe('unit-playground')
        expect(get(selectedCharID)).toBe(0)
        expect(get(PlaygroundStore)).toBe(0)
        const alerts = shownAlerts()
        expect(alerts).toHaveLength(1)
        expect(alerts[0]).toContain('Playground Archive')
    })

    test('a restore that ends with a placeholder still holding the slot leaves it unwritten and unselected, keeps the Playground view where it was, and shows one alert naming it', async () => {
        const unit = fullCharacter(PLAYGROUND)
        const stub = stubOf(unit, 'unit-playground')
        ;(stub as unknown as character).name = 'Playground Archive'
        installDb([asSlot(fullCharacter('other')), stub])
        selectedCharID.set(0)
        let release: (value: unknown) => void = () => {}
        readColdStorageItemMock.mockImplementation(() => new Promise((resolve) => { release = resolve }))

        const opening = openPlaygroundChat()
        await tick()
        // The slot now points at a different unit than the one being read, so
        // the restore has nothing to install and ends without a full holder.
        ;(DBState.db.characters[1] as unknown as character).coldstorage = 'unit-moved'
        const before = JSON.stringify(DBState.db.characters[1])
        release(ok(unit))
        await opening

        expect(JSON.stringify(DBState.db.characters[1])).toBe(before)
        expect(slot(1).coldstorage).toBe('unit-moved')
        expect(get(selectedCharID)).toBe(0)
        expect(get(PlaygroundStore)).not.toBe(2)
        const alerts = shownAlerts()
        expect(alerts).toHaveLength(1)
        expect(alerts[0]).toContain('Playground Archive')
    })

    test.each([
        ['no storage on the page', 'unavailable', /offers no storage/i, (name: string) => language.errors.coldStorageNamedRestoreUnavailable(name)],
        ['a copy that cannot be read', 'damaged', /may be damaged/i, (name: string) => language.errors.coldStorageNamedRestoreDamaged(name)],
    ] as const)('%s leaves the stub as it was, selects nothing, and shows one alert naming it with the wording for that cause', async (_label, kind, wording, expectedText) => {
        const unit = fullCharacter(PLAYGROUND)
        const stub = stubOf(unit, 'unit-playground')
        ;(stub as unknown as character).name = 'Playground Archive'
        installDb([asSlot(fullCharacter('other')), stub])
        selectedCharID.set(0)
        const before = JSON.stringify(DBState.db.characters[1])
        readColdStorageItemMock.mockResolvedValue({ status: 'error', error: new Error('cannot be used here'), kind })

        await openPlaygroundChat()

        expect(JSON.stringify(DBState.db.characters[1])).toBe(before)
        expect(get(selectedCharID)).toBe(0)
        expect(get(PlaygroundStore)).toBe(0)
        const alerts = shownAlerts()
        expect(alerts).toHaveLength(1)
        expect(alerts[0]).toContain('Playground Archive')
        expect(alerts[0]).not.toMatch(/try again/i)
        expect(alerts[0]).toMatch(wording)
        expect(alerts[0]).toBe(expectedText('Playground Archive'))
    })

    test('guard: an unreadable unit with no cause shows the named try-again text', async () => {
        const unit = fullCharacter(PLAYGROUND)
        const stub = stubOf(unit, 'unit-playground')
        ;(stub as unknown as character).name = 'Playground Archive'
        installDb([asSlot(fullCharacter('other')), stub])
        readColdStorageItemMock.mockResolvedValue({ status: 'error', error: new Error('disk unavailable') })

        await openPlaygroundChat()

        expect(shownAlerts()).toEqual([language.errors.coldStorageNamedRestoreUnreadable('Playground Archive')])
    })

    test('guard: a restore that ends with a placeholder still holding the slot, after a read that succeeded, shows the named try-again text', async () => {
        const unit = fullCharacter(PLAYGROUND)
        const stub = stubOf(unit, 'unit-playground')
        ;(stub as unknown as character).name = 'Playground Archive'
        installDb([asSlot(fullCharacter('other')), stub])
        let release: (value: unknown) => void = () => {}
        readColdStorageItemMock.mockImplementation(() => new Promise((resolve) => { release = resolve }))

        const opening = openPlaygroundChat()
        await tick()
        ;(DBState.db.characters[1] as unknown as character).coldstorage = 'unit-moved'
        release(ok(unit))
        await opening

        expect(shownAlerts()).toEqual([language.errors.coldStorageNamedRestoreUnreadable('Playground Archive')])
    })

    test('a restore that ends with no §playground left in the list creates a blank one, selects it and opens the chat page', async () => {
        const unit = fullCharacter(PLAYGROUND)
        installDb([asSlot(fullCharacter('other')), stubOf(unit, 'unit-playground')])
        let release: (value: unknown) => void = () => {}
        readColdStorageItemMock.mockImplementation(() => new Promise((resolve) => { release = resolve }))

        const opening = openPlaygroundChat()
        await tick()
        DBState.db.characters.splice(1, 1)
        release(ok(unit))
        await opening

        expect(DBState.db.characters).toHaveLength(2)
        expect(slot(1).chaId).toBe(PLAYGROUND)
        expect(slot(1).coldstorage).toBeUndefined()
        expect(slot(1).utilityBot).toBe(true)
        expect(slot(1).name).toBe('assistant')
        expect(slot(1).firstMessage).toBe('{{none}}')
        expect(get(selectedCharID)).toBe(1)
        expect(get(PlaygroundStore)).toBe(2)
        expect(shownAlerts()).toEqual([])
    })

    test('guard: a full §playground becomes the utility bot, gets an interaction time, is selected and opens the chat page', async () => {
        installDb([asSlot(fullCharacter('other')), asSlot(fullCharacter(PLAYGROUND, { name: 'Old name', firstMessage: 'Old greeting' }))])

        await openPlaygroundChat()

        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(slot(1).utilityBot).toBe(true)
        expect(slot(1).name).toBe('assistant')
        expect(slot(1).firstMessage).toBe('{{none}}')
        expect(slot(1).lastInteraction).toBeGreaterThan(1)
        expect(slot(1).chats.map((c) => c.id)).toEqual([`${PLAYGROUND}-chat`])
        expect(get(selectedCharID)).toBe(1)
        expect(get(PlaygroundStore)).toBe(2)
        expect(shownAlerts()).toEqual([])
    })

    test('guard: with no §playground one is created as the utility bot and selected', async () => {
        installDb([asSlot(fullCharacter('other'))])

        await openPlaygroundChat()

        expect(DBState.db.characters).toHaveLength(2)
        expect(slot(1).chaId).toBe(PLAYGROUND)
        expect(slot(1).utilityBot).toBe(true)
        expect(slot(1).name).toBe('assistant')
        expect(slot(1).firstMessage).toBe('{{none}}')
        expect(get(selectedCharID)).toBe(1)
        expect(get(PlaygroundStore)).toBe(2)
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
    })
})
