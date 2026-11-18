// @vitest-environment node
/**
 * The streamed bulk commit over the memory backend: a build that uploads units as it goes through `put`, the shared
 * marker and final-write halves, and the refusals that keep a partial import from ever landing. Each test says what it
 * is: new behaviour of `commitStreamed` or a guard of its entry checks (the whole commit path has its own files).
 */
import { describe, expect, test } from 'vitest'
import { createMemoryBackend, Store2BackendFailureError, type Store2Backend } from 'src/ts/storage/store2/backend'
import { IMPORT_REPLACES_BASE, Store2BulkAbortError, type CommitResult, type StreamedCommitRequest } from 'src/ts/storage/store2/commit'
import { firstCommitKey } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, newShardKey, UNIT_TYPE } from 'src/ts/storage/store2/format'
import {
    buildTree, committerOf, createClock, expectInvariant, hooked, parsedCommit, plantCommit, seedStore, testEnv, treeRequest, treeUnitCount,
} from './commitFixtures'

const EXTRA = 6

/** A streamed request over `buildTree(EXTRA)`: the first `putCount` units go through `put`, the rest are the tail. */
function streamedRequest(options: {
    putCount?: number
    log?: string[]
    label?: StreamedCommitRequest['label']
} = {}): StreamedCommitRequest {
    const putCount = options.putCount ?? 4
    return {
        newUnits: treeUnitCount(EXTRA),
        label: options.label ?? 'import',
        force: true,
        carry: IMPORT_REPLACES_BASE,
        async build(context) {
            options.log?.push('build')
            const built = buildTree(EXTRA, context, 'streamed')
            const head = built.units.slice(0, putCount)
            for (const unit of head) {
                await context.put(unit)
            }
            options.log?.push('tail-ready')
            return { units: built.units.slice(putCount), manifest: built.manifest }
        },
    }
}

async function setup() {
    const backend = createMemoryBackend()
    const clock = createClock()
    const m0 = await seedStore(backend, testEnv(clock, 1))
    const wrapped = hooked(backend)
    const committer = committerOf(wrapped.backend, clock, 100)
    const streaming = committer.commitStreamed
    if (streaming === undefined) {
        throw new Error('The committer has no commitStreamed.')
    }
    return { raw: backend, wrapped, committer, m0, clock, commitStreamed: streaming, env: testEnv(clock, 300) }
}

function expectCommitted(result: CommitResult): Extract<CommitResult, { status: 'committed' }> {
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') {
        throw new Error(`Expected committed, got ${result.status}.`)
    }
    return result
}

describe('commitStreamed', () => {
    test('T-C3: the marker CAS and its read-back precede the build, the puts precede the tail, the manifest is last and the final CAS follows; the marker carries the request label', async () => {
        const { raw, wrapped, committer, commitStreamed, m0 } = await setup()
        const read = await committer.readCommit()
        const log = wrapped.log
        log.length = 0
        let markerLabel: string | null = null
        let markerCurrent: string | null = null
        const request = streamedRequest({ putCount: 4, log })
        const result = expectCommitted(await commitStreamed(read, {
            ...request,
            build: async (context) => {
                const key = await parsedCommit(raw)
                markerLabel = key.staging?.label ?? null
                markerCurrent = key.current?.key ?? null
                return request.build(context)
            },
        }))
        const total = treeUnitCount(EXTRA)
        expect(log).toEqual([
            'casCommit', 'readCommit', 'build',
            ...Array<string>(4).fill('putUnit'), 'tail-ready',
            ...Array<string>(total - 4).fill('putUnit'),
            'casCommit',
        ])
        expect(markerLabel).toBe('import')
        expect(markerCurrent).toBe(m0)
        const after = await parsedCommit(raw)
        expect(after.staging).toBeNull()
        expect(after.current?.key).toBe(result.manifestKey)
        expect(result.mode).toBe('bulk')
        expect(after.retained.map(entry => entry.key)).toEqual([m0])
        await expectInvariant(raw)
    })

    test('T-C3: the manifest is the last unit put', async () => {
        const backend = createMemoryBackend()
        const clock = createClock()
        await seedStore(backend, testEnv(clock, 1))
        const putKeys: string[] = []
        const spy: Store2Backend = { ...backend, putUnit: (key, bytes) => { putKeys.push(key); return backend.putUnit(key, bytes) } }
        const committer = committerOf(spy, clock, 7)
        const commitStreamed = committer.commitStreamed as NonNullable<typeof committer.commitStreamed>
        const result = expectCommitted(await commitStreamed(await committer.readCommit(), streamedRequest({ putCount: 2 })))
        expect(putKeys.at(-1)).toBe(result.manifestKey)
        expect(putKeys).toHaveLength(treeUnitCount(EXTRA))
    })

    test('T-C1: a put of a key this attempt did not issue is a build throw: Store2BulkAbortError over the TypeError, the marker cleared, the base intact', async () => {
        const { raw, wrapped, committer, commitStreamed, m0, env } = await setup()
        const read = await committer.readCommit()
        const before = await parsedCommit(raw)
        wrapped.log.length = 0
        const request = streamedRequest()
        const stray = { key: newShardKey(env), bytes: encodeUnit(UNIT_TYPE.shard, { v: 1, entries: [] }) }
        const error = await commitStreamed(read, {
            ...request,
            build: async (context) => {
                await context.put(stray)
                return request.build(context)
            },
        }).catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(Store2BulkAbortError)
        const abort = error as Store2BulkAbortError
        expect(abort.original).toBeInstanceOf(TypeError)
        expect(abort.cleared?.status).toBe('cleared')
        expect(wrapped.log).not.toContain('putUnit')
        const after = await parsedCommit(raw)
        expect(after.staging).toBeNull()
        expect(after.current?.key).toBe(m0)
        expect(after.seq).toBe(before.seq + 2)
    })

    test('T-C1: a repeated put and a put past newUnits - 1 are build throws too', async () => {
        const { raw, committer, commitStreamed, m0 } = await setup()
        const request = streamedRequest()
        const repeated = await commitStreamed(await committer.readCommit(), {
            ...request,
            build: async (context) => {
                const unit = buildTree(EXTRA, context, 'x').units[0]
                await context.put(unit)
                await context.put(unit)
                return request.build(context)
            },
        }).catch((caught: unknown) => caught)
        expect(repeated).toBeInstanceOf(Store2BulkAbortError)
        expect((repeated as Store2BulkAbortError).original).toBeInstanceOf(TypeError)

        const over = await commitStreamed(await committer.readCommit(), {
            ...request,
            build: async (context) => {
                const built = buildTree(EXTRA, context, 'x')
                for (let i = 0; i < treeUnitCount(EXTRA); i++) {
                    await context.put({ key: context.mint.unit(), bytes: built.units[0].bytes })
                }
                return built
            },
        }).catch((caught: unknown) => caught)
        expect(over).toBeInstanceOf(Store2BulkAbortError)
        expect((over as Store2BulkAbortError).original).toBeInstanceOf(TypeError)
        expect((await parsedCommit(raw)).current?.key).toBe(m0)
        expect((await parsedCommit(raw)).staging).toBeNull()
    })

    test('T-C2: a unit count that differs from newUnits is refused bad-unit-set with the marker cleared, in both directions', async () => {
        const { raw, committer, commitStreamed, m0 } = await setup()
        for (const delta of [-1, 1]) {
            const request = streamedRequest()
            const result = await commitStreamed(await committer.readCommit(), {
                ...request,
                build: async (context) => {
                    const built = await request.build(context)
                    return delta < 0
                        ? { ...built, units: built.units.slice(1) }
                        : { ...built, units: [...built.units, { key: context.mint.unit(), bytes: built.units[0].bytes }] }
                },
            })
            expect(result.status).toBe('refused')
            if (result.status === 'refused') {
                expect(result.reason).toBe('bad-unit-set')
                expect(result.cleared?.status).toBe('cleared')
            }
            const key = await parsedCommit(raw)
            expect(key.staging).toBeNull()
            expect(key.current?.key).toBe(m0)
        }
    })

    test('T-C4: flush false and a backend failure on a put each return abandoned/upload-failed with the marker cleared, never a throw', async () => {
        for (const mode of ['flush-false', 'backend-error'] as const) {
            const backend = createMemoryBackend()
            const clock = createClock()
            const m0 = await seedStore(backend, testEnv(clock, 1))
            let puts = 0
            const failing: Store2Backend = {
                ...backend,
                async putUnit(key, bytes) {
                    puts += 1
                    if (puts === 3) {
                        if (mode === 'backend-error') {
                            throw new Store2BackendFailureError('The device refused the unit.')
                        }
                        await backend.putUnit(key, bytes)
                        return { flushed: false }
                    }
                    return backend.putUnit(key, bytes)
                },
            }
            const committer = committerOf(failing, clock, 100)
            const commitStreamed = committer.commitStreamed as NonNullable<typeof committer.commitStreamed>
            const result = await commitStreamed(await committer.readCommit(), streamedRequest({ putCount: 5 }))
            expect(result.status).toBe('abandoned')
            if (result.status === 'abandoned') {
                expect(result.reason).toBe('upload-failed')
                expect(result.cleared?.status).toBe('cleared')
                expect(result.cause).toBeInstanceOf(Store2BackendFailureError)
            }
            expect(puts).toBe(3)
            const key = await parsedCommit(backend)
            expect(key.staging).toBeNull()
            expect(key.current?.key).toBe(m0)
        }
    })

    test('T-C4: a build that swallows the stop of a failed put still ends abandoned/upload-failed', async () => {
        const backend = createMemoryBackend()
        const clock = createClock()
        await seedStore(backend, testEnv(clock, 1))
        const failing: Store2Backend = {
            ...backend,
            async putUnit(key, bytes) {
                await backend.putUnit(key, bytes)
                return { flushed: false }
            },
        }
        const committer = committerOf(failing, clock, 100)
        const commitStreamed = committer.commitStreamed as NonNullable<typeof committer.commitStreamed>
        const request = streamedRequest({ putCount: 3 })
        const result = await commitStreamed(await committer.readCommit(), {
            ...request,
            build: async (context) => {
                try {
                    return await request.build(context)
                } catch {
                    return { units: [], manifest: buildTree(EXTRA, context, 'swallowed').manifest }
                }
            },
        })
        expect(result.status).toBe('abandoned')
        expect((await parsedCommit(backend)).staging).toBeNull()
    })

    test('T-C5: a build throw is a Store2BulkAbortError with the original and the clear result, and the base is intact', async () => {
        const { raw, committer, commitStreamed, m0 } = await setup()
        const failure = new Error('the build failed')
        const request = streamedRequest()
        const error = await commitStreamed(await committer.readCommit(), {
            ...request,
            build: async (context) => {
                await context.put(buildTree(EXTRA, context, 'x').units[0])
                throw failure
            },
        }).catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(Store2BulkAbortError)
        expect((error as Store2BulkAbortError).original).toBe(failure)
        expect((error as Store2BulkAbortError).cleared?.status).toBe('cleared')
        const key = await parsedCommit(raw)
        expect(key.staging).toBeNull()
        expect(key.current?.key).toBe(m0)
    })

    test('T-C7: a tail unit that was already put is refused bad-unit-set, and a manifest key that is not a staged-manifest key is refused bad-manifest-key', async () => {
        const { raw, committer, commitStreamed, m0 } = await setup()
        const request = streamedRequest()
        const overlap = await commitStreamed(await committer.readCommit(), {
            ...request,
            build: async (context) => {
                const built = buildTree(EXTRA, context, 'overlap')
                await context.put(built.units[0])
                return { ...built, units: built.units.slice(0, built.units.length - 1) }
            },
        })
        expect(overlap.status).toBe('refused')
        if (overlap.status === 'refused') {
            expect(overlap.reason).toBe('bad-unit-set')
            expect(overlap.cleared?.status).toBe('cleared')
        }

        const shape = await commitStreamed(await committer.readCommit(), {
            ...request,
            build: async (context) => {
                const built = buildTree(EXTRA, { ...context, mint: { ...context.mint, manifest: () => context.mint.unit() } }, 'shape')
                await context.put(built.units[0])
                return { ...built, units: built.units.slice(1) }
            },
        })
        expect(shape.status).toBe('refused')
        if (shape.status === 'refused') {
            expect(shape.reason).toBe('bad-manifest-key')
            expect(shape.cleared?.status).toBe('cleared')
        }
        const key = await parsedCommit(raw)
        expect(key.staging).toBeNull()
        expect(key.current?.key).toBe(m0)
    })
})

describe('commitStreamed entry checks (T-C9, guard of commit\'s refusals)', () => {
    const states: { name: string, plant: (backend: Store2Backend) => Promise<void> }[] = [
        { name: 'absent', plant: async () => {} },
        { name: 'damaged', plant: async (backend) => plantCommit(backend, Uint8Array.from([1, 2, 3, 250, 251])) },
        { name: 'too-new', plant: async (backend) => {
            const seed = firstCommitKey({ current: { key: `store2/m-${'0'.repeat(26)}`, at: 1 }, staging: null })
            await plantCommit(backend, encodeUnit(UNIT_TYPE.commit, { ...seed, fmt: 2 }))
        } },
        { name: 'no-current', plant: async (backend) => {
            await plantCommit(backend, encodeUnit(UNIT_TYPE.commit, firstCommitKey({ current: null, staging: null })))
        } },
    ]

    test.each(states)('over a $name key the result equals commit\'s, no marker is written and build is not called', async ({ plant }) => {
        const backend = createMemoryBackend()
        const clock = createClock()
        await plant(backend)
        const wrapped = hooked(backend)
        const committer = committerOf(wrapped.backend, clock, 100)
        const commitStreamed = committer.commitStreamed as NonNullable<typeof committer.commitStreamed>
        const read = await committer.readCommit()
        wrapped.log.length = 0
        let built = false
        const request = { ...streamedRequest(), build: () => { built = true; throw new Error('unused') } }
        const streamedResult = await commitStreamed(read, request)
        const wholeResult = await committer.commit(read, treeRequest(EXTRA))
        expect(streamedResult.status).toBe('refused')
        expect(streamedResult).toEqual(wholeResult)
        expect(built).toBe(false)
        expect(wrapped.log).not.toContain('casCommit')
        expect(wrapped.log).not.toContain('putUnit')
    })

    test('a bad carry throws TypeError before any backend call', async () => {
        const backend = createMemoryBackend()
        const wrapped = hooked(backend)
        const committer = committerOf(wrapped.backend, createClock(), 100)
        const commitStreamed = committer.commitStreamed as NonNullable<typeof committer.commitStreamed>
        const read = await committer.readCommit()
        wrapped.log.length = 0
        const request = { ...streamedRequest(), carry: { from: 5, units: 0 } as unknown as StreamedCommitRequest['carry'] }
        await expect(commitStreamed(read, request)).rejects.toBeInstanceOf(TypeError)
        expect(wrapped.log).toEqual([])
    })
})
