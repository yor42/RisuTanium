// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    markIdentitySeen: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { Store2BackendFailureError } from 'src/ts/storage/store2/backend/errors'
import type { Store2Backend } from 'src/ts/storage/store2/backend/types'
import { crc32 } from 'src/ts/storage/blockFrame'
import { advancePrevious } from 'src/ts/storage/store2/fastForward/advancePrevious'
import { readPeerTree } from 'src/ts/storage/store2/fastForward/read'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { keyOfRef, readUnit, UNIT_TYPE, type Manifest } from 'src/ts/storage/store2/format'
import { chars, parsedKey } from './lineFixtures'
import { ffWorld } from './ffFixtures'

/** The peer's tree read against the acknowledged encoding: only the changed fixed units and shards are fetched. */

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

async function bootTree(world: Awaited<ReturnType<typeof ffWorld>>) {
    const key = await parsedKey(world.memory)
    const read = await readTreeBytes(world.memory, key.current?.key ?? '')
    if (read.status !== 'ok') {
        throw new Error(`The tree read ${read.status}.`)
    }
    return { old: previousOfTree(read.tree), db: assembleDatabase(read.tree.manifest, read.tree.source) }
}

describe('readPeerTree', () => {
    test('R5 a peer commit reads its manifest and changed units, and advances the encoding without reading entity units', async () => {
        const world = await ffWorld()
        const { old } = await bootTree(world)
        const edited = await world.page.commitEdit((db) => { db.temperature = 31 })
        const key = edited.current?.key ?? ''
        const reads: string[] = []
        const spy: Store2Backend = { ...world.memory, readUnits: async (keys) => { reads.push(...keys); return world.memory.readUnits(keys) }, readCommit: () => world.memory.readCommit() }
        const read = await readPeerTree(spy, key, old)
        expect(read.status).toBe('ok')
        if (read.status !== 'ok') {
            return
        }
        const next = advancePrevious(old, read.tree)
        expect(next.objects?.config?.temperature).toBe(31)
        const entityKeys = [...old.units].filter(([identity]) => identity.startsWith('char:') || identity.startsWith('chat:')).map(([, unit]) => unit.key)
        expect(reads.some(readKey => entityKeys.includes(readKey))).toBe(false)
    })

    test('R5b a commit key that moved while the units were read is `moved`', async () => {
        const world = await ffWorld()
        const { old } = await bootTree(world)
        const first = await world.page.commitEdit((db) => { db.temperature = 31 })
        await world.page.commitEdit((db) => { db.temperature = 32 })
        expect((await readPeerTree(world.memory, first.current?.key ?? '', old)).status).toBe('moved')
    })

    test('R5c a failing store is a retry, a missing changed unit is a structure park', async () => {
        const world = await ffWorld()
        const { old } = await bootTree(world)
        const edited = await world.page.commitEdit((db) => { chars(db)[1].personality = 'edit' })
        const key = edited.current?.key ?? ''
        const failing: Store2Backend = { ...world.memory, readUnits: async () => { throw new Store2BackendFailureError('store down') }, readCommit: () => world.memory.readCommit() }
        expect(await readPeerTree(failing, key, old)).toMatchObject({ status: 'retry' })
        const known = new Set([...old.units.values()].map(unit => unit.key))
        const gaps: Store2Backend = {
            ...world.memory,
            readUnits: async (keys) => {
                const found = await world.memory.readUnits(keys)
                for (const unitKey of [...found.keys()]) {
                    if (unitKey !== key && !known.has(unitKey)) {
                        found.delete(unitKey)
                    }
                }
                return found
            },
            readCommit: () => world.memory.readCommit(),
        }
        expect(await readPeerTree(gaps, key, old)).toMatchObject({ status: 'park', reason: 'structure' })
    })

    test('R5d a key that is not a manifest key is a structure park', async () => {
        const world = await ffWorld()
        const { old } = await bootTree(world)
        expect(await readPeerTree(world.memory, 'not-a-manifest', old)).toMatchObject({ status: 'park', reason: 'structure' })
    })

    test('R5e a changed unit a newer build wrote parks as too-new', async () => {
        const world = await ffWorld()
        const { old } = await bootTree(world)
        const edited = await world.page.commitEdit((db) => { db.temperature = 31 })
        const key = edited.current?.key ?? ''
        const manifestBytes = (await world.memory.readUnits([key])).get(key)
        const manifest = readUnit(manifestBytes as Uint8Array, UNIT_TYPE.manifest)
        const configKey = manifest.status === 'ok' ? keyOfRef((manifest.value.body as Manifest).fixed.config) : ''
        const newer: Store2Backend = {
            ...world.memory,
            readUnits: async (keys) => {
                const found = await world.memory.readUnits(keys)
                const bytes = found.get(configKey)
                if (bytes !== undefined && bytes !== null) {
                    const out = new Uint8Array(bytes)
                    out[4] = 9
                    new DataView(out.buffer, out.byteOffset + 12, 4).setUint32(0, crc32(out.subarray(0, 12)), true)
                    found.set(configKey, out)
                }
                return found
            },
            readCommit: () => world.memory.readCommit(),
        }
        expect(configKey).not.toBe('')
        expect(await readPeerTree(newer, key, old)).toMatchObject({ status: 'park', reason: 'too-new' })
    })})
