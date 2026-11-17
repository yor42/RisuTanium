// @vitest-environment node
/**
 * The streamed installer over the memory backend, entered both ways a boot import enters it (the first-life grant and
 * the fenced exit marker): units uploaded as the build goes, the refusals that leave the marker standing, and the
 * upload failure that is a result, never a throw. Every test is new behaviour of `installStreamed`.
 */
import { describe, expect, test } from 'vitest'
import { createMemoryBackend, Store2BackendFailureError, type Store2Backend } from 'src/ts/storage/store2/backend'
import { classifyBoot, probeStore2Presence } from 'src/ts/storage/store2/boot'
import { Store2BulkAbortError } from 'src/ts/storage/store2/commit'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import {
    firstLifeGrant, firstLifeInstallStreamed, installStreamed, Store2InstallAbortError, writeFirstLifeMarker,
    type FirstLifeResult, type StreamedInstall,
} from 'src/ts/storage/store2/firstLife'
import { runExit } from 'src/ts/storage/store2/recovery'
import { buildTree, createClock, hooked, plantCommit, testEnv, treeUnitCount } from './commitFixtures'

const OWNER = 'a'.repeat(26)
const EXTRA = 6
const DAMAGED_COMMIT = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63])
const ABSENT_FENCE = { state: 'absent', token: { kind: 'bytes', bytes: null } } as const

type Entry = 'first-life' | 'exit'

interface Rig {
    backend: Store2Backend
    log: string[]
    /** Runs the install over the entry and returns its result. */
    run(request: StreamedInstall): Promise<FirstLifeResult>
    /** The commit key bytes now, and the staged keys the backend holds. */
    commitBytes(): Promise<Uint8Array | null>
    staged(): Promise<string[]>
}

async function rig(entry: Entry, wrap?: (inner: Store2Backend) => Store2Backend): Promise<Rig> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 11)
    if (entry === 'exit') {
        await plantCommit(memory, DAMAGED_COMMIT)
    }
    const spy = hooked(wrap === undefined ? memory : wrap(memory))
    const backend = spy.backend
    return {
        backend,
        log: spy.log,
        async run(request) {
            if (entry === 'first-life') {
                const read = await backend.readCommit()
                const commit = classifyCommitRead(read)
                const decision = classifyBoot({
                    commit, fence: ABSENT_FENCE, presence: await probeStore2Presence(backend), tree: null,
                    upstreamMainFile: false, ownerId: OWNER, deviceOwner: false,
                })
                if (!(decision.row === 1 && decision.mode === 'first-life')) {
                    throw new Error('The boot is not row 1.')
                }
                const granted = firstLifeGrant({ decision, commitRead: read, startupClear: null }, { label: 'import' })
                if (granted.status !== 'granted') {
                    throw new Error(`The grant was refused: ${granted.reason}.`)
                }
                return firstLifeInstallStreamed(backend, granted.grant, request, { owner: OWNER, env })
            }
            const exit = await runExit(backend, await backend.readCommit(), { kind: 'import' }, { owner: OWNER, env })
            if (exit.status !== 'marked') {
                throw new Error(`The exit ended ${exit.status}.`)
            }
            return installStreamed({ backend, env, marked: exit }, request)
        },
        commitBytes: async () => (await memory.readCommit()).bytes,
        staged: async () => (await memory.listStore2()).filter(key => key.startsWith('store2/g-')),
    }
}

/** The first `putCount` units of a `buildTree(EXTRA)` go through `put`; the rest are the tail. */
function streamedInstall(options: { putCount?: number, log?: string[], onBuild?: () => Promise<void> } = {}): StreamedInstall {
    const putCount = options.putCount ?? 4
    return {
        newUnits: treeUnitCount(EXTRA),
        convertedFrom: 'import',
        async build(context) {
            await options.onBuild?.()
            options.log?.push('build')
            const built = buildTree(EXTRA, context, 'streamed')
            for (const unit of built.units.slice(0, putCount)) {
                await context.put(unit)
            }
            options.log?.push('tail-ready')
            return { units: built.units.slice(putCount), manifest: built.manifest }
        },
    }
}

function labelOf(bytes: Uint8Array | null): string | null {
    if (bytes === null) {
        return null
    }
    const parsed = classifyCommitRead({ bytes })
    return parsed.status === 'parsed' ? parsed.value.staging?.label ?? null : null
}

describe.each(['first-life', 'exit'] as const)('installStreamed over the %s entry', (entry) => {
    test('T-C8(3): the marker CAS and its read-back precede the build, the puts the tail, the manifest is last, the final write follows, under the import label', async () => {
        const w = await rig(entry)
        let markerBytes: Uint8Array | null = null
        const log: string[] = []
        const request = streamedInstall({ putCount: 4, log, onBuild: async () => { markerBytes = await w.commitBytes() } })
        const result = await w.run(request)
        expect(result.status).toBe('installed')
        const total = treeUnitCount(EXTRA)
        const calls = w.log.filter(name => name === 'putUnit' || name === 'casCommit')
        expect(calls).toEqual(['casCommit', ...Array<string>(total).fill('putUnit'), 'casCommit'])
        expect(labelOf(markerBytes)).toBe('import')
        expect(log).toEqual(['build', 'tail-ready'])
        const key = classifyCommitRead({ bytes: await w.commitBytes() })
        expect(key.status === 'parsed' && key.value.staging === null && key.value.convertedFrom === 'import').toBe(true)
    })

    test('T-C8(3): the build starts only after the marker is on the commit key, and the first put follows the build', async () => {
        const w = await rig(entry)
        const order: string[] = []
        const request = streamedInstall({ putCount: 2, onBuild: async () => { order.push(`build:${labelOf(await w.commitBytes())}`) } })
        await w.run({
            ...request,
            build: async (context) => {
                const built = await request.build({
                    ...context,
                    put: async (unit) => { order.push('put'); await context.put(unit) },
                })
                return built
            },
        })
        expect(order.slice(0, 3)).toEqual(['build:import', 'put', 'put'])
    })

    test('T-C8(1): a put of a key the mint did not issue is Store2InstallAbortError over a TypeError; the marker stands and the staged units are present', async () => {
        const w = await rig(entry)
        let markerBytes: Uint8Array | null = null
        const request = streamedInstall({ putCount: 3 })
        const error = await w.run({
            ...request,
            build: async (context) => {
                markerBytes = await w.commitBytes()
                const built = buildTree(EXTRA, context, 'x')
                await context.put(built.units[0])
                await context.put({ key: `store2/u-${'0'.repeat(26)}`, bytes: built.units[1].bytes })
                return built
            },
        }).catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(Store2InstallAbortError)
        expect((error as Store2InstallAbortError).original).toBeInstanceOf(TypeError)
        expect(await w.commitBytes()).toEqual(markerBytes)
        expect(await w.staged()).toHaveLength(1)
    })

    test('T-C8(2): a unit count that differs from newUnits throws TypeError with the marker standing', async () => {
        const w = await rig(entry)
        let markerBytes: Uint8Array | null = null
        const request = streamedInstall({ putCount: 3, onBuild: async () => { markerBytes = await w.commitBytes() } })
        const error = await w.run({
            ...request,
            build: async (context) => {
                const built = await request.build(context)
                return { ...built, units: built.units.slice(1) }
            },
        }).catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(TypeError)
        expect(error).not.toBeInstanceOf(Store2InstallAbortError)
        expect(await w.commitBytes()).toEqual(markerBytes)
        expect(await w.staged()).toHaveLength(3)
    })

    test('T-C8(7): a tail unit that was already put throws TypeError with the marker standing', async () => {
        const w = await rig(entry)
        let markerBytes: Uint8Array | null = null
        const request = streamedInstall()
        const error = await w.run({
            ...request,
            build: async (context) => {
                markerBytes = await w.commitBytes()
                const built = buildTree(EXTRA, context, 'overlap')
                await context.put(built.units[0])
                return { ...built, units: built.units.slice(0, built.units.length - 1) }
            },
        }).catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(TypeError)
        expect(error).not.toBeInstanceOf(Store2InstallAbortError)
        expect(await w.commitBytes()).toEqual(markerBytes)
        expect(await w.staged()).toHaveLength(1)
    })

    test.each(['flush-false', 'backend-error'] as const)('T-C8(4): a put that fails (%s) is the result upload-failed, not a throw; the marker stands', async (mode) => {
        let puts = 0
        const w = await rig(entry, inner => ({
            ...inner,
            async putUnit(key, bytes) {
                puts += 1
                if (puts === 3) {
                    if (mode === 'backend-error') {
                        throw new Store2BackendFailureError('The device refused the unit.')
                    }
                    await inner.putUnit(key, bytes)
                    return { flushed: false }
                }
                return inner.putUnit(key, bytes)
            },
        }))
        let markerBytes: Uint8Array | null = null
        const result = await w.run(streamedInstall({ putCount: 5, onBuild: async () => { markerBytes = await w.commitBytes() } }))
        expect(result.status).toBe('upload-failed')
        expect(puts).toBe(3)
        expect(await w.commitBytes()).toEqual(markerBytes)
    })

    test('T-C8(4): a build that swallows the stop of a failed put still ends upload-failed', async () => {
        const w = await rig(entry, inner => ({
            ...inner,
            async putUnit(key, bytes) {
                await inner.putUnit(key, bytes)
                return { flushed: false }
            },
        }))
        const request = streamedInstall({ putCount: 3 })
        const result = await w.run({
            ...request,
            build: async (context) => {
                try {
                    return await request.build(context)
                } catch {
                    return { units: [], manifest: buildTree(EXTRA, context, 'swallowed').manifest }
                }
            },
        })
        expect(result.status).toBe('upload-failed')
    })

    test('T-C8(6): any other build throw is Store2InstallAbortError over that original; nothing is cleared', async () => {
        class FileChangedLike extends Error {}
        const w = await rig(entry)
        let markerBytes: Uint8Array | null = null
        const original = new FileChangedLike('the file changed')
        const request = streamedInstall({ putCount: 2, onBuild: async () => { markerBytes = await w.commitBytes() } })
        const error = await w.run({
            ...request,
            build: async (context) => {
                await request.build(context)
                throw original
            },
        }).catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(Store2InstallAbortError)
        expect(error).not.toBeInstanceOf(Store2BulkAbortError)
        expect((error as Store2InstallAbortError).original).toBe(original)
        expect(await w.commitBytes()).toEqual(markerBytes)
        expect(await w.staged()).toHaveLength(2)
    })
})

describe('installStreamed marker label', () => {
    test('the first-life marker of an import grant is labelled import', async () => {
        const memory = createMemoryBackend()
        const clock = createClock()
        const commit = classifyCommitRead(await memory.readCommit())
        const decision = classifyBoot({
            commit, fence: ABSENT_FENCE, presence: await probeStore2Presence(memory), tree: null,
            upstreamMainFile: false, ownerId: OWNER, deviceOwner: false,
        })
        if (!(decision.row === 1 && decision.mode === 'first-life')) {
            throw new Error('The boot is not row 1.')
        }
        const granted = firstLifeGrant({ decision, commitRead: await memory.readCommit(), startupClear: null }, { label: 'import' })
        expect(granted.status).toBe('granted')
        if (granted.status !== 'granted') {
            return
        }
        const marked = await writeFirstLifeMarker(memory, granted.grant, { owner: OWNER, env: testEnv(clock, 3) })
        expect(marked.status).toBe('marked')
        expect(labelOf((await memory.readCommit()).bytes)).toBe('import')
    })
})
