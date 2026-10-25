// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { encodeDatabase, planScopedEncode, previousFrom, type EncodedTree } from '../../store2/codec'
import { createKeyMint } from '../../store2/commit'
import { UNIT_TYPE } from '../../store2/format'
import { createListDerivation } from '../../store2/lists'
import type { Database } from '../../database.svelte'
import { buildSmall, seededEnv, type Obj } from './codecFixtures'

const NOW = 1_700_000_000_000
const MODULE_COUNT = 12
const MODULE_BYTES = 20_000
/** Ceiling for the framed bytes an unchanged pass writes outside the manifest. */
const UNCHANGED_WRITTEN_CEILING = 1024

function mod(id: string): Obj {
    return { name: `Module ${id}`, description: 'x'.repeat(MODULE_BYTES), id, lorebook: [], regex: [], trigger: [] }
}

function profile(): Database {
    const base = buildSmall(3) as unknown as Obj
    const db = JSON.parse(JSON.stringify({ ...base, modules: Array.from({ length: MODULE_COUNT }, (_, i) => mod(`m${i}`)) })) as Obj
    return db as unknown as Database
}

/** A scoped module pass over an unchanged profile: every module unit is the previous encoding's. */
async function unchangedScopedTick(): Promise<EncodedTree> {
    const db = profile()
    const lists = createListDerivation()
    const first = encodeDatabase(db, { env: seededEnv(1), lists, seq: 1, createdAt: NOW })
    const plan = await planScopedEncode(db,
        { env: seededEnv(2), lists, seq: 2, createdAt: NOW, previous: previousFrom(first) },
        { modules: true, characters: new Set() })
    const { mint } = createKeyMint(seededEnv(902), null)
    return plan.finalize({ mint, seq: 2, now: NOW })
}

/**
 * A whole encode over an unchanged profile: every unit but the manifest is the previous encoding's. With `keepBytes`
 * the previous encoding holds its units' frames, so a reused unit could pick the earlier frame up as well.
 */
function unchangedFullEncode(keepBytes: boolean): EncodedTree {
    const db = profile()
    const lists = createListDerivation()
    const first = encodeDatabase(db, { env: seededEnv(1), lists, seq: 1, createdAt: NOW })
    return encodeDatabase(db, { env: seededEnv(2), lists, seq: 2, createdAt: NOW, previous: previousFrom(first, keepBytes) })
}

function isRawBuffer(value: object): value is ArrayBufferLike {
    return value instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer)
}

/** Every distinct buffer reachable from `value` through own properties, whatever the property is called. */
function collectBuffers(value: unknown, seen: Set<unknown>, buffers: Set<ArrayBufferLike>): void {
    if (typeof value !== 'object' || value === null || seen.has(value)) {
        return
    }
    seen.add(value)
    if (ArrayBuffer.isView(value)) {
        buffers.add(value.buffer)
        return
    }
    if (isRawBuffer(value)) {
        buffers.add(value)
        return
    }
    for (const key of Object.keys(value)) {
        collectBuffers(Reflect.get(value, key), seen, buffers)
    }
}

function reusedUnits(tree: EncodedTree): EncodedTree['units'] {
    return tree.units.filter(unit => unit.reused === true)
}

function ownBufferProperties(unit: object): string[] {
    return Object.keys(unit).filter((key) => {
        const value = Reflect.get(unit, key)
        return typeof value === 'object' && value !== null && (ArrayBuffer.isView(value) || isRawBuffer(value))
    })
}

function reachableReusedBytes(tree: EncodedTree): number {
    const buffers = new Set<ArrayBufferLike>()
    const seen = new Set<unknown>()
    for (const unit of reusedUnits(tree)) {
        collectBuffers(unit, seen, buffers)
    }
    let total = 0
    for (const buffer of buffers) {
        total += buffer.byteLength
    }
    return total
}

function writtenNonManifestBytes(tree: EncodedTree): number {
    let total = 0
    for (const unit of tree.units) {
        if (unit.reused === false && unit.type !== UNIT_TYPE.manifest) {
            total += unit.bytes.length
        }
    }
    return total
}

describe('a reused unit holds no bytes of the encode that found it unchanged', () => {
    for (const [label, build] of [
        ['scoped module tick', unchangedScopedTick],
        ['full encode', async () => unchangedFullEncode(false)],
        ['full encode over a previous that kept its frames', async () => unchangedFullEncode(true)],
    ] as const) {
        describe(label, () => {
            test('the pass reuses units, so the checks below have something to look at', async () => {
                expect(reusedUnits(await build()).length).toBeGreaterThan(MODULE_COUNT)
            })

            test('no own property of a reused unit is a buffer view or a raw buffer', async () => {
                const offenders = reusedUnits(await build()).flatMap(unit => ownBufferProperties(unit).map(key => `${unit.identity}.${key}`))
                expect(offenders).toEqual([])
            })

            test('the buffers reachable from the reused units total zero bytes', async () => {
                expect(reachableReusedBytes(await build())).toBe(0)
            })

            test('an unchanged pass writes next to nothing outside the manifest', async () => {
                expect(writtenNonManifestBytes(await build())).toBeLessThan(UNCHANGED_WRITTEN_CEILING)
            })
        })
    }
})
