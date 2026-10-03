/**
 * The copy back of an OPFS-main web profile into IndexedDB
 * (`src/ts/storage/opfsCopyBack.ts`): which store a page gets from the
 * `opfs_flag!` flag, the IndexedDB `migrated` marker and the OPFS files, that a
 * copy runs only under the exclusive tab lock, that the flag is cleared only
 * after a verified copy, that a copy that cannot finish rolls back and leaves
 * the profile on OPFS, and the clean-up that deletes OPFS leftovers later.
 *
 * Runs over `fake-indexeddb`, an in-memory OPFS root and a fake Web Locks
 * manager with simulated tabs; a pass says nothing about a real browser's OPFS
 * or IndexedDB. The `lastModified` comparison is a fake-based logic test: it
 * says nothing about how a real OPFS updates `lastModified`.
 *
 * Every test is labelled in its title:
 * - "new behaviour": the module does not exist before the change, so there is no
 *   pre-change run that fails on an assertion;
 * - "guard": holds before and after, and protects behaviour that must stay;
 * - "fake-based logic test": exercises a rule against a fake whose fidelity to a
 *   real browser is not established.
 * Crash-cut tests name the authority-table row the next start lands on.
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createIndexedDbStore } from 'src/ts/storage/store/indexedDbStore'
import {
    COPYBACK_CLEANUP_KEY,
    OPFS_FLAG_KEY,
    resolveWebStore,
    runLeftoverCleanup,
    type FlagStore,
    type WebStoreAuthority,
} from 'src/ts/storage/opfsCopyBack'
import { makeSimulatedTab } from './fakeWebLocks'
import { hexName } from './fakeOpfsRoot'
import {
    MAIN,
    bytes,
    indexedDbKeys,
    indexedDbText,
    makeEnv,
    newWorld,
    profile,
    putOpfs,
    resetProfile,
    seedOpfsMainProfile,
    sleep,
    text,
    type World,
} from './opfsCopyBackHarness'

let world: World

beforeEach(async () => {
    await resetProfile()
    world = newWorld()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'log').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

function expectIndexedDb(result: WebStoreAuthority, copiedBack: boolean): void {
    expect(result).toEqual({ kind: 'indexeddb', copiedBack })
}

/** Records every `getFileHandle` call that asked to create a file, so a test can prove nothing was written to OPFS. */
function watchOpfsWrites(): { creates: string[] } {
    const creates: string[] = []
    const original = world.root.getFileHandle.bind(world.root)
    vi.spyOn(world.root, 'getFileHandle').mockImplementation(async (name: string, options?: { create?: boolean }) => {
        if (options?.create) {
            creates.push(name)
        }
        return original(name, options)
    })
    return { creates }
}

describe('scenario 1 and 2: an OPFS-main profile is copied back', () => {
    test('new behaviour: flag and marker set: every OPFS file reaches IndexedDB, the main file is equal, the flag and the marker are gone, and nothing is written to OPFS', async () => {
        const files = await seedOpfsMainProfile(world)
        const before = new Map(world.root.files)
        const writes = watchOpfsWrites()
        const { env, progress } = makeEnv({ world })

        const result = await resolveWebStore(env)

        expectIndexedDb(result, true)
        for (const [key, value] of Object.entries(files)) {
            expect(text(await profile.getItem<Uint8Array>(key))).toBe(text(value))
        }
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBeNull()
        expect(await profile.getItem('migrated')).toBeNull()
        expect(localStorage.getItem(COPYBACK_CLEANUP_KEY)).toBe('pending')
        expect(writes.creates).toEqual([])
        expect(world.root.files).toEqual(before)
        expect(progress.open).toBe(false)
    })

    test('new behaviour: flag set and no main file in IndexedDB (a hand-set flag from first use) is copied back', async () => {
        await seedOpfsMainProfile(world, { staleIndexedDbMain: false, marker: false })

        const result = await resolveWebStore(makeEnv({ world }).env)

        expectIndexedDb(result, true)
        expect(await indexedDbText(MAIN)).toBe('current main file')
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBeNull()
    })
})

describe('scenario 3, 4 and 10: the flag with nothing to copy', () => {
    test('new behaviour (row: flag set, main present in IndexedDB, no marker): the flag is cleared, IndexedDB is used and no OPFS file is copied', async () => {
        await seedOpfsMainProfile(world, { marker: false })

        const result = await resolveWebStore(makeEnv({ world }).env)

        expectIndexedDb(result, false)
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBeNull()
        expect(await indexedDbText(MAIN)).toBe('stale main file')
        expect(await indexedDbKeys()).toEqual([MAIN])
    })

    test('new behaviour: a browser that cannot write OPFS files had IndexedDB current, so the flag is cleared and nothing is copied', async () => {
        await seedOpfsMainProfile(world)

        const result = await resolveWebStore(makeEnv({ world, opfsFilesUsable: false }).env)

        expectIndexedDb(result, false)
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBeNull()
        expect(await indexedDbText(MAIN)).toBe('stale main file')
    })

    test('new behaviour (scenario 10): OPFS holds no main file: the flag and marker are cleared, IndexedDB is used as it stands, and no IndexedDB entry is deleted', async () => {
        localStorage.setItem(OPFS_FLAG_KEY, 'able')
        await profile.setItem('migrated', true)
        await profile.setItem('database/dbbackup-1.bin', bytes('kept stale backup'))
        putOpfs(world, 'database/dbbackup-1.bin', bytes('backup in opfs'))

        const result = await resolveWebStore(makeEnv({ world }).env)

        expectIndexedDb(result, false)
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBeNull()
        expect(await profile.getItem('migrated')).toBeNull()
        expect(await indexedDbText('database/dbbackup-1.bin')).toBe('kept stale backup')
        expect(localStorage.getItem(COPYBACK_CLEANUP_KEY)).toBeNull()
    })

    test('guard: no flag: IndexedDB is used and OPFS is never opened', async () => {
        putOpfs(world, MAIN, bytes('opfs main'))
        const writes = watchOpfsWrites()
        const getRoot = vi.fn(async () => world.root as unknown as FileSystemDirectoryHandle)
        const { env } = makeEnv({ world })

        const result = await resolveWebStore({ ...env, getOpfsRoot: getRoot })

        expectIndexedDb(result, false)
        expect(getRoot).not.toHaveBeenCalled()
        expect(writes.creates).toEqual([])
        expect(await indexedDbKeys()).toEqual([])
    })
})

describe('scenario 5: the lock is not granted', () => {
    test('new behaviour: another page holds a presence lock: the page falls back to OPFS with the tab notice, the flag is kept and IndexedDB is untouched', async () => {
        await seedOpfsMainProfile(world)
        const before = await indexedDbKeys()
        // An older page that only ever holds the shared presence lock.
        const olderPage = makeSimulatedTab(world.core, 'older-page')
        await olderPage.locks.tabPresenceLockAcquired
        const { env, progress } = makeEnv({ world, lockTimeoutMs: 100 })

        const result = await resolveWebStore(env)

        expect(result).toEqual({ kind: 'opfs', notice: { reason: 'tab' } })
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBe('able')
        expect(await indexedDbKeys()).toEqual(before)
        expect(await indexedDbText(MAIN)).toBe('stale main file')
        expect(progress.shown).toEqual([])
    })

    test('new behaviour (5c): every page that starts while an older page holds its presence lock ends on OPFS and none on IndexedDB', async () => {
        await seedOpfsMainProfile(world)
        const olderPage = makeSimulatedTab(world.core, 'older-page')
        await olderPage.locks.tabPresenceLockAcquired
        const a = makeEnv({ world, lockTimeoutMs: 100 })
        const b = makeEnv({ world, lockTimeoutMs: 100 })

        const [resultA, resultB] = await Promise.all([resolveWebStore(a.env), resolveWebStore(b.env)])

        expect(resultA).toEqual({ kind: 'opfs', notice: { reason: 'tab' } })
        expect(resultB).toEqual({ kind: 'opfs', notice: { reason: 'tab' } })
        expect(await indexedDbText(MAIN)).toBe('stale main file')
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBe('able')
    })

    test('new behaviour (5b): a copy longer than the other page\'s lock wait: the other page, which had a storage epoch reading, stops for its reload and never serves OPFS or IndexedDB', async () => {
        await seedOpfsMainProfile(world)
        const otherReloads: string[] = []
        const other = makeEnv({
            world,
            lockTimeoutMs: 80,
            reloads: otherReloads,
            tab: makeSimulatedTab(world.core, 'other-page', { reload: () => { otherReloads.push('reload') } }),
        })
        const slow = makeEnv({
            world,
            faults: { beforeSetItem: async () => { await sleep(60) } },
        })

        const copying = resolveWebStore(slow.env)
        await sleep(30)
        const [resultOther, resultSlow] = await Promise.all([resolveWebStore(other.env), copying])

        expectIndexedDb(resultSlow, true)
        expect(resultOther).toEqual({ kind: 'stopped' })
        expect(otherReloads.length).toBeGreaterThan(0)
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBeNull()
    })

    test('new behaviour (5b): the same race for a page with no storage epoch reading re-reads the flag, finds it cleared, and gets IndexedDB rather than OPFS', async () => {
        await seedOpfsMainProfile(world)
        const other = makeEnv({ world, lockTimeoutMs: 80, skipEpochRecording: true })
        const slow = makeEnv({
            world,
            faults: { beforeSetItem: async () => { await sleep(60) } },
        })

        const copying = resolveWebStore(slow.env)
        await sleep(30)
        const [resultOther, resultSlow] = await Promise.all([resolveWebStore(other.env), copying])

        expectIndexedDb(resultSlow, true)
        expectIndexedDb(resultOther, false)
    })

    test('new behaviour (5e): a page with no epoch reading that is granted the lock after another page finished re-reads the flag under the lock and does not copy again', async () => {
        await seedOpfsMainProfile(world)
        let setItems = 0
        const first = makeEnv({ world, faults: { beforeSetItem: async () => { setItems++; await sleep(20) } } })
        const second = makeEnv({
            world,
            skipEpochRecording: true,
            faults: { beforeSetItem: () => { setItems += 1000 } },
        })

        const copying = resolveWebStore(first.env)
        await sleep(10)
        const [resultFirst, resultSecond] = await Promise.all([copying, resolveWebStore(second.env)])

        expectIndexedDb(resultFirst, true)
        expectIndexedDb(resultSecond, false)
        expect(setItems).toBeLessThan(1000)
    })
})

describe('scenario 6 and 6b: free space', () => {
    test('new behaviour: the quota estimate is smaller than the profile: the page falls back with the space notice and nothing is written to IndexedDB', async () => {
        await seedOpfsMainProfile(world)
        const { env, progress } = makeEnv({ world, estimate: async () => ({ usage: 100, quota: 110 }) })

        const result = await resolveWebStore(env)

        expect(result).toEqual({ kind: 'opfs', notice: { reason: 'space' } })
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBe('able')
        expect(await indexedDbKeys()).toEqual(['migrated'])
        expect(progress.open).toBe(false)
    })

    test('new behaviour (6b): leftovers of an interrupted attempt do not count against the space check, so a quota that fits the profile once succeeds', async () => {
        const files = await seedOpfsMainProfile(world)
        let opfsTotal = 0
        for (const value of Object.values(files)) {
            opfsTotal += value.byteLength
        }
        // An interrupted attempt left a full copy behind in IndexedDB.
        for (const [key, value] of Object.entries(files)) {
            await profile.setItem(key, value)
        }
        const indexedDbBytes = async () => {
            let total = 0
            for (const key of await profile.keys()) {
                total += (await profile.getItem<Uint8Array>(key))?.byteLength ?? 0
            }
            return total
        }
        const { env } = makeEnv({
            world,
            estimate: async () => ({ usage: opfsTotal + await indexedDbBytes(), quota: opfsTotal * 2 + 10 }),
        })

        const result = await resolveWebStore(env)

        expectIndexedDb(result, true)
    })

    test('new behaviour: an estimate that throws does not stop the copy', async () => {
        await seedOpfsMainProfile(world)
        const { env } = makeEnv({ world, estimate: async () => { throw new Error('estimate unavailable') } })

        expectIndexedDb(await resolveWebStore(env), true)
    })
})

describe('scenario 7 and 8: a copy that fails rolls back and the next start completes', () => {
    test('new behaviour: a write fails on one key: the keys written are removed from IndexedDB, the flag and marker stay, the page falls back, and the next start completes', async () => {
        const files = await seedOpfsMainProfile(world)
        const n = Object.keys(files).length
        const failing = makeEnv({
            world,
            faults: { beforeSetItem: (_key, count) => count === 3 ? new Error('disk is full of something') : undefined },
        })

        const result = await resolveWebStore(failing.env)

        expect(result).toEqual({ kind: 'opfs', notice: { reason: 'error', detail: 'disk is full of something' } })
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBe('able')
        expect(await profile.getItem('migrated')).toBe(true)
        expect(localStorage.getItem(COPYBACK_CLEANUP_KEY)).toBeNull()
        expect(await indexedDbKeys()).toEqual(['migrated'])
        expect(failing.progress.open).toBe(false)

        failing.tab.close()
        const next = await resolveWebStore(makeEnv({ world }).env)

        expectIndexedDb(next, true)
        expect((await indexedDbKeys()).filter((key) => key in files)).toHaveLength(n)
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBeNull()
    })

    test('new behaviour: a quota error while writing falls back with the space notice', async () => {
        await seedOpfsMainProfile(world)
        const { env } = makeEnv({
            world,
            faults: { beforeSetItem: (_key, count) => count === 2 ? new DOMException('full', 'QuotaExceededError') : undefined },
        })

        expect(await resolveWebStore(env)).toEqual({ kind: 'opfs', notice: { reason: 'space' } })
        expect(await indexedDbKeys()).toEqual(['migrated'])
    })

    test('new behaviour (8): the main file reads back different from the OPFS file: the copy is rolled back and the flag stays', async () => {
        await seedOpfsMainProfile(world)
        const { env } = makeEnv({
            world,
            faults: { corruptValue: (key, value) => key === MAIN ? bytes('not the main file') : value },
        })

        const result = await resolveWebStore(env)

        expect(result.kind).toBe('opfs')
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBe('able')
        expect(await indexedDbKeys()).toEqual(['migrated'])
        expect(localStorage.getItem(COPYBACK_CLEANUP_KEY)).toBeNull()
    })
})

describe('scenario 5d: an OPFS file changes during the copy (fake-based logic test)', () => {
    test('fake-based logic test: a fallback page writes a unit to OPFS during the copy: the copy rolls back with the tab notice, and the next start copies the new unit', async () => {
        await seedOpfsMainProfile(world)
        const newUnitKey = 'coldstorage/9a1d7c20-2b3e-4f5a-8c6d-1e2f3a4b5c6d'
        const copying = makeEnv({
            world,
            faults: {
                beforeSetItem: (_key, count) => {
                    if (count === 2) {
                        putOpfs(world, newUnitKey, bytes('written by a fallback page'))
                    }
                },
            },
        })

        const result = await resolveWebStore(copying.env)

        expect(result).toEqual({ kind: 'opfs', notice: { reason: 'tab' } })
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBe('able')
        expect(await indexedDbKeys()).toEqual(['migrated'])

        copying.tab.close()
        const next = await resolveWebStore(makeEnv({ world }).env)

        expectIndexedDb(next, true)
        expect(await indexedDbText(newUnitKey)).toBe('written by a fallback page')
    })

    test('fake-based logic test: a file rewritten in place with the same size but a new modification time is detected', async () => {
        await seedOpfsMainProfile(world)
        const { env } = makeEnv({
            world,
            faults: {
                beforeSetItem: (_key, count) => {
                    if (count === 2) {
                        world.root.put(hexName('assets/aaaa.png'), bytes('asset bytes'))
                    }
                },
            },
        })

        expect((await resolveWebStore(env)).kind).toBe('opfs')
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBe('able')
    })
})

describe('scenario 9: a crash at each cut ends in a correct state', () => {
    test('new behaviour (cut mid-copy; next start: row "flag set, marker present"): leftovers in IndexedDB are replaced and the copy completes', async () => {
        const files = await seedOpfsMainProfile(world)
        await profile.setItem(MAIN, bytes('half copied'))
        await profile.setItem('database/dbbackup-1.bin', bytes('half copied'))

        const result = await resolveWebStore(makeEnv({ world }).env)

        expectIndexedDb(result, true)
        for (const [key, value] of Object.entries(files)) {
            expect(await indexedDbText(key)).toBe(text(value))
        }
    })

    test('new behaviour (cut after the copy and before the clean-up marker; next start: row "flag set, marker present"): the copy runs again to the same end state', async () => {
        const files = await seedOpfsMainProfile(world)
        for (const [key, value] of Object.entries(files)) {
            await profile.setItem(key, value)
        }

        const result = await resolveWebStore(makeEnv({ world }).env)

        expectIndexedDb(result, true)
        expect(await indexedDbText(MAIN)).toBe('current main file')
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBeNull()
    })

    test('new behaviour (cut after the clean-up marker and before the flag removal; next start: row "flag set, marker present"): the copy runs again and the flag is cleared', async () => {
        const files = await seedOpfsMainProfile(world)
        for (const [key, value] of Object.entries(files)) {
            await profile.setItem(key, value)
        }
        localStorage.setItem(COPYBACK_CLEANUP_KEY, 'pending')

        const result = await resolveWebStore(makeEnv({ world }).env)

        expectIndexedDb(result, true)
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBeNull()
        expect(localStorage.getItem(COPYBACK_CLEANUP_KEY)).toBe('pending')
    })

    test('new behaviour (cut after the flag removal and before the marker removal; next start: row "flag unset"): IndexedDB is current, nothing is copied, and the marker is removed', async () => {
        await seedOpfsMainProfile(world)
        localStorage.removeItem(OPFS_FLAG_KEY)
        localStorage.setItem(COPYBACK_CLEANUP_KEY, 'pending')
        await profile.setItem(MAIN, bytes('newer main file saved after the copy'))

        const result = await resolveWebStore(makeEnv({ world }).env)

        expectIndexedDb(result, false)
        expect(await indexedDbText(MAIN)).toBe('newer main file saved after the copy')
        expect(await profile.getItem('migrated')).toBeNull()
    })

    test('new behaviour (cut after the marker removal; next start: row "flag unset"): IndexedDB is current and nothing is copied', async () => {
        await seedOpfsMainProfile(world, { marker: false })
        localStorage.removeItem(OPFS_FLAG_KEY)
        await profile.setItem(MAIN, bytes('newer main file saved after the copy'))

        const result = await resolveWebStore(makeEnv({ world }).env)

        expectIndexedDb(result, false)
        expect(await indexedDbText(MAIN)).toBe('newer main file saved after the copy')
    })
})

describe('scenario 9b and 9c: the commit step fails', () => {
    test('new behaviour (9b): the flag cannot be removed: the copy is rolled back, the flag stays, the clean-up marker is absent, and the page falls back', async () => {
        await seedOpfsMainProfile(world)
        const flags: FlagStore = {
            getItem: (key) => localStorage.getItem(key),
            setItem: (key, value) => localStorage.setItem(key, value),
            removeItem: (key) => {
                if (key === OPFS_FLAG_KEY) {
                    throw new Error('localStorage refused')
                }
                localStorage.removeItem(key)
            },
        }
        const { env } = makeEnv({ world, flags })

        const result = await resolveWebStore(env)

        expect(result).toEqual({ kind: 'opfs', notice: { reason: 'error', detail: 'localStorage refused' } })
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBe('able')
        expect(localStorage.getItem(COPYBACK_CLEANUP_KEY)).toBeNull()
        expect(await indexedDbKeys()).toEqual(['migrated'])
    })

    test('new behaviour (9c): the IndexedDB marker cannot be removed after the flag is: IndexedDB is used, and the next start removes the marker', async () => {
        await seedOpfsMainProfile(world)
        const { env } = makeEnv({
            world,
            faults: { beforeRemoveItem: (key) => key === 'migrated' ? new Error('marker removal refused') : undefined },
        })

        const result = await resolveWebStore(env)

        expectIndexedDb(result, true)
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBeNull()
        expect(await profile.getItem('migrated')).toBe(true)

        const next = await resolveWebStore(makeEnv({ world }).env)

        expectIndexedDb(next, false)
        expect(await profile.getItem('migrated')).toBeNull()
    })
})

describe('scenario 25 and 21b: every hex-named OPFS file is carried, whatever its key', () => {
    test('new behaviour (25): a hex coldstorage/<key> unit written by a fallback page is copied and readable through the IndexedDB store afterwards', async () => {
        await seedOpfsMainProfile(world)
        const unitKey = 'coldstorage/9a1d7c20-2b3e-4f5a-8c6d-1e2f3a4b5c6d'
        putOpfs(world, unitKey, bytes('unit from a fallback page'))

        expectIndexedDb(await resolveWebStore(makeEnv({ world }).env), true)

        const store = createIndexedDbStore()
        const read = await store.read(unitKey)
        expect(text(read.bytes)).toBe('unit from a fallback page')
    })

    test('new behaviour (21b): an upstream asset key with a backslash is copied, readable through the IndexedDB store, and its OPFS file is deleted by the clean-up only once IndexedDB holds it', async () => {
        await seedOpfsMainProfile(world)
        const oddKey = 'assets/abc.scan\\1'
        putOpfs(world, oddKey, bytes('odd asset'))

        expectIndexedDb(await resolveWebStore(makeEnv({ world }).env), true)

        const store = createIndexedDbStore()
        expect(text((await store.read(oddKey)).bytes)).toBe('odd asset')
        expect(world.root.files.has(hexName(oddKey))).toBe(true)

        expect(await runLeftoverCleanup(makeEnv({ world }).env)).toBe('done')
        expect(world.root.files.has(hexName(oddKey))).toBe(false)
        expect(text((await store.read(oddKey)).bytes)).toBe('odd asset')
    })

    test('guard: a root entry that is not a file, and a name that is not a hex key, are neither copied nor counted', async () => {
        await seedOpfsMainProfile(world)
        world.root.directories.add(hexName('some/directory'))
        world.root.files.set('coldstorage_3f2b8c1e-5a47-4d9e-8b61-0c7a9d2e4f10.json', bytes('legacy unit'))

        expectIndexedDb(await resolveWebStore(makeEnv({ world }).env), true)

        expect(await profile.getItem('some/directory')).toBeNull()
        expect((await indexedDbKeys()).some((key) => key.includes('coldstorage_'))).toBe(false)
    })
})

describe('no usable IndexedDB', () => {
    test('new behaviour: IndexedDB is not supported at all: the page runs from OPFS with the no-IndexedDB notice and nothing is copied', async () => {
        await seedOpfsMainProfile(world)
        const openIndexedDb = vi.fn()
        const { env } = makeEnv({ world, indexedDbSupported: false })

        const result = await resolveWebStore({ ...env, openIndexedDb })

        expect(result).toEqual({ kind: 'opfs', notice: { reason: 'noIndexedDb' } })
        expect(openIndexedDb).not.toHaveBeenCalled()
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBe('able')
    })

    test('new behaviour: IndexedDB is supported but cannot be opened: the boot fails loudly and no store is chosen', async () => {
        await seedOpfsMainProfile(world)
        const { env } = makeEnv({ world })

        await expect(resolveWebStore({ ...env, openIndexedDb: async () => { throw new Error('open failed') } })).rejects.toThrow('open failed')
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBe('able')
    })

    test('new behaviour: a deciding read that throws on an IndexedDB that opened fails the boot loudly and never selects OPFS', async () => {
        await seedOpfsMainProfile(world)
        const { env } = makeEnv({ world })

        await expect(resolveWebStore({
            ...env,
            createProbe: () => ({ exists: async () => { throw new Error('count failed') }, close: () => { } }),
        })).rejects.toThrow('count failed')
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBe('able')
    })
})

describe('the wait alert is cleared on every exit of a copy', () => {
    const exits: [string, () => ReturnType<typeof makeEnv>][] = [
        ['success', () => makeEnv({ world })],
        ['space', () => makeEnv({ world, estimate: async () => ({ usage: 1, quota: 2 }) })],
        ['write error', () => makeEnv({ world, faults: { beforeSetItem: (_key, count) => count === 2 ? new Error('boom') : undefined } })],
        ['verify mismatch', () => makeEnv({ world, faults: { corruptValue: (key, value) => key === MAIN ? bytes('x') : value } })],
        ['a lost race detected at the final comparison', () => makeEnv({
            world,
            faults: { beforeSetItem: (_key, count) => { if (count === 1) { putOpfs(world, 'assets/new.png', bytes('new')) } } },
        })],
    ]
    for (const [label, build] of exits) {
        test(`new behaviour: ${label} leaves no wait alert open`, async () => {
            await seedOpfsMainProfile(world)
            const built = build()

            await resolveWebStore(built.env)

            expect(built.progress.open).toBe(false)
        })
    }
})

describe('scenarios 22 to 24: the clean-up of OPFS leftovers', () => {
    async function afterCopyBack(): Promise<Record<string, Uint8Array>> {
        const files = await seedOpfsMainProfile(world)
        expectIndexedDb(await resolveWebStore(makeEnv({ world }).env), true)
        return files
    }

    test('new behaviour (22): with the flag unset and the marker pending it deletes every hex file IndexedDB holds, then removes the marker', async () => {
        const files = await afterCopyBack()

        const outcome = await runLeftoverCleanup(makeEnv({ world }).env)

        expect(outcome).toBe('done')
        for (const key of Object.keys(files)) {
            expect(world.root.files.has(hexName(key))).toBe(false)
            expect(await indexedDbText(key)).not.toBeNull()
        }
        expect(localStorage.getItem(COPYBACK_CLEANUP_KEY)).toBeNull()
    })

    test('new behaviour (22): it does nothing while the flag is set, and nothing without the pending marker', async () => {
        const files = await afterCopyBack()
        localStorage.setItem(OPFS_FLAG_KEY, 'able')

        expect(await runLeftoverCleanup(makeEnv({ world }).env)).toBe('skipped')
        localStorage.removeItem(OPFS_FLAG_KEY)
        localStorage.removeItem(COPYBACK_CLEANUP_KEY)
        expect(await runLeftoverCleanup(makeEnv({ world }).env)).toBe('skipped')

        for (const key of Object.keys(files)) {
            expect(world.root.files.has(hexName(key))).toBe(true)
        }
    })

    test('new behaviour (21c): an OPFS file whose key IndexedDB does not hold is not deleted', async () => {
        await afterCopyBack()
        putOpfs(world, 'assets/only-in-opfs.png', bytes('written by an overtaken page'))

        const outcome = await runLeftoverCleanup(makeEnv({ world }).env)

        expect(outcome).toBe('done')
        expect(world.root.files.has(hexName('assets/only-in-opfs.png'))).toBe(true)
        expect(await indexedDbText('assets/only-in-opfs.png')).toBeNull()
    })

    test('new behaviour (23): legacy coldstorage_<key>.json unit files are left alone', async () => {
        await afterCopyBack()
        const legacy = 'coldstorage_3f2b8c1e-5a47-4d9e-8b61-0c7a9d2e4f10.json'
        world.root.files.set(legacy, bytes('legacy unit'))
        await profile.setItem('coldstorage/3f2b8c1e-5a47-4d9e-8b61-0c7a9d2e4f10', bytes('store unit'))

        await runLeftoverCleanup(makeEnv({ world }).env)

        expect(world.root.files.has(legacy)).toBe(true)
    })

    test('new behaviour (24): one deletion failing keeps the marker pending, and the next run finishes', async () => {
        const files = await afterCopyBack()
        world.root.failRemoval.add(hexName('assets/aaaa.png'))

        expect(await runLeftoverCleanup(makeEnv({ world }).env)).toBe('pending')
        expect(localStorage.getItem(COPYBACK_CLEANUP_KEY)).toBe('pending')
        expect(world.root.files.has(hexName('assets/aaaa.png'))).toBe(true)
        expect(world.root.files.has(hexName(MAIN))).toBe(false)

        world.root.failRemoval.clear()
        expect(await runLeftoverCleanup(makeEnv({ world }).env)).toBe('done')
        for (const key of Object.keys(files)) {
            expect(world.root.files.has(hexName(key))).toBe(false)
        }
        expect(localStorage.getItem(COPYBACK_CLEANUP_KEY)).toBeNull()
    })

    test('new behaviour: a file removed by someone else between the listing and the deletion counts as deleted', async () => {
        await afterCopyBack()
        const original = world.root.removeEntry.bind(world.root)
        vi.spyOn(world.root, 'removeEntry').mockImplementation(async (name: string) => {
            await original(name)
            throw new DOMException('already gone', 'NotFoundError')
        })

        expect(await runLeftoverCleanup(makeEnv({ world }).env)).toBe('done')
    })

    test('new behaviour: a presence check that cannot be made keeps the file and the marker', async () => {
        await afterCopyBack()
        const { env } = makeEnv({ world })

        const outcome = await runLeftoverCleanup({ ...env, createProbe: () => ({ exists: async () => null, close: () => { } }) })

        expect(outcome).toBe('pending')
        expect(world.root.files.has(hexName(MAIN))).toBe(true)
        expect(localStorage.getItem(COPYBACK_CLEANUP_KEY)).toBe('pending')
    })
})
