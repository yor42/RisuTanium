/**
 * CHORE-07 -- `readPluginStorageValue`/`writePluginStorageValue`
 * (`src/ts/plugins/apiV3/pluginColdStorage.ts`), the dependency-injected
 * core of the v3 plugin API's `pluginStorage.getItem`/`setItem`.
 *
 * No mocking is needed: both functions take every external dependency
 * (`getLiveDb`, `readColdStorageItemFn`, `setColdStorageItemFn`,
 * `newColdId`) as a plain parameter.
 */
import { describe, test, expect, vi } from 'vitest'
import { readPluginStorageValue, writePluginStorageValue, type PluginColdStorageDb } from '../../plugins/apiV3/pluginColdStorage'
import type { ColdStorageReadResult } from '../coldstorage.svelte'
import { coldStorageHeader, formatColdStorageLoadError } from '../coldstorageData'

describe('CHORE-07: readPluginStorageValue', () => {
    test('no mapping for the key resolves null without calling the reader', async () => {
        const db: PluginColdStorageDb = { pluginCustomStorage: { _coldplugin: {} } }
        const reader = vi.fn()
        const result = await readPluginStorageValue(db, 'missing-key', reader)
        expect(result).toBeNull()
        expect(reader).not.toHaveBeenCalled()
    })

    test('an "ok" read returns the value', async () => {
        const db: PluginColdStorageDb = { pluginCustomStorage: { _coldplugin: { k: 'cold-id-1' } } }
        const reader = vi.fn(async (): Promise<ColdStorageReadResult> => ({ status: 'ok', value: { a: 1 } }))
        const result = await readPluginStorageValue(db, 'k', reader)
        expect(result).toEqual({ a: 1 })
        expect(reader).toHaveBeenCalledWith('cold-id-1')
    })

    test('an "ok" read of a stored null still returns null (not distinguished from missing)', async () => {
        const db: PluginColdStorageDb = { pluginCustomStorage: { _coldplugin: { k: 'cold-id-null' } } }
        const reader = vi.fn(async (): Promise<ColdStorageReadResult> => ({ status: 'ok', value: null }))
        const result = await readPluginStorageValue(db, 'k', reader)
        expect(result).toBeNull()
    })

    test('a "missing" read resolves null', async () => {
        const db: PluginColdStorageDb = { pluginCustomStorage: { _coldplugin: { k: 'cold-id-2' } } }
        const reader = vi.fn(async (): Promise<ColdStorageReadResult> => ({ status: 'missing' }))
        const result = await readPluginStorageValue(db, 'k', reader)
        expect(result).toBeNull()
    })

    test('an "error" read rejects, and the message does not contain the value', async () => {
        const db: PluginColdStorageDb = { pluginCustomStorage: { _coldplugin: { k: 'cold-id-3' } } }
        const secretValue = 'super-secret-plugin-value-should-never-appear-in-error'
        const reader = vi.fn(async (): Promise<ColdStorageReadResult> => ({
            status: 'error',
            error: new Error(secretValue),
        }))

        await expect(readPluginStorageValue(db, 'k', reader)).rejects.toThrow(/k/)
        try {
            await readPluginStorageValue(db, 'k', reader)
            expect.unreachable('expected readPluginStorageValue to throw')
        } catch (thrown) {
            const message = (thrown as Error).message
            expect(message).not.toContain(secretValue)
        }
    })

    test.each(['unavailable', 'damaged'] as const)('guard: an "error" read of kind %s rejects with the same message as any other "error" read, never resolving null', async (kind) => {
        const db: PluginColdStorageDb = { pluginCustomStorage: { _coldplugin: { k: 'cold-id-4' } } }
        const reader = vi.fn(async (): Promise<ColdStorageReadResult> => ({ status: 'error', error: new Error('cannot be used here'), kind }))

        await expect(readPluginStorageValue(db, 'k', reader)).rejects.toThrow('Failed to read plugin storage for key: k')
    })
})

describe('CHORE-07: writePluginStorageValue', () => {
    test('a failed write rejects', async () => {
        const db: PluginColdStorageDb = {}
        const writer = vi.fn(async () => false)
        await expect(
            writePluginStorageValue(db, () => db, 'k', 'v', writer, () => 'new-id')
        ).rejects.toThrow(/k/)
    })

    test('a failed first write leaves no mapping', async () => {
        const db: PluginColdStorageDb = {}
        const writer = vi.fn(async () => false)
        await expect(
            writePluginStorageValue(db, () => db, 'k', 'v', writer, () => 'new-id')
        ).rejects.toThrow()
        expect(db.pluginCustomStorage?._coldplugin?.k).toBeUndefined()
    })

    test('a failure with an existing mapping keeps the mapping', async () => {
        const db: PluginColdStorageDb = { pluginCustomStorage: { _coldplugin: { k: 'existing-id' } } }
        const writer = vi.fn(async () => false)
        await expect(
            writePluginStorageValue(db, () => db, 'k', 'v', writer, () => 'unused-new-id')
        ).rejects.toThrow()
        expect(db.pluginCustomStorage?._coldplugin?.k).toBe('existing-id')
    })

    test('setItem(undefined) stores null instead of undefined', async () => {
        const db: PluginColdStorageDb = {}
        const writer = vi.fn(async () => true)
        await writePluginStorageValue(db, () => db, 'k', undefined, writer, () => 'new-id')
        expect(writer).toHaveBeenCalledWith('new-id', null)
    })

    test('a mapping recorded after a clear during the write goes into the live object', async () => {
        const originalDb: PluginColdStorageDb = { pluginCustomStorage: { _coldplugin: {} } }
        // Simulates `_clearPluginStorage` replacing `_coldplugin` with a
        // brand-new object while the write below is in flight -- `getLiveDb`
        // returns a database whose `_coldplugin` is a DIFFERENT object
        // reference than the one `writePluginStorageValue` read at the top
        // of its call.
        const liveDb: PluginColdStorageDb = { pluginCustomStorage: { _coldplugin: {} } }
        const writer = vi.fn(async () => true)

        await writePluginStorageValue(originalDb, () => liveDb, 'k', 'v', writer, () => 'new-id')

        expect(liveDb.pluginCustomStorage?._coldplugin?.k).toBe('new-id')
        expect(originalDb.pluginCustomStorage?._coldplugin?.k).toBeUndefined()
    })

    test('a brand-new key is written into the same object when there was no clear', async () => {
        const db: PluginColdStorageDb = { pluginCustomStorage: { _coldplugin: {} } }
        const writer = vi.fn(async () => true)
        await writePluginStorageValue(db, () => db, 'k', 'v', writer, () => 'new-id')
        expect(db.pluginCustomStorage?._coldplugin?.k).toBe('new-id')
    })

    test('an existing key reuses its coldId and never calls newColdId', async () => {
        const db: PluginColdStorageDb = { pluginCustomStorage: { _coldplugin: { k: 'existing-id' } } }
        const writer = vi.fn(async () => true)
        const newColdId = vi.fn(() => 'should-not-be-used')
        await writePluginStorageValue(db, () => db, 'k', 'v', writer, newColdId)
        expect(writer).toHaveBeenCalledWith('existing-id', 'v')
        expect(newColdId).not.toHaveBeenCalled()
        expect(db.pluginCustomStorage?._coldplugin?.k).toBe('existing-id')
    })

    test('a stray empty-string mapping is treated as falsy, not reused as a coldId', async () => {
        // An empty-string mapping (which should never legitimately exist,
        // but is still a valid object value) must not be used as a
        // cold-storage key; a fresh id is generated instead.
        const db: PluginColdStorageDb = { pluginCustomStorage: { _coldplugin: { k: '' } } }
        const writer = vi.fn(async () => true)
        const newColdId = vi.fn(() => 'fresh-id')
        await writePluginStorageValue(db, () => db, 'k', 'v', writer, newColdId)
        expect(newColdId).toHaveBeenCalledTimes(1)
        expect(writer).toHaveBeenCalledWith('fresh-id', 'v')
        expect(db.pluginCustomStorage?._coldplugin?.k).toBe('fresh-id')
    })
})

describe('writePluginStorageValue never overwrites an archive that something else links', () => {
    const SHARED = 'shared-unit'
    const FAILURE = 'Failed to write plugin storage for key: k'

    type Character = NonNullable<PluginColdStorageDb['characters']>[number]

    const chatWith = (data: string) => ({ message: [{ data }] })

    /** Each way the live database can link the unit the slot `k` maps to. */
    const LINKS: Array<[string, () => Pick<PluginColdStorageDb, 'characters'> & { otherSlot?: string }]> = [
        ['a character stub\'s coldstorage', () => ({ characters: [{ coldstorage: SHARED, chats: [] }] })],
        ['an entry of a character\'s coldStoragedChats', () => ({ characters: [{ coldstorage: 'blob', coldStoragedChats: ['x', SHARED], chats: [] }] })],
        ['a chat\'s first-message pointer', () => ({ characters: [{ chats: [chatWith('plain'), chatWith(coldStorageHeader + SHARED)] }] })],
        ['a chat\'s first-message legacy error text', () => ({ characters: [{ chats: [chatWith(formatColdStorageLoadError(SHARED))] }] })],
        ['another plugin slot mapped to the same unit', () => ({ characters: [], otherSlot: SHARED })],
    ]

    function makeStore() {
        const units = new Map<string, unknown>([[SHARED, { character: { chaId: 'someone-else', name: 'Not a plugin value' } }]])
        const writer = vi.fn(async (coldId: string, value: unknown) => {
            units.set(coldId, value)
            return true
        })
        return { units, writer }
    }

    function makeDb(characters: PluginColdStorageDb['characters'], otherSlot?: string): PluginColdStorageDb {
        return {
            characters,
            pluginCustomStorage: { _coldplugin: { k: SHARED, ...(otherSlot ? { other: otherSlot } : {}) } },
        }
    }

    test.each(LINKS)('a slot whose unit is also linked by %s throws and leaves the unit and the mapping alone', async (_label, makeLink) => {
        const { characters, otherSlot } = makeLink()
        const db = makeDb(characters, otherSlot)
        const { units, writer } = makeStore()
        const unitBefore = JSON.stringify(units.get(SHARED))
        const mappingBefore = JSON.stringify(db.pluginCustomStorage?._coldplugin)

        await expect(writePluginStorageValue(db, () => db, 'k', 'plugin value', writer, () => 'unused')).rejects.toThrow(FAILURE)

        expect(writer).not.toHaveBeenCalled()
        expect(JSON.stringify(units.get(SHARED))).toBe(unitBefore)
        expect(units.size).toBe(1)
        expect(JSON.stringify(db.pluginCustomStorage?._coldplugin)).toBe(mappingBefore)
    })

    test('a slot whose unit nothing else links is updated in place', async () => {
        const unrelated: Character[] = [
            { coldstorage: 'other-blob', coldStoragedChats: ['other-chat'], chats: [chatWith(coldStorageHeader + 'other-pointer'), chatWith(formatColdStorageLoadError('other-error'))] },
            null,
            undefined,
        ]
        const db = makeDb(unrelated, 'another-unit')
        const { units, writer } = makeStore()
        const newColdId = vi.fn(() => 'unused')

        await writePluginStorageValue(db, () => db, 'k', 'plugin value', writer, newColdId)

        expect(writer).toHaveBeenCalledExactlyOnceWith(SHARED, 'plugin value')
        expect(units.get(SHARED)).toBe('plugin value')
        expect(newColdId).not.toHaveBeenCalled()
        expect(db.pluginCustomStorage?._coldplugin?.k).toBe(SHARED)
    })

    test('a link added after the slot was made blocks the write, and removing it allows the write again', async () => {
        const characters: NonNullable<PluginColdStorageDb['characters']> = [{ chats: [chatWith('plain')] }]
        const db = makeDb(characters)
        const { units, writer } = makeStore()

        await writePluginStorageValue(db, () => db, 'k', 'first', writer, () => 'unused')
        expect(units.get(SHARED)).toBe('first')

        characters.push({ coldstorage: SHARED, chats: [] })
        await expect(writePluginStorageValue(db, () => db, 'k', 'second', writer, () => 'unused')).rejects.toThrow(FAILURE)
        expect(units.get(SHARED)).toBe('first')

        characters.pop()
        await writePluginStorageValue(db, () => db, 'k', 'third', writer, () => 'unused')
        expect(units.get(SHARED)).toBe('third')
    })

    test('the decision reads the live database, not the one the call started from', async () => {
        const db = makeDb([])
        const live = makeDb([{ chats: [chatWith(coldStorageHeader + SHARED)] }])
        const { units, writer } = makeStore()

        await expect(writePluginStorageValue(db, () => live, 'k', 'v', writer, () => 'unused')).rejects.toThrow(FAILURE)
        expect(writer).not.toHaveBeenCalled()
        expect(units.get(SHARED)).toEqual({ character: { chaId: 'someone-else', name: 'Not a plugin value' } })
    })

    test('a new slot gets a fresh id and its mapping is set only after the write succeeds', async () => {
        const db: PluginColdStorageDb = {
            characters: [{ coldstorage: SHARED, chats: [] }],
            pluginCustomStorage: { _coldplugin: {} },
        }
        const { units, writer } = makeStore()
        writer.mockImplementationOnce(async (coldId: string, value: unknown) => {
            expect(db.pluginCustomStorage?._coldplugin?.fresh).toBeUndefined()
            units.set(coldId, value)
            return true
        })

        await writePluginStorageValue(db, () => db, 'fresh', 'v', writer, () => 'fresh-id')

        expect(units.get('fresh-id')).toBe('v')
        expect(db.pluginCustomStorage?._coldplugin?.fresh).toBe('fresh-id')
        expect(units.get(SHARED)).toEqual({ character: { chaId: 'someone-else', name: 'Not a plugin value' } })
    })

    test('guard: a pointer in a later message or a chat that only resembles a link does not block the write', async () => {
        const db = makeDb([{ chats: [{ message: [{ data: 'plain' }, { data: coldStorageHeader + SHARED }] }, chatWith(formatColdStorageLoadError(SHARED) + ' extra')] }])
        const { units, writer } = makeStore()

        await writePluginStorageValue(db, () => db, 'k', 'v', writer, () => 'unused')

        expect(units.get(SHARED)).toBe('v')
    })

    test('guard: a database with malformed characters or chats is judged without throwing', async () => {
        const malformed = [
            { chats: 'not an array' },
            { chats: [null, {}, { message: 'text' }, { message: [] }, { message: [{ data: 5 }] }] },
            { coldStoragedChats: 'x' },
        ] as unknown as PluginColdStorageDb['characters']
        const db = makeDb(malformed)
        const { units, writer } = makeStore()

        await writePluginStorageValue(db, () => db, 'k', 'v', writer, () => 'unused')

        expect(units.get(SHARED)).toBe('v')
    })
})
