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
import { advancePrevious } from 'src/ts/storage/store2/fastForward/advancePrevious'
import { realApply } from 'src/ts/storage/store2/fastForward/apply'
import { prepareFastForward, type Prepared } from 'src/ts/storage/store2/fastForward/prepare'
import { readPeerTree } from 'src/ts/storage/store2/fastForward/read'
import { defaultKeyEnv } from 'src/ts/storage/store2/format'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import type { Database } from 'src/ts/storage/database.svelte'
import { isColdStub } from 'src/ts/storage/store2/codec'
import { chars, clone, parsedKey } from './lineFixtures'
import { ffWorld, testHost } from './ffFixtures'
import { fakeLists } from './codecFixtures'

/**
 * The fast-forward's decisions over real encodings: the acknowledged encoding and the live database are those of a
 * booted page, the peer's tree is read with `readPeerTree`, and nothing is written until `realApply` runs the steps.
 */

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

type World = Awaited<ReturnType<typeof ffWorld>>

async function decide(world: World, mine: (db: Database) => void, peer: (db: Database) => void, state?: Parameters<typeof testHost>[0], replyOwners: ReadonlySet<string> = new Set()): Promise<{ prepared: Prepared, db: Database }> {
    const key = await parsedKey(world.memory)
    const read = await readTreeBytes(world.memory, key.current?.key ?? '')
    if (read.status !== 'ok') {
        throw new Error(`The tree read ${read.status}.`)
    }
    const old = previousOfTree(read.tree)
    const db = assembleDatabase(read.tree.manifest, read.tree.source)
    mine(db)
    const edited = await world.page.commitEdit(peer)
    const target = await readPeerTree(world.memory, edited.current?.key ?? '', old)
    if (target.status !== 'ok') {
        throw new Error(`The peer read ${target.status}.`)
    }
    const next = advancePrevious(old, target.tree)
    const { host } = testHost(state)
    return { prepared: prepareFastForward({ db, old, target: target.tree, next, host, replyOwners, env: defaultKeyEnv, lists: fakeLists }), db }
}

function ready(prepared: Prepared) {
    if (prepared.kind !== 'ready') {
        throw new Error(`Parked: ${prepared.reason}`)
    }
    return prepared
}

describe('prepareFastForward', () => {
    test('P1 a config field only the peer changed is taken, and arms a guard entry', async () => {
        const world = await ffWorld()
        const { prepared, db } = await decide(world, () => { }, (peerDb) => { peerDb.temperature = 31 })
        const plan = ready(prepared)
        expect(realApply(plan.steps)).toBe('applied')
        expect(db.temperature).toBe(31)
        expect(plan.guard).toContainEqual(expect.objectContaining({ kind: 'field', path: 'temperature', expected: 31 }))
    })

    test('P2 a setting both sides changed to different values parks and writes nothing', async () => {
        const world = await ffWorld()
        const { prepared, db } = await decide(world, (mine) => { Reflect.set(mine, 'ffTestSetting', 5) }, (peerDb) => { Reflect.set(peerDb, 'ffTestSetting', 31) })
        expect(prepared).toEqual({ kind: 'park', reason: 'config:ffTestSetting' })
        expect(Reflect.get(db, 'ffTestSetting')).toBe(5)
    })

    test('P3 a character body the peer changed is swapped for its stub when this page\'s copy is clean, and deferred as D2', async () => {
        const world = await ffWorld()
        const { prepared, db } = await decide(world, () => { }, (peerDb) => { chars(peerDb)[3].personality = 'peer edit' })
        const plan = ready(prepared)
        expect([...plan.defers]).toEqual(['d2'])
        expect(realApply(plan.steps)).toBe('applied')
        expect(isColdStub(chars(db)[3])).toBe(true)
        expect(plan.guard.some(entry => entry.kind === 'unit')).toBe(true)
    })

    test('P4 a character body this page also changed parks', async () => {
        const world = await ffWorld()
        const { prepared } = await decide(world, (mine) => { chars(mine)[3].personality = 'mine' }, (peerDb) => { chars(peerDb)[3].personality = 'peer edit' })
        expect(prepared).toEqual({ kind: 'park', reason: 'character:body-dirty' })
    })

    test('P5 a character in use here parks even when its copy is clean', async () => {
        const world = await ffWorld()
        const key = await parsedKey(world.memory)
        const read = await readTreeBytes(world.memory, key.current?.key ?? '')
        const chaId = read.status === 'ok' ? String(chars(assembleDatabase(read.tree.manifest, read.tree.source))[3].chaId) : ''
        const { prepared } = await decide(world, () => { }, (peerDb) => { chars(peerDb)[3].personality = 'peer edit' }, { inUse: new Set([chaId]), writing: new Set(), busy: false, sending: false })
        expect(prepared).toEqual({ kind: 'park', reason: 'character:in-use' })
    })

    test('P6 a character the peer appended is added as a stub, and a changed membership on both sides parks', async () => {
        const world = await ffWorld()
        const appended = await decide(world, () => { }, (peerDb) => {
            const added = clone(chars(peerDb)[0])
            added.chaId = 'appended-by-peer'
            added.name = 'Appended'
            peerDb.characters.push(added as unknown as Database['characters'][number])
        })
        const plan = ready(appended.prepared)
        expect(realApply(plan.steps)).toBe('applied')
        expect(appended.db.characters.length).toBe(5)
        expect(isColdStub(chars(appended.db)[4])).toBe(true)
    })

    test('P7 loadouts the peer changed are taken only while this page left them alone', async () => {
        const world = await ffWorld()
        const taken = await decide(world, () => { }, (peerDb) => { Reflect.set(peerDb, 'loadouts', [{ id: 'x' }]) })
        expect(realApply(ready(taken.prepared).steps)).toBe('applied')
        expect(Reflect.get(taken.db, 'loadouts')).toEqual([{ id: 'x' }])
        const world2 = await ffWorld()
        const parked = await decide(world2, (mine) => { Reflect.set(mine, 'loadouts', [{ id: 'mine' }]) }, (peerDb) => { Reflect.set(peerDb, 'loadouts', [{ id: 'x' }]) })
        expect(parked.prepared).toEqual({ kind: 'park', reason: 'loadouts' })
    })

    test('P8 statics: a counter both sides moved is theirs plus this page\'s change', async () => {
        const world = await ffWorld()
        await world.page.commitEdit((peerDb) => { Reflect.set(peerDb, 'statics', { count: 1 }) })
        const merged = await decide(world, (mine) => { Reflect.set(mine, 'statics', { count: 3 }) }, (peerDb) => { Reflect.set(peerDb, 'statics', { count: 5 }) })
        expect(realApply(ready(merged.prepared).steps)).toBe('applied')
        expect(Reflect.get(merged.db, 'statics')).toEqual({ count: 7 })
    })

    test('P1b a settings field only the peer changed is taken and arms a field entry', async () => {
        const world = await ffWorld()
        const { prepared, db } = await decide(world, () => { }, (peerDb) => { Reflect.set(peerDb, 'ffTestSetting', 'theirs') })
        const plan = ready(prepared)
        expect(realApply(plan.steps)).toBe('applied')
        expect(Reflect.get(db, 'ffTestSetting')).toBe('theirs')
        expect(plan.guard).toContainEqual(expect.objectContaining({ kind: 'field', path: 'ffTestSetting', expected: 'theirs' }))
    })

    test('P9 after a stub install the merged moved fields are written on the stub: lastInteraction is the larger value', async () => {
        const world = await ffWorld()
        const { prepared, db } = await decide(world, (mine) => { Reflect.set(chars(mine)[3], 'lastInteraction', 5000) }, (peerDb) => {
            chars(peerDb)[3].personality = 'peer edit'
            Reflect.set(chars(peerDb)[3], 'lastInteraction', 9000)
        })
        expect(realApply(ready(prepared).steps)).toBe('applied')
        expect(isColdStub(chars(db)[3])).toBe(true)
        expect(chars(db)[3].lastInteraction).toBe(9000)
    })
    test('P5b a character a reply is streaming into, or being written, is in use', async () => {
        const world = await ffWorld()
        const key = await parsedKey(world.memory)
        const read = await readTreeBytes(world.memory, key.current?.key ?? '')
        const chaId = read.status === 'ok' ? String(chars(assembleDatabase(read.tree.manifest, read.tree.source))[3].chaId) : ''
        const owner = await decide(world, () => { }, (peerDb) => { chars(peerDb)[3].personality = 'peer edit' }, undefined, new Set([chaId]))
        expect(owner.prepared).toEqual({ kind: 'park', reason: 'character:in-use' })
        const world2 = await ffWorld()
        const writing = await decide(world2, () => { }, (peerDb) => { chars(peerDb)[3].personality = 'peer edit' }, { inUse: new Set(), writing: new Set([chaId]), busy: false, sending: false })
        expect(writing.prepared).toEqual({ kind: 'park', reason: 'character:in-use' })
    })})
