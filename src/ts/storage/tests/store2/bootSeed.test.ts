// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    createMemoryBackend, Store2BackendFailureError, type MemoryBackend, type Store2Backend,
} from 'src/ts/storage/store2/backend'
import { emptySeedProfile, probeNumberedBackups, seedStore2Profile, type SeedEntry } from 'src/ts/storage/store2/bootSeed'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { firstLifeGrant } from 'src/ts/storage/store2/firstLife'
import { readUnit, UNIT_TYPE, type Manifest } from 'src/ts/storage/store2/format'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { createClock, testEnv } from '../store2SaveKit'
import { fakeLists } from './codecFixtures'

/**
 * The seed driver of the boot dispatch: the empty profile, the probe that decides whether seeding is allowed, and what
 * the first-life install came to. Labels: new behaviour (the driver is new).
 */

const clock = createClock()
const env = testEnv(clock, 4711)
const owner = freshOwnerId(testEnv(clock, 4712))

async function grantOf(backend: Store2Backend): Promise<SeedEntry> {
    const result = firstLifeGrant({
        decision: { row: 1, mode: 'first-life', action: 'seed' },
        commitRead: await backend.readCommit(),
        startupClear: null,
    })
    if (result.status !== 'granted') {
        throw new Error(`No grant: ${result.detail}`)
    }
    return { kind: 'first-life', grant: result.grant }
}

/** The backend with named calls failing definitely, counted from 1 per method. */
function failing(memory: MemoryBackend, fails: Partial<Record<'countPrefix' | 'listStore2' | 'putUnit' | 'casCommit', number[]>>): Store2Backend {
    const counts: Record<string, number> = {}
    function gate(name: keyof typeof fails): void {
        counts[name] = (counts[name] ?? 0) + 1
        if (fails[name]?.includes(counts[name])) {
            throw new Store2BackendFailureError(`${name} ${counts[name]} failed`)
        }
    }
    return {
        ...memory,
        countPrefix: async (prefix) => { gate('countPrefix'); return memory.countPrefix(prefix) },
        listStore2: async () => { gate('listStore2'); return memory.listStore2() },
        putUnit: async (key, bytes) => { gate('putUnit'); return memory.putUnit(key, bytes) },
        casCommit: async (expected, next) => { gate('casCommit'); return memory.casCommit(expected, next) },
    }
}

describe('new behaviour: the empty profile', () => {
    test('it holds the containers every save holds and nothing else', () => {
        expect(emptySeedProfile()).toEqual({
            characters: [], botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {},
        })
    })

    test('each call hands out a fresh object', () => {
        const a = emptySeedProfile()
        const b = emptySeedProfile()
        expect(a).not.toBe(b)
        expect(a.characters).not.toBe(b.characters)
    })
})

describe('new behaviour: the probe for numbered backups', () => {
    test('no backup is none', async () => {
        expect(await probeNumberedBackups(async () => [])).toEqual({ status: 'none' })
    })

    test('backups are returned as listed, newest first', async () => {
        expect(await probeNumberedBackups(async () => [30, 20, 10])).toEqual({ status: 'some', backups: [30, 20, 10] })
    })

    test('a listing that fails is unknown, with its reason, and is never read as none', async () => {
        const probe = await probeNumberedBackups(async () => { throw new Error('listing refused') })
        expect(probe).toEqual({ status: 'unknown', reason: 'listing refused' })
    })

    test('a listing that rejects with something that is not an Error is still unknown', async () => {
        const probe = await probeNumberedBackups(() => Promise.reject('plain text'))
        expect(probe).toEqual({ status: 'unknown', reason: 'plain text' })
    })
})

describe('new behaviour: the first-life install of the empty profile', () => {
    test('it installs a tree that assembles to the empty profile, under the marker\'s owner, converted from "seed"', async () => {
        const memory = createMemoryBackend()
        const outcome = await seedStore2Profile(memory, await grantOf(memory), { owner, lists: fakeLists, env })
        expect(outcome.status).toBe('installed')
        if (outcome.status !== 'installed') {
            return
        }
        const key = classifyCommitRead(await memory.readCommit())
        if (key.status !== 'parsed') {
            throw new Error('The commit key does not parse.')
        }
        expect(key.value.current?.key).toBe(outcome.manifestKey)
        expect(key.value.staging).toBeNull()
        expect(key.value.convertedFrom).toBe('seed')
        const stored = memory.snapshot()
        const manifest = readUnit(stored.get(outcome.manifestKey) as Uint8Array, UNIT_TYPE.manifest)
        if (manifest.status !== 'ok') {
            throw new Error('The manifest does not parse.')
        }
        const database = assembleDatabase(manifest.value.body as Manifest, { get: unit => stored.get(unit) })
        expect(database).toMatchObject({ characters: [], botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {} })
    })

    test('a store that already holds a unit is never seeded over: the boot is classified again, and nothing is written', async () => {
        const memory = createMemoryBackend()
        const grant = await grantOf(memory)
        memory.poke('store2/a-unit-a-peer-wrote', new Uint8Array([1]))
        const before = memory.snapshot()
        const outcome = await seedStore2Profile(memory, grant, { owner, lists: fakeLists, env })
        expect(outcome).toEqual({ status: 'reclassify' })
        expect([...memory.snapshot().keys()]).toEqual([...before.keys()])
        expect((await memory.readCommit()).bytes).toBeNull()
    })

    test('a peer that installed first makes the boot classify again, and the peer\'s profile stands', async () => {
        const memory = createMemoryBackend()
        const stale = await grantOf(memory)
        const peer = await seedStore2Profile(memory, await grantOf(memory), { owner: freshOwnerId(testEnv(clock, 99)), lists: fakeLists, env: testEnv(clock, 98) })
        expect(peer.status).toBe('installed')
        const before = (await memory.readCommit()).bytes
        // The first page still holds its absence read: its marker write loses the compare-and-write.
        const outcome = await seedStore2Profile(memory, stale, { owner, lists: fakeLists, env })
        expect(outcome).toEqual({ status: 'reclassify' })
        expect((await memory.readCommit()).bytes).toEqual(before)
    })

    test('a store2 listing that fails before the marker blocks as presence-unknown and writes nothing', async () => {
        const memory = createMemoryBackend()
        const backend = failing(memory, { countPrefix: [1], listStore2: [1] })
        const outcome = await seedStore2Profile(backend, await grantOf(memory), { owner, lists: fakeLists, env })
        expect(outcome).toMatchObject({ status: 'blocked', reason: 'presence-unknown' })
        expect((await memory.readCommit()).bytes).toBeNull()
        expect(memory.snapshot().size).toBe(0)
    })

    test('a marker write that fails definitely blocks as marker-failed and writes nothing', async () => {
        const memory = createMemoryBackend()
        const backend = failing(memory, { casCommit: [1] })
        const outcome = await seedStore2Profile(backend, await grantOf(memory), { owner, lists: fakeLists, env })
        expect(outcome).toMatchObject({ status: 'blocked', reason: 'marker-failed' })
        expect(memory.snapshot().size).toBe(0)
    })

    test('a staged unit that cannot be put blocks, leaving the marker standing and no current manifest', async () => {
        const memory = createMemoryBackend()
        const backend = failing(memory, { putUnit: [1] })
        const outcome = await seedStore2Profile(backend, await grantOf(memory), { owner, lists: fakeLists, env })
        expect(outcome).toMatchObject({ status: 'blocked', reason: 'install-upload-failed' })
        const key = classifyCommitRead(await memory.readCommit())
        expect(key.status === 'parsed' && key.value.current === null && key.value.staging !== null && key.value.staging.label === 'seed').toBe(true)
    })

    test('a final write that fails definitely blocks as install-failed with the marker standing', async () => {
        const memory = createMemoryBackend()
        const backend = failing(memory, { casCommit: [2] })
        const outcome = await seedStore2Profile(backend, await grantOf(memory), { owner, lists: fakeLists, env })
        expect(outcome).toMatchObject({ status: 'blocked', reason: 'install-failed' })
        const key = classifyCommitRead(await memory.readCommit())
        expect(key.status === 'parsed' && key.value.current === null && key.value.staging !== null).toBe(true)
    })
})

const DAMAGED_COMMIT = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63])

/** A recovery state (a damaged commit key) and the fenced `exit` entry over the key as read. */
async function exitEntry(memory: MemoryBackend): Promise<SeedEntry & { kind: 'exit' }> {
    await memory.casCommit((await memory.readCommit()).token, DAMAGED_COMMIT)
    return { kind: 'exit', commitRead: await memory.readCommit() }
}

/** The backend with its mutating calls recorded by name. */
function recorded(memory: MemoryBackend): { backend: Store2Backend, writes: string[] } {
    const writes: string[] = []
    return {
        writes,
        backend: {
            ...memory,
            casCommit: async (expected, next) => { writes.push('casCommit'); return memory.casCommit(expected, next) },
            casFence: async (expected, next) => { writes.push('casFence'); return memory.casFence(expected, next) },
            putUnit: async (key, bytes) => { writes.push('putUnit'); return memory.putUnit(key, bytes) },
        },
    }
}

describe('new behaviour: the fenced exit entry of the seed', () => {
    test('the fence is written before the seed marker, and the empty profile is installed under it', async () => {
        const memory = createMemoryBackend()
        const entry = await exitEntry(memory)
        const spy = recorded(memory)

        const outcome = await seedStore2Profile(spy.backend, entry, { owner, lists: fakeLists, env })

        expect(outcome.status).toBe('installed')
        expect(spy.writes.indexOf('casFence')).toBeGreaterThanOrEqual(0)
        expect(spy.writes.indexOf('casFence')).toBeLessThan(spy.writes.indexOf('casCommit'))
        const key = classifyCommitRead(await memory.readCommit())
        if (key.status !== 'parsed' || outcome.status !== 'installed') {
            throw new Error('The commit key does not parse.')
        }
        expect(key.value.current?.key).toBe(outcome.manifestKey)
        expect(key.value.staging).toBeNull()
        expect(key.value.convertedFrom).toBe('seed')
        expect((await memory.readFence()).bytes).not.toBeNull()
    })

    test('the marker the exit writes is a seed marker of the request owner, with the fence already held', async () => {
        const memory = createMemoryBackend()
        const entry = await exitEntry(memory)
        const seen: { label: string | null, owner: string | null, fenceHeld: boolean }[] = []
        const backend: Store2Backend = {
            ...memory,
            casCommit: async (expected, next) => {
                const result = await memory.casCommit(expected, next)
                const key = classifyCommitRead(await memory.readCommit())
                seen.push({
                    label: key.status === 'parsed' ? key.value.staging?.label ?? null : null,
                    owner: key.status === 'parsed' ? key.value.staging?.owner ?? null : null,
                    fenceHeld: (await memory.readFence()).bytes !== null,
                })
                return result
            },
        }

        await seedStore2Profile(backend, entry, { owner, lists: fakeLists, env })

        expect(seen[0]).toEqual({ label: 'seed', owner, fenceHeld: true })
    })

    test('an exit that does not end marked is passed through, and no unit is staged', async () => {
        const memory = createMemoryBackend()
        const entry = await exitEntry(memory)
        const peerBytes = Uint8Array.from([9, 9, 9, 250, 251, 252, 253, 254, 255, 62, 63])
        await memory.casCommit(entry.commitRead.token, peerBytes)
        const spy = recorded(memory)

        const outcome = await seedStore2Profile(spy.backend, entry, { owner, lists: fakeLists, env })

        expect(outcome).toMatchObject({ status: 'exit', exit: { status: 'conflict' } })
        expect(spy.writes).toEqual(['casFence', 'casCommit'])
        expect((await memory.readCommit()).bytes).toEqual(peerBytes)
    })

    test('a staged unit that cannot be put blocks with the fenced seed marker standing', async () => {
        const memory = createMemoryBackend()
        const entry = await exitEntry(memory)

        const outcome = await seedStore2Profile(failing(memory, { putUnit: [1] }), entry, { owner, lists: fakeLists, env })

        expect(outcome).toMatchObject({ status: 'blocked', reason: 'install-upload-failed' })
        const key = classifyCommitRead(await memory.readCommit())
        expect(key.status === 'parsed' && key.value.current === null && key.value.staging?.label === 'seed').toBe(true)
        expect((await memory.readFence()).bytes).not.toBeNull()
    })

    test('the first-life entry still writes no fence', async () => {
        const memory = createMemoryBackend()
        const spy = recorded(memory)

        await seedStore2Profile(spy.backend, await grantOf(memory), { owner, lists: fakeLists, env })

        expect(spy.writes).not.toContain('casFence')
        expect((await memory.readFence()).bytes).toBeNull()
    })
})
