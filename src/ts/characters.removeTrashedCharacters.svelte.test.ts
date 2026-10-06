/**
 * `removeTrashedCharacters` (src/ts/characters.ts), the "Empty trash" batch delete.
 *
 * Drives the REAL function and the REAL `restoreCharacterFromTrash` against a real `$state`
 * database and the REAL save marks (`characterSaveMarks.ts`). Every other module `characters.ts`
 * imports is mocked purely so the module loads (the set of
 * `characters.removeCharPermanentRestored.svelte.test.ts`); the alert confirm is a mock the test
 * holds open and answers, `stopWorkIn` is a recording stub and the reload flag is a plain object
 * here (the unmocked flag is exercised in `characters.removeTrashedCharacters.save.svelte.test.ts`).
 * Acceptance tests for a new feature; titles beginning "guard:" pin behaviour that must be
 * preserved.
 */
import { writable, get } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from './storage/database.svelte'
import type { toSaveType } from './storage/risuSave'

//#region module mocks

const confirms = vi.hoisted(() => {
    const pending: Array<{ message: string, settle: (answer: boolean) => void }> = []
    return {
        pending,
        ask: (message: string) => new Promise<boolean>((settle) => { pending.push({ message, settle }) }),
    }
})

const work = vi.hoisted(() => ({
    stopped: [] as string[],
    /** The length of the character list at the moment each `stopWorkIn` ran. */
    lengthAtStop: [] as number[],
    busy: new Set<string>(),
    orderCalls: [] as number[],
}))

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
    checkCharOrder: vi.fn(() => {
        const db = (globalThis as unknown as { __testDBState: Database }).__testDBState
        work.orderCalls.push(db.characters.length)
    }),
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
    alertConfirm: confirms.ask,
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => (globalThis as unknown as { __testDBState: Database }).__testDBState),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    saveImage: vi.fn(),
    defaultSdDataFunc: vi.fn(() => ({})),
    getCharacterByIndex: vi.fn(),
    setCharacterByIndex: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    findCharacterbyId: vi.fn((id: string) => {
        const db = (globalThis as unknown as { __testDBState: Database }).__testDBState
        return db.characters.find((c: { chaId: string }) => c.chaId === id)
    }),
    findCharacterIndexbyId: vi.fn((id: string) => {
        const db = (globalThis as unknown as { __testDBState: Database }).__testDBState
        return db.characters.findIndex((c: { chaId: string }) => c.chaId === id)
    }),
    getUserName: vi.fn(() => 'User'),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/media'), () => ({
    getImageType: vi.fn(),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn(),
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

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/process/chatOrigin'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        hasWorkIn: vi.fn((scope: { chaId: string }) => work.busy.has(scope.chaId)),
        stopWorkIn: vi.fn((scope: { chaId: string }) => {
            work.stopped.push(scope.chaId)
            const db = (globalThis as unknown as { __testDBState: Database }).__testDBState
            work.lengthAtStop.push(db.characters.length)
        }),
    }
})

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { requiresFullEncoderReload } from 'src/ts/globalApi.svelte'
import { language } from 'src/lang'
import { removeTrashedCharacters, restoreCharacterFromTrash } from './characters'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from './storage/characterSaveMarks'

//#region fixtures and helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

type CharacterFixture = Database['characters'][number]

const T0 = 1_700_000_000_000

function makeCharacter(chaId: string, name: string, trashTime?: number): CharacterFixture {
    return {
        chaId, name, type: 'character', chatPage: 0,
        chats: [{ id: `${chaId}-chat-0-${name}`, message: [], note: '', name: '', localLore: [] }],
        trashTime,
    } as unknown as CharacterFixture
}

function makeGroup(chaId: string, members: string[]): CharacterFixture {
    return {
        chaId, name: chaId, type: 'group', chatPage: 0, characters: members,
        chats: [{ id: `${chaId}-chat-0`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

function installDb(characters: CharacterFixture[], selected = -1): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: characters.filter((c) => !c.trashTime).map((c) => c.chaId),
        characters,
    } as unknown as Database
    ;(globalThis as unknown as { __testDBState: Database }).__testDBState = DBState.db
    selectedCharID.set(selected)
}

const names = () => DBState.db.characters.map((c) => c.name)
const selection = () => get(selectedCharID)
const refsOf = (...wanted: string[]) => wanted.map((n) => {
    const found = DBState.db.characters.find((c) => c.name === n)
    if (!found) throw new Error(`no character ${n}`)
    return found
})

let tracker: toSaveType
const schedule = vi.fn()

async function answer(value: boolean): Promise<string> {
    const next = confirms.pending.shift()
    if (!next) throw new Error('no confirmation is open')
    next.settle(value)
    await sleep(10)
    return next.message
}

/** Starts a batch delete, waits for its confirmation to open and returns the pending promise and the text. */
async function openConfirm(refs: CharacterFixture[], matching = false): Promise<{ done: Promise<void>, message: string }> {
    const done = removeTrashedCharacters(refs, { matching })
    await sleep(10)
    expect(confirms.pending.length).toBe(1)
    return { done, message: confirms.pending[0].message }
}

async function confirmed(refs: CharacterFixture[], matching = false): Promise<void> {
    const { done } = await openConfirm(refs, matching)
    await answer(true)
    await done
}

beforeEach(() => {
    confirms.pending.length = 0
    work.stopped.length = 0
    work.lengthAtStop.length = 0
    work.orderCalls.length = 0
    work.busy.clear()
    requiresFullEncoderReload.state = false
    schedule.mockReset()
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    installCharacterSaveMarks({ tracker, schedule })
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
})

//#endregion

describe('E1: only the snapshot is removed', () => {
    test('live characters before, between and after the trashed ones, and a hidden system character and a non-matching trashed one that are not handed to it, survive', async () => {
        installDb([
            makeCharacter('l0', 'Live0'),
            makeCharacter('t1', 'Trash1', T0),
            makeCharacter('l1', 'Live1'),
            makeCharacter('§playground', 'Playground', T0),
            makeCharacter('t2', 'Trash2', T0),
            makeCharacter('other', 'OtherTrash', T0),
            makeCharacter('l2', 'Live2'),
        ])
        const live1 = DBState.db.characters[2]
        await confirmed(refsOf('Trash1', 'Trash2'), true)
        expect(names()).toEqual(['Live0', 'Live1', 'Playground', 'OtherTrash', 'Live2'])
        expect(DBState.db.characters[1]).toBe(live1)
    })

    test('a trashed and a live character sharing a chaId: only the trashed one goes', async () => {
        installDb([
            makeCharacter('dup', 'LiveTwin'),
            makeCharacter('dup', 'TrashedTwin', T0),
            makeCharacter('x', 'Other'),
        ])
        await confirmed(refsOf('TrashedTwin'))
        expect(names()).toEqual(['LiveTwin', 'Other'])
        expect(DBState.db.characters[0].trashTime).toBeUndefined()
    })

    test('a ref list with the same object twice counts and removes it once', async () => {
        installDb([makeCharacter('a', 'A', T0), makeCharacter('b', 'B')])
        const a = DBState.db.characters[0]
        const { done, message } = await openConfirm([a, a])
        expect(message).toContain(language.emptyTrashConfirmAll(1))
        await answer(true)
        await done
        expect(names()).toEqual(['B'])
    })

    test('guard: a ref that was not in the trash at the click is never removed', async () => {
        installDb([makeCharacter('live', 'Live'), makeCharacter('t', 'T', T0)])
        const before = DBState.db.characters
        await confirmed(refsOf('Live'))
        expect(names()).toEqual(['Live', 'T'])
        expect(DBState.db.characters).toBe(before)
        expect(requiresFullEncoderReload.state).toBe(false)
        expect(tracker.character).toEqual([])
        expect(work.stopped).toEqual([])
    })

    test('an empty ref list opens no confirmation and changes nothing', async () => {
        installDb([makeCharacter('a', 'A', T0)])
        const before = DBState.db.characters
        await removeTrashedCharacters([], { matching: false })
        expect(confirms.pending.length).toBe(0)
        expect(DBState.db.characters).toBe(before)
        expect(requiresFullEncoderReload.state).toBe(false)
    })
})

describe('E2: one confirmation, stating the count', () => {
    test('one confirmation for N characters, with the count and the cannot-be-undone sentence, and no "matching" wording without a search', async () => {
        installDb([makeCharacter('a', 'A', T0), makeCharacter('b', 'B', T0), makeCharacter('c', 'C', T0), makeCharacter('d', 'D')])
        const { done, message } = await openConfirm(refsOf('A', 'B', 'C'))
        expect(message).toContain(language.emptyTrashConfirmAll(3))
        expect(message).toContain(language.emptyTrashCannotUndo)
        expect(message).not.toContain('matching')
        expect(message).not.toContain(language.removeCharacterWhileWorking)
        await answer(true)
        await done
        expect(confirms.pending.length).toBe(0)
        expect(names()).toEqual(['D'])
    })

    test('a single character is named in the singular, with and without a search', async () => {
        installDb([makeCharacter('a', 'A', T0), makeCharacter('b', 'B', T0)])
        const all = await openConfirm(refsOf('A'))
        expect(all.message).toContain('Delete the 1 character in the trash permanently?')
        expect(all.message).not.toContain('1 characters')
        await answer(false)
        await all.done
        const matching = await openConfirm(refsOf('B'), true)
        expect(matching.message).toContain('Delete 1 matching character permanently?')
        expect(matching.message).not.toContain('1 matching characters')
        await answer(false)
        await matching.done
        expect(names()).toEqual(['A', 'B'])
    })

    test('with a search the confirmation uses the "matching" wording and the row count', async () => {
        installDb([makeCharacter('a', 'Ann', T0), makeCharacter('b', 'Ben', T0), makeCharacter('c', 'Cat', T0)])
        const { done, message } = await openConfirm(refsOf('Ann', 'Ben'), true)
        expect(message).toContain(language.emptyTrashConfirmMatching(2))
        expect(message).toContain('matching')
        await answer(true)
        await done
        expect(names()).toEqual(['Cat'])
    })

    test('declining leaves the array, the selection, the reload flag, the marks and all work untouched', async () => {
        installDb([makeCharacter('l', 'Live'), makeCharacter('a', 'A', T0), makeCharacter('b', 'B', T0)], 0)
        work.busy.add('a')
        const before = DBState.db.characters
        const { done } = await openConfirm(refsOf('A', 'B'))
        await answer(false)
        await done
        expect(DBState.db.characters).toBe(before)
        expect(names()).toEqual(['Live', 'A', 'B'])
        expect(selection()).toBe(0)
        expect(requiresFullEncoderReload.state).toBe(false)
        expect(tracker.character).toEqual([])
        expect(schedule).not.toHaveBeenCalled()
        expect(work.stopped).toEqual([])
        expect(work.orderCalls).toEqual([])
    })
})

describe('E3: the confirmation window', () => {
    test('a character restored while the confirmation is open survives and its work is not stopped; the rest go; the count is an upper bound', async () => {
        installDb([makeCharacter('a', 'A', T0), makeCharacter('b', 'B', T0), makeCharacter('c', 'C', T0)])
        const { done, message } = await openConfirm(refsOf('A', 'B', 'C'))
        expect(message).toContain(language.emptyTrashConfirmAll(3))
        restoreCharacterFromTrash(DBState.db.characters[1])
        await answer(true)
        await done
        expect(names()).toEqual(['B'])
        expect(DBState.db.characters[0].trashTime).toBeUndefined()
        expect(work.stopped.sort()).toEqual(['a', 'c'])
    })

    test('a character restored and trashed again while the confirmation is open survives', async () => {
        installDb([makeCharacter('a', 'A', T0), makeCharacter('b', 'B', T0)])
        const { done } = await openConfirm(refsOf('A', 'B'))
        const a = DBState.db.characters[0]
        restoreCharacterFromTrash(a)
        a.trashTime = T0 + 5_000
        await answer(true)
        await done
        expect(names()).toEqual(['A'])
        expect(work.stopped).toEqual(['b'])
    })

    test('a character trashed after the click survives', async () => {
        installDb([makeCharacter('a', 'A', T0), makeCharacter('late', 'Late')])
        const { done } = await openConfirm(refsOf('A'))
        DBState.db.characters[1].trashTime = T0 + 9
        await answer(true)
        await done
        expect(names()).toEqual(['Late'])
        expect(DBState.db.characters[0].trashTime).toBe(T0 + 9)
    })

    test('when every ref was restored during the confirmation nothing changes at all', async () => {
        installDb([makeCharacter('l', 'Live'), makeCharacter('a', 'A', T0), makeCharacter('b', 'B', T0)], 0)
        const before = DBState.db.characters
        const { done } = await openConfirm(refsOf('A', 'B'))
        restoreCharacterFromTrash(DBState.db.characters[1])
        restoreCharacterFromTrash(DBState.db.characters[2])
        tracker.character.length = 0
        schedule.mockClear()
        work.orderCalls.length = 0
        await answer(true)
        await done
        expect(DBState.db.characters).toBe(before)
        expect(names()).toEqual(['Live', 'A', 'B'])
        expect(requiresFullEncoderReload.state).toBe(false)
        expect(tracker.character).toEqual([])
        expect(schedule).not.toHaveBeenCalled()
        expect(selection()).toBe(0)
        expect(work.stopped).toEqual([])
        expect(work.orderCalls).toEqual([])
    })

    test('characters inserted ahead of the trashed ones while the confirmation is open do not shift what is removed', async () => {
        installDb([makeCharacter('a', 'A', T0), makeCharacter('l', 'Live'), makeCharacter('b', 'B', T0)])
        const { done } = await openConfirm(refsOf('A', 'B'))
        DBState.db.characters = [makeCharacter('n1', 'New1'), makeCharacter('n2', 'New2', T0), ...DBState.db.characters]
        await answer(true)
        await done
        expect(names()).toEqual(['New1', 'New2', 'Live'])
        expect(DBState.db.characters[1].trashTime).toBe(T0)
    })

    test('a ref that left the list during the confirmation is skipped and the others still go', async () => {
        installDb([makeCharacter('a', 'A', T0), makeCharacter('b', 'B', T0)])
        const { done } = await openConfirm(refsOf('A', 'B'))
        DBState.db.characters = DBState.db.characters.filter((c) => c.name !== 'A')
        await answer(true)
        await done
        expect(names()).toEqual([])
        expect(work.stopped).toEqual(['b'])
    })
})

describe('E4: work in removed characters', () => {
    test('work is stopped for each removed character before the list changes, and the list is assigned before checkCharOrder runs once', async () => {
        installDb([makeCharacter('l', 'Live'), makeCharacter('a', 'A', T0), makeCharacter('b', 'B', T0)])
        await confirmed(refsOf('A', 'B'))
        expect(work.stopped).toEqual(['a', 'b'])
        expect(work.lengthAtStop).toEqual([3, 3])
        expect(names()).toEqual(['Live'])
        expect(work.orderCalls).toEqual([1])
    })

    test('the busy line is shown when any member has work, and not otherwise', async () => {
        installDb([makeCharacter('a', 'A', T0), makeCharacter('b', 'B', T0)])
        const calm = await openConfirm(refsOf('A', 'B'))
        expect(calm.message).not.toContain(language.removeCharacterWhileWorking)
        await answer(false)
        await calm.done

        work.busy.add('b')
        const busy = await openConfirm(refsOf('A', 'B'))
        expect(busy.message).toContain(language.removeCharacterWhileWorking)
        await answer(false)
        await busy.done
    })

    test('stopWorkIn is keyed by chaId, so a live twin sharing a removed chaId also has its work stopped, as removeChar does', async () => {
        installDb([makeCharacter('dup', 'LiveTwin'), makeCharacter('dup', 'TrashedTwin', T0)])
        await confirmed(refsOf('TrashedTwin'))
        expect(work.stopped).toEqual(['dup'])
        expect(names()).toEqual(['LiveTwin'])
    })
})

describe('the removal itself', () => {
    test('sets the reload flag and marks each removed id for saving, once each', async () => {
        installDb([makeCharacter('l', 'Live'), makeCharacter('a', 'A', T0), makeCharacter('b', 'B', T0)])
        await confirmed(refsOf('A', 'B'))
        expect(requiresFullEncoderReload.state).toBe(true)
        expect(tracker.character).toEqual(['a', 'b'])
        expect(schedule).toHaveBeenCalled()
    })

    test('guard: a trashed member of a live group chat is removed and the group is not edited', async () => {
        installDb([makeGroup('grp', ['m1', 'live']), makeCharacter('m1', 'Member', T0), makeCharacter('live', 'Live')])
        await confirmed(refsOf('Member'))
        expect(names()).toEqual(['grp', 'Live'])
        expect((DBState.db.characters[0] as unknown as { characters: string[] }).characters).toEqual(['m1', 'live'])
    })
})

describe('E7: the selection', () => {
    test('a removed selected character leaves nothing selected', async () => {
        installDb([makeCharacter('l', 'Live'), makeCharacter('a', 'A', T0)], 1)
        await confirmed(refsOf('A'))
        expect(selection()).toBe(-1)
    })

    test('a selected live character after removed entries stays selected, at its new index', async () => {
        installDb([makeCharacter('a', 'A', T0), makeCharacter('b', 'B', T0), makeCharacter('l', 'Live')], 2)
        const live = DBState.db.characters[2]
        await confirmed(refsOf('A', 'B'))
        expect(selection()).toBe(0)
        expect(DBState.db.characters[selection()]).toBe(live)
    })

    test('a selected live character before the removed entries keeps its index', async () => {
        installDb([makeCharacter('l', 'Live'), makeCharacter('a', 'A', T0)], 0)
        await confirmed(refsOf('A'))
        expect(selection()).toBe(0)
    })

    test('with nothing selected nothing becomes selected', async () => {
        installDb([makeCharacter('l', 'Live'), makeCharacter('a', 'A', T0)], -1)
        await confirmed(refsOf('A'))
        expect(selection()).toBe(-1)
    })
})
