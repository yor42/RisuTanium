// @vitest-environment node
/**
 * The GC pass: it deletes only what the mark of ONE commit-key read leaves
 * unnamed, every batch carries that read's token, and every refusal or stop
 * leaves the store as it was. Backends: memory, IndexedDB (fake-indexeddb), the
 * Node backend against the real server process, and the Tauri backend over the
 * desktop command and file system stand-ins (not evidence about the Rust commands).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => {
    const CAP_BYTES = 4 * 1024 * 1024
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const fake = await import('src/ts/storage/tests/tauriDesktopFake')
    const desktop = fake.createDesktopInvoke(fs, { cap: CAP_BYTES })
    const bounded = fake.createBoundedFs(fs, { cap: CAP_BYTES })
    const paths = (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths()
    async function invoke(command: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<unknown> {
        if (command !== 'write_durable') {
            return desktop.invoke(command, args, options)
        }
        await desktop.invoke(command, args, options)
        return { flushed: true }
    }
    return { fs, desktop, bounded, paths, invoke }
})

vi.mock('@tauri-apps/plugin-fs', () => h.bounded.module)
vi.mock('@tauri-apps/api/path', () => h.paths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({ ...h.paths.coreModule, invoke: h.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { createTauriBackend } from 'src/ts/storage/store2/backend'
import { crc32 } from 'src/ts/storage/blockFrame'
import {
    Store2BackendFailureError, Store2UnitConflictError, Store2UnknownOutcomeError, type Store2Backend,
} from 'src/ts/storage/store2/backend'
import { classifyCommitRead, firstCommitKey } from 'src/ts/storage/store2/commitKey'
import {
    encodeUnit, newStagedKey, newStagingId, newUnitKey, refOfFrame, stagingPrefix, tailOfKey, UNIT_TYPE,
} from 'src/ts/storage/store2/format'
import { gcPass, type GcDeps, type GcResult } from 'src/ts/storage/store2/gc/pass'
import {
    committerOf, COMMIT_BACKENDS, createClock, expectInvariant, hooked, plantKey, seedStore, START_TIME, testEnv, treeRequest, buildTree,
    type BuildRecord, type OpenedBackend,
} from './commitFixtures'
import { plantFence, traced } from './fenceFixtures'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const opened: OpenedBackend[] = []

afterEach(async () => {
    await Promise.all(opened.splice(0).map(entry => entry.close()))
})

const clock = createClock()
const env = testEnv(clock, 4242)
let peerSeed = 7000

const GARBAGE = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 255, 254, 253, 252, 251, 250, 249])

function fenceOf(keys: readonly string[]): Uint8Array {
    return encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: START_TIME, priorCommits: [], keys: keys.map(tailOfKey) })
}

function withCodec(bytes: Uint8Array, codec: number): Uint8Array {
    const out = new Uint8Array(bytes)
    out[6] = codec
    new DataView(out.buffer).setUint32(12, crc32(out.subarray(0, 12)), true)
    return out
}

function depsOf(backend: Store2Backend, kind: GcDeps['kind'], extra: Partial<GcDeps> = {}): GcDeps {
    return {
        backend,
        kind,
        idleReason: () => null,
        probe: kind === 'node' ? async () => ({ checkOnly: true, retire: true, pieces: false }) : undefined,
        ...extra,
    }
}

async function orphan(backend: Store2Backend): Promise<string> {
    const key = newUnitKey(env)
    await backend.putUnit(key, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan: key }))
    return key
}

async function exists(backend: Store2Backend, key: string): Promise<boolean> {
    return (await backend.readUnits([key])).get(key) !== null
}

/** A peer commits a complete new tree; returns every key of it. */
async function landCommit(backend: Store2Backend): Promise<string[]> {
    const record: BuildRecord[] = []
    const committer = committerOf(backend, clock, peerSeed++)
    const result = await committer.commit(await backend.readCommit(), treeRequest(0, { record }))
    expect(result.status).toBe('committed')
    return record[0].keys
}

function done(result: GcResult): Extract<GcResult, { status: 'done' }> {
    if (result.status !== 'done') {
        throw new Error(`The pass was refused: ${result.reason}.`)
    }
    return result
}

describe.each(COMMIT_BACKENDS.map(fixture => [fixture.name, fixture] as const))('GC pass on the %s backend', (name, fixture) => {
    const kind = name === 'node' ? 'node' : 'indexeddb'

    async function open(): Promise<Store2Backend> {
        const entry = await fixture.open()
        opened.push(entry)
        return entry.backend
    }

    async function seeded(): Promise<{ backend: Store2Backend, manifest: string }> {
        const backend = await open()
        const manifest = await seedStore(backend, env)
        return { backend, manifest }
    }

    test('garbage is collected and every unit of the current tree stays', async () => {
        const { backend } = await seeded()
        const before = await backend.listStore2()
        const junk = [await orphan(backend), await orphan(backend)]

        const result = done(await gcPass(depsOf(backend, kind)))

        expect(result).toEqual({ status: 'done', deleted: 2, batches: 1 })
        expect(await backend.listStore2()).toEqual(before)
        for (const key of junk) {
            expect(await exists(backend, key)).toBe(false)
        }
        await expectInvariant(backend)
    })

    test('retained and pinned manifests keep their units', async () => {
        const { backend, manifest } = await seeded()
        const pinned = await committerOf(backend, clock, peerSeed++).pin(await backend.readCommit(), manifest, 'test')
        expect(pinned.status).toBe('committed')
        const seedKeys = await backend.listStore2()
        const superseded = [...await landCommit(backend), ...await landCommit(backend)]
        const kept = await landCommit(backend)
        const junk = await orphan(backend)

        const result = done(await gcPass(depsOf(backend, kind)))

        // Only the current tree and the pinned seed tree are named; the two trees between them are garbage with the orphan.
        expect(result.deleted).toBe(superseded.length + 1)
        for (const key of [...seedKeys, ...kept]) {
            expect(await exists(backend, key)).toBe(true)
        }
        expect(await exists(backend, junk)).toBe(false)
        await expectInvariant(backend)
    })

    test('a key a standing fence names is kept, and an unnamed orphan beside it is collected', async () => {
        const { backend } = await seeded()
        const fenced = await orphan(backend)
        const other = await orphan(backend)
        await plantFence(backend, fenceOf([fenced]))

        const result = done(await gcPass(depsOf(backend, kind)))

        expect(result.deleted).toBe(1)
        expect(await exists(backend, fenced)).toBe(true)
        expect(await exists(backend, other)).toBe(false)
    })

    test('a fence that was created and then discarded leaves a revision the batch still honours', async () => {
        const { backend } = await seeded()
        await plantFence(backend, fenceOf([]))
        await plantFence(backend, null)
        const junk = await orphan(backend)

        expect(done(await gcPass(depsOf(backend, kind))).deleted).toBe(1)
        expect(await exists(backend, junk)).toBe(false)
    })

    test('keys under the standing staging prefix are kept', async () => {
        const { backend } = await seeded()
        const parsed = classifyCommitRead(await backend.readCommit())
        if (parsed.status !== 'parsed') {
            throw new Error('The seeded commit key does not parse.')
        }
        const stagingId = newStagingId(env)
        const marker = { owner: 'b'.repeat(26), prefix: stagingPrefix(stagingId), startedAt: START_TIME, label: 'bulk' } as const
        await plantKey(backend, firstCommitKey({ current: parsed.value.current, staging: marker }, env))
        const staged = newStagedKey(stagingId, 'u', env)
        await backend.putUnit(staged, encodeUnit(UNIT_TYPE.preset, { v: 1 }))
        const junk = await orphan(backend)

        const result = done(await gcPass(depsOf(backend, kind)))

        expect(result.deleted).toBe(1)
        expect(await exists(backend, staged)).toBe(true)
        expect(await exists(backend, junk)).toBe(false)
    })

    test('more than one batch of candidates is deleted in several batches', async () => {
        const { backend } = await seeded()
        const junk: string[] = []
        for (let i = 0; i < 60; i++) {
            junk.push(await orphan(backend))
        }
        const watched = hooked(backend)

        const result = done(await gcPass(depsOf(watched.backend, kind)))

        expect(result).toEqual({ status: 'done', deleted: 60, batches: 3 })
        expect(watched.log.filter(call => call === 'removeBatch')).toHaveLength(3)
        expect((await backend.listStore2()).filter(key => junk.includes(key))).toEqual([])
    })

    test('the pacing hook runs between batches and not before the first or after the last', async () => {
        const { backend } = await seeded()
        for (let i = 0; i < 30; i++) {
            await orphan(backend)
        }
        const pace = vi.fn(async () => {})

        done(await gcPass(depsOf(backend, kind, { pace })))

        expect(pace).toHaveBeenCalledTimes(1)
    })

    describe('refusals delete nothing', () => {
        async function expectRefused(backend: Store2Backend, deps: GcDeps, reason: string): Promise<void> {
            const junk = await orphan(backend)
            const before = await backend.listStore2()
            const result = await gcPass(deps)

            expect(result.status === 'refused' && result.reason).toBe(reason)
            expect(await backend.listStore2()).toEqual(before)
            expect(await exists(backend, junk)).toBe(true)
        }

        test('an absent commit key', async () => {
            const backend = await open()
            await expectRefused(backend, depsOf(backend, kind), 'mark-refused')
        })

        test('an unparsable commit key', async () => {
            const { backend } = await seeded()
            await backend.casCommit((await backend.readCommit()).token, GARBAGE)
            await expectRefused(backend, depsOf(backend, kind), 'mark-refused')
        })

        test('a too-new commit key', async () => {
            const { backend } = await seeded()
            const stored = (await backend.readCommit()).bytes as Uint8Array
            await backend.casCommit((await backend.readCommit()).token, withCodec(stored, 1))
            await expectRefused(backend, depsOf(backend, kind), 'mark-refused')
        })

        test('a commit key that names no current', async () => {
            const { backend } = await seeded()
            await plantKey(backend, firstCommitKey({ current: null, staging: null }, env))
            await expectRefused(backend, depsOf(backend, kind), 'no-current')
        })

        test.each([
            ['an unparsable', GARBAGE, 'fence-unparsable'],
            ['a too-new', withCodec(fenceOf([]), 1), 'fence-too-new'],
        ] as const)('%s fence', async (_label, bytes, reason) => {
            const { backend } = await seeded()
            await plantFence(backend, bytes)
            await expectRefused(backend, depsOf(backend, kind), reason)
        })

        test('a fence that cannot be read', async () => {
            const { backend } = await seeded()
            const failing = traced(backend, { failReadFence: true })
            await expectRefused(backend, depsOf(failing.backend, kind), 'fence-unreadable')
        })

        test('a commit key that cannot be read', async () => {
            const { backend } = await seeded()
            const failing = hooked(backend, { before: (call) => {
                if (call === 'readCommit') {
                    throw new Store2BackendFailureError('Injected commit read failure.')
                }
            } })
            await expectRefused(backend, depsOf(failing.backend, kind), 'commit-unreadable')
        })

        test('a listing that fails', async () => {
            const { backend } = await seeded()
            const failing = traced(backend, { failList: true })
            await expectRefused(backend, depsOf(failing.backend, kind), 'list-failed')
        })

        test('an idle session, read live at the pass', async () => {
            const { backend } = await seeded()
            await expectRefused(backend, depsOf(backend, kind, { idleReason: () => 'not flushed' }), 'idle')
        })

        test('a tree whose shard is missing', async () => {
            const { backend } = await seeded()
            const shardKey = (await backend.listStore2()).find(key => key.startsWith('store2/s-')) as string
            const read = await backend.readCommit()
            const fence = await backend.readFence()
            await backend.removeBatch([shardKey], read.token, fence.token)
            await expectRefused(backend, depsOf(backend, kind), 'mark-refused')
        })
    })

    describe('a change after the read', () => {
        test('a commit landing between the mark and the batches is never deleted (F1)', async () => {
            const { backend } = await seeded()
            const junk = await orphan(backend)
            let landed: string[] = []
            const watched = hooked(backend, { after: async (call, count) => {
                if (call === 'readFence' && count === 1) {
                    landed = await landCommit(backend)
                }
            } })

            const result = done(await gcPass(depsOf(watched.backend, kind)))

            expect(landed.length).toBeGreaterThan(0)
            for (const key of landed) {
                expect(await exists(backend, key)).toBe(true)
            }
            expect(await exists(backend, junk)).toBe(false)
            expect(result.stopped).toBeUndefined()
            await expectInvariant(backend)
        })

        test('a commit landing after the rebuild\'s own read stops the pass and loses nothing', async () => {
            const { backend } = await seeded()
            const junk = await orphan(backend)
            const landed: string[][] = []
            const watched = hooked(backend, { after: async (call, count) => {
                if (call === 'readFence' && count <= 2) {
                    landed.push(await landCommit(backend))
                }
            } })

            const result = done(await gcPass(depsOf(watched.backend, kind)))

            expect(result.stopped).toBe('commit-conflict')
            expect(landed).toHaveLength(2)
            for (const key of landed.flat()) {
                expect(await exists(backend, key)).toBe(true)
            }
            expect(await exists(backend, junk)).toBe(true)
            await expectInvariant(backend)
        })

        test('a commit between two batches conflicts the next one, the pass rebuilds and the new units survive', async () => {
            const { backend } = await seeded()
            const junk: string[] = []
            for (let i = 0; i < 30; i++) {
                junk.push(await orphan(backend))
            }
            let landed: string[] = []
            const watched = hooked(backend, { after: async (call, count) => {
                if (call === 'removeBatch' && count === 1) {
                    landed = await landCommit(backend)
                }
            } })

            const result = done(await gcPass(depsOf(watched.backend, kind)))

            expect(result).toEqual({ status: 'done', deleted: 30, batches: 2 })
            for (const key of landed) {
                expect(await exists(backend, key)).toBe(true)
            }
            expect((await backend.listStore2()).filter(key => junk.includes(key))).toEqual([])
            await expectInvariant(backend)
        })

        test('a rebuild round refused after earlier deletions keeps its reason, and the idle flag is read at every attempt', async () => {
            const { backend } = await seeded()
            const junk: string[] = []
            for (let i = 0; i < 30; i++) {
                junk.push(await orphan(backend))
            }
            let landed: string[] = []
            let idle: string | null = null
            const watched = hooked(backend, { after: async (call, count) => {
                if (call === 'removeBatch' && count === 1) {
                    landed = await landCommit(backend)
                    idle = 'not flushed'
                }
            } })

            const result = done(await gcPass(depsOf(watched.backend, kind, { idleReason: () => idle })))

            expect(result).toEqual({
                status: 'done', deleted: 25, batches: 1, stopped: 'refused', refusal: { reason: 'idle', detail: 'not flushed' },
            })
            for (const key of landed) {
                expect(await exists(backend, key)).toBe(true)
            }
            expect((await backend.listStore2()).filter(key => junk.includes(key))).toHaveLength(5)
        })

        test('a fence written after the fence read conflicts the batch and deletes nothing', async () => {
            const { backend } = await seeded()
            const junk = await orphan(backend)
            const watched = hooked(backend, { after: async (call, count) => {
                if (call === 'readFence' && count === 1) {
                    await plantFence(backend, fenceOf([junk]))
                }
            } })

            const result = done(await gcPass(depsOf(watched.backend, kind)))

            expect(result).toEqual({ status: 'done', deleted: 0, batches: 0, stopped: 'fence-conflict' })
            expect(await exists(backend, junk)).toBe(true)
        })

        test('the fence is read before the listing', async () => {
            const { backend } = await seeded()
            await orphan(backend)
            const watched = traced(backend)

            done(await gcPass(depsOf(watched.backend, kind)))

            expect(watched.log.indexOf('readFence')).toBeGreaterThanOrEqual(0)
            expect(watched.log.indexOf('readFence')).toBeLessThan(watched.log.indexOf('listStore2'))
        })

        test('a fence standing at the fence read keeps its keys even if it is discarded before the batch', async () => {
            const { backend } = await seeded()
            const fenced = await orphan(backend)
            await plantFence(backend, fenceOf([fenced]))
            const watched = hooked(backend, { after: async (call) => {
                if (call === 'listStore2') {
                    await plantFence(backend, null)
                }
            } })

            const result = done(await gcPass(depsOf(watched.backend, kind)))

            expect(result.deleted).toBe(0)
            expect(await exists(backend, fenced)).toBe(true)
        })
    })

    describe('batch failures', () => {
        test('a definite failure stops the pass', async () => {
            const { backend } = await seeded()
            const junk = await orphan(backend)
            const failing = hooked(backend, { before: (call) => {
                if (call === 'removeBatch') {
                    throw new Store2BackendFailureError('Injected.')
                }
            } })

            expect(done(await gcPass(depsOf(failing.backend, kind)))).toEqual({ status: 'done', deleted: 0, batches: 0, stopped: 'backend-failure' })
            expect(await exists(backend, junk)).toBe(true)
        })

        test('a unit conflict stops the pass', async () => {
            const { backend } = await seeded()
            const junk = await orphan(backend)
            const failing = hooked(backend, { before: (call) => {
                if (call === 'removeBatch') {
                    throw new Store2UnitConflictError(junk)
                }
            } })

            expect(done(await gcPass(depsOf(failing.backend, kind))).stopped).toBe('unit-conflict')
        })

        test('an unknown outcome abandons the pass after reading the commit key back', async () => {
            const { backend } = await seeded()
            await orphan(backend)
            const failing = hooked(backend, { before: (call) => {
                if (call === 'removeBatch') {
                    throw new Store2UnknownOutcomeError('Lost.')
                }
            } })

            const result = done(await gcPass(depsOf(failing.backend, kind)))

            expect(result).toEqual({ status: 'done', deleted: 0, batches: 0, stopped: 'unknown-outcome', commitMoved: false })
            expect(failing.log.filter(call => call === 'removeBatch')).toHaveLength(1)
            expect(failing.log.at(-1)).toBe('readCommit')
        })

        test('an unknown outcome reports a commit key that moved meanwhile', async () => {
            const { backend } = await seeded()
            await orphan(backend)
            const failing = hooked(backend, { after: async (call) => {
                if (call === 'removeBatch') {
                    await landCommit(backend)
                    throw new Store2UnknownOutcomeError('Lost.')
                }
            } })

            const result = done(await gcPass(depsOf(failing.backend, kind)))

            expect(result.stopped).toBe('unknown-outcome')
            expect(result.commitMoved).toBe(true)
        })
    })
})

describe('GC pass: Node capability probe', () => {
    test.each([
        ['no probe', undefined],
        ['check-only missing', async () => ({ checkOnly: false, retire: true, pieces: false })],
        ['retire missing', async () => ({ checkOnly: true, retire: false, pieces: false })],
        ['a failing probe', async () => { throw new Error('down') }],
    ] as const)('%s: refused before any read', async (_label, probe) => {
        const fixture = COMMIT_BACKENDS[0]
        const entry = await fixture.open()
        opened.push(entry)
        await seedStore(entry.backend, env)
        const junk = await orphan(entry.backend)
        const watched = hooked(entry.backend)

        const result = await gcPass({ backend: watched.backend, kind: 'node', idleReason: () => null, probe })

        expect(result.status === 'refused' && result.reason).toBe('capability-missing')
        expect(watched.log).toEqual([])
        expect(await exists(entry.backend, junk)).toBe(true)
    })
})

describe('GC pass: a malformed reference never reaches the gate', () => {
    test('a mark refused as malformed deletes nothing even though its closure is ok', async () => {
        const entry = await COMMIT_BACKENDS[0].open()
        opened.push(entry)
        const backend = entry.backend
        const built = buildTree(0, {
            mint: { shard: () => newUnitKey(env), unit: () => newUnitKey(env), manifest: () => `store2/m-${'0'.repeat(7)}${'a'.repeat(19)}` },
            seq: 1,
            now: START_TIME,
        }, 'bad')
        const bucket = built.units[1]
        const badBytes = encodeUnit(UNIT_TYPE.pluginStorageBucket, { v: 1, entries: [{ k: 'a', ref: ['', 1, 0] }] })
        built.manifest.body.fixed.pluginStorage.refs = [refOfFrame(bucket.key, badBytes)]
        for (const unit of built.units) {
            await backend.putUnit(unit.key, unit.key === bucket.key ? badBytes : unit.bytes)
        }
        await backend.putUnit(built.manifest.key, encodeUnit(UNIT_TYPE.manifest, built.manifest.body))
        await backend.casCommit((await backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, firstCommitKey({ current: { key: built.manifest.key, at: START_TIME }, staging: null, manifests: [built.manifest.body] }, env)))
        const junk = await orphan(backend)

        const result = await gcPass(depsOf(backend, 'indexeddb'))
        expect(result.status === 'refused' && result.reason).toBe('mark-refused')
        expect(await exists(backend, junk)).toBe(true)
    })
})

describe('GC pass on the Tauri backend (desktop stand-ins)', () => {
    beforeEach(() => {
        h.fs.reset()
        h.desktop.reset()
        h.bounded.reset()
        h.paths.reset()
        h.desktop.chunk.reportFlushes()
        h.fs.setPlatform('windows')
        resetByteTransportForTests()
    })

    async function openTauri(): Promise<Store2Backend> {
        return await createTauriBackend(createTauriFilesStore({ platform: 'windows' }))
    }

    test('garbage is collected and the units of the current tree stay', async () => {
        const backend = await openTauri()
        await seedStore(backend, env)
        const before = await backend.listStore2()
        const junk = [await orphan(backend), await orphan(backend)]

        const result = done(await gcPass(depsOf(backend, 'tauri')))

        expect(result).toEqual({ status: 'done', deleted: 2, batches: 1 })
        expect(await backend.listStore2()).toEqual(before)
        for (const key of junk) {
            expect(await exists(backend, key)).toBe(false)
        }
        await expectInvariant(backend)
    })

    test('a commit landing between two batches conflicts the next one under the mutex, the pass rebuilds and the new units survive', async () => {
        const backend = await openTauri()
        await seedStore(backend, env)
        const junk: string[] = []
        for (let i = 0; i < 30; i++) {
            junk.push(await orphan(backend))
        }
        let landed: string[] = []
        const watched = hooked(backend, { after: async (call, count) => {
            if (call === 'removeBatch' && count === 1) {
                landed = await landCommit(backend)
            }
        } })

        const result = done(await gcPass(depsOf(watched.backend, 'tauri')))

        expect(result).toEqual({ status: 'done', deleted: 30, batches: 2 })
        expect(landed.length).toBeGreaterThan(0)
        for (const key of landed) {
            expect(await exists(backend, key)).toBe(true)
        }
        expect((await backend.listStore2()).filter(key => junk.includes(key))).toEqual([])
        await expectInvariant(backend)
    })

    test('a commit landing between the mark and the batches is never deleted', async () => {
        const backend = await openTauri()
        await seedStore(backend, env)
        const junk = await orphan(backend)
        let landed: string[] = []
        const watched = hooked(backend, { after: async (call, count) => {
            if (call === 'readFence' && count === 1) {
                landed = await landCommit(backend)
            }
        } })

        done(await gcPass(depsOf(watched.backend, 'tauri')))

        for (const key of landed) {
            expect(await exists(backend, key)).toBe(true)
        }
        expect(await exists(backend, junk)).toBe(false)
        await expectInvariant(backend)
    })
})