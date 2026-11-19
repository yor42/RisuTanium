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
vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))
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
// The note of the export is the measurement build's sink; the real module needs a browser page.
vi.mock(import('src/ts/drive/storeImport'), () => ({
    noteImportPhase: () => { },
}) as unknown as typeof import('src/ts/drive/storeImport'))

import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { isColdStub, stubFromEntry } from 'src/ts/storage/store2/codec'
import { encodeUnit, keyOfTail, newUnitKey, readUnit, refsOf, UNIT_TYPE, type ShardEntry } from 'src/ts/storage/store2/format'
import { runAutoGc } from 'src/ts/storage/store2/gc/autoGc'
import type { GcResult } from 'src/ts/storage/store2/gc/pass'
import { createResidency } from 'src/ts/storage/store2/residency'
import { acknowledgedManifestKey } from 'src/ts/storage/store2/saveLoop'
import { Store2Session } from 'src/ts/storage/store2/session'
import { createClock, testEnv } from './commitFixtures'
import { TEST_DESCENT } from './descentTable'
import { bootB, ffSetup, ffTeardown, ffWorldOver, ownEdit, runLoopWorld, signal, stopAllWorlds, takenBy, type PageB } from './ffFixtures'
import { flushConfirming } from './flushConfirmBackend'
import { chaIdOf, chars, parsedKey } from './lineFixtures'

/**
 * The web clean-up pass against a real peer: page A boots over a store, runs the real save loop and fast-forward, and a
 * peer page built from the committer and encoder APIs commits over it. The pass runs by `runAutoGc` with the real accessor
 * of this module graph's save loop as its own-base fact, over an `indexeddb` session on the same memory backend; the loop
 * is quiescent (no idle net, no commit in flight) while the pass runs, and each case starts its own loop before the pass.
 *
 * A5a is the reproducer of the stale-base rule: a page whose base a peer commit dropped refuses, so the units only that
 * base reaches (among them the units its cold stub of a character names) stay and the stub still loads. A5b is the positive
 * control (a fresh page over the same store collects exactly those units and keeps every named tree); A5c guards the
 * fail-closed rule after a fast-forward (I4c): the pass refuses `stale-base` right after the fast-forward and after a later own commit, with every unit still present. Mocked storage
 * here says nothing about a native backend.
 */

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

beforeEach(() => {
    ffSetup()
    vi.spyOn(console, 'info').mockImplementation(() => { })
})

afterEach(() => {
    ffTeardown()
    resetPageStorageModeForTests()
})

const ORPHANS = 12

async function plantOrphans(memory: MemoryBackend): Promise<string[]> {
    const env = testEnv(createClock(), 5150)
    const keys: string[] = []
    for (let i = 0; i < ORPHANS; i++) {
        const key = newUnitKey(env)
        await memory.putUnit(key, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan: key }))
        keys.push(key)
    }
    return keys
}

/** Runs the pass as an `indexeddb` page whose own-base fact is the real accessor of the save loop started in this file. */
async function runPass(memory: MemoryBackend): Promise<GcResult | null> {
    const over = flushConfirming(memory)
    const session = await Store2Session.open(createMemoryByteStore(), { kind: 'indexeddb', backend: over.backend, upstreamMainFile: async () => false })
    setPageStorageMode({ kind: 'store2' })
    return await runAutoGc(session, {
        isBusy: () => false,
        saveLoopParked: () => false,
        isSaveClean: () => true,
        restoreInProgress: () => false,
        peers: async () => 'alone',
        ownBase: () => acknowledgedManifestKey(),
    })
}

async function present(memory: MemoryBackend, keys: readonly string[]): Promise<number> {
    const read = await memory.readUnits([...keys])
    return keys.filter(key => read.get(key) !== null).length
}

async function currentKey(memory: MemoryBackend): Promise<string | undefined> {
    return (await parsedKey(memory)).current?.key
}

async function peerEdit(world: Awaited<ReturnType<typeof ffWorldOver>>, index: number, text: string): Promise<void> {
    world.clock.advance(60_000)
    await world.page.commitEdit((db) => { chars(db)[index].personality = text })
}

/** Every unit key a stored manifest names, by an independent walk over `refsOf` (not the collector's mark). */
async function treeKeys(memory: MemoryBackend, manifestKey: string): Promise<Set<string>> {
    const keys = new Set<string>([manifestKey])
    const bytes = (await memory.readUnits([manifestKey])).get(manifestKey) ?? null
    const manifest = bytes === null ? null : readUnit(bytes, UNIT_TYPE.manifest)
    if (manifest === null || manifest.status !== 'ok') {
        throw new Error(`The manifest ${manifestKey} is not readable.`)
    }
    for (const target of refsOf(UNIT_TYPE.manifest, manifest.value.body)) {
        const key = keyOfTail(target.tail)
        keys.add(key)
        const type = TEST_DESCENT[target.path]
        if (type === undefined) {
            continue
        }
        const childBytes = (await memory.readUnits([key])).get(key) ?? null
        const child = childBytes === null ? null : readUnit(childBytes, type)
        if (child === null || child.status !== 'ok') {
            throw new Error(`The unit ${key} is not readable.`)
        }
        for (const leaf of refsOf(type, child.value.body)) {
            keys.add(keyOfTail(leaf.tail))
        }
    }
    return keys
}

/** The entry the page's acknowledged encoding holds for the character `chaId`. */
function entryOfCharacter(page: PageB, chaId: string): ShardEntry {
    for (const shard of page.context.encoder.acknowledged().objects?.shards ?? []) {
        for (const entry of shard.entries) {
            if (entry.chaId === chaId) {
                return entry
            }
        }
    }
    throw new Error(`The acknowledged encoding holds no entry for ${chaId}.`)
}

/** The units the shard entry names itself (its core, lore, scripts, lists and chats), not the shard that holds it. */
function unitsOfEntry(entry: ShardEntry): Set<string> {
    return new Set(refsOf(UNIT_TYPE.shard, { v: 1, entries: [entry] }).map(target => keyOfTail(target.tail)))
}

/** Puts the page's resident character `chaId` back to the cold stub of its acknowledged entry, as the page holds an unloaded one. */
function putBackToStub(page: PageB, chaId: string): void {
    const index = chars(page.db).findIndex(slot => slot.chaId === chaId)
    chars(page.db)[index] = stubFromEntry(entryOfCharacter(page, chaId)) as Record<string, unknown>
}

/** A cold load of the stub's entity through the page's own encoder: every unit the entry names must be stored. */
async function loadStubOf(memory: MemoryBackend, page: PageB, chaId: string) {
    const stub = chars(page.db).find(slot => slot.chaId === chaId)
    const u = (stub as { coldstorage?: string }).coldstorage
    if (u === undefined) {
        throw new Error('The character is not a cold stub.')
    }
    return await createResidency({ backend: memory, context: page.context }).readCharacter(u)
}

interface DroppedBase {
    memory: MemoryBackend
    a: PageB
    /** The character X, held by `a` as a cold stub whose entry names units the dropped base alone reaches. */
    chaId: string
    /** Units the dropped base reaches that no tree the commit key names reaches. */
    stale: Set<string>
    /** Every unit of the current, retained and pinned trees. */
    named: Set<string>
}

/**
 * Page A booted on C2 and a peer commit C3 whose admission window had not opened dropped C2: A's base is in no list of the
 * commit key, its loop never judged C3 (no idle net), and its stub of X names units only C2 reaches.
 */
async function pageWithDroppedBase(): Promise<DroppedBase> {
    const memory = createMemoryBackend()
    const world = await ffWorldOver(memory)
    // C1 is current and C0 retained; the next commit admits C1 (admission is keyed on the newest retained entry's time).
    await peerEdit(world, 0, 'peer change 1')
    const a = await bootB(memory)
    runLoopWorld(a.context, a.db)
    const chaId = chaIdOf(a.db, 0)
    putBackToStub(a, chaId)
    const base = a.context.encoder.manifestKey
    const entry = entryOfCharacter(a, chaId)
    // Within the admission interval of the commit that admitted C1, so C3 does not admit C2 and C2 is dropped.
    await peerEdit(world, 0, 'peer change 2')

    const key = await parsedKey(memory)
    const named = new Set<string>()
    for (const manifest of [key.current?.key as string, ...key.retained.map(item => item.key), ...key.pins.map(pin => pin.key)]) {
        for (const unit of await treeKeys(memory, manifest)) {
            named.add(unit)
        }
    }
    const stale = new Set([...await treeKeys(memory, base)].filter(unit => !named.has(unit)))
    expect(key.retained.map(item => item.key), 'precondition: the base is not retained').not.toContain(base)
    expect(key.current?.key, 'precondition: the base is not the current').not.toBe(base)
    expect(acknowledgedManifestKey(), 'precondition: the accessor is the base').toBe(base)
    expect(stale.size, 'precondition: units only the dropped base reaches exist').toBeGreaterThan(0)
    const own = unitsOfEntry(entry)
    expect([...own].filter(unit => stale.has(unit)), 'precondition: the stub of X names a stale unit').not.toEqual([])
    expect(isColdStub(chars(a.db).find(slot => slot.chaId === chaId) as object), 'precondition: X is a cold stub').toBe(true)
    return { memory, a, chaId, stale, named }
}

describe('the web pass against a real peer', () => {
    test('A5a: a page whose base a peer commit dropped refuses stale-base, keeps every stale unit, and still loads its cold stub of X', async () => {
        const { memory, a, stale, chaId } = await pageWithDroppedBase()
        const before = new Set(await memory.listStore2())

        const result = await runPass(memory)

        // Soft, so a deleting pass reports the lost units and the failed cold load together with the wrong status.
        expect.soft(await present(memory, [...stale]), 'every unit only the dropped base reaches is still stored').toBe(stale.size)
        expect.soft((await loadStubOf(memory, a, chaId)).status, 'the cold stub of X loads through the page\'s own base').toBe('ok')
        expect.soft(new Set(await memory.listStore2())).toEqual(before)
        expect(result).toMatchObject({ status: 'refused', reason: 'stale-base' })
    })

    test('A5b: after A stops, a fresh page over the same store deletes every stale unit, keeps every named tree and loads its stub of X', async () => {
        const { memory, stale, named, chaId } = await pageWithDroppedBase()
        stopAllWorlds()

        const fresh = await bootB(memory)
        runLoopWorld(fresh.context, fresh.db)
        expect(fresh.context.encoder.manifestKey, 'the fresh page boots on the current manifest').toBe(await currentKey(memory))
        putBackToStub(fresh, chaId)
        const result = await runPass(memory)

        expect(result).toMatchObject({ status: 'done' })
        expect(await present(memory, [...stale]), 'every stale unit is gone').toBe(0)
        expect(await present(memory, [...named]), 'every unit of current, retained and pins is present').toBe(named.size)
        expect((await loadStubOf(memory, fresh, chaId)).status).toBe('ok')
    })

    describe('A5c: a page that fast-forwarded to the peer\'s tree', () => {
        async function fastForwarded(): Promise<{ a: PageB, loop: ReturnType<typeof runLoopWorld>, memory: MemoryBackend, orphans: string[] }> {
            const memory = createMemoryBackend()
            const world = await ffWorldOver(memory)
            const a = await bootB(memory)
            const loop = runLoopWorld(a.context, a.db)
            const orphans = await plantOrphans(memory)
            await peerEdit(world, 1, 'peer change')
            signal(loop)
            await takenBy(a, memory)
            return { a, loop, memory, orphans }
        }

        test('(c1) right after the fast-forward the pass refuses stale-base and every unit stays', async () => {
            const { a, memory, orphans } = await fastForwarded()

            // The preconditions of the fail-closed rule: the encoder's base is the store's current and it fast-forwarded.
            expect(a.context.encoder.manifestKey).toBe(await currentKey(memory))
            expect(a.context.encoder.fastForwarded).toBe(true)
            const before = new Set(await memory.listStore2())
            const result = await runPass(memory)

            expect(result).toMatchObject({ status: 'refused', reason: 'stale-base' })
            expect(await present(memory, orphans)).toBe(ORPHANS)
            expect(new Set(await memory.listStore2())).toEqual(before)
        })

        test('(c2) after a later own commit the pass still refuses stale-base and every unit stays', async () => {
            const { a, loop, memory, orphans } = await fastForwarded()
            await ownEdit(loop, a, 0, 'own edit after the fast-forward')

            expect(a.context.encoder.manifestKey).toBe(await currentKey(memory))
            expect(a.context.encoder.fastForwarded).toBe(true)
            const before = new Set(await memory.listStore2())
            const result = await runPass(memory)

            expect(result).toMatchObject({ status: 'refused', reason: 'stale-base' })
            expect(await present(memory, orphans)).toBe(ORPHANS)
            expect(new Set(await memory.listStore2())).toEqual(before)
        })
    })
})
