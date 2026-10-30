/**
 * Deleting the unit a re-archive replaced (`process/memory/supersededUnits.ts`)
 * through the REAL, unmocked `saveDb()` loop, `RisuSaveEncoder` and block-store
 * owner over an in-memory byte store (see `saveLoopWorld.ts`), with the real
 * restore, put-back, re-archive and deletion module. The unit store and the
 * unit deletion are stand-ins (a map and a recorder); the Web Locks API is a
 * stand-in too. A pass here says nothing about a real store or browser.
 *
 * Each withhold test arranges the condition after the proof, shows that
 * nothing is deleted while it holds, then removes only that condition and
 * shows the unit is deleted: the condition, and nothing else, was what
 * withheld it.
 *
 * Labels: "new behaviour" fails on the base (no deletion exists); "guard" pins
 * one condition of the new code and names the mutation it catches.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeCharacter, makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import { BLOCKS_PREFIX, keptKey, rootKey } from 'src/ts/storage/blockKeys'
import { STORAGE_TAB_LOCK_NAME } from 'src/ts/storage/storageTabLocks'

vi.setConfig({ testTimeout: 120_000 })

const platformState = vi.hoisted(() => ({ node: false }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    get isNodeServer() { return platformState.node },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const kit = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

type Entry = Record<string, unknown>

const units = new Map<string, unknown>()
/** Every key `deleteColdStorageUnits` was asked to delete. */
const deleted: string[][] = []

let stops: Array<() => void> = []
let locksHolders = 1
let locksMode: 'ok' | 'throws' | 'absent' = 'ok'
/** Another tab's exclusive storage request, queued or granted. */
let locksExclusive: 'none' | 'pending' | 'held' = 'none'
/** Runs inside every unit write, after the value is taken. */
let onUnitWrite: (() => void) | null = null
/** While set, the write of x's unit waits for it. */
let unitHold: Promise<void> | null = null
/** Runs when a deletion is requested, before it is recorded. */
let deleteProbe: (() => void) | null = null

beforeEach(() => {
    vi.clearAllMocks()
    units.clear()
    deleted.length = 0
    onUnitWrite = null
    unitHold = null
    deleteProbe = null
    locksHolders = 1
    locksMode = 'ok'
    locksExclusive = 'none'
    platformState.node = false
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
    Object.defineProperty(globalThis.navigator, 'locks', {
        configurable: true,
        get: () => locksMode === 'absent' ? undefined : {
            query: async () => {
                if (locksMode === 'throws') {
                    throw new Error('lock query failed')
                }
                const held: Array<{ name: string, mode: string }> = Array.from({ length: locksHolders }, () => ({ name: STORAGE_TAB_LOCK_NAME, mode: 'shared' }))
                if (locksExclusive === 'held') {
                    held.push({ name: STORAGE_TAB_LOCK_NAME, mode: 'exclusive' })
                }
                return { held, pending: locksExclusive === 'pending' ? [{ name: STORAGE_TAB_LOCK_NAME, mode: 'exclusive' }] : [] }
            },
            request: async () => undefined,
        },
    })
    vi.doMock('src/ts/process/coldstorage.svelte', async () => {
        const { noteReadSize } = await import('src/ts/process/memory/restoredBytes')
        return {
            getColdStorageItem: vi.fn(),
            writeColdStorageUnit: async (key: string, value: { character: { chaId: string } }) => {
                if (value.character.chaId === 'x' && unitHold) {
                    await unitHold
                }
                units.set(key, JSON.parse(JSON.stringify(value)))
                onUnitWrite?.()
                return 'written'
            },
            readColdStorageItem: async (key: string) => {
                const unit = units.get(key)
                if (unit === undefined) {
                    return { status: 'missing' }
                }
                const json = JSON.stringify(unit)
                const result = { status: 'ok', value: JSON.parse(json) }
                noteReadSize(result, json.length)
                return result
            },
            deleteColdStorageUnits: async (keys: string[]) => {
                deleteProbe?.()
                deleted.push([...keys])
                for (const key of keys) {
                    units.delete(key)
                }
                return []
            },
        }
    })
})

afterEach(() => {
    for (const stop of stops) {
        stop()
    }
    stops = []
    kit.parkAll()
    vi.restoreAllMocks()
    delete (globalThis.navigator as unknown as Record<string, unknown>).locks
})

interface Arena {
    w: World
    stores: typeof import('src/ts/stores.svelte')
    superseded: typeof import('src/ts/process/memory/supersededUnits')
    slotOfX(): Entry
    /** One more commit, so that a pending deletion checks again. */
    bump(): Promise<void>
    backups(): string[]
    pruneBackups(): void
}

const isStubEntry = (entry: Entry) => typeof entry.coldstorage === 'string'

/** A world holding x as a stub on unit-x beside y and z, archiving allowed; x restored, edited, and re-archived. */
async function openArena(afterStart?: (w: World) => void): Promise<Arena> {
    const full = makeCharacter('x')
    full.chats = [{ id: 'x-chat', message: [{ role: 'char', data: 'hello from the unit', time: 1 }], note: '', name: '', localLore: [] }]
    units.set('unit-x', { character: full })
    const db = makeDb('p', ['y', 'z'])
    ;(db.characters as unknown[]).unshift(buildColdStub(full as never, 'unit-x', []))
    h.db = db
    const w = await kit.startWorld({ kind: 'tauri', startLoop: false })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Record<string, unknown>
    w.start()
    afterStart?.(w)
    await sleepReal(150)
    w.bootState.noteBootArchiveSession(true)
    h.db.archiveCharacters = true
    const { restoreColdCharacter } = await import('src/ts/process/coldCharacterRestore')
    const putBack = await import('src/ts/process/memory/characterPutBack')
    const superseded = await import('src/ts/process/memory/supersededUnits')
    superseded.setSupersededTimingForTest({ pollMs: 20, polls: 50, checkEveryMs: 0 })
    stores.selectedCharID.set(-1)
    stops.push(putBack.startCharacterPutBack())
    const characters = () => h.db!.characters as Entry[]
    const slotOfX = () => characters().find((c) => c.chaId === 'x')!
    const arena: Arena = {
        w,
        stores,
        superseded,
        slotOfX,
        bump: () => nextCommit(w, () => w.marks.markCharacterForSave('y')),
        backups: () => w.store.keys('database/dbbackup-'),
        pruneBackups() {
            for (const key of w.store.keys('database/dbbackup-')) {
                w.store.unplant(key)
            }
        },
    }
    const outcome = await restoreColdCharacter(slotOfX() as never, { byChaId: true, quiet: true })
    expect(outcome.status).toBe('restored')
    await nextCommit(w, () => w.marks.markCharacterForSave('x'))
    ;((slotOfX().chats as Entry[])[0].message as Entry[])[0].data = 'edited after the restore'
    await nextCommit(w, () => w.marks.markCharacterForSave('x'))
    return arena
}

/** Moves on from x, which is then re-archived; waits for the stub to be placed and the loop to go idle. */
async function moveOn(a: Arena): Promise<void> {
    const characters = () => h.db!.characters as Entry[]
    await nextCommit(a.w, () => {
        a.stores.selectedCharID.set(characters().findIndex((c) => c.chaId === 'y'))
        a.w.marks.markCharacterForSave('y')
    })
    await until(() => isStubEntry(a.slotOfX()), 'the re-archive to place the stub')
    await settled(a.w)
}

/** x archived, restored, edited, and re-archived. */
async function reArchivedWorld(afterStart?: (w: World) => void): Promise<Arena> {
    const a = await openArena(afterStart)
    await moveOn(a)
    return a
}

/** Gives the loop and the deletion checks time to act on what the test arranged. */
async function quiet(a: Arena): Promise<void> {
    await a.bump()
    await sleepReal(300)
    await a.bump()
    await sleepReal(300)
}

const deletedKeys = () => deleted.flat()

describe('the unit a re-archive replaced', () => {
    test('new behaviour: it is kept while a backup that existed at the proof is stored, and deleted once those backups are pruned; the new unit is never deleted', async () => {
        const a = await reArchivedWorld()
        expect(a.backups().length).toBeGreaterThan(0)
        expect(a.slotOfX().coldstorage).not.toBe('unit-x')

        await quiet(a)

        expect(deletedKeys()).toEqual([])
        expect(a.superseded.pendingSupersededCount()).toBe(1)

        a.pruneBackups()
        await a.bump()
        await until(() => deletedKeys().length > 0, 'the superseded unit to be deleted')

        expect(deleted).toEqual([['unit-x']])
        expect(deletedKeys()).not.toContain(a.slotOfX().coldstorage as string)
        expect(units.has(a.slotOfX().coldstorage as string)).toBe(true)
        expect(a.superseded.pendingSupersededCount()).toBe(0)
    })

    test('guard: a backup written after the proof does not hold the deletion; catches comparing against all current backups instead of the keys listed at the proof', async () => {
        const a = await reArchivedWorld()
        await quiet(a)
        expect(deletedKeys()).toEqual([])
        const held = a.backups()
        a.pruneBackups()
        a.w.store.plant('database/dbbackup-99999999999999.bin', new Uint8Array([1]))
        expect(held).not.toContain('database/dbbackup-99999999999999.bin')

        await a.bump()
        await until(() => deletedKeys().length > 0, 'the superseded unit to be deleted')
    })

    test('guard: a name that is not a numbered backup does not hold the deletion; the filter is deliberate', async () => {
        const a = await openArena((w) => w.store.plant('database/dbbackup-notanumber.bin', new Uint8Array([1])))
        await moveOn(a)
        for (const key of a.backups().filter((name) => /^database\/dbbackup-\d+\.bin$/.test(name))) {
            a.w.store.unplant(key)
        }
        expect(a.backups()).toEqual(['database/dbbackup-notanumber.bin'])

        await a.bump()
        await until(() => deletedKeys().length > 0, 'the superseded unit to be deleted')
    })

    test('guard: the proof waits for the clean loop, so a commit whose iteration began before the stub was placed does not drop the entry; the unit goes only once the stub is committed', async () => {
        const a = await openArena()
        // The poll right after the commit callback, while the loop is still inside that iteration.
        a.superseded.setSupersededTimingForTest({ pollMs: 0, polls: 200 })
        const proto = a.w.risuSave.RisuSaveEncoder.prototype as unknown as { encodeCharacterBlock: (...args: unknown[]) => Promise<unknown> }
        const original = proto.encodeCharacterBlock
        let holdEncode: Promise<void> | null = null
        let encodeReached = false
        proto.encodeCharacterBlock = async function (this: unknown, ...args: unknown[]) {
            if (holdEncode && (args[0] as { chaId?: string }).chaId === 'x') {
                encodeReached = true
                await holdEncode
            }
            return await original.apply(this, args)
        }
        let stubCommittedAtDelete: boolean | null = null
        deleteProbe = () => {
            const generation = a.w.owner.committedState()!.generation
            const pack = a.w.store.peek(`blocks/${generation}/stubs`)
            stubCommittedAtDelete = pack !== null && new TextDecoder().decode(pack).includes(a.slotOfX().coldstorage as string)
        }
        let releaseWrite!: () => void
        unitHold = new Promise<void>((resolve) => { releaseWrite = resolve })
        // Leave x: its re-archive starts and waits in the unit write.
        await nextCommit(a.w, () => {
            a.stores.selectedCharID.set((h.db!.characters as Entry[]).findIndex((c) => c.chaId === 'y'))
            a.w.marks.markCharacterForSave('y')
        })
        await until(() => a.w.api.isSaveClean(), 'the loop to be idle')
        let releaseEncode!: () => void
        holdEncode = new Promise<void>((resolve) => { releaseEncode = resolve })
        a.w.marks.markCharacterForSave('x')
        await until(() => encodeReached, 'an iteration to reach the encode of x')
        releaseWrite()
        await until(() => isStubEntry(a.slotOfX()), 'the re-archive to place the stub')
        a.pruneBackups()
        // The held iteration commits first: its snapshot predates the stub.
        releaseEncode()
        await settled(a.w)
        await sleepReal(300)

        // The stub's own commit has landed by now, and only then may the unit go.
        expect(a.superseded.pendingSupersededCount()).toBeLessThanOrEqual(1)
        await a.bump()
        await until(() => deletedKeys().length > 0, 'the superseded unit to be deleted')
        expect(deleted).toEqual([['unit-x']])
        expect(stubCommittedAtDelete).toBe(true)
    })

    test('guard: a reload forgets the pending deletion; the unit stays', async () => {
        const a = await reArchivedWorld()
        a.superseded.resetSupersededUnitsForTest()
        a.superseded.setSupersededTimingForTest({ pollMs: 20, polls: 50, checkEveryMs: 0 })
        a.pruneBackups()

        await quiet(a)

        expect(deletedKeys()).toEqual([])
        expect(units.has('unit-x')).toBe(true)
    })
})

describe('the older copies of the profile', () => {
    async function withheldBy(plant: (a: Arena) => void, unplant: (a: Arena) => void): Promise<void> {
        const a = await reArchivedWorld()
        await quiet(a)
        a.pruneBackups()
        plant(a)

        await quiet(a)

        expect(deletedKeys()).toEqual([])
        expect(a.superseded.pendingSupersededCount()).toBe(1)

        unplant(a)
        await a.bump()
        await until(() => deletedKeys().length > 0, 'the superseded unit to be deleted')
    }

    test('guard: a pre-blocks copy withholds it; catches dropping the pre-blocks check', async () => {
        await withheldBy(
            (a) => a.w.store.plant('database/database.pre-blocks.bin', new Uint8Array([1])),
            (a) => a.w.store.unplant('database/database.pre-blocks.bin'),
        )
    })

    test('guard: the legacy main file withholds it; catches dropping the legacy-file check', async () => {
        await withheldBy(
            (a) => a.w.store.plant('database/database.bin', new Uint8Array([1])),
            (a) => a.w.store.unplant('database/database.bin'),
        )
    })

    test('guard: a leftover generation withholds it; catches ignoring leftover generations', async () => {
        const id = '000000000001-aaaaaaaa'
        await withheldBy(
            (a) => a.w.store.plant(rootKey(id), new Uint8Array([1])),
            (a) => a.w.store.unplant(rootKey(id)),
        )
    })

    test('guard: a kept generation withholds it; catches ignoring kept generations', async () => {
        const id = '000000000002-bbbbbbbb'
        await withheldBy(
            (a) => { a.w.store.plant(rootKey(id), new Uint8Array([1])); a.w.store.plant(keptKey(id), new Uint8Array([1])) },
            (a) => { a.w.store.unplant(rootKey(id)); a.w.store.unplant(keptKey(id)) },
        )
        expect(BLOCKS_PREFIX).toBe('blocks/')
    })
})

describe('the commit proof backstop', () => {
    test('guard (Gate 1 B1): a committed stubs pack that still names the old unit holds the deletion; catches dropping the byte search', async () => {
        let stale = true
        const a = await reArchivedWorld((w) => {
            // What the owner acknowledged lags: the pack read at the proof still carries the old unit's name.
            const read = w.store.read.bind(w.store)
            w.store.read = async (key) => {
                const result = await read(key)
                if (stale && key.endsWith('/stubs') && result.bytes !== null) {
                    const extra = new TextEncoder().encode('{"coldstorage":"unit-x"}')
                    const merged = new Uint8Array(result.bytes.length + extra.length)
                    merged.set(result.bytes)
                    merged.set(extra, result.bytes.length)
                    return { bytes: merged, version: result.version }
                }
                return result
            }
        })
        a.pruneBackups()

        await quiet(a)

        expect(deletedKeys()).toEqual([])
        expect(a.superseded.pendingSupersededCount()).toBe(1)

        stale = false
        await a.bump()
        await until(() => deletedKeys().length > 0, 'the superseded unit to be deleted')
    })
})

describe('the commit proof, own block and bound', () => {
    test('guard (N1): the character\'s own committed block naming the old unit holds the deletion; catches dropping the own-block half of the byte search', async () => {
        let stale = true
        const a = await reArchivedWorld((w) => {
            const read = w.store.read.bind(w.store)
            w.store.read = async (key) => {
                const result = await read(key)
                if (stale && key.endsWith('/c/78')) {
                    return { bytes: new TextEncoder().encode('{"coldstorage":"unit-x"}'), version: result.version }
                }
                return result
            }
        })
        a.pruneBackups()

        await quiet(a)

        expect(deletedKeys()).toEqual([])
        expect(a.superseded.pendingSupersededCount()).toBe(1)
        stale = false
        await a.bump()
        await until(() => deletedKeys().length > 0, 'the superseded unit to be deleted')
    })

    test('new behaviour (N3): a pack that keeps naming the old unit is given up after a bounded number of commits, and nothing is deleted', async () => {
        const a = await reArchivedWorld((w) => {
            const read = w.store.read.bind(w.store)
            w.store.read = async (key) => {
                const result = await read(key)
                if (key.endsWith('/stubs') && result.bytes !== null) {
                    const extra = new TextEncoder().encode('{"coldstorage":"unit-x"}')
                    const merged = new Uint8Array(result.bytes.length + extra.length)
                    merged.set(result.bytes)
                    merged.set(extra, result.bytes.length)
                    return { bytes: merged, version: result.version }
                }
                return result
            }
        })
        a.pruneBackups()

        for (let i = 0; i < 8; i++) {
            await a.bump()
            await sleepReal(100)
        }

        expect(a.superseded.pendingSupersededCount()).toBe(0)
        expect(deletedKeys()).toEqual([])
    })
})

describe('other tabs and platforms', () => {
    async function withheldAfter(arrange: () => void, release: () => void): Promise<Arena> {
        const a = await reArchivedWorld()
        await quiet(a)
        a.pruneBackups()
        arrange()

        await quiet(a)

        expect(deletedKeys()).toEqual([])
        expect(a.superseded.pendingSupersededCount()).toBe(1)

        release()
        await a.bump()
        await until(() => deletedKeys().length > 0, 'the superseded unit to be deleted')
        return a
    }

    test('guard: a second presence-lock holder withholds it; catches counting no holders', async () => {
        await withheldAfter(() => { locksHolders = 2 }, () => { locksHolders = 1 })
    })

    test('guard: another tab\'s pending exclusive request withholds it, though that tab has released its own hold; catches counting held presence locks only', async () => {
        await withheldAfter(() => { locksExclusive = 'pending' }, () => { locksExclusive = 'none' })
    })

    test('guard: a granted exclusive lock withholds it', async () => {
        await withheldAfter(() => { locksExclusive = 'held' }, () => { locksExclusive = 'none' })
    })

    test('guard: a failed lock query withholds it; catches treating a failed query as alone', async () => {
        await withheldAfter(() => { locksMode = 'throws' }, () => { locksMode = 'ok' })
    })

    test('guard: no lock API on the web withholds it; catches treating a missing API as alone off the desktop', async () => {
        await withheldAfter(() => { locksMode = 'absent' }, () => { locksMode = 'ok' })
    })

    test('guard: a Node server never deletes it', async () => {
        const a = await reArchivedWorld()
        platformState.node = true
        await quiet(a)
        a.pruneBackups()

        await quiet(a)

        expect(deletedKeys()).toEqual([])
        expect(units.has('unit-x')).toBe(true)
    })

    test('guard: on a Node server the unit is never queued; catches dropping the queue-time Node check', async () => {
        platformState.node = true
        const a = await reArchivedWorld()
        a.pruneBackups()

        await quiet(a)

        expect(a.superseded.pendingSupersededCount()).toBe(0)
        expect(deletedKeys()).toEqual([])
        expect(units.has('unit-x')).toBe(true)
    })

    test('guard: a peer save after the job started drops the pending deletion; catches taking the baseline after the engine call or not comparing it', async () => {
        const a = await reArchivedWorld()
        // The count a peer's broadcast raises; a real broadcast would also stop this page's own saves at its conflict prompt.
        const peer = vi.spyOn(a.w.api, 'getPeerSaveCount')
        peer.mockReturnValue(a.w.api.getPeerSaveCount() + 1)
        a.pruneBackups()

        await quiet(a)

        expect(deletedKeys()).toEqual([])
        expect(a.superseded.pendingSupersededCount()).toBe(0)
    })
})

describe('the peer baseline', () => {
    test('guard: a peer save that lands during the re-archive write drops the pending deletion; catches taking the baseline after the engine call', async () => {
        let extra = 0
        onUnitWrite = () => { extra += 1 }
        const a = await reArchivedWorld((w) => {
            const real = w.api.getPeerSaveCount
            vi.spyOn(w.api, 'getPeerSaveCount').mockImplementation(() => real() + extra)
        })
        a.pruneBackups()

        await quiet(a)

        expect(deletedKeys()).toEqual([])
        expect(a.superseded.pendingSupersededCount()).toBe(0)
    })
})

describe('what is in use', () => {
    test('guard: a busy action withholds it until it ends; catches dropping the busy check', async () => {
        const a = await reArchivedWorld()
        await quiet(a)
        a.pruneBackups()
        const { beginBusy } = await import('src/ts/process/memory/busyActions')
        const busy = beginBusy('export')

        await quiet(a)

        expect(deletedKeys()).toEqual([])
        busy.end()
        await a.bump()
        await until(() => deletedKeys().length > 0, 'the superseded unit to be deleted')
    })

    test('guard: a write choke point in flight withholds it until it ends', async () => {
        const a = await reArchivedWorld()
        await quiet(a)
        a.pruneBackups()
        const { beginChokePoint } = await import('src/ts/process/memory/busyActions')
        const end = beginChokePoint('asset')

        await quiet(a)

        expect(deletedKeys()).toEqual([])
        end()
        await a.bump()
        await until(() => deletedKeys().length > 0, 'the superseded unit to be deleted')
    })

    test('guard: a unit a live stub still names is never deleted; catches dropping the live-key check', async () => {
        const a = await reArchivedWorld()
        await quiet(a)
        a.pruneBackups()
        // Another slot names the old unit.
        ;(h.db!.characters as Entry[]).push({ chaId: 'dup', name: 'dup', type: 'character', coldstorage: 'unit-x', chats: [], coldStoragedChats: [] })

        await quiet(a)

        expect(deletedKeys()).toEqual([])
        expect(a.superseded.pendingSupersededCount()).toBe(0)
    })

    test('guard: a database replaced after the job drops the pending deletion; catches holding no database identity', async () => {
        const a = await reArchivedWorld()
        a.pruneBackups()
        a.stores.DBState.db = { ...a.stores.DBState.db } as never

        await quiet(a)

        expect(deletedKeys()).toEqual([])
    })
})

describe('the delete itself', () => {
    test('guard: a deletion that fails is not retried and the entry is gone; only the old unit is ever passed', async () => {
        const a = await reArchivedWorld()
        const cold = await import('src/ts/process/coldstorage.svelte')
        const calls: string[][] = []
        ;(cold as unknown as { deleteColdStorageUnits: (keys: string[]) => Promise<unknown[]> }).deleteColdStorageUnits = async (keys) => {
            calls.push([...keys])
            return [{ key: keys[0], error: new Error('refused') }]
        }
        await quiet(a)
        a.pruneBackups()

        await a.bump()
        await until(() => calls.length > 0, 'the deletion to be attempted')
        await quiet(a)

        expect(calls).toEqual([['unit-x']])
        expect(a.superseded.pendingSupersededCount()).toBe(0)
    })
})
