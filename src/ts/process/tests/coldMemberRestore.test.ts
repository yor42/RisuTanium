/**
 * Bringing a cold-storage character back into memory by its `chaId`.
 *
 * `restoreColdCharacterByChaId` (`../coldMemberRestore`) resolves true when
 * the character holding the id is warm afterwards, and false when the
 * restore failed. After the cold read's await the install lands in the sole
 * holder of the `chaId` that is still a placeholder: never in an index
 * captured before the read, and not only in the placeholder object the restore
 * started from. A character inserted or deleted during the read, or the
 * placeholder replaced by a copy carrying the same `chaId`, therefore cannot
 * turn into a spurious failure or a write into another character's slot.
 *
 * The cold read is `readColdStorageItem` (three-way: ok, missing, error),
 * mocked: a test controls what it returns, and what happens to
 * `DBState.db.characters` while it is pending. `getColdStorageItem`, the
 * reader that collapses missing and error into null, is mocked as a thin
 * adapter over the same mock and recorded, so a test can require the restore
 * to read through `readColdStorageItem` only. The character-format step
 * (`../../characters`) and the alert (`../../alert`) are mocked too, so this
 * file exercises which slot is installed, what state the installed character
 * carries, when the answer is true, and what the user is told.
 */
import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, character } from '../../storage/database.svelte'

const readColdStorageItemMock = vi.hoisted(() => vi.fn())
const legacyReadSpy = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const characterFormatUpdateMock = vi.hoisted(() => vi.fn())

vi.mock(import('../../stores.svelte'), () => {
    const state = { db: {} as unknown as Database }
    return {
        DBState: state,
        selectedCharID: writable(-1),
        CharEmotion: writable({}),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../coldstorage.svelte'), () => ({
    readColdStorageItem: readColdStorageItemMock,
    getColdStorageItem: async (key: string) => {
        legacyReadSpy(key)
        const result = await readColdStorageItemMock(key)
        return result?.status === 'ok' ? result.value : null
    },
}) as unknown as typeof import('../coldstorage.svelte'))

vi.mock(import('../../characters'), () => ({
    characterFormatUpdate: characterFormatUpdateMock,
}) as unknown as typeof import('../../characters'))

vi.mock(import('../../alert'), () => ({
    alertError: alertErrorMock,
}) as unknown as typeof import('../../alert'))

vi.mock(import('../index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('../index.svelte'))

import { restoreColdCharacterByChaId } from '../coldMemberRestore'
import { buildColdStub } from '../coldCharacter'
import { restoreColdCharacter } from '../coldCharacterRestore'
import { doingChat } from '../index.svelte'
import { DBState } from '../../stores.svelte'
import { language } from '../../../lang'

type CharacterFixture = Database['characters'][number]

function warmCharacter(chaId: string, description = `${chaId} description`, extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        chaId,
        name: chaId,
        type: 'character',
        chatPage: 0,
        desc: description,
        chats: [{ id: `${chaId}-chat`, message: [{ role: 'user', data: 'Hi', time: 1 }], note: '', name: '', localLore: [] }],
        ...extra,
    } as unknown as CharacterFixture
}

function coldPlaceholder(chaId: string, key = `cold-key-${chaId}`, name = chaId): CharacterFixture {
    return {
        type: 'character',
        name,
        chaId,
        chats: [{ id: `${chaId}-placeholder-chat`, message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
        chatPage: 0,
        firstMsgIndex: 0,
        coldstorage: key,
        coldStoragedChats: [],
    } as unknown as CharacterFixture
}

/** An archived character in the shape the upstream application writes: no marker, a dummy chat without an id. */
function upstreamPlaceholder(chaId: string, key = `cold-key-${chaId}`, extra: Record<string, unknown> = {}): CharacterFixture {
    const stub = coldPlaceholder(chaId, key) as unknown as Record<string, unknown>
    delete (stub.chats as Record<string, unknown>[])[0].id
    return { ...stub, ...extra } as unknown as CharacterFixture
}

function installDb(characters: CharacterFixture[]): void {
    DBState.db = { characters } as unknown as Database
}

function holderOf(chaId: string): CharacterFixture | undefined {
    return DBState.db.characters.find((c) => c.chaId === chaId)
}

function ok(restored: CharacterFixture) {
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

/** The character `characterFormatUpdate` was handed, whether it got an index or the object. */
function formattedCharacters(): CharacterFixture[] {
    return characterFormatUpdateMock.mock.calls.map(([arg]) => (typeof arg === 'number' ? DBState.db.characters[arg] : arg) as CharacterFixture)
}

let consoleErrorSpy: MockInstance<typeof console.error>

beforeEach(() => {
    readColdStorageItemMock.mockReset()
    legacyReadSpy.mockReset()
    alertErrorMock.mockReset()
    characterFormatUpdateMock.mockReset()
    doingChat.set(false)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    consoleErrorSpy.mockRestore()
})

describe('restoreColdCharacterByChaId', () => {
    test('installs the restored character in the slot that holds the chaId, read with the placeholder\'s key', async () => {
        installDb([warmCharacter('before'), coldPlaceholder('member'), warmCharacter('after')])
        readColdStorageItemMock.mockResolvedValueOnce(ok(warmCharacter('member', 'restored description')))

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(true)
        expect(readColdStorageItemMock).toHaveBeenCalledTimes(1)
        expect(readColdStorageItemMock).toHaveBeenCalledWith('cold-key-member')
        expect(DBState.db.characters.map((c) => c.chaId)).toEqual(['before', 'member', 'after'])
        expect((holderOf('member') as unknown as character).coldstorage).toBeUndefined()
        expect((holderOf('member') as unknown as character).desc).toBe('restored description')
    })

    test('reads the unit through readColdStorageItem and never through the null-collapsing reader', async () => {
        installDb([coldPlaceholder('member')])
        readColdStorageItemMock.mockResolvedValueOnce(ok(warmCharacter('member', 'restored description')))

        await restoreColdCharacterByChaId('member')

        expect(readColdStorageItemMock).toHaveBeenCalledTimes(1)
        expect(legacyReadSpy).not.toHaveBeenCalled()
    })

    test('a character inserted before the member during the cold read does not move the install onto another slot', async () => {
        installDb([warmCharacter('before'), coldPlaceholder('member'), warmCharacter('after')])
        readColdStorageItemMock.mockImplementationOnce(async () => {
            DBState.db.characters.unshift(warmCharacter('inserted'))
            return ok(warmCharacter('member', 'restored description'))
        })

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(true)
        expect(DBState.db.characters.map((c) => c.chaId)).toEqual(['inserted', 'before', 'member', 'after'])
        expect((holderOf('member') as unknown as character).desc).toBe('restored description')
        expect((holderOf('member') as unknown as character).coldstorage).toBeUndefined()
        expect((holderOf('before') as unknown as character).desc).toBe('before description')
        expect((holderOf('inserted') as unknown as character).desc).toBe('inserted description')
    })

    test('a character deleted before the member during the cold read does not stop the install', async () => {
        installDb([warmCharacter('before'), coldPlaceholder('member'), warmCharacter('after')])
        readColdStorageItemMock.mockImplementationOnce(async () => {
            DBState.db.characters.splice(0, 1)
            return ok(warmCharacter('member', 'restored description'))
        })

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(true)
        expect(DBState.db.characters.map((c) => c.chaId)).toEqual(['member', 'after'])
        expect((holderOf('member') as unknown as character).desc).toBe('restored description')
        expect((holderOf('after') as unknown as character).desc).toBe('after description')
    })

    test('an item whose character has another chaId resolves false and leaves the placeholder in place', async () => {
        installDb([warmCharacter('before'), coldPlaceholder('member')])
        readColdStorageItemMock.mockResolvedValueOnce(ok(warmCharacter('someone-else')))

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(false)
        expect(DBState.db.characters.map((c) => c.chaId)).toEqual(['before', 'member'])
        expect((holderOf('member') as unknown as character).coldstorage).toBe('cold-key-member')
    })

    test.each([
        ['a missing unit', { status: 'missing' }],
        ['a read error', { status: 'error', error: new Error('disk unavailable') }],
        ['an item without a character', { status: 'ok', value: {} }],
        ['an item that decoded to null', { status: 'ok', value: null }],
    ] as const)('guard: %s resolves false and leaves the placeholder in place', async (_label, item) => {
        installDb([warmCharacter('before'), coldPlaceholder('member')])
        readColdStorageItemMock.mockResolvedValueOnce(item)

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(false)
        expect(DBState.db.characters.map((c) => c.chaId)).toEqual(['before', 'member'])
        expect((holderOf('member') as unknown as character).coldstorage).toBe('cold-key-member')
        expect(characterFormatUpdateMock).not.toHaveBeenCalled()
    })

    test('a character that is already warm resolves true without a read', async () => {
        installDb([warmCharacter('before'), warmCharacter('member', 'already warm')])

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(true)
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect((holderOf('member') as unknown as character).desc).toBe('already warm')
    })

    test('guard: a chaId held by two characters is refused without a read', async () => {
        installDb([coldPlaceholder('member', 'cold-key-a'), coldPlaceholder('member', 'cold-key-b')])

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(false)
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(DBState.db.characters.every((c) => !!(c as unknown as character).coldstorage)).toBe(true)
    })

    test('guard: keeps working while a chat is generating', async () => {
        installDb([coldPlaceholder('member')])
        doingChat.set(true)
        readColdStorageItemMock.mockResolvedValueOnce(ok(warmCharacter('member', 'restored description')))

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(true)
        expect((holderOf('member') as unknown as character).desc).toBe('restored description')
    })

    test('guard: formats the installed character once and never a placeholder', async () => {
        installDb([warmCharacter('before'), coldPlaceholder('member')])
        readColdStorageItemMock.mockResolvedValueOnce(ok(warmCharacter('member', 'restored description')))

        await restoreColdCharacterByChaId('member')

        const formatted = formattedCharacters()
        expect(formatted).toHaveLength(1)
        expect((formatted[0] as character).coldstorage).toBeUndefined()
        expect((formatted[0] as character).desc).toBe('restored description')
    })

    test('guard: the installed character carries none of the placeholder\'s pointer, marker or count fields', async () => {
        const blob = warmCharacter('member', 'restored description', { image: '', creatorNotes: '', lastInteraction: 5 })
        const stub = buildColdStub(blob as unknown as character, 'cold-key-member', ['chat-unit'])
        installDb([stub as unknown as CharacterFixture])
        readColdStorageItemMock.mockResolvedValueOnce(ok(blob))

        await restoreColdCharacterByChaId('member')

        const installed = holderOf('member') as unknown as Record<string, unknown>
        const stubOnlyKeys = Object.keys(stub).filter((key) => !(key in (blob as unknown as Record<string, unknown>)) && key !== 'trashTime')
        expect(stubOnlyKeys).toContain('coldstorage')
        for (const key of stubOnlyKeys) {
            expect(key in installed).toBe(false)
        }
    })
})

describe('restoreColdCharacterByChaId -- what the user is told', () => {
    test('a missing unit shows the data-loss warning once, naming the character', async () => {
        installDb([coldPlaceholder('member')])
        readColdStorageItemMock.mockResolvedValueOnce({ status: 'missing' })

        await restoreColdCharacterByChaId('member')

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.errors.coldStorageNamedRestoreFailed('member'))
    })

    test('a read error asks to try again and never claims the data may be lost', async () => {
        installDb([coldPlaceholder('member')])
        readColdStorageItemMock.mockResolvedValueOnce({ status: 'error', error: new Error('disk unavailable') })

        await restoreColdCharacterByChaId('member')

        const unreadable = language.errors.coldStorageNamedRestoreUnreadable('member')
        expect(typeof unreadable).toBe('string')
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(unreadable)
        expect(alertErrorMock).not.toHaveBeenCalledWith(language.errors.coldStorageNamedRestoreFailed('member'))
    })

    test('a unit for another character is refused with an alert, and the log names both ids, the key and the name', async () => {
        installDb([coldPlaceholder('member', 'cold-key-member', 'Member Name')])
        readColdStorageItemMock.mockResolvedValueOnce(ok(warmCharacter('someone-else')))

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(false)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.errors.coldStorageNamedRestoreFailed('Member Name'))
        expect(consoleErrorSpy).toHaveBeenCalled()
        const logged = loggedErrorText(consoleErrorSpy)
        expect(logged).toContain('member')
        expect(logged).toContain('someone-else')
        expect(logged).toContain('cold-key-member')
        expect(logged).toContain('Member Name')
        expect((holderOf('member') as unknown as character).coldstorage).toBe('cold-key-member')
        expect((holderOf('member') as unknown as character).chaId).toBe('member')
    })

    test('a chaId held by several characters is refused without a read and shows the data-loss warning once', async () => {
        installDb([coldPlaceholder('member', 'cold-key-a'), coldPlaceholder('member', 'cold-key-b')])

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(false)
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.errors.coldStorageNamedRestoreFailed('member'))
    })

    test('guard: the placeholder deleted during the read installs nothing and shows no alert', async () => {
        installDb([warmCharacter('before'), coldPlaceholder('member'), warmCharacter('after')])
        readColdStorageItemMock.mockImplementationOnce(async () => {
            DBState.db.characters.splice(1, 1)
            return ok(warmCharacter('member', 'restored description'))
        })

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(false)
        expect(DBState.db.characters.map((c) => c.chaId)).toEqual(['before', 'after'])
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(characterFormatUpdateMock).not.toHaveBeenCalled()
    })

    test('guard: the placeholder replaced by another character during the read writes nothing and shows no alert', async () => {
        installDb([warmCharacter('before'), coldPlaceholder('member'), warmCharacter('after')])
        readColdStorageItemMock.mockImplementationOnce(async () => {
            DBState.db.characters[1] = warmCharacter('replacement', 'replacement description')
            return ok(warmCharacter('member', 'restored description'))
        })

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(false)
        expect(DBState.db.characters.map((c) => c.chaId)).toEqual(['before', 'replacement', 'after'])
        expect((holderOf('replacement') as unknown as character).desc).toBe('replacement description')
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(characterFormatUpdateMock).not.toHaveBeenCalled()
    })
})

describe('restoreColdCharacterByChaId -- the placeholder is replaced by a copy of itself during the read', () => {
    function copyOf(cha: CharacterFixture): CharacterFixture {
        return JSON.parse(JSON.stringify(cha)) as CharacterFixture
    }

    function archived(chaId: string): character {
        return buildColdStub(warmCharacter(chaId) as unknown as character, `cold-key-${chaId}`, [])
    }

    test('one slot replaced by a copy that is still a placeholder installs the unit in the holder of the chaId, with the copy\'s trash state, and shows no alert', async () => {
        installDb([warmCharacter('before'), archived('member') as unknown as CharacterFixture, warmCharacter('after')])
        readColdStorageItemMock.mockImplementationOnce(async () => {
            const replacement = copyOf(DBState.db.characters[1])
            ;(replacement as unknown as character).trashTime = 9_000
            DBState.db.characters[1] = replacement
            return ok(warmCharacter('member', 'restored description'))
        })

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(true)
        expect(DBState.db.characters.map((c) => c.chaId)).toEqual(['before', 'member', 'after'])
        const installed = holderOf('member') as unknown as character
        expect(installed.coldstorage).toBeUndefined()
        expect(installed.desc).toBe('restored description')
        expect(installed.trashTime).toBe(9_000)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(formattedCharacters()).toHaveLength(1)
        expect((formattedCharacters()[0] as character).coldstorage).toBeUndefined()
    })

    test('the whole list replaced by copies still installs the unit in the holder of the chaId and shows no alert', async () => {
        installDb([warmCharacter('before'), archived('member') as unknown as CharacterFixture, warmCharacter('after')])
        readColdStorageItemMock.mockImplementationOnce(async () => {
            DBState.db.characters = DBState.db.characters.map(copyOf)
            return ok(warmCharacter('member', 'restored description'))
        })

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(true)
        expect(DBState.db.characters.map((c) => c.chaId)).toEqual(['before', 'member', 'after'])
        const installed = holderOf('member') as unknown as character
        expect(installed.coldstorage).toBeUndefined()
        expect(installed.desc).toBe('restored description')
        expect((holderOf('before') as unknown as character).desc).toBe('before description')
        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})

describe('restoreColdCharacterByChaId -- who holds the chaId once the read is done', () => {
    test('a second holder inserted ahead of the placeholder during the read refuses the restore with the data-loss warning, and installs nowhere', async () => {
        installDb([warmCharacter('before'), coldPlaceholder('member'), warmCharacter('after')])
        readColdStorageItemMock.mockImplementationOnce(async () => {
            DBState.db.characters.unshift(warmCharacter('member', 'the other holder'))
            return ok(warmCharacter('member', 'restored description'))
        })

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(false)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(language.errors.coldStorageNamedRestoreFailed('member'))
        expect(DBState.db.characters.map((c) => c.chaId)).toEqual(['member', 'before', 'member', 'after'])
        expect((DBState.db.characters[0] as unknown as character).desc).toBe('the other holder')
        expect((DBState.db.characters[2] as unknown as character).coldstorage).toBe('cold-key-member')
        expect((DBState.db.characters[2] as unknown as character).desc).toBeUndefined()
        expect(characterFormatUpdateMock).not.toHaveBeenCalled()
    })

    test('guard: a placeholder replaced during the read by the full character with the same chaId keeps that character and its edits, formatting it once like any restored answer', async () => {
        installDb([warmCharacter('before'), coldPlaceholder('member')])
        const replacement = warmCharacter('member', 'edited by the user')
        readColdStorageItemMock.mockImplementationOnce(async () => {
            DBState.db.characters[1] = replacement
            return ok(warmCharacter('member', 'restored description'))
        })

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(true)
        expect(holderOf('member')).toBe(replacement)
        expect((holderOf('member') as unknown as character).desc).toBe('edited by the user')
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(formattedCharacters()).toEqual([replacement])
    })

    test('a placeholder replaced during the read by a placeholder with the same chaId and another unit key installs nothing, keeps the new placeholder and its key, and stays silent', async () => {
        installDb([warmCharacter('before'), coldPlaceholder('member', 'cold-key-old')])
        const replacement = coldPlaceholder('member', 'cold-key-new')
        readColdStorageItemMock.mockImplementationOnce(async () => {
            DBState.db.characters[1] = replacement
            return ok(warmCharacter('member', 'content of the old unit'))
        })

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(false)
        expect(readColdStorageItemMock).toHaveBeenCalledTimes(1)
        expect(readColdStorageItemMock).toHaveBeenCalledWith('cold-key-old')
        expect(holderOf('member')).toBe(replacement)
        expect((holderOf('member') as unknown as character).coldstorage).toBe('cold-key-new')
        expect((holderOf('member') as unknown as character).desc).toBeUndefined()
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(characterFormatUpdateMock).not.toHaveBeenCalled()
    })

    // The click-side restore is started through `restoreColdCharacter` itself
    // so the removal below runs after that restore settles and before the
    // by-chaId request's own continuation.
    test('a request that joins a running restore resolves false and silent when no character holds the chaId once that restore settles', async () => {
        installDb([warmCharacter('before'), coldPlaceholder('member')])
        const pending = holdReads()
        const stub = DBState.db.characters[1]

        const click = restoreColdCharacter(stub)
        const settledClick = click.then(() => {
            DBState.db.characters.splice(1, 1)
        })
        const byChaId = restoreColdCharacterByChaId('member')
        await tick()
        pending[0].resolve(ok(warmCharacter('member', 'restored description')))
        await settledClick

        expect(await byChaId).toBe(false)
        expect(DBState.db.characters.map((c) => c.chaId)).toEqual(['before'])
        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})

describe('restoreColdCharacterByChaId -- two restores of one placeholder', () => {
    test('guard: the second restore ends on the character the first one installed, and an edit made in between survives', async () => {
        installDb([warmCharacter('before'), coldPlaceholder('member')])
        const pending = holdReads()

        const first = restoreColdCharacterByChaId('member')
        const second = restoreColdCharacterByChaId('member')
        await tick()
        pending[0].resolve(ok(warmCharacter('member', 'first read')))
        expect(await first).toBe(true)
        const installedByFirst = holderOf('member') as unknown as character
        installedByFirst.desc = 'edited between the two completions'
        await tick()
        pending[1]?.resolve(ok(warmCharacter('member', 'second read')))
        expect(await second).toBe(true)

        expect(holderOf('member')).toBe(installedByFirst)
        expect((holderOf('member') as unknown as character).desc).toBe('edited between the two completions')
        expect(DBState.db.characters.map((c) => c.chaId)).toEqual(['before', 'member'])
    })
})

describe('restoreColdCharacterByChaId -- a request that joins a running restore', () => {
    test('guard: both requests resolve true and each formats the one installed character', async () => {
        installDb([warmCharacter('before'), coldPlaceholder('member')])
        const pending = holdReads()

        const first = restoreColdCharacterByChaId('member')
        const joined = restoreColdCharacterByChaId('member')
        await tick()
        pending[0].resolve(ok(warmCharacter('member', 'restored description')))

        expect(await first).toBe(true)
        expect(await joined).toBe(true)
        const formatted = formattedCharacters()
        expect(formatted).toHaveLength(2)
        expect(formatted[0]).toBe(holderOf('member'))
        expect(formatted[1]).toBe(holderOf('member'))
    })

    test('a format that throws rejects the joined request too, and never answers true for an unformatted member', async () => {
        installDb([warmCharacter('before'), coldPlaceholder('member')])
        const pending = holdReads()
        characterFormatUpdateMock.mockImplementation(() => { throw new Error('member format failed') })

        const first = restoreColdCharacterByChaId('member')
        const joined = restoreColdCharacterByChaId('member')
        const firstSettled = expect(first).rejects.toThrow('member format failed')
        const joinedSettled = expect(joined).rejects.toThrow('member format failed')
        await tick()
        pending[0].resolve(ok(warmCharacter('member', 'restored description')))
        await firstSettled
        await joinedSettled

        expect((holderOf('member') as unknown as character).coldstorage).toBeUndefined()
        expect((holderOf('member') as unknown as character).desc).toBe('restored description')
    })
})

describe('restoreColdCharacterByChaId -- the restored character\'s trash state', () => {
    function blob(extra: Record<string, unknown> = {}): CharacterFixture {
        return warmCharacter('member', 'restored description', { image: '', creatorNotes: '', ...extra })
    }

    test('a placeholder built here that was trashed after archiving restores as trashed', async () => {
        const stub = buildColdStub(blob() as unknown as character, 'cold-key-member', [])
        stub.trashTime = 5_000
        installDb([stub as unknown as CharacterFixture])
        readColdStorageItemMock.mockResolvedValueOnce(ok(blob()))

        await restoreColdCharacterByChaId('member')

        expect((holderOf('member') as unknown as character).trashTime).toBe(5_000)
        expect((holderOf('member') as unknown as character).desc).toBe('restored description')
    })

    test('a placeholder built here that was un-trashed after archiving restores as not trashed', async () => {
        const stub = buildColdStub(blob({ trashTime: 4_000 }) as unknown as character, 'cold-key-member', [])
        stub.trashTime = undefined
        installDb([stub as unknown as CharacterFixture])
        readColdStorageItemMock.mockResolvedValueOnce(ok(blob({ trashTime: 4_000 })))

        await restoreColdCharacterByChaId('member')

        expect((holderOf('member') as unknown as character).trashTime).toBeUndefined()
    })

    test('a trash applied to the placeholder while the read is pending is kept', async () => {
        const stub = buildColdStub(blob() as unknown as character, 'cold-key-member', [])
        installDb([stub as unknown as CharacterFixture])
        readColdStorageItemMock.mockImplementationOnce(async () => {
            ;(DBState.db.characters[0] as unknown as character).trashTime = 6_000
            return ok(blob())
        })

        await restoreColdCharacterByChaId('member')

        expect((holderOf('member') as unknown as character).trashTime).toBe(6_000)
    })

    test('an upstream-made placeholder with a truthy trashTime restores as trashed', async () => {
        installDb([upstreamPlaceholder('member', 'cold-key-member', { trashTime: 7_000 })])
        readColdStorageItemMock.mockResolvedValueOnce(ok(blob()))

        await restoreColdCharacterByChaId('member')

        expect((holderOf('member') as unknown as character).trashTime).toBe(7_000)
    })

    test('an upstream-made placeholder without trashTime restores as not trashed even when the unit holds a trashTime', async () => {
        installDb([upstreamPlaceholder('member')])
        readColdStorageItemMock.mockResolvedValueOnce(ok(blob({ trashTime: 8_000 })))

        await restoreColdCharacterByChaId('member')

        expect((holderOf('member') as unknown as character).trashTime).toBeUndefined()
        expect((holderOf('member') as unknown as character).desc).toBe('restored description')
    })
})
