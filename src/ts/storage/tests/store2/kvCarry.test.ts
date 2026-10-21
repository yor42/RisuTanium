// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { JsonValue } from 'src/ts/storage/blockFrame'
import { createLegacyStoreReader } from 'src/ts/storage/store2/legacy/storeReader'
import { resolveLegacyTree } from 'src/ts/storage/store2/legacy/resolve'
import { asDatabase, bodyOf, buildSmall, differingIdentities, encodeWith, roundTrip, seededEnv, unitOf, type Obj } from './codecFixtures'

/**
 * Compatibility guards: upstream's SaveKV data (`upstreamKvBlocks`) is an
 * ordinary top-level database key to store2. It travels in the `config` unit's
 * fields, comes back out of assemble unchanged, and a legacy tree that holds it
 * keeps it through `resolveLegacyTree`. All pass before and after the field was
 * declared, because the codec carries any top-level key; they pin that a later
 * codec change cannot silently drop it.
 */

/** Built by JSON.parse so that `__proto__` is an own key, as the decoder produces it. */
function kvField(): Record<string, JsonValue> {
    return JSON.parse(
        '{"__proto__":{"version":1,"entries":[{"k":"p","v":1}]},'
        + '"alpha":{"version":1,"entries":[{"k":"nested","v":{"list":[1,{"deep":null},"x"],"flag":true}},{"k":"한글키🙂","v":"값"}]},'
        + '"ネーム":{"version":1,"entries":[{"k":"0","v":[]}]}}',
    ) as Record<string, JsonValue>
}

function withKv(db: Database, field: Record<string, JsonValue>): Database {
    return asDatabase({ ...(JSON.parse(JSON.stringify(db)) as Obj), upstreamKvBlocks: field })
}

function ownValue(field: Record<string, JsonValue> | undefined, namespace: string): JsonValue | undefined {
    return field === undefined ? undefined : Object.getOwnPropertyDescriptor(field, namespace)?.value as JsonValue | undefined
}

function kvOf(db: Database): Record<string, JsonValue> | undefined {
    return (db as Database & { upstreamKvBlocks?: Record<string, JsonValue> }).upstreamKvBlocks
}

describe('guard: store2 carries the upstream KV field', () => {
    const field = kvField()
    const db = withKv(buildSmall(3), field)

    test('the fixture field has an own __proto__ namespace', () => {
        expect(Object.keys(field)).toEqual(['__proto__', 'alpha', 'ネーム'])
    })

    test('the field is written into the config unit and assembles back with every namespace', () => {
        const { first, assembled } = roundTrip(db)

        const written = (bodyOf(unitOf(first, 'config')).f as Obj).upstreamKvBlocks as Record<string, JsonValue>
        expect(Object.keys(written)).toEqual(Object.keys(field))
        const out = kvOf(assembled)
        expect(Object.keys(out ?? {})).toEqual(Object.keys(field))
        for (const namespace of Object.keys(field)) {
            expect(ownValue(out, namespace), namespace).toEqual(ownValue(field, namespace))
        }
        expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    })

    test('a change to the field changes only the config unit and the manifest that names it', () => {
        const before = encodeWith(db, { env: seededEnv(3) })
        const changed = withKv(buildSmall(3), { ...field, alpha: { version: 1, entries: [] } })
        const after = encodeWith(changed, { env: seededEnv(3) })

        expect(differingIdentities(before, after)).toEqual(['config', 'manifest'])
    })

    test('a database without the field assembles without it', () => {
        const { assembled } = roundTrip(buildSmall(3))

        expect('upstreamKvBlocks' in assembled).toBe(false)
    })
})

describe('guard: a legacy tree keeps the upstream KV field through resolveLegacyTree', () => {
    test('the resolved database holds every namespace, and no unit read was needed for it', async () => {
        const field = kvField()
        const tree = asDatabase({
            characters: [
                { chaId: 'whole', name: 'Whole', type: 'character', chats: [{ id: 'c', name: 'c', message: [], note: '', localLore: [] }], chatPage: 0 },
            ],
            upstreamKvBlocks: field,
        })
        const read = vi.fn(async (_key: string) => ({ status: 'error' as const, error: new Error('no unit is named by this tree') }))

        const { database, incomplete } = await resolveLegacyTree(tree, createLegacyStoreReader(read), { newId: () => 'chat-id', now: () => 1_700_000_000_001 })

        expect(incomplete).toEqual([])
        expect(read).not.toHaveBeenCalled()
        const out = kvOf(database)
        expect(Object.keys(out ?? {})).toEqual(Object.keys(field))
        for (const namespace of Object.keys(field)) {
            expect(ownValue(out, namespace), namespace).toEqual(ownValue(field, namespace))
        }
    })
})
