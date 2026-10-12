/**
 * `changeChar` (`src/ts/characters.ts`) opening an archived character: the
 * character list holds a placeholder (the "stub") whose full data lives in a
 * cold-storage unit; clicking it reads the unit and installs the full
 * character in the stub's slot, then selects it.
 *
 * Invariants exercised here:
 * - The unit is read through `readColdStorageItem` (ok / missing / error).
 *   A missing unit and an unreadable one are told apart to the user, and an
 *   unreadable one never claims the data may be lost.
 * - The install lands in the slot that holds the SAME stub object the click
 *   started from, found again after the read: entries inserted or deleted
 *   meanwhile neither redirect the write nor throw. A stub that is gone (or
 *   was replaced by another character) is left alone and nothing is claimed
 *   lost. Two concurrent restores of one stub install once; the second ends on
 *   the character the first installed.
 * - Only the most recent `changeChar` call selects, and never after a chat
 *   started generating during the read.
 * - The restored character's `trashTime` is the stub's as it is when the read
 *   completes (see `applyStubStateOnRestore`), for every stub shape: a stub
 *   without a `trashTime`, whether made by this fork or by the upstream
 *   application, restores a character without one, whatever the unit holds.
 *   Nothing else on the restored character changes.
 * - A unit whose character has another `chaId` than the stub is refused with
 *   an alert and a log line naming both ids, the unit key and the name.
 *
 * This file drives the REAL `src/ts/characters.ts`; every other module it
 * imports is mocked, following `characters.newChatIdentity.svelte.test.ts`
 * (same source file, same import set). `getColdStorageItem`, the reader that
 * collapses missing and error into null, is a thin adapter over the
 * `readColdStorageItem` mock and recorded, so a test can require the restore
 * to read through `readColdStorageItem` only.
 */
import { get, writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import type { Database, character } from './storage/database.svelte'

//#region module mocks -- copied from characters.newChatIdentity.svelte.test.ts

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

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(() => -1),
    getUserName: vi.fn(() => 'User'),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

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
const legacyReadSpy = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: readColdStorageItemMock,
    getColdStorageItem: async (key: string) => {
        legacyReadSpy(key)
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
import { alertError } from 'src/ts/alert'
import { setCharacterByIndex } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import { changeChar } from './characters'
import { restoreColdCharacterByChaId } from 'src/ts/process/coldMemberRestore'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

/** A full character with every field `characterFormatUpdate` would otherwise have to invent for the fields the tests read. */
function fullCharacter(chaId: string, description = `${chaId} description`, extra: Record<string, unknown> = {}): character {
    return {
        type: 'character',
        name: `${chaId} name`,
        image: `${chaId}.png`,
        chaId,
        chatPage: 0,
        firstMsgIndex: 0,
        creatorNotes: '',
        lastInteraction: 1,
        desc: description,
        globalLore: [],
        newGenData: true,
        chats: [{ id: `${chaId}-chat`, message: [{ role: 'user', data: 'Hi', time: 1 }], note: '', name: 'Chat 1', localLore: [] }],
        ...extra,
    } as unknown as character
}

function warmCharacter(chaId: string): CharacterFixture {
    return fullCharacter(chaId) as unknown as CharacterFixture
}

/** An archived character in the shape the upstream application writes: no marker, a dummy chat without an id. */
function upstreamStub(chaId: string, key: string, extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        type: 'character',
        name: `${chaId} name`,
        image: `${chaId}.png`,
        chaId,
        chats: [{ message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
        chatPage: 0,
        firstMsgIndex: 0,
        coldstorage: key,
        coldStoragedChats: [],
        ...extra,
    } as unknown as CharacterFixture
}

/** An archived character built by this fork's stub builder. */
function forkStub(chaId: string, key: string): CharacterFixture {
    return buildColdStub(fullCharacter(chaId), key, []) as unknown as CharacterFixture
}

function installDb(characters: CharacterFixture[]): void {
    DBState.db = { characters } as unknown as Database
}

function slot(index: number): character {
    return DBState.db.characters[index] as unknown as character
}

function chaIds(): string[] {
    return DBState.db.characters.map((c) => c.chaId)
}

function ok(restored: character) {
    return { status: 'ok', value: { character: restored } }
}

interface PendingRead {
    key: string
    resolve: (result: unknown) => void
}

/** Every read stays pending until the test settles it. */
function holdReads(): PendingRead[] {
    const pending: PendingRead[] = []
    readColdStorageItemMock.mockImplementation((key: string) => new Promise((resolve) => {
        pending.push({ key, resolve })
    }))
    return pending
}

function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

function loggedErrorText(spy: MockInstance<typeof console.error>): string {
    return spy.mock.calls.map((args) => args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')).join('\n')
}

/** Every character `characterFormatUpdate` wrote back, as handed to the database setter. */
function formattedCharacters(): character[] {
    return vi.mocked(setCharacterByIndex).mock.calls.map(([, cha]) => cha as unknown as character)
}

let consoleErrorSpy: MockInstance<typeof console.error>

beforeEach(() => {
    readColdStorageItemMock.mockReset()
    legacyReadSpy.mockReset()
    vi.mocked(alertError).mockClear()
    vi.mocked(setCharacterByIndex).mockClear()
    doingChat.set(false)
    selectedCharID.set(-1)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    consoleErrorSpy.mockRestore()
})

//#endregion

describe('changeChar on an archived character -- the install', () => {
    test('guard: a placeholder made by the upstream application is replaced by the unit\'s character, which is selected', async () => {
        installDb([warmCharacter('before'), upstreamStub('member', 'unit-member')])
        readColdStorageItemMock.mockResolvedValue(ok(fullCharacter('member', 'restored description')))

        await changeChar(1)

        expect(chaIds()).toEqual(['before', 'member'])
        expect(slot(1).coldstorage).toBeUndefined()
        expect(slot(1).desc).toBe('restored description')
        expect(get(selectedCharID)).toBe(1)
        expect(readColdStorageItemMock).toHaveBeenCalledWith('unit-member')
    })

    test('guard: a placeholder made by this fork is replaced by the unit\'s character, which is selected', async () => {
        installDb([warmCharacter('before'), forkStub('member', 'unit-member')])
        readColdStorageItemMock.mockResolvedValue(ok(fullCharacter('member', 'restored description')))

        await changeChar(1)

        expect(slot(1).coldstorage).toBeUndefined()
        expect(slot(1).desc).toBe('restored description')
        expect(get(selectedCharID)).toBe(1)
    })

    test('reads the unit through readColdStorageItem and never through the null-collapsing reader', async () => {
        installDb([upstreamStub('member', 'unit-member')])
        readColdStorageItemMock.mockResolvedValue(ok(fullCharacter('member')))

        await changeChar(0)

        expect(readColdStorageItemMock).toHaveBeenCalledTimes(1)
        expect(legacyReadSpy).not.toHaveBeenCalled()
    })

    test('guard: of two placeholders sharing a chaId, the one clicked is restored with its own unit', async () => {
        installDb([upstreamStub('dup', 'unit-a'), upstreamStub('dup', 'unit-b')])
        readColdStorageItemMock.mockImplementation(async (key: string) => ok(fullCharacter('dup', `restored from ${key}`)))

        await changeChar(1)

        expect(readColdStorageItemMock).toHaveBeenCalledWith('unit-b')
        expect(slot(1).desc).toBe('restored from unit-b')
        expect(slot(0).coldstorage).toBe('unit-a')
        expect(get(selectedCharID)).toBe(1)
    })

    test('guard: the installed character carries none of the placeholder\'s pointer, marker or count fields', async () => {
        const blob = fullCharacter('member', 'restored description', { tags: ['stub-tag'], creator: 'stub-creator' })
        const stub = buildColdStub(blob, 'unit-member', ['chat-unit'])
        installDb([stub as unknown as CharacterFixture])
        readColdStorageItemMock.mockResolvedValue(ok(fullCharacter('member', 'restored description', { tags: ['unit-tag'], creator: 'unit-creator' })))

        await changeChar(0)

        const restored = slot(0) as unknown as { tags: string[], creator: string }
        expect(restored.tags).toEqual(['unit-tag'])
        expect(restored.creator).toBe('unit-creator')
        // `tags` and `creator` are character fields too: the format update gives a restored character its defaults.
        const stubOnlyKeys = Object.keys(stub).filter((key) => !(key in (blob as unknown as Record<string, unknown>)) && key !== 'trashTime' && key !== 'tags' && key !== 'creator')
        expect(stubOnlyKeys).toContain('coldstorage')
        for (const key of stubOnlyKeys) {
            expect(key in (slot(0) as unknown as Record<string, unknown>)).toBe(false)
        }
    })

    test('guard: the character formatted after the install is the restored one, never a placeholder', async () => {
        installDb([warmCharacter('before'), forkStub('member', 'unit-member')])
        readColdStorageItemMock.mockResolvedValue(ok(fullCharacter('member', 'restored description')))

        await changeChar(1)

        const formatted = formattedCharacters()
        expect(formatted.length).toBeGreaterThan(0)
        for (const cha of formatted) {
            expect(cha.coldstorage).toBeUndefined()
            expect(cha.desc).toBe('restored description')
        }
    })

    test('guard: the restore leaves every other character as it was', async () => {
        installDb([warmCharacter('a'), upstreamStub('member', 'unit-member'), warmCharacter('b')])
        const before = JSON.stringify([DBState.db.characters[0], DBState.db.characters[2]])
        readColdStorageItemMock.mockResolvedValue(ok(fullCharacter('member')))

        await changeChar(1)

        expect(JSON.stringify([DBState.db.characters[0], DBState.db.characters[2]])).toBe(before)
    })
})

describe('changeChar on an archived character -- what the user is told', () => {
    test.each([
        ['a missing unit', { status: 'missing' }],
        ['an item without a character', { status: 'ok', value: {} }],
        ['an item that decoded to null', { status: 'ok', value: null }],
    ] as const)('guard: %s shows the data-loss warning once and leaves the placeholder and the selection alone', async (_label, item) => {
        installDb([warmCharacter('before'), upstreamStub('member', 'unit-member')])
        readColdStorageItemMock.mockResolvedValue(item)

        await changeChar(1)

        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError)).toHaveBeenCalledWith(language.errors.coldStorageRestoreFailed)
        expect(slot(1).coldstorage).toBe('unit-member')
        expect(get(selectedCharID)).toBe(-1)
        expect(vi.mocked(setCharacterByIndex)).not.toHaveBeenCalled()
    })

    test('a read error asks to try again, never claims the data may be lost, and leaves the placeholder and the selection alone', async () => {
        installDb([warmCharacter('before'), upstreamStub('member', 'unit-member')])
        readColdStorageItemMock.mockResolvedValue({ status: 'error', error: new Error('disk unavailable') })

        await changeChar(1)

        const unreadable = language.errors.coldStorageRestoreUnreadable
        expect(typeof unreadable).toBe('string')
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError)).toHaveBeenCalledWith(unreadable)
        expect(vi.mocked(alertError)).not.toHaveBeenCalledWith(language.errors.coldStorageRestoreFailed)
        expect(slot(1).coldstorage).toBe('unit-member')
        expect(get(selectedCharID)).toBe(-1)
        expect(vi.mocked(setCharacterByIndex)).not.toHaveBeenCalled()
    })

    test('guard: a unit for another character is refused with an alert, the placeholder stays and nothing is selected', async () => {
        installDb([warmCharacter('before'), upstreamStub('member', 'unit-member')])
        readColdStorageItemMock.mockResolvedValue(ok(fullCharacter('someone-else')))

        await changeChar(1)

        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError)).toHaveBeenCalledWith(language.errors.coldStorageRestoreFailed)
        expect(slot(1).coldstorage).toBe('unit-member')
        expect(slot(1).chaId).toBe('member')
        expect(get(selectedCharID)).toBe(-1)
        expect(vi.mocked(setCharacterByIndex)).not.toHaveBeenCalled()
    })

    test('a unit for another character is logged with the placeholder\'s chaId, the unit\'s chaId, the key and the name', async () => {
        installDb([upstreamStub('member', 'unit-member', { name: 'Member Name' })])
        readColdStorageItemMock.mockResolvedValue(ok(fullCharacter('someone-else')))

        await changeChar(0)

        expect(consoleErrorSpy).toHaveBeenCalled()
        const logged = loggedErrorText(consoleErrorSpy)
        expect(logged).toContain('member')
        expect(logged).toContain('someone-else')
        expect(logged).toContain('unit-member')
        expect(logged).toContain('Member Name')
    })

    test('guard: a refused unit never gives the placeholder the unit\'s chaId', async () => {
        installDb([upstreamStub('member', 'unit-member')])
        readColdStorageItemMock.mockResolvedValue(ok(fullCharacter('someone-else')))

        await changeChar(0)

        expect(slot(0).chaId).toBe('member')
        expect(slot(0).coldstorage).toBe('unit-member')
    })
})

describe('changeChar on an archived character -- the restored character\'s trash state', () => {
    test('a placeholder built here that was trashed after archiving restores as trashed', async () => {
        installDb([forkStub('member', 'unit-member')])
        slot(0).trashTime = 111
        readColdStorageItemMock.mockResolvedValue(ok(fullCharacter('member')))

        await changeChar(0)

        expect(slot(0).coldstorage).toBeUndefined()
        expect(slot(0).trashTime).toBe(111)
    })

    test('a placeholder built here that was un-trashed after archiving restores as not trashed', async () => {
        installDb([forkStub('member', 'unit-member')])
        slot(0).trashTime = undefined
        readColdStorageItemMock.mockResolvedValue(ok(fullCharacter('member', 'restored', { trashTime: 222 })))

        await changeChar(0)

        expect(slot(0).coldstorage).toBeUndefined()
        expect(slot(0).trashTime).toBeUndefined()
    })

    test('a trash applied to the placeholder while the read is pending is kept', async () => {
        installDb([forkStub('member', 'unit-member')])
        const pending = holdReads()

        const done = changeChar(0)
        await tick()
        slot(0).trashTime = 333
        pending[0].resolve(ok(fullCharacter('member')))
        await done

        expect(slot(0).coldstorage).toBeUndefined()
        expect(slot(0).trashTime).toBe(333)
    })

    test('an upstream-made placeholder with a truthy trashTime restores as trashed', async () => {
        installDb([upstreamStub('member', 'unit-member', { trashTime: 444 })])
        readColdStorageItemMock.mockResolvedValue(ok(fullCharacter('member')))

        await changeChar(0)

        expect(slot(0).trashTime).toBe(444)
    })

    test('an upstream-made placeholder without trashTime restores as not trashed even when the unit holds a trashTime', async () => {
        installDb([upstreamStub('member', 'unit-member')])
        readColdStorageItemMock.mockResolvedValue(ok(fullCharacter('member', 'restored', { trashTime: 555 })))

        await changeChar(0)

        expect(slot(0).coldstorage).toBeUndefined()
        expect(slot(0).desc).toBe('restored')
        expect(slot(0).trashTime).toBeUndefined()
    })

    test('guard: the trash merge changes no other field of the restored character', async () => {
        installDb([forkStub('member', 'unit-member')])
        slot(0).trashTime = 666
        slot(0).name = 'name written on the placeholder'
        slot(0).image = 'placeholder.png'
        readColdStorageItemMock.mockResolvedValue(ok(fullCharacter('member', 'restored description', { name: 'stored name', image: 'stored.png' })))

        await changeChar(0)

        expect(slot(0).name).toBe('stored name')
        expect(slot(0).image).toBe('stored.png')
        expect(slot(0).desc).toBe('restored description')
        expect(slot(0).chats).toHaveLength(1)
        expect(slot(0).chats[0].message[0].data).toBe('Hi')
    })
})

describe('changeChar on an archived character -- the list changes during the read', () => {
    test('a character inserted before the placeholder does not redirect the install or the selection', async () => {
        installDb([warmCharacter('x'), upstreamStub('member', 'unit-member')])
        const pending = holdReads()

        const done = changeChar(1)
        await tick()
        DBState.db.characters.unshift(warmCharacter('inserted'))
        pending[0].resolve(ok(fullCharacter('member', 'restored description')))
        await done

        expect(chaIds()).toEqual(['inserted', 'x', 'member'])
        expect(slot(2).coldstorage).toBeUndefined()
        expect(slot(2).desc).toBe('restored description')
        expect(get(selectedCharID)).toBe(2)
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(slot(0).desc).toBe('inserted description')
        expect(slot(1).desc).toBe('x description')
    })

    test('a character deleted before the placeholder does not stop the install or misplace the selection', async () => {
        installDb([warmCharacter('x'), upstreamStub('member', 'unit-member')])
        const pending = holdReads()

        const done = changeChar(1)
        await tick()
        DBState.db.characters.splice(0, 1)
        pending[0].resolve(ok(fullCharacter('member', 'restored description')))

        await expect(done).resolves.toBeUndefined()
        expect(chaIds()).toEqual(['member'])
        expect(slot(0).coldstorage).toBeUndefined()
        expect(slot(0).desc).toBe('restored description')
        expect(get(selectedCharID)).toBe(0)
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
    })

    test('a list that shrank below the clicked index installs and selects the placeholder\'s new slot without throwing', async () => {
        installDb([warmCharacter('x'), warmCharacter('y'), upstreamStub('member', 'unit-member')])
        const pending = holdReads()

        const done = changeChar(2)
        await tick()
        DBState.db.characters.splice(0, 2)
        pending[0].resolve(ok(fullCharacter('member', 'restored description')))

        await expect(done).resolves.toBeUndefined()
        expect(chaIds()).toEqual(['member'])
        expect(slot(0).desc).toBe('restored description')
        expect(get(selectedCharID)).toBe(0)
    })

    test('a placeholder deleted during the read installs nothing, writes no other slot and claims no data loss', async () => {
        installDb([warmCharacter('x'), upstreamStub('member', 'unit-member')])
        const pending = holdReads()

        const done = changeChar(1)
        await tick()
        DBState.db.characters.splice(1, 1)
        pending[0].resolve(ok(fullCharacter('member', 'restored description')))

        await expect(done).resolves.toBeUndefined()
        expect(chaIds()).toEqual(['x'])
        expect(slot(0).desc).toBe('x description')
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(vi.mocked(setCharacterByIndex)).not.toHaveBeenCalled()
        expect(get(selectedCharID)).toBe(-1)
    })

    test('a placeholder replaced by another character during the read leaves that character alone and claims no data loss', async () => {
        installDb([warmCharacter('x'), upstreamStub('member', 'unit-member')])
        const pending = holdReads()

        const done = changeChar(1)
        await tick()
        DBState.db.characters[1] = warmCharacter('replacement')
        pending[0].resolve(ok(fullCharacter('member', 'restored description')))

        await expect(done).resolves.toBeUndefined()
        expect(chaIds()).toEqual(['x', 'replacement'])
        expect(slot(1).desc).toBe('replacement description')
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(vi.mocked(setCharacterByIndex)).not.toHaveBeenCalled()
        expect(get(selectedCharID)).toBe(-1)
    })
})

describe('changeChar on an archived character -- two clicks on one placeholder', () => {
    test('the second restore ends on the character the first one installed, and an edit made in between survives', async () => {
        installDb([warmCharacter('before'), upstreamStub('member', 'unit-member')])
        const pending = holdReads()

        const first = changeChar(1)
        const second = changeChar(1)
        await tick()
        pending[0].resolve(ok(fullCharacter('member', 'first read')))
        await first
        const installedByFirst = slot(1)
        installedByFirst.desc = 'edited between the two completions'
        await tick()
        pending[1]?.resolve(ok(fullCharacter('member', 'second read')))
        await second

        expect(slot(1)).toBe(installedByFirst)
        expect(slot(1).desc).toBe('edited between the two completions')
        expect(slot(1).coldstorage).toBeUndefined()
        expect(chaIds()).toEqual(['before', 'member'])
        expect(get(selectedCharID)).toBe(1)
    })
})

describe('changeChar on an archived character -- which call selects', () => {
    test('a click on another character while the first read is pending keeps that other character selected', async () => {
        installDb([upstreamStub('member', 'unit-member'), warmCharacter('other')])
        const pending = holdReads()

        const first = changeChar(0)
        await tick()
        await changeChar(1)
        expect(get(selectedCharID)).toBe(1)
        pending[0].resolve(ok(fullCharacter('member', 'restored description')))
        await first

        expect(get(selectedCharID)).toBe(1)
    })

    test('a chat that starts generating during the read leaves the selection unchanged', async () => {
        installDb([warmCharacter('before'), upstreamStub('member', 'unit-member')])
        const pending = holdReads()

        const done = changeChar(1)
        await tick()
        doingChat.set(true)
        pending[0].resolve(ok(fullCharacter('member', 'restored description')))
        await done

        expect(get(selectedCharID)).toBe(-1)
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
    })

    test('guard: a chat already generating at the start returns before the reseter and any read', async () => {
        installDb([warmCharacter('before'), upstreamStub('member', 'unit-member')])
        doingChat.set(true)
        const reseter = vi.fn()

        await changeChar(1, { reseter })

        expect(reseter).not.toHaveBeenCalled()
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(get(selectedCharID)).toBe(-1)
        expect(slot(1).coldstorage).toBe('unit-member')
    })

    test('guard: the reseter runs at the start, before the read completes', async () => {
        installDb([warmCharacter('before'), upstreamStub('member', 'unit-member')])
        const pending = holdReads()
        const reseter = vi.fn()

        const done = changeChar(1, { reseter })
        await tick()

        expect(reseter).toHaveBeenCalledTimes(1)
        expect(get(selectedCharID)).toBe(-1)
        pending[0].resolve(ok(fullCharacter('member')))
        await done
    })

    test('guard: selecting a character that is already in memory reads nothing', async () => {
        installDb([warmCharacter('before'), warmCharacter('after')])

        await changeChar(1)

        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(get(selectedCharID)).toBe(1)
    })
})

describe('changeChar on an archived character -- a read that cannot succeed here', () => {
    test.each([
        ['no storage on the page', 'unavailable', /offers no storage/i, () => language.errors.coldStorageRestoreUnavailable],
        ['a copy that cannot be read', 'damaged', /may be damaged/i, () => language.errors.coldStorageRestoreDamaged],
    ] as const)('%s shows its own text once, never claims loss or asks for a retry, and leaves the placeholder and the selection alone', async (_label, kind, wording, expectedText) => {
        installDb([warmCharacter('before'), upstreamStub('member', 'unit-member')])
        readColdStorageItemMock.mockResolvedValue({ status: 'error', error: new Error('cannot be used here'), kind })

        await changeChar(1)

        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        const shown = String(vi.mocked(alertError).mock.calls[0][0])
        expect(shown).not.toMatch(/try again/i)
        expect(shown).not.toMatch(/lost|permanently/i)
        expect(shown).toMatch(wording)
        expect(shown).toBe(expectedText())
        expect(slot(1).coldstorage).toBe('unit-member')
        expect(get(selectedCharID)).toBe(-1)
        expect(vi.mocked(setCharacterByIndex)).not.toHaveBeenCalled()
    })

    test('guard: a read error with no cause still asks to try again and does not claim loss', async () => {
        installDb([warmCharacter('before'), upstreamStub('member', 'unit-member')])
        readColdStorageItemMock.mockResolvedValue({ status: 'error', error: new Error('disk unavailable') })

        await changeChar(1)

        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError)).toHaveBeenCalledWith(language.errors.coldStorageRestoreUnreadable)
        expect(String(vi.mocked(alertError).mock.calls[0][0])).toMatch(/try again/i)
    })

    test.each([
        ['no storage on the page', 'unavailable'],
        ['a copy that cannot be read', 'damaged'],
        ['a read error with no cause', undefined],
    ] as const)('guard: opening a group whose archived member has %s shows the group notice that names the member, whatever the cause, and selects the group', async (_label, kind) => {
        const group = { type: 'group', name: 'The Group', chaId: 'group', image: '', characters: ['member'], chats: [], chatPage: 0, firstMsgIndex: -1 } as unknown as CharacterFixture
        installDb([group, upstreamStub('member', 'unit-member')])
        readColdStorageItemMock.mockResolvedValue({ status: 'error', error: new Error('cannot be used here'), ...(kind ? { kind } : {}) })

        await changeChar(0)

        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError)).toHaveBeenCalledWith(language.errors.coldStorageGroupMembersNotLoaded('member name'))
        expect(slot(1).coldstorage).toBe('unit-member')
        expect(get(selectedCharID)).toBe(0)
    })
})

describe('a by-chaId restore that joins a click restore of the same placeholder', () => {
    test('is refused with the data-loss warning when a second holder of the chaId appears during the read, leaving the selection to the click', async () => {
        installDb([warmCharacter('before'), upstreamStub('member', 'unit-member')])
        const pending = holdReads()

        const click = changeChar(1)
        await tick()
        const byChaId = restoreColdCharacterByChaId('member')
        await tick()
        DBState.db.characters.push(warmCharacter('member'))
        pending[0].resolve(ok(fullCharacter('member', 'restored description')))
        await click

        expect(await byChaId).toBe(false)
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(alertError)).toHaveBeenCalledWith(language.errors.coldStorageNamedRestoreFailed('member name'))
        expect(get(selectedCharID)).toBe(1)
    })

    test('guard: joins the click restore and resolves true when the placeholder stays the only holder', async () => {
        installDb([warmCharacter('before'), upstreamStub('member', 'unit-member')])
        const pending = holdReads()

        const click = changeChar(1)
        await tick()
        const byChaId = restoreColdCharacterByChaId('member')
        await tick()
        pending[0].resolve(ok(fullCharacter('member', 'restored description')))
        await click

        expect(await byChaId).toBe(true)
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(slot(1).desc).toBe('restored description')
    })
})
