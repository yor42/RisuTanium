// @vitest-environment jsdom
// The worker-backed Studio history store: the main-thread proxy, the worker host and the real IndexedDB
// adapter, joined by a channel double that clones every message and delivers it as a macrotask. The host's
// database is a factory of its own, never the page's global `indexedDB`. Records come from the real model
// (`commitStep`, `applyReplayMove`); the oracle is the direct adapter on the same inputs, so a stored byte
// that differs between the two legs is a defect of the proxy or the host. Long text is synthetic Hangul.
import 'fake-indexeddb/auto'
import { IDBFactory, IDBObjectStore, forceCloseDatabase } from 'fake-indexeddb'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    applyReplayMove,
    commitStep,
    createModelState,
    emptyRecord,
    type FieldValue,
    type ModelState,
    type OwnerRecord,
} from '../historyModel'
import { characterOwnerKey, type OwnerKey } from '../ownerPhase'
import {
    asideMarkKey,
    headerKey,
    storedSizeOf,
    type LoadResult,
    type SaveResult,
    type StudioHistoryStore,
} from '../studioHistoryStore'
import { createStudioStoreHost } from '../studioStoreHost'
import { createStudioStoreIdb } from '../studioStoreIdb'
import {
    applyEdits,
    diffEntry,
    MAX_DELTA_DEPTH,
    type DeltaEntry,
    type Edit,
    type FromWorker,
    type SaveMessage,
} from '../studioStoreProtocol'
import { createStudioStoreProxy } from '../studioStoreProxy'
import { storedRecord, seedOwner } from './studioStoreDoubles'
import { createStudioChannel, readStoredMap, writeStoredEntries, type StudioChannel, type StudioChannelOptions } from './studioStoreChannel'

const A = characterOwnerKey('A')
const B = characterOwnerKey('B')
const C = characterOwnerKey('C')
const P = characterOwnerKey('P')
const Q = characterOwnerKey('Q')
const R = characterOwnerKey('R')
const X = characterOwnerKey('X')

// Both legs of a comparison use one page session, so equal inputs give equal write ids and generations.
const PAGE = 'ps'
const OK: SaveResult = { kind: 'ok', asided: false, trimmed: false }
const ABSENT: LoadResult = { kind: 'absent' }

afterEach(() => {
    vi.restoreAllMocks()
})

// ---------------------------------------------------------------- records, built by the real model

function editDesc(state: ModelState, id: string, at: number, from: string, to: string, visitId = 'v1'): ModelState {
    const before: FieldValue = { had: true, value: from }
    const after: FieldValue = { had: true, value: to }
    return commitStep(state, {
        id,
        at,
        visitId,
        label: { kind: 'field', field: 'desc' },
        ops: [{ op: 'set', path: 'desc', before, after }],
        restoreWrites: [{ path: 'desc', before, after }],
        coalesceKey: 'desc',
        replacesRestore: true,
    })
}

function removeGreeting(state: ModelState, id: string, at: number, deletedId: string): ModelState {
    return commitStep(state, {
        id,
        at,
        visitId: 'v1',
        label: { kind: 'greetingRemove' },
        ops: [{ op: 'listRemove', index: 0, value: '첫 인사', deletedId }],
        restoreWrites: [{ path: 'alternateGreetings', before: { list: ['첫 인사', '둘째 인사'] }, after: { list: ['둘째 인사'] } }],
        coalesceKey: null,
        replacesRestore: true,
    })
}

function replay(state: ModelState, direction: 'undo' | 'redo', at: number): ModelState {
    const from = direction === 'undo' ? state.record.done : state.record.undone
    const top = from[from.length - 1]
    return applyReplayMove(
        state,
        direction,
        { ok: true, label: top.label, ops: top.ops, writes: [], restoreWrites: [], deletedRemove: [], skipped: 0, fmNotRestored: false },
        at,
        'v1',
    )
}

// `count` edits past the coalescing window, each with `fill` Hangul characters.
function chainState(owner: OwnerKey, count: number, fill = 0): ModelState {
    let state = createModelState(emptyRecord(owner, 0))
    for (let i = 0; i < count; i++) {
        state = editDesc(state, `st${i}`, (i + 1) * 1500, `${'가'.repeat(fill)}${i - 1}`, `${'가'.repeat(fill)}${i}`)
    }
    return state
}

function chain(owner: OwnerKey, count: number, fill = 0): OwnerRecord {
    return chainState(owner, count, fill).record
}

function sizeOf(record: OwnerRecord): number {
    return storedSizeOf(record, record.ownerKey, Infinity)
}

// A record of `steps` steps whose stored size is about `target` bytes.
function sizedChain(owner: OwnerKey, steps: number, target: number): OwnerRecord {
    const small = sizeOf(chain(owner, steps, 0))
    const large = sizeOf(chain(owner, steps, 1000))
    return chain(owner, steps, Math.max(0, Math.round(((target - small) * 1000) / (large - small))))
}

// ---------------------------------------------------------------- the rig

interface Rig {
    channel: StudioChannel
    proxy: StudioHistoryStore
}

function proxyRig(options: StudioChannelOptions = {}): Rig {
    const channel = createStudioChannel({ pageSession: PAGE, ...options })
    return { channel, proxy: createStudioStoreProxy({ spawn: channel.spawn }) }
}

function protectOnly(owner: OwnerKey): ReadonlySet<OwnerKey> {
    return new Set([owner])
}

async function openAndLoad(rig: Rig, owner: OwnerKey): Promise<LoadResult> {
    expect(await rig.proxy.open()).toBe('ok')
    return rig.proxy.load(owner)
}

function savesOf(channel: StudioChannel): SaveMessage[] {
    return channel.posted.filter((message): message is SaveMessage => message.t === 'save')
}

function lastSave(channel: StudioChannel): SaveMessage {
    const saves = savesOf(channel)
    return saves[saves.length - 1]
}

// The kinds of every entry the message carries, whole or as a delta.
function kindsOf(message: SaveMessage): string[] {
    return [...message.put, ...message.delta].map((entry) => entry.k).sort()
}

// The part of a key: `h` for the header, the text after the generation for an owner entry.
function partOf(key: string): string {
    if (key.startsWith('h:')) return 'h'
    if (!key.startsWith('e:')) return key
    return key.slice(key.indexOf('|', key.indexOf('|') + 1) + 1)
}

function spyOnWrites(): { puts: string[]; deletes: string[] } {
    const log: { puts: string[]; deletes: string[] } = { puts: [], deletes: [] }
    const nativePut = IDBObjectStore.prototype.put
    const nativeDelete = IDBObjectStore.prototype.delete
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        log.puts.push(partOf(String(key)))
        return nativePut.call(this, value, key)
    })
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
        log.deletes.push(query instanceof IDBKeyRange ? 'range' : partOf(String(query)))
        return nativeDelete.call(this, query)
    })
    return log
}

// ---------------------------------------------------------------- the two legs of a comparison

interface Leg {
    store: StudioHistoryStore
    factory: IDBFactory
}

function directLeg(capBytes?: number): Leg {
    const factory = new IDBFactory()
    return { factory, store: createStudioStoreIdb({ factory, capBytes, pageSession: PAGE }) }
}

function workerLeg(capBytes?: number): Leg {
    const rig = proxyRig({ capBytes })
    return { factory: rig.channel.factory, store: rig.proxy }
}

// Runs the scenario on the direct adapter and through the worker: both must give the pinned results and
// leave the same bytes in the database.
async function onBothLegs(scenario: (leg: Leg) => Promise<unknown[]>, expected: unknown[], capBytes?: number): Promise<void> {
    const direct = directLeg(capBytes)
    const viaWorker = workerLeg(capBytes)
    expect(await scenario(direct)).toEqual(expected)
    expect(await scenario(viaWorker)).toEqual(expected)
    const bytes = await readStoredMap(direct.factory)
    expect(await readStoredMap(viaWorker.factory)).toEqual(bytes)
}

// A later producer's header: stands for data this build cannot read.
const LATER_HEADER = JSON.stringify({ v: 2, wid: 'later:1', ownerKey: A, size: 5, touchedAt: 1 })

function otherPage(leg: Leg): StudioHistoryStore {
    return createStudioStoreIdb({ factory: leg.factory, pageSession: 'other' })
}

async function seedStored(leg: Leg, record: OwnerRecord): Promise<void> {
    const scratch = new Map<string, string>()
    seedOwner(scratch, record, 'seed:1')
    await writeStoredEntries(leg.factory, scratch)
}

describe('T-W2 / T-W11 port answers and stored bytes are the same through the worker as on the direct adapter', () => {
    test('absent, then ok', async () => {
        const record = chain(A, 3)
        await onBothLegs(
            async ({ store }) => [await store.open(), await store.load(A), await store.save(A, record, protectOnly(A))],
            ['ok', ABSENT, OK],
        )
    })

    test('ok: a stored owner is loaded equal, and an edit of it is saved', async () => {
        const stored = chain(A, 3)
        await onBothLegs(
            async (leg) => {
                await seedStored(leg, stored)
                await leg.store.open()
                const loaded = await leg.store.load(A)
                if (loaded.kind !== 'ok') {
                    return [loaded]
                }
                const next = editDesc(createModelState(loaded.record), 'st3', 9000, '2', '3').record
                return [loaded, await leg.store.save(A, next, protectOnly(A))]
            },
            [{ kind: 'ok', record: stored }, OK],
        )
    })

    test('unreadable: the later producer header is copied aside and this page writes its own', async () => {
        const record = chain(A, 2)
        await onBothLegs(
            async (leg) => {
                await writeStoredEntries(leg.factory, [[headerKey(A), LATER_HEADER]])
                await leg.store.open()
                return [await leg.store.load(A), await leg.store.save(A, record, protectOnly(A))]
            },
            [{ kind: 'unreadable' }, { kind: 'ok', asided: true, trimmed: false }],
        )
    })

    test('keptUnreadable: both values stay and every save is kept', async () => {
        await onBothLegs(
            async (leg) => {
                await writeStoredEntries(leg.factory, [
                    [headerKey(A), LATER_HEADER],
                    [asideMarkKey(A), 'earlier header'],
                ])
                await leg.store.open()
                return [await leg.store.load(A), await leg.store.save(A, chain(A, 2), protectOnly(A))]
            },
            [{ kind: 'keptUnreadable' }, { kind: 'kept' }],
        )
    })

    test('aside: a state another page wrote is copied aside once', async () => {
        await onBothLegs(
            async (leg) => {
                await leg.store.open()
                const first = await leg.store.load(A)
                const other = otherPage(leg)
                await other.load(A)
                await other.save(A, chain(A, 2, 5), protectOnly(A))
                return [first, await leg.store.save(A, chain(A, 3), protectOnly(A))]
            },
            [ABSENT, { kind: 'ok', asided: true, trimmed: false }],
        )
    })

    test('kept: the aside marker is already taken, so nothing is written', async () => {
        await onBothLegs(
            async (leg) => {
                await leg.store.open()
                await leg.store.load(A)
                const other = otherPage(leg)
                await other.load(A)
                await other.save(A, chain(A, 2, 5), protectOnly(A))
                await writeStoredEntries(leg.factory, [[asideMarkKey(A), 'taken earlier']])
                return [await leg.store.save(A, chain(A, 3), protectOnly(A))]
            },
            [{ kind: 'kept' }],
        )
    })

    test('notLoaded: a save without a load writes nothing', async () => {
        await onBothLegs(async ({ store }) => [await store.open(), await store.save(A, chain(A, 2), protectOnly(A))], ['ok', { kind: 'notLoaded' }])
    })

    test('an id-rule breach is unwritable and writes nothing', async () => {
        let state = chainState(A, 1)
        state = editDesc(state, 'st0', 9000, '0', '1')
        expect(state.record.done.map((step) => step.id)).toEqual(['st0', 'st0'])
        await onBothLegs(
            async ({ store }) => [await store.open(), await store.load(A), await store.save(A, state.record, protectOnly(A))],
            ['ok', ABSENT, { kind: 'unwritable' }],
        )
    })

    test('protected eviction: the owner the save protects stays and the oldest unprotected one goes', async () => {
        const CAP = 10000
        await onBothLegs(
            async (leg) => {
                await leg.store.open()
                const out: unknown[] = []
                for (const record of [sizedChain(P, 3, CAP * 0.4), sizedChain(Q, 3, CAP * 0.3)]) {
                    await leg.store.load(record.ownerKey)
                    out.push(await leg.store.save(record.ownerKey, record, protectOnly(record.ownerKey)))
                }
                await leg.store.load(X)
                out.push(await leg.store.save(X, sizedChain(X, 3, CAP * 0.45), new Set([X, P])))
                const stored = await readStoredMap(leg.factory)
                out.push(stored.has(headerKey(P)), stored.has(headerKey(Q)))
                return out
            },
            [OK, OK, OK, true, false],
            CAP,
        )
    })

    test('T-W11 the record key apart from the owner, and touchedAt, reach the planners: header and entry bytes equal the direct leg', async () => {
        const record: OwnerRecord = { ...chain(B, 2, 4), touchedAt: 424242 }
        expect(record.ownerKey).not.toBe(A)
        const direct = directLeg()
        const viaWorker = workerLeg()
        const results: SaveResult[] = []
        for (const leg of [direct, viaWorker]) {
            await leg.store.open()
            await leg.store.load(A)
            results.push(await leg.store.save(A, record, protectOnly(A)))
        }
        expect(results[1]).toEqual(results[0])
        const bytes = await readStoredMap(direct.factory)
        expect(bytes.size).toBeGreaterThan(0)
        expect(await readStoredMap(viaWorker.factory)).toEqual(bytes)
        expect([...bytes.values()].some((value) => value.includes('424242'))).toBe(true)
    })
})

describe('T-W3 every kind of model transition is stored as on the direct adapter', () => {
    test('an edit, a coalesced edit, a new edit, an undo, a redo and a delete: each save leaves the stored record equal to memory and the bytes equal to the direct leg', async () => {
        let state = createModelState(emptyRecord(A, 0))
        const states: ModelState[] = []
        state = editDesc(state, 'e1', 100, '', 'one')
        states.push(state)
        state = editDesc(state, 'e1b', 300, 'one', 'two')
        expect(state.record.done).toHaveLength(1)
        states.push(state)
        state = editDesc(state, 'e2', 3000, 'two', 'three')
        states.push(state)
        state = replay(state, 'undo', 4000)
        expect(state.record.undone).toHaveLength(1)
        states.push(state)
        state = replay(state, 'redo', 5000)
        states.push(state)
        state = removeGreeting(state, 'e3', 6000, 'del1')
        expect(state.record.deleted).toHaveLength(1)
        states.push(state)

        const direct = directLeg()
        const viaWorker = workerLeg()
        for (const leg of [direct, viaWorker]) {
            await leg.store.open()
            await leg.store.load(A)
        }
        for (const next of states) {
            expect(await direct.store.save(A, next.record, protectOnly(A))).toEqual(OK)
            expect(await viaWorker.store.save(A, next.record, protectOnly(A))).toEqual(OK)
            const bytes = await readStoredMap(direct.factory)
            expect(await readStoredMap(viaWorker.factory)).toEqual(bytes)
            expect(storedRecord(bytes, A)?.record).toEqual(next.record)
        }
    })
})

describe('T-W1b / T-W1c the main realm builds no database request and loads no format module', () => {
    test('T-W1b open, load and save make no call to the page IndexedDB', async () => {
        const open = vi.spyOn(indexedDB, 'open')
        const rig = proxyRig()
        expect(await openAndLoad(rig, A)).toEqual(ABSENT)
        expect(await rig.proxy.save(A, chain(A, 2), protectOnly(A))).toEqual(OK)
        expect(open).not.toHaveBeenCalled()
        expect((await readStoredMap(rig.channel.factory)).has(headerKey(A))).toBe(true)
    })

    test('T-W1c the proxy module loads and answers a request while the adapter, the format and the host modules cannot load', async () => {
        const unavailable = (name: string) => () => {
            throw new Error(`${name} must not load in the main realm`)
        }
        vi.resetModules()
        vi.doMock('../studioStoreIdb', unavailable('the adapter'))
        vi.doMock('../studioHistoryStore', unavailable('the format module'))
        vi.doMock('../studioStoreHost', unavailable('the host'))
        try {
            const { createStudioStoreProxy: freshProxy } = await import('../studioStoreProxy')
            const listeners: ((event: Event) => void)[] = []
            const proxy = freshProxy({
                spawn: () => ({
                    postMessage: (message) => {
                        queueMicrotask(() => {
                            for (const listener of listeners) {
                                listener(new MessageEvent('message', { data: { t: 'ack', seq: message.seq, op: 'open', reply: 'ok' } }))
                            }
                        })
                    },
                    terminate: () => {},
                    addEventListener: (type, listener) => {
                        if (type === 'message') listeners.push(listener)
                    },
                }),
            })
            expect(await proxy.open()).toBe('ok')
        } finally {
            vi.doUnmock('../studioStoreIdb')
            vi.doUnmock('../studioHistoryStore')
            vi.doUnmock('../studioStoreHost')
            vi.resetModules()
        }
    })
})

describe('T-W4 / T-W12 what a save posts', () => {
    test('T-W4 the first save after a load posts exactly the changed entries, and the write log is a delta', async () => {
        const factory = new IDBFactory()
        const first = proxyRig({ factory })
        await openAndLoad(first, A)
        expect(await first.proxy.save(A, chain(A, 4), protectOnly(A))).toEqual(OK)

        // A second page of the same origin: a new proxy over a new channel on the same database.
        const second = proxyRig({ factory, pageSession: 'ps2' })
        const loaded = await openAndLoad(second, A)
        if (loaded.kind !== 'ok') throw new Error('the stored owner did not load')
        const next = editDesc(createModelState(loaded.record), 'st4', 9000, '3', '4', 'v2').record
        const writes = spyOnWrites()
        expect(await second.proxy.save(A, next, protectOnly(A))).toEqual(OK)

        const message = lastSave(second.channel)
        expect(kindsOf(message)).toEqual(['r', 's'])
        expect(message.put.flatMap((entry) => (entry.k === 's' ? [entry.value.id] : []))).toEqual(['st4'])
        expect(message.done).toHaveLength(5)
        expect(writes.puts.sort()).toEqual(['h', 'i', 'r', 's:st4'].sort())
        expect(writes.deletes).toEqual([])
    })

    test('a second load of the owner replaces its tokens: the next save is again a delta', async () => {
        const rig = proxyRig()
        await openAndLoad(rig, A)
        expect(await rig.proxy.save(A, chain(A, 3), protectOnly(A))).toEqual(OK)
        const loaded = await rig.proxy.load(A)
        if (loaded.kind !== 'ok') throw new Error('the stored owner did not load')
        const next = editDesc(createModelState(loaded.record), 'st3', 9000, '2', '3', 'v2').record
        expect(await rig.proxy.save(A, next, protectOnly(A))).toEqual(OK)
        expect(kindsOf(lastSave(rig.channel))).toEqual(['r', 's'])
        expect(storedRecord(await readStoredMap(rig.channel.factory), A)?.record).toEqual(next)
    })

    test('a load that is not ok forgets the owner: the next save posts every entry', async () => {
        const rig = proxyRig()
        await openAndLoad(rig, A)
        const record = chain(A, 3)
        expect(await rig.proxy.save(A, record, protectOnly(A))).toEqual(OK)
        await writeStoredEntries(rig.channel.factory, [[headerKey(A), LATER_HEADER]])
        expect((await rig.proxy.load(A)).kind).toBe('unreadable')
        expect(await rig.proxy.save(A, record, protectOnly(A))).toMatchObject({ kind: 'ok' })
        expect(lastSave(rig.channel).put).toHaveLength(record.done.length + 1)
        expect(lastSave(rig.channel).delta).toEqual([])
    })

    test('T-W12 a save with no change posts no entry, and a full rewrite after eviction posts ids only', async () => {
        const CAP = 10000
        const rig = proxyRig({ capBytes: CAP })
        await rig.proxy.open()
        const records = [P, Q, R].map((owner) => sizedChain(owner, 4, CAP * 0.45))
        for (const record of records) {
            await rig.proxy.load(record.ownerKey)
        }
        for (let round = 0; round < 2; round++) {
            for (const record of records) {
                const result = await rig.proxy.save(record.ownerKey, record, protectOnly(record.ownerKey))
                expect(result).toMatchObject({ kind: 'ok', trimmed: false })
                const message = lastSave(rig.channel)
                expect(message.owner).toBe(record.ownerKey)
                if (round === 0) {
                    expect(message.put).toHaveLength(record.done.length + 1)
                } else {
                    expect(message.put).toEqual([])
                    expect(message.delta).toEqual([])
                    expect(message.done).toHaveLength(record.done.length)
                }
                expect(storedRecord(await readStoredMap(rig.channel.factory), record.ownerKey)?.record).toEqual(record)
            }
        }
    })
})

describe('T-W5 / T-W6 / T-W7a failed saves, reordered acks and the synchronous post', () => {
    test('T-W5 a put that throws in the worker gives unwritable, and the retry posts no entry and stores the record', async () => {
        const rig = proxyRig()
        await openAndLoad(rig, A)
        const record = chain(A, 3)
        const nativePut = IDBObjectStore.prototype.put
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
            if (key === headerKey(A)) {
                throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
            }
            return nativePut.call(this, value, key)
        })
        expect(await rig.proxy.save(A, record, protectOnly(A))).toEqual({ kind: 'unwritable' })
        put.mockRestore()
        expect(await rig.proxy.save(A, record, protectOnly(A))).toEqual(OK)
        const saves = savesOf(rig.channel)
        expect(saves[0].put).toHaveLength(record.done.length + 1)
        expect(saves[1].put).toEqual([])
        expect(storedRecord(await readStoredMap(rig.channel.factory), A)?.record).toEqual(record)
    })

    test('T-W5 an aborted transaction answers unwritable, never ok, and writes nothing', async () => {
        const rig = proxyRig()
        await openAndLoad(rig, A)
        const record = chain(A, 3)
        const nativePut = IDBObjectStore.prototype.put
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
            const request = nativePut.call(this, value, key)
            if (key === headerKey(A)) {
                this.transaction.abort()
            }
            return request
        })
        expect(await rig.proxy.save(A, record, protectOnly(A))).toEqual({ kind: 'unwritable' })
        put.mockRestore()
        expect((await readStoredMap(rig.channel.factory)).size).toBe(0)
        expect(await rig.proxy.save(A, record, protectOnly(A))).toEqual(OK)
    })

    test('T-W6 saves of two owners and a load of a third, with the acks delivered in reverse, each get their own result', async () => {
        const rig = proxyRig()
        await openAndLoad(rig, A)
        const answered = rig.channel.replies.length
        rig.channel.holdReplies()
        const saveA = rig.proxy.save(A, chain(A, 2), protectOnly(A))
        const saveB = rig.proxy.save(B, chain(B, 2), protectOnly(B))
        const loadC = rig.proxy.load(C)
        await vi.waitFor(() => expect(rig.channel.replies.length).toBe(answered + 3))
        rig.channel.releaseReplies('reverse')
        // B was never loaded, so its answer differs from A's; C is absent.
        expect(await Promise.all([saveA, saveB, loadC])).toEqual([OK, { kind: 'notLoaded' }, ABSENT])
    })

    test('T-W7a the proxy posts before save() returns', async () => {
        const rig = proxyRig()
        await openAndLoad(rig, A)
        const before = savesOf(rig.channel).length
        const pending = rig.proxy.save(A, chain(A, 2), protectOnly(A))
        expect(savesOf(rig.channel)).toHaveLength(before + 1)
        expect(await pending).toEqual(OK)
    })
})

describe('T-W8 faults: errors, closing, a throwing post, no worker', () => {
    function countClosed(store: StudioHistoryStore): { count: number } {
        const seen = { count: 0 }
        store.onClosed(() => {
            seen.count += 1
        })
        return seen
    }

    async function expectLocalAnswers(rig: Rig): Promise<void> {
        const posted = rig.channel.posted.length
        expect(await rig.proxy.save(A, chain(A, 1), protectOnly(A))).toEqual({ kind: 'unwritable' })
        expect(await rig.proxy.load(B)).toEqual({ kind: 'failed' })
        expect(await rig.proxy.open()).toBe('unavailable')
        expect(rig.channel.posted).toHaveLength(posted)
    }

    test('(i) a closed connection fires onClosed once, then every call answers locally and posts nothing', async () => {
        const factory = new IDBFactory()
        const connections: IDBDatabase[] = []
        const adapter = createStudioStoreIdb({
            factory: {
                open(name, version) {
                    const request = factory.open(name, version)
                    request.addEventListener('success', () => connections.push(request.result))
                    return request
                },
            },
            pageSession: PAGE,
        })
        const rig = proxyRig({ factory, adapter })
        const closed = countClosed(rig.proxy)
        await openAndLoad(rig, A)
        expect(await rig.proxy.save(A, chain(A, 2), protectOnly(A))).toEqual(OK)
        expect(connections).toHaveLength(1)

        forceCloseDatabase(connections[0] as unknown as Parameters<typeof forceCloseDatabase>[0])
        forceCloseDatabase(connections[0] as unknown as Parameters<typeof forceCloseDatabase>[0])
        await rig.channel.flush()
        expect(closed.count).toBe(1)
        await expectLocalAnswers(rig)
        let late = 0
        rig.proxy.onClosed(() => {
            late += 1
        })
        expect(late).toBe(1)
        expect(closed.count).toBe(1)
    })

    test('(ii) a worker error after its first message resolves the pending save, fires onClosed once and stops posting', async () => {
        const rig = proxyRig()
        const closed = countClosed(rig.proxy)
        await openAndLoad(rig, A)
        rig.channel.holdReplies()
        const pending = rig.proxy.save(A, chain(A, 2), protectOnly(A))
        rig.channel.emitError()
        expect(await pending).toEqual({ kind: 'unwritable' })
        expect(closed.count).toBe(1)
        expect(rig.channel.terminated.value).toBe(true)
        await expectLocalAnswers(rig)
    })

    test('(iii) a message error resolves the pending load, fires onClosed once and stops posting', async () => {
        const rig = proxyRig()
        const closed = countClosed(rig.proxy)
        await openAndLoad(rig, A)
        rig.channel.holdReplies()
        const pending = rig.proxy.load(B)
        rig.channel.emitMessageError()
        expect(await pending).toEqual({ kind: 'failed' })
        expect(closed.count).toBe(1)
        await expectLocalAnswers(rig)
    })

    test.each([
        ['a DataCloneError', () => new DOMException('The object could not be cloned.', 'DataCloneError')],
        ['a generic error', () => new Error('postMessage failed')],
    ])('(iv) %s from postMessage gives unwritable, leaves what is believed posted unchanged, and the next save succeeds', async (_label, makeError) => {
        const rig = proxyRig()
        await openAndLoad(rig, A)
        const record = chain(A, 3)
        rig.channel.failPosts(makeError())
        expect(await rig.proxy.save(A, record, protectOnly(A))).toEqual({ kind: 'unwritable' })
        rig.channel.failPosts(null)
        expect(await rig.proxy.save(A, record, protectOnly(A))).toEqual(OK)
        expect(lastSave(rig.channel).put).toHaveLength(record.done.length + 1)
        expect(storedRecord(await readStoredMap(rig.channel.factory), A)?.record).toEqual(record)
    })

    test('(v) a worker error after a closed message does not fire onClosed again', async () => {
        const rig = proxyRig()
        const closed = countClosed(rig.proxy)
        await openAndLoad(rig, A)
        rig.channel.emitFromWorker({ t: 'closed' })
        await rig.channel.flush()
        expect(closed.count).toBe(1)
        rig.channel.emitError()
        expect(closed.count).toBe(1)
        await expectLocalAnswers(rig)
    })

    test('(vi) a page that cannot start the worker has an unavailable store: no onClosed, no post, no main-thread database', async () => {
        const open = vi.spyOn(indexedDB, 'open')
        const spawn = vi.fn(() => {
            throw new Error('module workers are not supported')
        })
        const proxy = createStudioStoreProxy({ spawn })
        const closed = countClosed(proxy)
        expect(await proxy.open()).toBe('unavailable')
        expect(await proxy.load(A)).toEqual({ kind: 'failed' })
        expect(await proxy.save(A, chain(A, 1), protectOnly(A))).toEqual({ kind: 'unwritable' })
        expect(closed.count).toBe(0)
        expect(spawn).toHaveBeenCalledTimes(1)
        expect(open).not.toHaveBeenCalled()
    })

    test('(vii) a worker error before any message is the unavailable path: open unavailable, no onClosed, nothing posted afterwards', async () => {
        const rig = proxyRig()
        const closed = countClosed(rig.proxy)
        const pending = rig.proxy.open()
        rig.channel.emitError()
        expect(await pending).toBe('unavailable')
        expect(closed.count).toBe(0)
        expect(rig.channel.terminated.value).toBe(true)
        const posted = rig.channel.posted.length
        expect(await rig.proxy.save(A, chain(A, 1), protectOnly(A))).toEqual({ kind: 'unwritable' })
        expect(await rig.proxy.load(A)).toEqual({ kind: 'failed' })
        expect(rig.channel.posted).toHaveLength(posted)
        expect(closed.count).toBe(0)
    })

    test('(viii) a fatal message and a message that is not one of ours both end the worker the same way', async () => {
        for (const data of [{ t: 'fatal' }, { t: 'unheard-of' }]) {
            const rig = proxyRig()
            const closed = countClosed(rig.proxy)
            await openAndLoad(rig, A)
            rig.channel.holdReplies()
            const pending = rig.proxy.save(A, chain(A, 1), protectOnly(A))
            rig.channel.emitFromWorker(data)
            expect(await pending).toEqual({ kind: 'unwritable' })
            expect(closed.count).toBe(1)
        }
    })

    test('(ix) an adapter whose save rejects or throws still answers: the save is unwritable and the worker goes on', async () => {
        for (const failure of [
            async () => {
                throw new Error('the adapter rejected')
            },
            () => {
                throw new Error('the adapter threw')
            },
        ]) {
            const adapter: StudioHistoryStore = {
                open: async () => 'ok',
                load: async () => ABSENT,
                save: failure,
                onClosed: () => {},
            }
            const rig = proxyRig({ adapter })
            expect(await openAndLoad(rig, A)).toEqual(ABSENT)
            expect(await rig.proxy.save(A, chain(A, 1), protectOnly(A))).toEqual({ kind: 'unwritable' })
            expect(await rig.proxy.open()).toBe('ok')
        }
    })

    test('(x) an adapter whose open and load reject or throw still answers unavailable and failed', async () => {
        const adapter: StudioHistoryStore = {
            open: () => Promise.reject(new Error('open rejected')),
            load: () => {
                throw new Error('load threw')
            },
            save: async () => OK,
            onClosed: () => {},
        }
        const rig = proxyRig({ adapter })
        expect(await rig.proxy.open()).toBe('unavailable')
        expect(await rig.proxy.load(A)).toEqual({ kind: 'failed' })
    })

    test('(xi) an adapter whose load returns a rejected promise still answers failed', async () => {
        const adapter: StudioHistoryStore = {
            open: async () => 'ok',
            load: () => Promise.reject(new Error('load rejected')),
            save: async () => OK,
            onClosed: () => {},
        }
        const rig = proxyRig({ adapter })
        expect(await rig.proxy.open()).toBe('ok')
        expect(await rig.proxy.load(A)).toEqual({ kind: 'failed' })
    })

    test('(xii) an ack with a well-formed tag and a malformed body answers its pending call as failed instead of hanging', async () => {
        const rig = proxyRig()
        await openAndLoad(rig, A)
        rig.channel.holdReplies()
        const saving = rig.proxy.save(A, chain(A, 1), protectOnly(A))
        rig.channel.emitFromWorker({ t: 'ack', seq: lastSave(rig.channel).seq, op: 'save' })
        expect(await saving).toEqual({ kind: 'unwritable' })

        const loading = rig.proxy.load(B)
        const sent = rig.channel.posted[rig.channel.posted.length - 1]
        rig.channel.emitFromWorker({
            t: 'ack',
            seq: sent.seq,
            op: 'load',
            reply: { kind: 'ok' },
            tokens: { done: [], undone: [], deleted: [], restore: null },
        })
        expect(await loading).toEqual({ kind: 'failed' })
    })
})

describe('T-W9 mirror loss', () => {
    test('a save that names a token the worker does not hold is unwritable, calls no adapter, and the next save posts every entry and succeeds', async () => {
        const factory = new IDBFactory()
        const real = createStudioStoreIdb({ factory, pageSession: PAGE })
        const calls = { save: 0 }
        const adapter: StudioHistoryStore = {
            open: () => real.open(),
            load: (owner) => real.load(owner),
            save: (owner, record, protect) => {
                calls.save += 1
                return real.save(owner, record, protect)
            },
            onClosed: (callback) => real.onClosed(callback),
        }
        const rig = proxyRig({ factory, adapter })
        await openAndLoad(rig, A)
        let state = chainState(A, 1)
        expect(await rig.proxy.save(A, state.record, protectOnly(A))).toEqual(OK)

        // The second save never reaches the worker, but the proxy believes it did.
        rig.channel.dropNext('save')
        state = editDesc(state, 'st1', 4500, '0', '1')
        void rig.proxy.save(A, state.record, protectOnly(A))
        state = editDesc(state, 'st2', 7500, '1', '2')
        expect(await rig.proxy.save(A, state.record, protectOnly(A))).toEqual({ kind: 'unwritable' })
        expect(calls.save).toBe(1)

        expect(await rig.proxy.save(A, state.record, protectOnly(A))).toEqual(OK)
        expect(lastSave(rig.channel).put).toHaveLength(state.record.done.length + 1)
        expect(calls.save).toBe(2)
        expect(storedRecord(await readStoredMap(factory), A)?.record).toEqual(state.record)
    })

    // Each case introduces exactly one new token kind in the dropped save, so only that kind's check can
    // refuse the next save.
    test.each(['a deleted item', 'a restore point'])('a dropped save that introduced %s makes the next save unwritable with no adapter call', async (introduced) => {
        const factory = new IDBFactory()
        const real = createStudioStoreIdb({ factory, pageSession: PAGE })
        const calls = { save: 0 }
        const adapter: StudioHistoryStore = {
            open: () => real.open(),
            load: (owner) => real.load(owner),
            save: (owner, record, protect) => {
                calls.save += 1
                return real.save(owner, record, protect)
            },
            onClosed: (callback) => real.onClosed(callback),
        }
        const rig = proxyRig({ factory, adapter })
        await openAndLoad(rig, A)
        const base = chainState(A, 1)
        expect(base.record.restore).not.toBeNull()
        expect(await rig.proxy.save(A, base.record, protectOnly(A))).toEqual(OK)

        const withDeleted = removeGreeting(base, 'st1', 4500, 'del1').record
        expect(withDeleted.deleted).toHaveLength(1)
        const changed: OwnerRecord =
            introduced === 'a deleted item'
                ? { ...base.record, deleted: withDeleted.deleted }
                : { ...base.record, restore: { ...base.record.restore! } }

        rig.channel.dropNext('save')
        void rig.proxy.save(A, changed, protectOnly(A))
        expect(await rig.proxy.save(A, changed, protectOnly(A))).toEqual({ kind: 'unwritable' })
        expect(calls.save).toBe(1)

        expect(await rig.proxy.save(A, changed, protectOnly(A))).toEqual(OK)
        expect(calls.save).toBe(2)
        expect(storedRecord(await readStoredMap(factory), A)?.record).toEqual(changed)
    })
})

// ---------------------------------------------------------------- the identity delta

// Characters per long text. A save that sends a text once is about LONG characters; the oracle for "what a
// save carries" is `postedChars`, not a byte count.
const LONG = 20000

// `length` Hangul characters led by `mark`, so two texts of one length differ.
function hangul(length: number, mark: string): string {
    return `${mark}${'가'.repeat(length - mark.length)}`
}

// The string characters a posted message carries once structured-cloned: an object reachable twice counts
// once (the clone keeps shared objects shared), a string counts once per property that holds it.
function postedChars(message: unknown): number {
    const seen = new Set<object>()
    let total = 0
    const visit = (value: unknown): void => {
        if (typeof value === 'string') {
            total += value.length
            return
        }
        if (typeof value !== 'object' || value === null || seen.has(value)) {
            return
        }
        seen.add(value)
        for (const child of Array.isArray(value) ? value : Object.values(value)) {
            visit(child)
        }
    }
    visit(message)
    return total
}

interface Legs {
    direct: Leg
    rig: Rig
    viaWorker: Leg
}

function legsOf(): Legs {
    const direct = directLeg()
    const rig = proxyRig()
    return { direct, rig, viaWorker: { factory: rig.channel.factory, store: rig.proxy } }
}

async function openBoth(legs: Legs): Promise<void> {
    for (const leg of [legs.direct, legs.viaWorker]) {
        await leg.store.open()
        await leg.store.load(A)
    }
}

// Saves the record through both legs: the results are equal and so is every stored byte, key order included.
async function saveOnBoth(legs: Legs, record: OwnerRecord): Promise<SaveResult> {
    const result = await legs.direct.store.save(A, record, protectOnly(A))
    expect(await legs.viaWorker.store.save(A, record, protectOnly(A))).toEqual(result)
    expect(await readStoredMap(legs.viaWorker.factory)).toEqual(await readStoredMap(legs.direct.factory))
    return result
}

function deltaOf(message: SaveMessage, kind: 's' | 'r'): DeltaEntry {
    const found = message.delta.filter((entry) => entry.k === kind)
    expect(found).toHaveLength(1)
    return found[0]
}

function editPaths(entry: DeltaEntry): string[] {
    return entry.edits.map((edit) => edit[0].join('.')).sort()
}

// An owner whose first edit rewrote a long text, then a second edit within the coalescing window.
async function coalescedSave(): Promise<{ legs: Legs; first: SaveMessage; message: SaveMessage; state: ModelState }> {
    const legs = legsOf()
    await openBoth(legs)
    let state = editDesc(createModelState(emptyRecord(A, 0)), 'e1', 100, hangul(LONG, 'a'), 'x')
    expect(await saveOnBoth(legs, state.record)).toEqual(OK)
    const first = lastSave(legs.rig.channel)
    state = editDesc(state, 'e1b', 300, 'x', hangul(LONG, 'b'))
    expect(state.record.done).toHaveLength(1)
    expect(await saveOnBoth(legs, state.record)).toEqual(OK)
    return { legs, first, message: lastSave(legs.rig.channel), state }
}

describe('T-D identity delta: a changed entry travels as edits from the entry the worker holds', () => {
    test('T-D1 a coalesced desc save sends the step and the restore point as deltas against the previous top and restore point; the old top leaves', async () => {
        const { first, message } = await coalescedSave()
        expect(message.put).toEqual([])
        expect(kindsOf(message)).toEqual(['r', 's'])
        const step = deltaOf(message, 's')
        expect(step.base).toBe(first.done[0])
        expect(deltaOf(message, 'r').base).toBe(first.restore)
        expect(message.done).toEqual([step.tok])
        expect(message.done).not.toContain(first.done[0])
    })

    test('T-D2 the same save carries the new long text once', async () => {
        const { message } = await coalescedSave()
        expect(postedChars(message)).toBeLessThanOrEqual(LONG + 2048)
    })

    test('T-D3 an undo and a redo of a large step: bytes equal, and the moved step carries no text', async () => {
        const legs = legsOf()
        await openBoth(legs)
        let state = chainState(A, 3)
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        state = editDesc(state, 'big', 9000, hangul(LONG, 'a'), hangul(LONG, 'b'))
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        const big = lastSave(legs.rig.channel)

        state = replay(state, 'undo', 10000)
        expect(state.record.undone).toHaveLength(1)
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        const undo = lastSave(legs.rig.channel)
        expect(postedChars(undo)).toBeLessThanOrEqual(LONG + 2048)
        expect(deltaOf(undo, 's').base).toBe(big.done[big.done.length - 1])

        state = replay(state, 'redo', 11000)
        expect(state.record.undone).toHaveLength(0)
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        const redo = lastSave(legs.rig.channel)
        expect(postedChars(redo)).toBeLessThanOrEqual(LONG + 2048)
        expect(deltaOf(redo, 's').base).toBe(undo.undone[0])
    })

    test('T-D5 the first edit of a new visit on the same path: the restore point is four edits, two of them under fields.desc', async () => {
        const legs = legsOf()
        await openBoth(legs)
        let state = chainState(A, 2)
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        state = editDesc(state, 'st2', 20000, '1', hangul(50, 'z'), 'v2')
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        const message = lastSave(legs.rig.channel)
        expect(editPaths(deltaOf(message, 'r'))).toEqual(['at', 'fields.desc.before', 'fields.desc.last', 'visitId'])
        expect(message.put.map((entry) => entry.k)).toEqual(['s'])
    })

    test('T-D7 a greeting edit, then a greeting delete, in one visit: bytes equal, the shrunk list travels whole', async () => {
        const legs = legsOf()
        await openBoth(legs)
        let state = chainState(A, 1)
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        state = commitStep(state, {
            id: 'g1',
            at: 5000,
            visitId: 'v1',
            label: { kind: 'greetingEdit' },
            ops: [{ op: 'listSet', index: 0, before: '첫 인사', after: '첫 인사!' }],
            restoreWrites: [
                {
                    path: 'alternateGreetings',
                    before: { list: ['첫 인사', '둘째 인사'] },
                    after: { list: ['첫 인사!', '둘째 인사'] },
                },
            ],
            coalesceKey: 'greeting:0',
            replacesRestore: true,
        })
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        expect(editPaths(deltaOf(lastSave(legs.rig.channel), 'r'))).toEqual(['fields.alternateGreetings'])

        state = removeGreeting(state, 'g2', 9000, 'del1')
        expect(state.record.deleted).toHaveLength(1)
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        const message = lastSave(legs.rig.channel)
        expect(editPaths(deltaOf(message, 'r'))).toEqual(['fields.alternateGreetings.last.list'])
        expect(kindsOf(message)).toEqual(['d', 'r', 's'])
    })

    test('T-D4 (model) one commit that writes a known path and a new path: the known path is edited and the new one added, bytes equal', async () => {
        const legs = legsOf()
        await openBoth(legs)
        let state = editDesc(createModelState(emptyRecord(A, 0)), 'e1', 100, 'a', 'b')
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        const descBefore: FieldValue = { had: true, value: 'b' }
        const descAfter: FieldValue = { had: true, value: 'c' }
        const iconBefore: FieldValue = { had: false }
        const iconAfter: FieldValue = { had: true, value: true }
        state = commitStep(state, {
            id: 'm1',
            at: 5000,
            visitId: 'v1',
            label: { kind: 'restorePoint' },
            ops: [
                { op: 'set', path: 'desc', before: descBefore, after: descAfter },
                { op: 'set', path: 'hideChatIcon', before: iconBefore, after: iconAfter },
            ],
            restoreWrites: [
                { path: 'desc', before: descBefore, after: descAfter },
                { path: 'hideChatIcon', before: iconBefore, after: iconAfter },
            ],
            coalesceKey: null,
            replacesRestore: true,
        })
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        const edits = deltaOf(lastSave(legs.rig.channel), 'r').edits
        expect(edits.map((edit) => [edit[0].join('.'), edit[2] ?? 'set'])).toEqual([
            ['fields.desc.last', 'set'],
            ['fields.hideChatIcon', 'add'],
        ])
    })

    test('T-D9 a post that throws, then a coalesced save: the deltas are made against the last delivered save, and the bytes equal', async () => {
        const legs = legsOf()
        await openBoth(legs)
        let state = editDesc(createModelState(emptyRecord(A, 0)), 'e1', 100, hangul(LONG, 'a'), 'x')
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        const delivered = lastSave(legs.rig.channel)

        state = editDesc(state, 'e1b', 300, 'x', hangul(LONG, 'b'))
        legs.rig.channel.failPosts(new Error('postMessage failed'))
        expect(await legs.viaWorker.store.save(A, state.record, protectOnly(A))).toEqual({ kind: 'unwritable' })
        legs.rig.channel.failPosts(null)

        state = editDesc(state, 'e1c', 500, hangul(LONG, 'b'), hangul(LONG, 'c'))
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        const message = lastSave(legs.rig.channel)
        expect(deltaOf(message, 's').base).toBe(delivered.done[0])
        expect(deltaOf(message, 'r').base).toBe(delivered.restore)
        expect(message.put).toEqual([])
    })

    test('T-D10 a dropped save: the next delta names a base the worker lacks and is refused with no adapter call, and the save after it is whole and stored', async () => {
        const factory = new IDBFactory()
        const real = createStudioStoreIdb({ factory, pageSession: PAGE })
        const calls = { save: 0 }
        const adapter: StudioHistoryStore = {
            open: () => real.open(),
            load: (owner) => real.load(owner),
            save: (owner, record, protect) => {
                calls.save += 1
                return real.save(owner, record, protect)
            },
            onClosed: (callback) => real.onClosed(callback),
        }
        const rig = proxyRig({ factory, adapter })
        await openAndLoad(rig, A)
        let state = editDesc(createModelState(emptyRecord(A, 0)), 'e1', 100, hangul(LONG, 'a'), 'x')
        expect(await rig.proxy.save(A, state.record, protectOnly(A))).toEqual(OK)

        state = editDesc(state, 'e1b', 300, 'x', hangul(LONG, 'b'))
        rig.channel.dropNext('save')
        void rig.proxy.save(A, state.record, protectOnly(A))
        state = editDesc(state, 'e1c', 500, hangul(LONG, 'b'), hangul(LONG, 'c'))
        expect(await rig.proxy.save(A, state.record, protectOnly(A))).toEqual({ kind: 'unwritable' })
        expect(calls.save).toBe(1)

        expect(await rig.proxy.save(A, state.record, protectOnly(A))).toEqual(OK)
        const message = lastSave(rig.channel)
        expect(message.delta).toEqual([])
        expect(message.put).toHaveLength(state.record.done.length + 1)
        expect(calls.save).toBe(2)
        expect(storedRecord(await readStoredMap(factory), A)?.record).toEqual(state.record)
    })

    describe('T-D11 a fresh proxy that loaded a stored owner', () => {
        // Runs the edit on the direct adapter and through the worker on the same seeded database: equal bytes.
        async function editLoaded(stored: OwnerRecord, edit: (loaded: OwnerRecord) => OwnerRecord): Promise<StudioChannel> {
            const direct = directLeg()
            const rig = proxyRig()
            const viaWorker: Leg = { factory: rig.channel.factory, store: rig.proxy }
            for (const leg of [direct, viaWorker]) {
                await seedStored(leg, stored)
                await leg.store.open()
                const loaded = await leg.store.load(A)
                if (loaded.kind !== 'ok') {
                    throw new Error('the seeded owner did not load')
                }
                expect(await leg.store.save(A, edit(loaded.record), protectOnly(A))).toEqual(OK)
            }
            expect(await readStoredMap(viaWorker.factory)).toEqual(await readStoredMap(direct.factory))
            return rig.channel
        }

        const stored = editDesc(createModelState(emptyRecord(A, 0)), 'st0', 1500, hangul(LONG, 'a'), 'x').record

        test('(a) the first edit is a new visit: the restore point is a delta against the loaded restore point', async () => {
            const channel = await editLoaded(stored, (loaded) =>
                editDesc(createModelState(loaded), 'st1', 90000, 'x', 'y', 'v2').record,
            )
            const message = lastSave(channel)
            expect(deltaOf(message, 'r').base).toMatch(/^w/)
            expect(message.put.map((entry) => entry.k)).toEqual(['s'])
        })

        test('(b) an edit that coalesces with the loaded top carries the new text once', async () => {
            const channel = await editLoaded(stored, (loaded) => {
                const top = loaded.done[loaded.done.length - 1]
                const open = { stepId: top.id, key: 'desc', lastAt: top.at }
                return editDesc({ record: loaded, open }, 'st0b', top.at + 300, 'x', hangul(LONG, 'b'), loaded.restore!.visitId).record
            })
            const message = lastSave(channel)
            expect(postedChars(message)).toBeLessThanOrEqual(LONG + 2048)
            expect(deltaOf(message, 's').base).toMatch(/^w/)
            expect(deltaOf(message, 'r').base).toMatch(/^w/)
        })
    })

    test('T-D13 a long desc edit, then the first edit of another path in the same visit: only the new path travels, bytes equal', async () => {
        const legs = legsOf()
        await openBoth(legs)
        let state = editDesc(createModelState(emptyRecord(A, 0)), 'e1', 100, hangul(LONG, 'a'), hangul(LONG, 'b'))
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        const iconBefore: FieldValue = { had: false }
        const iconAfter: FieldValue = { had: true, value: true }
        state = commitStep(state, {
            id: 'icon1',
            at: 5000,
            visitId: 'v1',
            label: { kind: 'field', field: 'hideChatIcon' },
            ops: [{ op: 'set', path: 'hideChatIcon', before: iconBefore, after: iconAfter }],
            restoreWrites: [{ path: 'hideChatIcon', before: iconBefore, after: iconAfter }],
            coalesceKey: 'hideChatIcon',
            replacesRestore: true,
        })
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        const message = lastSave(legs.rig.channel)
        expect(postedChars(message)).toBeLessThanOrEqual(4096)
        expect(editPaths(deltaOf(message, 'r'))).toEqual(['fields.hideChatIcon'])
    })

    test('T-D14 a later step on the same path in one visit carries two texts, not three', async () => {
        const legs = legsOf()
        await openBoth(legs)
        let state = editDesc(createModelState(emptyRecord(A, 0)), 'e1', 100, hangul(LONG, 'a'), hangul(LONG, 'b'))
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        state = editDesc(state, 'e2', 3000, hangul(LONG, 'b'), hangul(LONG, 'c'))
        expect(state.record.done).toHaveLength(2)
        expect(await saveOnBoth(legs, state.record)).toEqual(OK)
        const message = lastSave(legs.rig.channel)
        expect(postedChars(message)).toBeLessThanOrEqual(2 * LONG + 2048)
        expect(editPaths(deltaOf(message, 'r'))).toEqual(['fields.desc.last'])
    })
})

describe('T-D4 the delta codec round-trips and keeps the next entry`s key order', () => {
    // Applies the diff to the base and checks the result is the next entry, key order included, with the base
    // untouched.
    function roundTrip(next: object, base: object): Edit[] {
        const edits = diffEntry(next, base)
        if (edits === null) {
            throw new Error('the pair did not diff')
        }
        const baseText = JSON.stringify(base)
        expect(JSON.stringify(applyEdits(base, edits))).toBe(JSON.stringify(next))
        expect(JSON.stringify(base)).toBe(baseText)
        return edits
    }

    test('(a) the same keys in another order at a nested node: the node is emitted whole', () => {
        const base = { id: 's', x: { a: 1, b: 2 }, y: 1 }
        const next = { id: 's', x: { b: 2, a: 1 }, y: 1 }
        expect(roundTrip(next, base)).toEqual([[['x'], { b: 2, a: 1 }]])
    })

    test('(b) arrays of unequal length are emitted whole', () => {
        expect(roundTrip({ l: [1, 2] }, { l: [1, 2, 3] })).toEqual([[['l'], [1, 2]]])
        expect(roundTrip({ l: [1, 2, 3, 4] }, { l: [1, 2, 3] })).toEqual([[['l'], [1, 2, 3, 4]]])
    })

    test('(c) a changed primitive inside a recursed node is one edit at its path', () => {
        expect(roundTrip({ n: { a: 1, b: 3 } }, { n: { a: 1, b: 2 } })).toEqual([[['n', 'b'], 3]])
        expect(roundTrip({ a: [{ x: 1 }, { x: 3 }] }, { a: [{ x: 1 }, { x: 2 }] })).toEqual([[['a', 1, 'x'], 3]])
    })

    test('(d) a changed field value is emitted whole, as next`s own object', () => {
        const base = { f: { had: true, value: 'x' } }
        const next = { f: { had: true, value: 'y' } }
        const edits = roundTrip(next, base)
        expect(edits).toHaveLength(1)
        expect(edits[0][0]).toEqual(['f'])
        expect(edits[0][1]).toBe(next.f)
    })

    test('(e1) keys added at the end are added in next`s order, and the base keys are still diffed', () => {
        const kept = { p: 1 }
        const base = { n: { a: 1, b: kept } }
        const next = { n: { a: 9, b: kept, z: 'zz', m: { q: 1 } } }
        expect(roundTrip(next, base)).toEqual([
            [['n', 'a'], 9],
            [['n', 'z'], 'zz', 'add'],
            [['n', 'm'], { q: 1 }, 'add'],
        ])
    })

    test('(e2) a key inserted before an existing one is emitted whole; a root never grows keys', () => {
        const base = { n: { a: 1, b: 2 } }
        const next = { n: { a: 1, x: 5, b: 2 } }
        expect(roundTrip(next, base)).toEqual([[['n'], { a: 1, x: 5, b: 2 }]])
        expect(diffEntry({ a: 1, b: 2 }, { a: 1 })).toBeNull()
        expect(diffEntry({ b: 1, a: 1 }, { a: 1, b: 1 })).toBeNull()
    })

    test('(f) a field value that gains its value is one whole edit, not a recursed add', () => {
        const base = { f: { had: false } }
        const next = { f: { had: true, value: 'v' } }
        const edits = roundTrip(next, base)
        expect(edits).toHaveLength(1)
        expect(edits[0][0]).toEqual(['f'])
        expect(edits[0][1]).toBe(next.f)
        expect(edits[0][2]).toBeUndefined()
        expect(roundTrip(base, next)).toHaveLength(1)
    })

    test('(g) two edits under one nested container: both apply, the untouched subtree shared with the base', () => {
        const untouched = { k: 1 }
        const base = { n: { a: 1, b: 2, c: 3 }, u: untouched }
        const next = { n: { a: 9, b: 2, c: 8 }, u: untouched }
        const edits = roundTrip(next, base)
        expect(edits).toEqual([
            [['n', 'a'], 9],
            [['n', 'c'], 8],
        ])
        const applied = applyEdits(base, edits)
        expect(applied.u).toBe(untouched)
        expect(applied.n).not.toBe(base.n)
    })

    test('(h) null against an object, in both directions, is one whole edit and does not throw', () => {
        expect(roundTrip({ n: null }, { n: { a: 1 } })).toEqual([[['n'], null]])
        expect(roundTrip({ n: { a: 1 } }, { n: null })).toEqual([[['n'], { a: 1 }]])
        expect(roundTrip({ l: [null, 2] }, { l: [{ a: 1 }, 2] })).toEqual([[['l', 0], null]])
    })

    test('a change below the depth limit is emitted whole at that depth', () => {
        const nest = (depth: number, leaf: number): object => (depth === 0 ? { leaf } : { c: nest(depth - 1, leaf) })
        const edits = roundTrip(nest(MAX_DELTA_DEPTH + 2, 2), nest(MAX_DELTA_DEPTH + 2, 1))
        expect(edits).toHaveLength(1)
        expect(edits[0][0]).toHaveLength(MAX_DELTA_DEPTH)
    })
})

describe('T-D12 the worker host answers mirrorLost to a delta it cannot apply', () => {
    interface HostRig {
        handle: (message: SaveMessage) => Promise<FromWorker | undefined>
        saves: { count: number; last: OwnerRecord | null }
    }

    // A host over an adapter double that accepts every save, and its first save: one step `b0` and the restore
    // point `br`, whole.
    async function hostWithMirror(): Promise<HostRig & { base: OwnerRecord }> {
        const acks: FromWorker[] = []
        const saves: { count: number; last: OwnerRecord | null } = { count: 0, last: null }
        const adapter: StudioHistoryStore = {
            open: async () => 'ok',
            load: async () => ABSENT,
            save: async (_owner, record) => {
                saves.count += 1
                saves.last = record
                return OK
            },
            onClosed: () => {},
        }
        const host = createStudioStoreHost(adapter, (message) => acks.push(message))
        const handle = async (message: SaveMessage): Promise<FromWorker | undefined> => {
            const before = acks.length
            host.handle(message)
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
            return acks.length > before ? acks[acks.length - 1] : undefined
        }
        const base = chainState(A, 1).record
        const first = await handle(saveMessage(1, base, [], 'b0', 'br'))
        expect(first).toMatchObject({ t: 'ack', seq: 1, op: 'save', reply: OK })
        return { handle, saves, base }
    }

    // `done` and `restore` name tokens; the base record's entries are put whole when `whole` is not given.
    function saveMessage(seq: number, record: OwnerRecord, delta: DeltaEntry[], done: string, restore: string): SaveMessage {
        return {
            t: 'save',
            seq,
            owner: A,
            ownerKey: A,
            touchedAt: record.touchedAt,
            protect: [A],
            done: [done],
            undone: [],
            deleted: [],
            restore,
            put:
                delta.length === 0 && done === 'b0'
                    ? [
                          { k: 's', tok: 'b0', value: record.done[0] },
                          { k: 'r', tok: 'br', value: record.restore! },
                      ]
                    : [],
            delta,
        }
    }

    const refused: [string, DeltaEntry, string, string][] = [
        ['(a) an unknown base, the new token listed', { k: 's', tok: 'n1', base: 'nobase', edits: [] }, 'n1', 'br'],
        ['(a) an unknown base, the new token not listed', { k: 's', tok: 'n1', base: 'nobase', edits: [] }, 'b0', 'br'],
        ['(b) a set path absent from the base', { k: 's', tok: 'n1', base: 'b0', edits: [[['nothing'], 1]] }, 'n1', 'br'],
        ['(b) a nested set path absent from the base', { k: 's', tok: 'n1', base: 'b0', edits: [[['ops', 0, 'nothing'], 1]] }, 'n1', 'br'],
        ['(c) a step delta over a restore point, no edits', { k: 's', tok: 'n1', base: 'br', edits: [] }, 'n1', 'br'],
        ['(c) a step delta over a restore point, one edit', { k: 's', tok: 'n1', base: 'br', edits: [[['at'], 5]] }, 'n1', 'br'],
        ['(c) a restore delta over a step, no edits', { k: 'r', tok: 'nr', base: 'b0', edits: [] }, 'b0', 'nr'],
        ['(c) a restore delta over a step, one edit', { k: 'r', tok: 'nr', base: 'b0', edits: [[['at'], 5]] }, 'b0', 'nr'],
        [
            '(d) an add on a key the base has',
            { k: 'r', tok: 'nr', base: 'br', edits: [[['fields', 'desc'], { before: { had: false }, last: { had: false } }, 'add']] },
            'b0',
            'nr',
        ],
        [
            '(e1) an add of __proto__',
            { k: 'r', tok: 'nr', base: 'br', edits: [[['fields', '__proto__'], { before: { had: false }, last: { had: false } }, 'add']] },
            'b0',
            'nr',
        ],
        ['(e2) an add under an array parent with a string key', { k: 's', tok: 'n1', base: 'b0', edits: [[['ops', '1'], { op: 'x' }, 'add']] }, 'n1', 'br'],
        [
            '(f) an add whose intermediate container is missing',
            { k: 'r', tok: 'nr', base: 'br', edits: [[['fields', 'hideChatIcon', 'last'], { had: false }, 'add']] },
            'b0',
            'nr',
        ],
        ['(g) an edit with a mode other than add', { k: 's', tok: 'n1', base: 'b0', edits: [[['at'], 5, 'zap' as 'add']] }, 'n1', 'br'],
    ]

    test.each(refused)('%s', async (_label, delta, done, restore) => {
        const rig = await hostWithMirror()
        const reply = await rig.handle(saveMessage(2, rig.base, [delta], done, restore))
        expect(reply).toEqual({ t: 'ack', seq: 2, op: 'save', reply: { kind: 'unwritable', mirrorLost: true } })
        expect(rig.saves.count).toBe(1)

        // The mirror is gone, so the owner's next save is whole and stored: no livelock.
        const next = await rig.handle(saveMessage(3, rig.base, [], 'b0', 'br'))
        expect(next).toMatchObject({ t: 'ack', seq: 3, op: 'save', reply: OK })
        expect(rig.saves.count).toBe(2)
    })

    test('a delta that fits is applied to a copy: the stored record has the edit and the base entry is untouched', async () => {
        const rig = await hostWithMirror()
        const reply = await rig.handle(saveMessage(2, rig.base, [{ k: 's', tok: 'n1', base: 'b0', edits: [[['at'], 7]] }], 'n1', 'br'))
        expect(reply).toMatchObject({ t: 'ack', seq: 2, op: 'save', reply: OK })
        expect(rig.saves.count).toBe(2)
        expect(rig.saves.last?.done[0]).toEqual({ ...rig.base.done[0], at: 7 })

        // The base token b0 left the mirror in that save, and the one before it is still the first save's entry.
        const again = await rig.handle(saveMessage(3, rig.base, [{ k: 's', tok: 'n2', base: 'n1', edits: [[['at'], 8]] }], 'n2', 'br'))
        expect(again).toMatchObject({ t: 'ack', seq: 3, op: 'save', reply: OK })
        expect(rig.saves.last?.done[0]).toEqual({ ...rig.base.done[0], at: 8 })
        expect(rig.base.done[0].at).not.toBe(7)
    })
})

describe('T-W10 the channel double isolates the two sides', () => {
    test('a change made after the post is seen neither in the posted message nor in what is stored', async () => {
        const rig = proxyRig()
        await openAndLoad(rig, A)
        const record = chain(A, 2)
        const original = record.done[0].at
        const pending = rig.proxy.save(A, record, protectOnly(A))
        record.done[0].at = 777
        expect(await pending).toEqual(OK)
        const posted = lastSave(rig.channel).put.find((entry) => entry.k === 's' && entry.value.id === 'st0')
        expect(posted?.value).toMatchObject({ at: original })
        expect(storedRecord(await readStoredMap(rig.channel.factory), A)?.record.done[0].at).toBe(original)
    })
})
