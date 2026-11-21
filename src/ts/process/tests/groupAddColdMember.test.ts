/**
 * Adding a member to a group (`addGroupChar` in `../group`) when the picked
 * character is archived: a placeholder (the "stub") in `DBState.db.characters`
 * whose `firstMessage` and every other field except `name`, `image`, `chaId`,
 * `type`, `lastInteraction` and `trashTime` is not data.
 *
 * Invariants exercised here:
 * - The greeting pushed into the group's current chat is the `firstMessage` of
 *   the character's own unit, and the member is a full character afterwards.
 * - A member whose unit cannot be read is still added to `characters`,
 *   `characterTalks` and `characterActive`, gets no greeting (not even a blank
 *   one) and the user is told once, by name.
 * - A restored member is format-updated in its slot, and its own
 *   `lastInteraction` is not bumped by being added.
 * - A picked character that is gone from the list once its read is done is not
 *   added, gets no greeting and raises no alert.
 * - A character already in the group is refused without restoring anything.
 *
 * Every cold-storage read goes through the mocked `readColdStorageItem`; the
 * picker and the confirmation are mocked answers. The restore itself is the
 * real one.
 */
import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, character, groupChat } from '../../storage/database.svelte'

const readColdStorageItemMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())
const alertConfirmMock = vi.hoisted(() => vi.fn())
const alertSelectCharMock = vi.hoisted(() => vi.fn())

vi.mock(import('../../stores.svelte'), () => {
    const state = { db: {} as unknown as Database }
    return {
        DBState: state,
        selectedCharID: writable(-1),
        CharEmotion: writable({}),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../storage/database.svelte'), async () => {
    const { DBState } = await import('../../stores.svelte')
    return {
        getDatabase: vi.fn(() => DBState.db),
        setDatabase: vi.fn((db: Database) => { DBState.db = db }),
    } as unknown as typeof import('../../storage/database.svelte')
})

// Faithful to production: the live non-group character holding the id (a stub
// included), or a blank one.
vi.mock(import('../../util'), async () => {
    const { DBState } = await import('../../stores.svelte')
    return {
        findCharacterbyId: (id: string) => {
            for (const candidate of DBState.db.characters) {
                if (candidate.type !== 'group' && candidate.chaId === id) {
                    return candidate
                }
            }
            return { name: 'Unknown Character', firstMessage: '', chaId: id, type: 'character', chats: [] }
        },
    } as unknown as typeof import('../../util')
})

vi.mock(import('../../alert'), () => ({
    alertConfirm: alertConfirmMock,
    alertError: alertErrorMock,
    alertNormal: alertNormalMock,
    alertSelectChar: alertSelectCharMock,
    alertToast: vi.fn(),
    alertMd: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../coldstorage.svelte'), () => ({
    readColdStorageItem: readColdStorageItemMock,
    getColdStorageItem: async (key: string) => {
        const result = await readColdStorageItemMock(key)
        return result?.status === 'ok' ? result.value : null
    },
}) as unknown as typeof import('../coldstorage.svelte'))

vi.mock(import('../../characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('../../characters'))

vi.mock(import('../index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('../index.svelte'))

import { addGroupChar } from '../group'
import { buildColdStub } from './coldStubFixture'
import { DBState, selectedCharID } from '../../stores.svelte'
import { language } from '../../../lang'
import { characterFormatUpdate } from '../../characters'

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
        desc: `${chaId} description`,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: 'Chat 1', localLore: [] }],
        ...extra,
    } as unknown as character
}

function stubOf(source: character, key: string): Slot {
    return buildColdStub(source, key, []) as unknown as Slot
}

/** The group, selected, in slot 0; its current chat is the second of two. */
function installGroup(members: string[], others: Slot[]): groupChat {
    const group = {
        type: 'group',
        name: 'the group',
        chaId: 'group-1',
        chatPage: 1,
        characters: [...members],
        characterTalks: members.map(() => 1),
        characterActive: members.map(() => true),
        chats: [
            { id: 'older-chat', message: [], note: '', name: 'Older', localLore: [] },
            { id: 'current-chat', message: [], note: '', name: 'Current', localLore: [] },
        ],
    } as unknown as groupChat
    DBState.db = { characters: [group as unknown as Slot, ...others] } as unknown as Database
    selectedCharID.set(0)
    return DBState.db.characters[0] as unknown as groupChat
}

function ok(restored: character) {
    return { status: 'ok', value: { character: restored } }
}

function shownAlerts(): string[] {
    return [alertErrorMock, alertNormalMock].flatMap((fn) => fn.mock.calls.map((args) => String(args[0])))
}

let consoleErrorSpy: MockInstance<typeof console.error>

beforeEach(() => {
    readColdStorageItemMock.mockReset()
    alertErrorMock.mockReset()
    alertNormalMock.mockReset()
    alertConfirmMock.mockReset()
    alertSelectCharMock.mockReset()
    vi.mocked(characterFormatUpdate).mockClear()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    consoleErrorSpy.mockRestore()
})

describe('addGroupChar with an archived character', () => {
    test('accepting the greeting pushes the unit\'s firstMessage into the current chat and leaves the member full', async () => {
        const unit = fullCharacter('m', { firstMessage: 'greeting from the unit', desc: 'description from the unit' })
        const group = installGroup(['x'], [stubOf(unit, 'unit-m')])
        alertSelectCharMock.mockResolvedValue('m')
        alertConfirmMock.mockResolvedValue(true)
        readColdStorageItemMock.mockResolvedValue(ok(unit))

        await addGroupChar()

        expect(group.chats[1].message).toHaveLength(1)
        expect(group.chats[1].message[0]).toMatchObject({ role: 'char', data: 'greeting from the unit', saying: 'm' })
        expect(group.chats[0].message).toEqual([])
        expect(group.characters).toEqual(['x', 'm'])
        const member = DBState.db.characters[1] as unknown as character
        expect(member.coldstorage).toBeUndefined()
        expect(member.desc).toBe('description from the unit')
        expect(shownAlerts()).toEqual([])
    })

    test('declining the greeting still restores and adds the member and pushes no greeting', async () => {
        const unit = fullCharacter('m', { desc: 'description from the unit' })
        const group = installGroup([], [stubOf(unit, 'unit-m')])
        alertSelectCharMock.mockResolvedValue('m')
        alertConfirmMock.mockResolvedValue(false)
        readColdStorageItemMock.mockResolvedValue(ok(unit))

        await addGroupChar()

        expect(group.chats[1].message).toEqual([])
        expect(group.characters).toEqual(['m'])
        expect(group.characterTalks).toHaveLength(1)
        expect(group.characterActive).toEqual([true])
        const member = DBState.db.characters[1] as unknown as character
        expect(member.coldstorage).toBeUndefined()
        expect(member.desc).toBe('description from the unit')
        expect(shownAlerts()).toEqual([])
    })

    test('a missing unit adds the member without any greeting, leaves it archived, and shows one alert naming it', async () => {
        const unit = fullCharacter('m', { name: 'Alice' })
        const group = installGroup(['x'], [stubOf(unit, 'unit-m')])
        alertSelectCharMock.mockResolvedValue('m')
        alertConfirmMock.mockResolvedValue(true)
        readColdStorageItemMock.mockResolvedValue({ status: 'missing' })

        await addGroupChar()

        expect(group.chats[1].message).toEqual([])
        expect(group.chats[0].message).toEqual([])
        expect(group.characters).toEqual(['x', 'm'])
        expect(group.characterTalks).toHaveLength(2)
        expect(group.characterActive).toEqual([true, true])
        expect((DBState.db.characters[1] as unknown as character).coldstorage).toBe('unit-m')
        const alerts = shownAlerts()
        expect(alerts).toHaveLength(1)
        expect(alerts[0]).toContain('Alice')
    })

    test('an unreadable unit adds the member without any greeting and shows one alert naming it', async () => {
        const unit = fullCharacter('m', { name: 'Alice' })
        const group = installGroup([], [stubOf(unit, 'unit-m')])
        alertSelectCharMock.mockResolvedValue('m')
        alertConfirmMock.mockResolvedValue(true)
        readColdStorageItemMock.mockResolvedValue({ status: 'error', error: new Error('disk unavailable') })

        await addGroupChar()

        expect(group.chats[1].message).toEqual([])
        expect(group.characters).toEqual(['m'])
        const alerts = shownAlerts()
        expect(alerts).toHaveLength(1)
        expect(alerts[0]).toContain('Alice')
    })

    test.each([
        ['no storage on the page', 'unavailable', /offers no storage/i, (name: string) => language.errors.coldStorageNamedRestoreUnavailable(name)],
        ['a copy that cannot be read', 'damaged', /may be damaged/i, (name: string) => language.errors.coldStorageNamedRestoreDamaged(name)],
    ] as const)('%s adds the member without a first message, leaves it archived, and shows one alert naming it with the wording for that cause', async (_label, kind, wording, expectedText) => {
        const unit = fullCharacter('m', { name: 'Alice' })
        const group = installGroup(['x'], [stubOf(unit, 'unit-m')])
        alertSelectCharMock.mockResolvedValue('m')
        alertConfirmMock.mockResolvedValue(true)
        readColdStorageItemMock.mockResolvedValue({ status: 'error', error: new Error('cannot be used here'), kind })

        await addGroupChar()

        expect(group.chats[1].message).toEqual([])
        expect(group.characters).toEqual(['x', 'm'])
        expect((DBState.db.characters[1] as unknown as character).coldstorage).toBe('unit-m')
        const alerts = shownAlerts()
        expect(alerts).toHaveLength(1)
        expect(alerts[0]).toContain('Alice')
        expect(alerts[0]).not.toMatch(/try again/i)
        expect(alerts[0]).not.toMatch(/lost|permanently/i)
        expect(alerts[0]).toMatch(wording)
        expect(alerts[0]).toBe(expectedText('Alice'))
    })

    test('a restored member is format-updated in its slot without a new interaction time', async () => {
        const unit = fullCharacter('m', { lastInteraction: 1234 })
        installGroup(['x'], [stubOf(unit, 'unit-m')])
        alertSelectCharMock.mockResolvedValue('m')
        alertConfirmMock.mockResolvedValue(false)
        readColdStorageItemMock.mockResolvedValue(ok(unit))

        await addGroupChar()

        const calls = vi.mocked(characterFormatUpdate).mock.calls
        expect(calls.map((args) => args[0])).toEqual([1])
        expect(calls[0][1]?.updateInteraction).toBeFalsy()
        expect((DBState.db.characters[1] as unknown as character).lastInteraction).toBe(1234)
    })

    test('a picked character deleted while its unit is being read is not added, gets no greeting, and shows no alert', async () => {
        const unit = fullCharacter('m', { name: 'Alice' })
        const group = installGroup(['x'], [stubOf(unit, 'unit-m')])
        alertSelectCharMock.mockResolvedValue('m')
        alertConfirmMock.mockResolvedValue(true)
        let release: (value: unknown) => void = () => {}
        readColdStorageItemMock.mockImplementation(() => new Promise((resolve) => { release = resolve }))

        const adding = addGroupChar()
        await new Promise((resolve) => setTimeout(resolve, 0))
        DBState.db.characters.splice(1, 1)
        release(ok(unit))
        await adding

        expect(group.characters).toEqual(['x'])
        expect(group.characterTalks).toEqual([1])
        expect(group.characterActive).toEqual([true])
        expect(group.chats[1].message).toEqual([])
        expect(alertConfirmMock).not.toHaveBeenCalled()
        expect(shownAlerts()).toEqual([])
    })

    test('guard: a character already in the group is refused with its own message and nothing is restored', async () => {
        const unit = fullCharacter('m', { name: 'Alice' })
        const group = installGroup(['m'], [stubOf(unit, 'unit-m')])
        alertSelectCharMock.mockResolvedValue('m')
        alertConfirmMock.mockResolvedValue(true)

        await addGroupChar()

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.errors.alreadyCharInGroup)
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(alertConfirmMock).not.toHaveBeenCalled()
        expect(group.characters).toEqual(['m'])
        expect((DBState.db.characters[1] as unknown as character).coldstorage).toBe('unit-m')
    })
})
