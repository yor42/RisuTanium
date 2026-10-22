/**
 * Groups and archived members: `changeChar` (selecting a group) and
 * `createNewChat` (the New Chat button) in `src/ts/characters.ts`.
 *
 * An archived character is a placeholder (the "stub") in
 * `DBState.db.characters` whose full data lives in a cold-storage unit; only
 * its `name`, `image`, `chaId`, `type`, `lastInteraction`, `trashTime` and, for
 * a group, `characters` are real. Invariants exercised here:
 *
 * - When a group is selected, every archived member that can be restored is a
 *   full character in its slot before `selectedCharID` is set. A member that
 *   cannot be restored stays exactly as it was, and the group still opens: the
 *   user is told once, by name, which members could not be loaded.
 * - Only the most recent `changeChar` call selects, and never after a chat
 *   started generating while members were being restored.
 * - A member restored by a selection is format-updated but keeps its own
 *   `lastInteraction`: the user opened the group, not the member. The group
 *   itself is bumped.
 * - A new chat in a group holds the greeting of every member that is in memory
 *   and none for an archived member, whose `firstMessage` is not data.
 *
 * Every cold-storage read goes through the mocked `readColdStorageItem`; no
 * real store is touched. This file drives the REAL `src/ts/characters.ts` and
 * the real cold-character modules, with the import set of
 * `characters.coldRestore.svelte.test.ts`.
 */
import { get, writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import type { Database, character, groupChat } from './storage/database.svelte'

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

// `findCharacterbyId` is faithful to production: the live non-group character
// holding the id (an archived stub included), or a blank one named
// 'Unknown Character'.
vi.mock(import('src/ts/util'), async () => {
    const { DBState: liveDBState } = await import('src/ts/stores.svelte')
    return {
        checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
        findCharacterbyId: vi.fn((id: string) => {
            for (const candidate of liveDBState.db.characters) {
                if (candidate.type !== 'group' && candidate.chaId === id) {
                    return candidate
                }
            }
            return { name: 'Unknown Character', firstMessage: '', chaId: id, type: 'character', chats: [] }
        }),
        findCharacterIndexbyId: vi.fn(() => -1),
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

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { doingChat } from 'src/ts/process/index.svelte'
import { alertError, alertNormal, alertToast, alertMd } from 'src/ts/alert'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import { changeChar, createNewChat } from './characters'

//#region fixtures and helpers

type Slot = Database['characters'][number]

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
        chats: [{ id: `${chaId}-chat`, message: [{ role: 'user', data: 'Hi', time: 1 }], note: '', name: 'Chat 1', localLore: [] }],
        ...extra,
    } as unknown as character
}

function fullGroup(chaId: string, memberIds: string[], extra: Record<string, unknown> = {}): groupChat {
    return {
        type: 'group',
        name: `${chaId} name`,
        image: '',
        chaId,
        chatPage: 0,
        firstMsgIndex: -1,
        lastInteraction: 1,
        characters: [...memberIds],
        characterTalks: memberIds.map(() => 0.5),
        characterActive: memberIds.map(() => true),
        globalLore: [],
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: 'Chat 1', localLore: [] }],
        ...extra,
    } as unknown as groupChat
}

function asSlot(value: character | groupChat): Slot {
    return value as unknown as Slot
}

/** An archived copy of `source` as this fork's stub builder makes it. */
function stubOf(source: character | groupChat, key: string): Slot {
    return asSlot(buildColdStub(source as never, key, []) as character | groupChat)
}

function installDb(characters: Slot[]): void {
    DBState.db = { characters } as unknown as Database
}

function slot(index: number): character {
    return DBState.db.characters[index] as unknown as character
}

function ok(restored: character | groupChat) {
    return { status: 'ok', value: { character: restored } }
}

function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Reads answer from `units` by key; a key with no entry is a missing unit. */
function serveUnits(units: Map<string, unknown>): void {
    readColdStorageItemMock.mockImplementation(async (key: string) => units.get(key) ?? { status: 'missing' })
}

/** Every read stays pending until released; a released read answers from `units`. */
function holdReads(units: Map<string, unknown>) {
    const pending: Array<() => void> = []
    let released = 0
    readColdStorageItemMock.mockImplementation((key: string) => new Promise((resolve) => {
        pending.push(() => resolve(units.get(key) ?? { status: 'missing' }))
    }))
    return {
        count: () => pending.length,
        async releaseUntil(isDone: () => boolean): Promise<void> {
            for (let round = 0; round < 50 && !isDone(); round++) {
                await tick()
                while (released < pending.length) {
                    pending[released++]()
                }
            }
            await tick()
        },
    }
}

interface SelectionSnapshot {
    id: number
    stubs: boolean[]
    descs: Array<string | undefined>
}

/** Records the character list as it is each time `selectedCharID` takes a character. */
function watchSelection(): { selections: SelectionSnapshot[], stop: () => void } {
    const selections: SelectionSnapshot[] = []
    const stop = selectedCharID.subscribe((id) => {
        if (id >= 0) {
            selections.push({
                id,
                stubs: DBState.db.characters.map((c) => !!(c as unknown as character).coldstorage),
                descs: DBState.db.characters.map((c) => (c as unknown as character).desc),
            })
        }
    })
    return { selections, stop }
}

/** The text of every alert the user would have been shown, whichever alert function showed it. */
function shownAlerts(): string[] {
    return [alertError, alertNormal, alertToast, alertMd].flatMap((fn) => vi.mocked(fn).mock.calls.map((args) => String(args[0])))
}

function snapshotOf(index: number): string {
    return JSON.stringify(DBState.db.characters[index])
}

let consoleErrorSpy: MockInstance<typeof console.error>
let stopWatching: (() => void) | null = null

beforeEach(() => {
    readColdStorageItemMock.mockReset()
    for (const fn of [alertError, alertNormal, alertToast, alertMd]) {
        vi.mocked(fn).mockClear()
    }
    doingChat.set(false)
    selectedCharID.set(-1)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    stopWatching?.()
    stopWatching = null
    consoleErrorSpy.mockRestore()
})

function watch(): SelectionSnapshot[] {
    const watcher = watchSelection()
    stopWatching = watcher.stop
    return watcher.selections
}

//#endregion

describe('changeChar on a group -- archived members are restored before the group is selected', () => {
    test('a full group with two archived members opens with both members full in their slots and shows no alert', async () => {
        const memberA = fullCharacter('a', { desc: 'unit a description' })
        const memberB = fullCharacter('b', { desc: 'unit b description' })
        installDb([asSlot(fullGroup('g', ['a', 'b'])), stubOf(memberA, 'unit-a'), stubOf(memberB, 'unit-b')])
        serveUnits(new Map([['unit-a', ok(memberA)], ['unit-b', ok(memberB)]]))
        const selections = watch()

        await changeChar(0)

        expect(selections).toHaveLength(1)
        expect(selections[0].id).toBe(0)
        expect(selections[0].stubs).toEqual([false, false, false])
        expect(selections[0].descs.slice(1)).toEqual(['unit a description', 'unit b description'])
        expect(shownAlerts()).toEqual([])
    })

    test('an archived group opens by restoring the group, then its archived members, then selecting it', async () => {
        const memberA = fullCharacter('a', { desc: 'unit a description' })
        const memberB = fullCharacter('b', { desc: 'unit b description' })
        const group = fullGroup('g', ['a', 'b'])
        installDb([stubOf(group, 'unit-g'), stubOf(memberA, 'unit-a'), stubOf(memberB, 'unit-b')])
        serveUnits(new Map([['unit-g', ok(group)], ['unit-a', ok(memberA)], ['unit-b', ok(memberB)]]))
        const selections = watch()

        await changeChar(0)

        const keysRead = readColdStorageItemMock.mock.calls.map((args) => args[0] as string)
        expect(keysRead[0]).toBe('unit-g')
        expect([...keysRead.slice(1)].sort()).toEqual(['unit-a', 'unit-b'])
        expect(selections).toHaveLength(1)
        expect(selections[0].id).toBe(0)
        expect(selections[0].stubs).toEqual([false, false, false])
        expect(selections[0].descs.slice(1)).toEqual(['unit a description', 'unit b description'])
        expect(shownAlerts()).toEqual([])
    })

    test('members that cannot be restored leave the group open, stay exactly as they were, and are named together in one alert', async () => {
        const memberA = fullCharacter('a', { name: 'Alice' })
        const memberB = fullCharacter('b', { name: 'Bob' })
        const memberC = fullCharacter('c', { name: 'Carol', desc: 'unit c description' })
        installDb([asSlot(fullGroup('g', ['a', 'b', 'c'])), stubOf(memberA, 'unit-a'), stubOf(memberB, 'unit-b'), stubOf(memberC, 'unit-c')])
        const stubA = snapshotOf(1)
        const stubB = snapshotOf(2)
        serveUnits(new Map<string, unknown>([
            ['unit-a', { status: 'missing' }],
            ['unit-b', { status: 'error', error: new Error('disk unavailable') }],
            ['unit-c', ok(memberC)],
        ]))
        const selections = watch()

        await changeChar(0)

        expect(get(selectedCharID)).toBe(0)
        expect(selections.at(-1)?.id).toBe(0)
        expect(snapshotOf(1)).toBe(stubA)
        expect(snapshotOf(2)).toBe(stubB)
        expect(slot(1).coldstorage).toBe('unit-a')
        expect(slot(2).coldstorage).toBe('unit-b')
        expect(slot(3).coldstorage).toBeUndefined()
        expect(slot(3).desc).toBe('unit c description')
        const alerts = shownAlerts()
        expect(alerts).toHaveLength(1)
        expect(alerts[0]).toContain('Alice')
        expect(alerts[0]).toContain('Bob')
        expect(alerts[0]).not.toContain('Carol')
    })

    test('an archived group is selected at its new index when a character is inserted before it while a member is being restored', async () => {
        const memberA = fullCharacter('a', { desc: 'unit a description' })
        const group = fullGroup('g', ['a'])
        installDb([asSlot(fullCharacter('other')), stubOf(group, 'unit-g'), stubOf(memberA, 'unit-a')])
        let releaseMember: () => void = () => {}
        readColdStorageItemMock.mockImplementation((key: string) => {
            if (key === 'unit-g') {
                return Promise.resolve(ok(group))
            }
            return new Promise((resolve) => { releaseMember = () => resolve(ok(memberA)) })
        })
        const selections = watch()

        const opening = changeChar(1)
        await tick()
        DBState.db.characters.unshift(asSlot(fullCharacter('inserted')))
        releaseMember()
        await opening

        expect(DBState.db.characters[2].chaId).toBe('g')
        expect(selections.map((s) => s.id)).toEqual([2])
        expect(get(selectedCharID)).toBe(2)
        expect(slot(3).coldstorage).toBeUndefined()
        expect(slot(3).desc).toBe('unit a description')
    })

    test('a member whose chaId is held by two characters, one archived, is named as not loaded and the group still opens', async () => {
        const dana = fullCharacter('d', { name: 'Dana' })
        installDb([asSlot(fullGroup('g', ['d'])), asSlot(dana), stubOf(fullCharacter('d', { name: 'Dana' }), 'unit-d')])
        serveUnits(new Map([['unit-d', ok(fullCharacter('d', { name: 'Dana' }))]]))

        await changeChar(0)

        expect(get(selectedCharID)).toBe(0)
        expect(slot(2).coldstorage).toBe('unit-d')
        const alerts = shownAlerts()
        expect(alerts).toHaveLength(1)
        expect(alerts[0]).toContain('Dana')
    })

    test('guard: a member chaId that no character holds is not reported and the group opens without an alert', async () => {
        installDb([asSlot(fullGroup('g', ['ghost', 'a'])), asSlot(fullCharacter('a'))])

        await changeChar(0)

        expect(get(selectedCharID)).toBe(0)
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(shownAlerts()).toEqual([])
    })

    test('guard: selecting a group whose members are all full reads no unit and shows no alert', async () => {
        installDb([asSlot(fullGroup('g', ['a', 'b'])), asSlot(fullCharacter('a')), asSlot(fullCharacter('b'))])

        await changeChar(0)

        expect(get(selectedCharID)).toBe(0)
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(shownAlerts()).toEqual([])
    })

    test('guard: selecting a character that is not a group reads no unit and shows no alert', async () => {
        installDb([asSlot(fullCharacter('a')), asSlot(fullCharacter('b'))])

        await changeChar(1)

        expect(get(selectedCharID)).toBe(1)
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(shownAlerts()).toEqual([])
    })
})

describe('changeChar on a group -- which call selects', () => {
    test('a later changeChar call that starts while members are being restored keeps the selection, and the earlier call never selects', async () => {
        const memberA = fullCharacter('a')
        installDb([asSlot(fullGroup('g', ['a'])), stubOf(memberA, 'unit-a'), asSlot(fullCharacter('other'))])
        const held = holdReads(new Map([['unit-a', ok(memberA)]]))
        const selections = watch()
        let finished = false

        const first = changeChar(0).then(() => { finished = true })
        await tick()
        await changeChar(2)
        await held.releaseUntil(() => finished)
        await first

        expect(selections.map((s) => s.id)).toEqual([2])
        expect(get(selectedCharID)).toBe(2)
    })

    test('a chat that starts generating while members are being restored leaves the selection unchanged', async () => {
        const memberA = fullCharacter('a')
        installDb([asSlot(fullGroup('g', ['a'])), stubOf(memberA, 'unit-a')])
        const held = holdReads(new Map([['unit-a', ok(memberA)]]))
        const selections = watch()
        let finished = false

        const done = changeChar(0).then(() => { finished = true })
        await tick()
        doingChat.set(true)
        await held.releaseUntil(() => finished)
        await done

        expect(selections).toEqual([])
        expect(get(selectedCharID)).toBe(-1)
    })
})

describe('changeChar on a group -- the members it restores', () => {
    test('a restored member keeps its own lastInteraction and is format-updated, while the group itself is bumped', async () => {
        const memberA = fullCharacter('a', {
            lastInteraction: 1234,
            chats: [{ message: [], note: '', name: 'Chat 1', localLore: [] }],
        })
        installDb([asSlot(fullGroup('g', ['a'])), stubOf(memberA, 'unit-a')])
        serveUnits(new Map([['unit-a', ok(memberA)]]))

        await changeChar(0)

        expect(slot(1).coldstorage).toBeUndefined()
        expect(slot(1).lastInteraction).toBe(1234)
        expect(slot(1).chats[0].id).toBeTruthy()
        expect(slot(0).lastInteraction).toBeGreaterThan(1)
    })
})

describe('createNewChat on a group with an archived member', () => {
    test('holds the greeting of the member in memory and none for the archived member', () => {
        const memberB = fullCharacter('b', { firstMessage: 'unit b greeting' })
        const group = fullGroup('g', ['a', 'b'])
        installDb([asSlot(group), asSlot(fullCharacter('a', { firstMessage: 'a greeting' })), stubOf(memberB, 'unit-b')])

        const opened = createNewChat(DBState.db.characters[0] as unknown as groupChat)

        const created = slot(0).chats[0]
        expect(opened).toBe(0)
        expect(created.id).toBeTruthy()
        expect(created.message.map((m) => m.saying)).toEqual(['a'])
        expect(created.message.map((m) => m.data)).toEqual(['a greeting'])
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
    })

    test('guard: a member chaId that no character holds still gets an empty greeting entry', () => {
        installDb([asSlot(fullGroup('g', ['a', 'ghost'])), asSlot(fullCharacter('a', { firstMessage: 'a greeting' }))])

        createNewChat(DBState.db.characters[0] as unknown as groupChat)

        const created = slot(0).chats[0]
        expect(created.message.map((m) => m.saying)).toEqual(['a', 'ghost'])
        expect(created.message.map((m) => m.data)).toEqual(['a greeting', ''])
    })
})

describe('changeChar on a stored group or member that lacks default fields', () => {
    test('reproducer: an archived group stored without its member list opens with an empty list and is selected', async () => {
        const group = fullGroup('g', ['a'], { characters: undefined })
        installDb([stubOf(fullGroup('g', ['a']), 'unit-g')])
        serveUnits(new Map([['unit-g', ok(group)]]))

        await changeChar(0)

        const opened = DBState.db.characters[0] as unknown as groupChat
        expect(opened.coldstorage).toBeUndefined()
        expect(opened.characters).toEqual([])
        expect(opened.characterTalks).toEqual([])
        expect(opened.characterActive).toEqual([])
        expect(get(selectedCharID)).toBe(0)
        expect(shownAlerts()).toEqual([])
    })

    test('guard: an archived group stored with members keeps them and their talk and active lists', async () => {
        const group = fullGroup('g', ['a', 'b'])
        installDb([stubOf(group, 'unit-g'), asSlot(fullCharacter('a')), asSlot(fullCharacter('b'))])
        serveUnits(new Map([['unit-g', ok(group)]]))

        await changeChar(0)

        const opened = DBState.db.characters[0] as unknown as groupChat
        expect(opened.characters).toEqual(['a', 'b'])
        expect(opened.characterTalks).toEqual([0.5, 0.5])
        expect(opened.characterActive).toEqual([true, true])
        expect(get(selectedCharID)).toBe(0)
    })

    test('reproducer: an archived member stored without a lorebook list is formatted with defaults when its group opens', async () => {
        const member = fullCharacter('a', { globalLore: undefined })
        installDb([asSlot(fullGroup('g', ['a'])), stubOf(fullCharacter('a'), 'unit-a')])
        serveUnits(new Map([['unit-a', ok(member)]]))

        await changeChar(0)

        expect(slot(1).coldstorage).toBeUndefined()
        expect(slot(1).globalLore).toEqual([])
        expect(get(selectedCharID)).toBe(0)
        expect(shownAlerts()).toEqual([])
    })
})
