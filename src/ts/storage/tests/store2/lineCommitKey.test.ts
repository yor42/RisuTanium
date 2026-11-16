// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead, firstCommitKey, lineIdOf, nextCommitKey, replacedStamp, withLine, withReplaced } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, newManifestKey, UNIT_TYPE, type CommitKey } from 'src/ts/storage/store2/format'
import type { Store2Lineage } from 'src/ts/storage/store2/saveActive'
import { createClock, peerPin, startStore2, testEnv, type Store2Kit, type TestClock } from '../store2SaveKit'
import { committerOf, hooked, parsedCommit, seedStore, treeRequest, type Hooks } from './commitFixtures'
import { chaIdOf, chars, damageCommitKey, extrasOf, olderBuildRecovery, plantBytes, recoveryInstall, runLoopOver, seedProfile, stopAllLoops, until } from './lineFixtures'

afterEach(() => {
    stopAllLoops()
})

/**
 * The two additive commit-key fields: `line` (the descent proof) and `replaced` (the tree-replacing stamp), over the real
 * committer and the real key rules. New-path guards: nothing here has a counterpart before the feature.
 */

const ADMISSION = 10 * 60_000
const BULK_EXTRA = 49

interface Rig {
    memory: MemoryBackend
    clock: TestClock
    m0: string
}

async function rig(): Promise<Rig> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const m0 = await seedStore(memory, testEnv(clock, 1))
    return { memory, clock, m0 }
}

function descending(extra: number, from: string, options: Parameters<typeof treeRequest>[1] = {}) {
    return { ...treeRequest(extra, options), carry: { from, units: 0 } }
}

async function commit(memory: MemoryBackend, clock: TestClock, seed: number, request: ReturnType<typeof treeRequest>): Promise<CommitKey> {
    const committer = committerOf(memory, clock, seed)
    const result = await committer.commit(await committer.readCommit(), request)
    if (result.status !== 'committed') {
        throw new Error(`The commit came to ${result.status}.`)
    }
    return result.value
}

const currentOf = (key: CommitKey): string => {
    if (key.current === null) {
        throw new Error('No current manifest.')
    }
    return key.current.key
}

describe('C14 the writers stamp the line and the replaced stamp', () => {
    test('an ordinary commit over a key without a line mints a line whose id is its own epoch and whose tip is the new current', async () => {
        const { memory, clock } = await rig()
        const minted = await commit(memory, clock, 10, descending(0, (await parsedCommit(memory)).current?.key ?? ''))
        expect(extrasOf(minted).line).toEqual({ id: minted.epoch, tip: currentOf(minted) })
        expect(extrasOf(minted).replaced).toBeUndefined()
        expect(lineIdOf(minted)).toBe(minted.epoch)
    })

    test('a descending ordinary commit over a key with a line keeps the id and moves the tip', async () => {
        const { memory, clock } = await rig()
        const first = await commit(memory, clock, 10, descending(0, currentOf(await parsedCommit(memory))))
        const second = await commit(memory, clock, 11, descending(1, currentOf(first)))
        expect(extrasOf(second).line).toEqual({ id: first.epoch, tip: currentOf(second) })
        expect(second.seq).toBe(first.seq + 1)
    })

    test('a forced ordinary commit (save mine, import) mints even over a key with a line', async () => {
        const { memory, clock } = await rig()
        const first = await commit(memory, clock, 10, descending(0, currentOf(await parsedCommit(memory))))
        const forced = await commit(memory, clock, 11, { ...descending(1, currentOf(first)), force: true })
        expect(extrasOf(forced).line?.id).toBe(forced.epoch)
        expect(extrasOf(forced).line?.id).not.toBe(extrasOf(first).line?.id)
    })

    test('an ordinary commit over a replace-everything carry mints', async () => {
        const { memory, clock } = await rig()
        const first = await commit(memory, clock, 10, descending(0, currentOf(await parsedCommit(memory))))
        const replacing = await commit(memory, clock, 11, treeRequest(1))
        expect(extrasOf(replacing).line?.id).toBe(replacing.epoch)
        expect(extrasOf(replacing).line?.id).not.toBe(extrasOf(first).line?.id)
    })

    test('an ordinary import stamps the key with its own seq and epoch, and an unlabelled commit stamps nothing', async () => {
        const { memory, clock } = await rig()
        const plain = await commit(memory, clock, 10, descending(0, currentOf(await parsedCommit(memory))))
        expect(extrasOf(plain).replaced).toBeUndefined()
        const imported = await commit(memory, clock, 11, { ...treeRequest(0, { label: 'import' }), force: true })
        expect(extrasOf(imported).replaced).toEqual({ kind: 'import', seq: imported.seq, epoch: imported.epoch })
        const after = await commit(memory, clock, 12, descending(0, currentOf(imported)))
        // A later commit carries the stamp unchanged: it is the same replacement, seen again.
        expect(extrasOf(after).replaced).toEqual(extrasOf(imported).replaced)
        expect(replacedStamp(after)).toBe(replacedStamp(imported))
    })

    test('a bulk final over an unchanged current keeps the line id', async () => {
        const { memory, clock } = await rig()
        const first = await commit(memory, clock, 10, descending(0, currentOf(await parsedCommit(memory))))
        const final = await commit(memory, clock, 11, descending(BULK_EXTRA, currentOf(first)))
        expect(final.staging).toBeNull()
        expect(extrasOf(final).line).toEqual({ id: first.epoch, tip: currentOf(final) })
    })

    test('a bulk final after a peer commit under the marker mints, in the round that judged the changed key, and stamps an import only on the final key', async () => {
        const { memory, clock } = await rig()
        const first = await commit(memory, clock, 10, descending(0, currentOf(await parsedCommit(memory))))
        const seen: Array<{ staging: boolean, stamped: boolean, line: unknown }> = []
        let peerKey: CommitKey | null = null
        const hooks: Hooks = {
            async before(name, count) {
                if (name === 'putUnit' && count === 1) {
                    const marker = await parsedCommit(memory)
                    seen.push({ staging: marker.staging !== null, stamped: extrasOf(marker).replaced !== undefined, line: extrasOf(marker).line })
                    clock.advance(ADMISSION)
                    peerKey = await commit(memory, clock, 12, descending(1, currentOf(marker)))
                }
            },
        }
        const wrapped = hooked(memory, hooks)
        const bulker = committerOf(wrapped.backend, clock, 11)
        const result = await bulker.commit(await bulker.readCommit(), { ...descending(BULK_EXTRA, currentOf(first), { label: 'import' }) })
        expect(result.status).toBe('committed')
        const final = await parsedCommit(memory)
        expect(seen).toEqual([{ staging: true, stamped: false, line: extrasOf(first).line }])
        expect(peerKey).not.toBeNull()
        expect(extrasOf(final).line).toEqual({ id: final.epoch, tip: currentOf(final) })
        expect(extrasOf(final).line?.id).not.toBe(extrasOf(first).line?.id)
        expect(extrasOf(final).replaced).toEqual({ kind: 'import', seq: final.seq, epoch: final.epoch })
        expect(final.staging).toBeNull()
    })

    test('restore mints and stamps a restore over a manifest that was retained', async () => {
        const { memory, clock, m0 } = await rig()
        clock.advance(ADMISSION)
        const first = await commit(memory, clock, 10, descending(0, m0))
        const committer = committerOf(memory, clock, 20)
        const result = await committer.restore(await committer.readCommit(), m0)
        expect(result.status).toBe('committed')
        const restored = await parsedCommit(memory)
        expect(currentOf(restored)).toBe(m0)
        expect(extrasOf(restored).line).toEqual({ id: restored.epoch, tip: m0 })
        expect(extrasOf(restored).line?.id).not.toBe(extrasOf(first).line?.id)
        expect(extrasOf(restored).replaced).toEqual({ kind: 'restore', seq: restored.seq, epoch: restored.epoch })
    })

    test('the install writer mints and stamps an install', async () => {
        const { memory, clock, m0 } = await rig()
        const before = await parsedCommit(memory)
        await damageCommitKey(memory)
        const installed = await recoveryInstall(memory, clock, m0, before.seq + 5)
        expect(extrasOf(installed).line).toEqual({ id: installed.epoch, tip: m0 })
        expect(extrasOf(installed).replaced).toEqual({ kind: 'install', seq: installed.seq, epoch: installed.epoch })
        expect(classifyCommitRead(await memory.readCommit())).toMatchObject({ status: 'parsed' })
    })

    test('a pin, an unpin and a marker write leave the line byte-equal', async () => {
        const { memory, clock, m0 } = await rig()
        clock.advance(ADMISSION)
        const first = await commit(memory, clock, 10, descending(0, m0))
        const committer = committerOf(memory, clock, 21)
        const pinned = await committer.pin(await committer.readCommit(), m0, 'keep')
        expect(pinned.status).toBe('committed')
        expect(extrasOf(await parsedCommit(memory)).line).toEqual(extrasOf(first).line)
        const unpinned = await committer.unpin(await committer.readCommit(), m0)
        expect(unpinned.status).toBe('committed')
        const afterUnpin = await parsedCommit(memory)
        expect(extrasOf(afterUnpin).line).toEqual(extrasOf(first).line)
        expect(extrasOf(afterUnpin).replaced).toBeUndefined()
        let markerLine: unknown = null
        const hooks: Hooks = {
            async before(name, count) {
                if (name === 'putUnit' && count === 1) {
                    markerLine = extrasOf(await parsedCommit(memory)).line
                }
            },
        }
        const bulker = committerOf(hooked(memory, hooks).backend, clock, 22)
        await bulker.commit(await bulker.readCommit(), descending(BULK_EXTRA, currentOf(afterUnpin)))
        expect(markerLine).toEqual(extrasOf(first).line)
    })

    test('the helpers never write into the carried objects of the base key', () => {
        const clock = createClock()
        const env = testEnv(clock, 5)
        const first = withLine(firstWithCurrent('m-one'), firstWithCurrent('m-zero'), false)
        withReplaced(first, 'import')
        const before = structuredClone(first)
        const next = nextCommitKey(first, { current: { key: 'm-two', at: 1 } }, env)
        withLine(next, first, true)
        withReplaced(next, 'restore')
        expect(first).toStrictEqual(before)
        const another = nextCommitKey(first, { current: { key: 'm-three', at: 2 } }, env)
        withLine(another, first, false)
        expect(first).toStrictEqual(before)
        expect(extrasOf(next).line?.id).toBe(extrasOf(first).line?.id)
    })
})

function firstWithCurrent(key: string): CommitKey {
    return firstCommitKey({ current: { key, at: 1 }, staging: null }, testEnv(createClock(), key.length))
}

describe('C17 lineIdOf reads a line only while its tip names the current manifest', () => {
    const base = firstWithCurrent('manifest-a')

    function withExtras(key: CommitKey, line: unknown, current: CommitKey['current'] = key.current): CommitKey {
        return { ...key, current, line } as unknown as CommitKey
    }

    test('absent line, null current, stale tip and malformed lines read as null; a proven line reads as its id', () => {
        expect(lineIdOf(base)).toBeNull()
        expect(lineIdOf(withExtras(base, { id: 'L', tip: 'manifest-a' }, null))).toBeNull()
        expect(lineIdOf(withExtras(base, { id: 'L', tip: 'manifest-z' }))).toBeNull()
        expect(lineIdOf(withExtras(base, { id: 7, tip: 'manifest-a' }))).toBeNull()
        expect(lineIdOf(withExtras(base, { id: 'L', tip: 7 }))).toBeNull()
        expect(lineIdOf(withExtras(base, 'L'))).toBeNull()
        expect(lineIdOf(withExtras(base, ['L', 'manifest-a']))).toBeNull()
        expect(lineIdOf(withExtras(base, null))).toBeNull()
        expect(lineIdOf(withExtras(base, { id: 'L', tip: 'manifest-a' }))).toBe('L')
    })

    test('an older build that moves the current back to the tip makes the line provable again, and the tree is the tip\'s', () => {
        const env = testEnv(createClock(), 9)
        const x = withLine(nextCommitKey(base, { current: { key: 'manifest-x', at: 2 } }, env), base, true)
        const y = nextCommitKey(x, { current: { key: 'manifest-y', at: 3 } }, env)
        expect(lineIdOf(y)).toBeNull()
        const back = nextCommitKey(y, { current: { key: 'manifest-x', at: 4 } }, env)
        expect(lineIdOf(back)).toBe(lineIdOf(x))
        expect(back.current?.key).toBe(x.current?.key)
    })

    test('an unsigned older-build recovery key (firstCommitKey over a damaged key) carries no line', async () => {
        const memory = createMemoryBackend()
        const clock = createClock()
        const m0 = await seedStore(memory, testEnv(clock, 1))
        const first = await commit(memory, clock, 10, descending(0, m0))
        expect(lineIdOf(first)).not.toBeNull()
        await damageCommitKey(memory)
        const recovered = await olderBuildRecovery(memory, clock, m0, 'in-place', first.seq + 10)
        expect(lineIdOf(recovered)).toBeNull()
        const stored = classifyCommitRead(await memory.readCommit())
        expect(stored.status === 'parsed' && lineIdOf(stored.value)).toBeNull()
    })
})

// A seeded generator over the real key rules, judged against an independent tree model: a descending write relates its
// new manifest to its base's manifest, nothing else relates two manifests, and a key moved back to an existing manifest
// names that manifest. `proven(final, k)` is the judge's step-4 conjuncts without the baseline's stamp.
describe('C17 generator: proven implies the final tree descends from the earlier key\'s tree', () => {
    type Step = 'descend' | 'force' | 'bulk-over-peer' | 'restore' | 'older' | 'older-recovery' | 'new-recovery'

    interface Model {
        /** manifest -> the manifests it descends from, directly. */
        parents: Map<string, Set<string>>
        keys: CommitKey[]
        manifestOf: Map<number, string>
    }

    function descendsOrEqual(model: Model, later: string, earlier: string): boolean {
        if (later === earlier) {
            return true
        }
        const seen = new Set<string>()
        const stack = [later]
        while (stack.length > 0) {
            const next = stack.pop() as string
            if (next === earlier) {
                return true
            }
            if (seen.has(next)) {
                continue
            }
            seen.add(next)
            for (const parent of model.parents.get(next) ?? []) {
                stack.push(parent)
            }
        }
        return false
    }

    function random(seed: number): () => number {
        let state = seed >>> 0
        return () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0
            return state / 2 ** 32
        }
    }

    function run(seed: number, withLineAtStart: boolean, steps: readonly Step[] | null): { model: Model, allDescending: boolean } {
        const rnd = random(seed)
        const env = testEnv(createClock(), seed)
        const model: Model = { parents: new Map(), keys: [], manifestOf: new Map() }
        let counter = 0
        const fresh = (): string => `manifest-${seed}-${counter++}`
        let key = firstWithCurrent(fresh())
        if (withLineAtStart) {
            key = withLine(key, firstWithCurrent(fresh()), false)
        }
        model.keys.push(key)
        model.parents.set(currentOf(key), new Set())
        let allDescending = true
        const sequence = steps ?? Array.from({ length: 24 }, (): Step => (['descend', 'descend', 'force', 'bulk-over-peer', 'restore', 'older', 'older-recovery', 'new-recovery'] as const)[Math.floor(rnd() * 8)])
        for (const step of sequence) {
            const base = key
            const manifests = [...model.parents.keys()]
            switch (step) {
                case 'descend': {
                    const name = fresh()
                    key = withLine(nextCommitKey(base, { current: { key: name, at: 1 } }, env), base, true)
                    model.parents.set(name, new Set([currentOf(base)]))
                    break
                }
                case 'force':
                case 'bulk-over-peer': {
                    const name = fresh()
                    key = withLine(nextCommitKey(base, { current: { key: name, at: 1 } }, env), base, false)
                    model.parents.set(name, new Set())
                    allDescending = false
                    break
                }
                case 'restore': {
                    const name = manifests[Math.floor(rnd() * manifests.length)]
                    key = withReplaced(withLine(nextCommitKey(base, { current: { key: name, at: 1 } }, env), base, false), 'restore')
                    allDescending = false
                    break
                }
                case 'older': {
                    // A build without the rule: a delta in truth, but never a claim, so the model relates nothing.
                    const name = fresh()
                    key = nextCommitKey(base, { current: { key: name, at: 1 } }, env)
                    model.parents.set(name, new Set())
                    allDescending = false
                    break
                }
                case 'older-recovery': {
                    // A copy of an existing tree under a fresh manifest key, behind a marker made of a first-life key.
                    const copied = fresh()
                    const marker = { ...firstCommitKey({ current: null, staging: null }, env), seq: base.seq + 7 }
                    key = nextCommitKey(marker, { current: { key: copied, at: 1 } }, env)
                    model.parents.set(copied, new Set())
                    allDescending = false
                    break
                }
                case 'new-recovery': {
                    const copied = fresh()
                    const marker = { ...firstCommitKey({ current: null, staging: null }, env), seq: base.seq + 7 }
                    key = withReplaced(withLine(nextCommitKey(marker, { current: { key: copied, at: 1 } }, env), marker, false), 'install')
                    model.parents.set(copied, new Set())
                    allDescending = false
                    break
                }
            }
            model.keys.push(key)
        }
        return { model, allDescending }
    }

    test('soundness over seeded sequences, from a start with and without a line', () => {
        let proven = 0
        for (let seed = 1; seed <= 120; seed++) {
            for (const withLineAtStart of [false, true]) {
                const { model } = run(seed, withLineAtStart, null)
                const final = model.keys[model.keys.length - 1]
                for (const earlier of model.keys.slice(0, -1)) {
                    const line = lineIdOf(final)
                    if (line !== null && line === lineIdOf(earlier) && final.seq > earlier.seq) {
                        proven += 1
                        expect(descendsOrEqual(model, currentOf(final), currentOf(earlier)), `seed ${seed}`).toBe(true)
                    }
                }
            }
        }
        // The generator must reach the proof, or the soundness check says nothing.
        expect(proven).toBeGreaterThan(50)
    })

    test('completeness: a run of descending writes over a start with a line proves every pair', () => {
        for (let seed = 1; seed <= 20; seed++) {
            const { model, allDescending } = run(seed, true, Array.from({ length: 10 }, (): Step => 'descend'))
            expect(allDescending).toBe(true)
            const final = model.keys[model.keys.length - 1]
            for (const earlier of model.keys.slice(0, -1)) {
                expect(lineIdOf(final)).not.toBeNull()
                expect(lineIdOf(final)).toBe(lineIdOf(earlier))
                expect(final.seq).toBeGreaterThan(earlier.seq)
            }
        }
    })
})

// The loop's judge over a kit page with an injected baseline: step 3 (a stamp the baseline did not see, or a stamp over an
// unknown baseline, stops `tree-replaced`) and step 4 (a proof needs the baseline's line and a `seq` above its own). The kit
// never judges on a line by itself, so each test hands its page a `lineage`. A clean page's prompt tells the verdicts apart:
// Export this tab first is offered only for an unproven descent.

type LoopOf = ReturnType<typeof runLoopOver>

async function judgedPage(lineage: Store2Lineage | undefined): Promise<{ kit: Store2Kit, loop: LoopOf }> {
    const db = seedProfile()
    const kit = await startStore2({ db, kind: 'indexeddb' })
    if (lineage !== undefined) {
        kit.context.lineage = lineage
    }
    return { kit, loop: runLoopOver(kit.context, JSON.parse(JSON.stringify(db))) }
}

interface Planted {
    line?: string | 'none'
    stamp?: boolean
    seq?: number
}

/** A peer key over the stored one: a new current, the line and stamp the test names, and a `seq` the test may set. */
async function plant(kit: Store2Kit, options: Planted): Promise<CommitKey> {
    const env = testEnv(kit.clock, 4040)
    const base = await kit.commitKey()
    const next = nextCommitKey(base, { current: { key: newManifestKey(env), at: env.now() } }, env)
    if (options.line !== undefined && options.line !== 'none') {
        Object.assign(next, { line: { id: options.line, tip: next.current?.key } })
    }
    if (options.stamp === true) {
        withReplaced(next, 'restore')
    }
    if (options.seq !== undefined) {
        next.seq = options.seq
    }
    await plantBytes(kit.memory, encodeUnit(UNIT_TYPE.commit, next))
    return next
}

async function cleanPrompt(kit: Store2Kit, loop: LoopOf) {
    loop.state.peerHeard = true
    await until(() => kit.peer.clean.length >= 1, 'the clean notice', 4000)
    return kit.peer.clean[0]
}

describe('C18 an unknown baseline fails closed', () => {
    test('a key with a stamp stops tree-replaced', async () => {
        const { kit, loop } = await judgedPage({ base: 'unknown' })
        await plant(kit, { line: 'L', stamp: true })
        expect(await cleanPrompt(kit, loop)).toMatchObject({ reason: 'tree-replaced', offers: ['reload'] })
    })

    test('a key without a stamp but with a valid line is an unproven peer commit', async () => {
        const { kit, loop } = await judgedPage({ base: 'unknown' })
        await plant(kit, { line: 'L' })
        const prompt = await cleanPrompt(kit, loop)
        expect(prompt).toMatchObject({ reason: 'peer-commit' })
        expect(prompt.offers).toEqual(['reload', 'export-first'])
    })
})

describe('R29 (judge half) a proof needs the baseline\'s line and a seq above the baseline\'s', () => {
    test('a key on the baseline\'s line with a higher seq is proven: a clean page parks with Reload only', async () => {
        const { kit, loop } = await judgedPage({ base: { line: 'L', stamp: null, seq: 3 } })
        await plant(kit, { line: 'L', seq: 4 })
        expect((await cleanPrompt(kit, loop)).offers).toEqual(['reload'])
    })

    test('the same line with a seq at or below the baseline\'s (a rolled-back key) is unproven', async () => {
        const { kit, loop } = await judgedPage({ base: { line: 'L', stamp: null, seq: 9 } })
        await plant(kit, { line: 'L', seq: 4 })
        expect((await cleanPrompt(kit, loop)).offers).toEqual(['reload', 'export-first'])
    })

    test('another line, a baseline without a line and a key without a line are unproven', async () => {
        for (const [base, planted] of [
            [{ line: 'L', stamp: null, seq: 3 }, { line: 'M', seq: 4 }],
            [{ line: null, stamp: null, seq: 3 }, { line: 'L', seq: 4 }],
            [{ line: 'L', stamp: null, seq: 3 }, { line: 'none', seq: 4 }],
        ] as const) {
            stopAllLoops()
            const { kit, loop } = await judgedPage({ base })
            await plant(kit, planted)
            expect((await cleanPrompt(kit, loop)).offers).toEqual(['reload', 'export-first'])
        }
    })

    test('a stamp the baseline did not see stops tree-replaced even on the baseline\'s line', async () => {
        const { kit, loop } = await judgedPage({ base: { line: 'L', stamp: null, seq: 3 } })
        await plant(kit, { line: 'L', seq: 4, stamp: true })
        expect(await cleanPrompt(kit, loop)).toMatchObject({ reason: 'tree-replaced' })
    })

    test('a stamp the baseline already holds does not stop the page', async () => {
        const stamped = withReplaced(firstWithCurrent('manifest-s'), 'import')
        const { kit, loop } = await judgedPage({ base: { line: 'L', stamp: replacedStamp(stamped), seq: 3 } })
        const key = await plant(kit, { line: 'L', seq: 4 })
        Object.assign(key, { replaced: extrasOf(stamped).replaced })
        await plantBytes(kit.memory, encodeUnit(UNIT_TYPE.commit, key))
        expect((await cleanPrompt(kit, loop)).offers).toEqual(['reload'])
    })
})

describe('the baseline is replaced whole by a judged ok and by an own landed commit', () => {
    test('a peer pin keeps the current, so the judge is ok and the baseline moves to the pin\'s key', async () => {
        const { kit, loop } = await judgedPage({ base: { line: null, stamp: null, seq: 0 } })
        const key = await peerPin(kit)
        loop.state.peerHeard = true
        await until(() => (kit.context.lineage?.base as { seq: number }).seq === key.seq, 'the baseline to move', 4000)
        expect(kit.context.lineage?.base).toEqual({ line: null, stamp: null, seq: key.seq })
        expect(kit.peer.clean).toEqual([])
    })

    test('an own commit replaces the baseline from the landed key', async () => {
        const db = seedProfile()
        const kit = await startStore2({ db, kind: 'indexeddb' })
        kit.context.lineage = { base: 'unknown' }
        const mine = JSON.parse(JSON.stringify(db))
        const loop = runLoopOver(kit.context, mine)
        chars(mine)[1].personality = 'an own edit'
        loop.mark(chaIdOf(mine, 1))
        await until(() => loop.state.saved >= 1, 'the own commit', 4000)
        const stored = await kit.commitKey()
        expect(kit.context.lineage?.base).toEqual({ line: extrasOf(stored).line?.id, stamp: null, seq: stored.seq })
        expect(extrasOf(stored).line?.id).toBeDefined()
    })
})

describe('a loop without lineage runs the unchanged judge', () => {
    test('a kit page keeps today\'s clean prompt for any peer commit', async () => {
        const { kit, loop } = await judgedPage(undefined)
        await plant(kit, { line: 'none' })
        expect(await cleanPrompt(kit, loop)).toMatchObject({ reason: 'peer-commit', offers: ['reload'] })
    })

    test('a kit page does not stop tree-replaced on a stamped key either', async () => {
        const { kit, loop } = await judgedPage(undefined)
        await plant(kit, { stamp: true })
        expect(await cleanPrompt(kit, loop)).toMatchObject({ reason: 'peer-commit', offers: ['reload'] })
    })
})
