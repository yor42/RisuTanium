import { describe, expect, test } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { LegacyReadError, readLegacyUnit, resolveLegacyTree } from 'src/ts/storage/store2/legacy/resolve'
import { createLegacyStoreReader, type ColdUnitRead } from 'src/ts/storage/store2/legacy/storeReader'
import { collectLegacyColdKeys } from 'src/ts/storage/store2/legacy/walk'

/**
 * The production legacy entry reader over an injected three-way cold-unit reader. The mapping decides what a conversion
 * does with a unit: a unit that is stored but does not decode is `unparsable` (the resolve gives it a placeholder and
 * names it), a unit that is absent is `missing`, and every other failure says nothing about the unit and so aborts.
 */

const KEY = '00000000-0000-4000-8000-0000000000a1'

describe('new behaviour: the reader maps the three-way answer', () => {
    test.each<[string, ColdUnitRead, unknown]>([
        ['ok', { status: 'ok', value: { a: 1 } }, { status: 'ok', value: { a: 1 } }],
        ['missing', { status: 'missing' }, { status: 'missing' }],
        ['a stored unit that does not decode', { status: 'error', error: new Error('bad json'), kind: 'damaged' }, { status: 'unparsable' }],
    ])('%s', async (_label, answer, expected) => {
        const reader = createLegacyStoreReader(async () => answer)
        expect(await reader.read(KEY)).toEqual(expected)
    })

    test.each<[string, ColdUnitRead]>([
        ['an error of an unclassified kind', { status: 'error', error: new Error('disk') }],
        ['an error of the unavailable kind', { status: 'error', error: new Error('store offline'), kind: 'unavailable' }],
    ])('%s is an error carrying the cause, never missing and never unparsable', async (_label, answer) => {
        const reader = createLegacyStoreReader(async () => answer)
        const read = await reader.read(KEY)
        expect(read.status).toBe('error')
        expect(read.status === 'error' ? read.error : null).toBe(answer.status === 'error' ? answer.error : null)
    })

    test('the key is passed through unchanged', async () => {
        const asked: string[] = []
        await createLegacyStoreReader(async (key) => { asked.push(key); return { status: 'missing' } }).read(KEY)
        expect(asked).toEqual([KEY])
    })
})

describe('new behaviour: what the callers do with the mapping', () => {
    const tree = {
        botPresets: [],
        characters: [{ chaId: 'stub-cha', name: 'Stub', type: 'character', coldstorage: KEY, coldStoragedChats: [], chats: [] }],
    } as unknown as Database

    test('a read error aborts the resolve with the unit named, so no conversion goes on to write', async () => {
        const reader = createLegacyStoreReader(async () => ({ status: 'error', error: new Error('disk') }))
        const outcome = await resolveLegacyTree(tree, reader).then(() => 'resolved', (error: unknown) => error)
        expect(outcome).toBeInstanceOf(LegacyReadError)
        expect((outcome as LegacyReadError).key).toBe(KEY)
    })

    test('a read that rejects aborts as well', async () => {
        const reader = createLegacyStoreReader(async () => { throw new Error('rejected') })
        await expect(readLegacyUnit(reader, KEY, 'stub')).rejects.toBeInstanceOf(LegacyReadError)
    })

    test('a stored unit that does not decode resolves to a placeholder and is named, not aborted', async () => {
        const reader = createLegacyStoreReader(async () => ({ status: 'error', error: new Error('bad json'), kind: 'damaged' }))
        const resolved = await resolveLegacyTree(tree, reader, { newId: () => 'id', now: () => 1 })
        expect(resolved.incomplete).toEqual([{ kind: 'character', chaId: 'stub-cha', name: 'Stub', key: KEY, reason: 'unparsable' }])
    })

    test('the walk rejects on an unparsable unit, because the references it holds are unknown', async () => {
        const reader = createLegacyStoreReader(async () => ({ status: 'error', error: new Error('bad json'), kind: 'damaged' }))
        await expect(collectLegacyColdKeys([tree], reader)).rejects.toBeInstanceOf(LegacyReadError)
    })

    test('an absent unit is a placeholder and named', async () => {
        const reader = createLegacyStoreReader(async () => ({ status: 'missing' }))
        const resolved = await resolveLegacyTree(tree, reader, { newId: () => 'id', now: () => 1 })
        expect(resolved.incomplete).toEqual([expect.objectContaining({ key: KEY, reason: 'missing' })])
    })
})
