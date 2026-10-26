// @vitest-environment node
/**
 * The ordinary commit-key operations (commit, restore, save-mine, pin, unpin)
 * over the memory, IndexedDB (fake-indexeddb) and Node (real server process)
 * backends: I1 after every operation, restore always pushing `current`,
 * retention admission and pins, refusal on every unusable base, and a conflict
 * never retried. Tauri is not run here. Bulk commit and the abandon-clear are in
 * `commitBulk.test.ts`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    createMemoryBackend, Store2BackendFailureError, Store2UnknownOutcomeError, sameBytes, type Store2Backend,
} from 'src/ts/storage/store2/backend'
import {
    ADMISSION_INTERVAL_MS, nextRetained, type CommitRequest, type CommitResult, type Committer,
} from 'src/ts/storage/store2/commit'
import { RETAINED_MAX, firstCommitKey } from 'src/ts/storage/store2/commitKey'
import {
    encodeUnit, keyOfTail, newManifestKey, readUnit, refOfFrame, UNIT_TYPE, type CommitKey, type KeyEnv, type Manifest,
} from 'src/ts/storage/store2/format'
import {
    COMMIT_BACKENDS, committerOf, createClock, expectInvariant, hooked, parsedCommit, peerWrite, plantCommit,
    plantKey, seedStore, testEnv, treeRequest, type BuildRecord, type Hooks, type OpenedBackend,
} from './commitFixtures'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const opened: OpenedBackend[] = []
const MINUTE = 60_000
const FOREIGN_MARKER = { owner: 'q'.repeat(26), prefix: 'store2/g-0000000000000000-', startedAt: 5, label: 'bulk' } as const

afterEach(async () => {
    await Promise.all(opened.splice(0).map(entry => entry.close()))
})

function committed(result: CommitResult): { manifestKey: string } {
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') {
        throw new Error(`Expected committed, got ${result.status}.`)
    }
    return { manifestKey: result.manifestKey }
}

describe('nextRetained', () => {
    const base = (over: Partial<CommitKey>): CommitKey => ({
        fmt: 1, req: [], seq: 1, epoch: '0'.repeat(26), current: { key: 'store2/m-cur', at: 1000 },
        retained: [], pins: [], staging: null, convertedFrom: null, convertedAt: null, ...over,
    })
    const entries = (count: number): CommitKey['retained'] => Array.from({ length: count }, (_, i) => ({ key: `store2/m-r${i}`, at: 100 - i }))

    test('an empty retained list admits the previous current', () => {
        expect(nextRetained(base({}), 1000, false)).toEqual([{ key: 'store2/m-cur', at: 1000 }])
    })

    test('the previous current is admitted only when the newest entry is at least five minutes old', () => {
        const key = base({ retained: [{ key: 'store2/m-old', at: 1000 }] })
        expect(nextRetained(key, 1000 + ADMISSION_INTERVAL_MS - 1, false).map(entry => entry.key)).toEqual(['store2/m-old'])
        expect(nextRetained(key, 1000 + ADMISSION_INTERVAL_MS, false).map(entry => entry.key)).toEqual(['store2/m-cur', 'store2/m-old'])
    })

    test('a forced push ignores admission, and a dropped key is removed first', () => {
        const key = base({ retained: [{ key: 'store2/m-old', at: 1000 }, { key: 'store2/m-x', at: 900 }] })
        expect(nextRetained(key, 1001, true).map(entry => entry.key)).toEqual(['store2/m-cur', 'store2/m-old', 'store2/m-x'])
        expect(nextRetained(key, 1001, true, 'store2/m-old').map(entry => entry.key)).toEqual(['store2/m-cur', 'store2/m-x'])
    })

    test('overflow drops the oldest unpinned entry and keeps a pinned one', () => {
        const full = entries(RETAINED_MAX)
        const pinnedOldest = base({ retained: full, pins: [{ key: full[RETAINED_MAX - 1].key, reason: 'p' }] })
        const result = nextRetained(pinnedOldest, 1e9, true)
        expect(result).toHaveLength(RETAINED_MAX)
        expect(result.map(entry => entry.key)).toContain(full[RETAINED_MAX - 1].key)
        expect(result.map(entry => entry.key)).not.toContain(full[RETAINED_MAX - 2].key)
    })

    test('when every entry is pinned the oldest goes, since a pin names its manifest by itself', () => {
        const full = entries(RETAINED_MAX)
        const allPinned = base({ retained: full, pins: full.map(entry => ({ key: entry.key, reason: 'p' })) })
        const result = nextRetained(allPinned, 1e9, true)
        expect(result).toHaveLength(RETAINED_MAX)
        expect(result[0].key).toBe('store2/m-cur')
        expect(result.map(entry => entry.key)).not.toContain(full[RETAINED_MAX - 1].key)
    })
})

describe.each(COMMIT_BACKENDS.map(fixture => [fixture.name, fixture] as const))('commit operations on the %s backend', (name, fixture) => {
    async function setup(hooks: Hooks = {}) {
        const entry = await fixture.open()
        opened.push(entry)
        const clock = createClock()
        const m0 = await seedStore(entry.backend, testEnv(clock, 1))
        const wrapped = hooked(entry.backend, hooks)
        return {
            raw: entry.backend,
            wrapped,
            clock,
            m0,
            hooks,
            a: committerOf(wrapped.backend, clock, 100),
            b: committerOf(entry.backend, clock, 200),
            env: testEnv(clock, 300),
        }
    }

    async function commitNext(committer: Committer, extra = 0, tag = 'x'): Promise<string> {
        return committed(await committer.commit(await committer.readCommit(), treeRequest(extra, { tag }))).manifestKey
    }

    describe('ordinary commit', () => {
        test('installs the new manifest with seq plus one and a fresh epoch, pushes the first previous current, and keeps I1', async () => {
            const { raw, a, m0 } = await setup()
            const before = await parsedCommit(raw)
            const result = await a.commit(await a.readCommit(), treeRequest(2, { tag: 'one' }))
            const { manifestKey } = committed(result)
            const after = await parsedCommit(raw)
            expect(after.seq).toBe(before.seq + 1)
            expect(after.epoch).not.toBe(before.epoch)
            expect(after.current?.key).toBe(manifestKey)
            expect(after.retained.map(entry => entry.key)).toEqual([m0])
            expect(result.status === 'committed' && result.value).toEqual(after)
            await expectInvariant(raw)
        })

        test('within five minutes the previous current is dropped, after five it is admitted', async () => {
            const { raw, a, clock, m0 } = await setup()
            const m1 = await commitNext(a)
            clock.advance(MINUTE)
            const m2 = await commitNext(a)
            expect((await parsedCommit(raw)).retained.map(entry => entry.key)).toEqual([m0])
            clock.advance(ADMISSION_INTERVAL_MS)
            const m3 = await commitNext(a)
            expect((await parsedCommit(raw)).retained.map(entry => entry.key)).toEqual([m2, m0])
            expect(m1).not.toBe(m2)
            expect(m3).not.toBe(m2)
            await expectInvariant(raw)
        })

        test('a forced commit keeps the previous current inside the admission window, and the same request without force does not', async () => {
            const { raw, a, clock, m0 } = await setup()
            const m1 = await commitNext(a)
            clock.advance(MINUTE)
            const m2 = committed(await a.commit(await a.readCommit(), { ...treeRequest(0, { tag: 'forced' }), force: true })).manifestKey
            const forced = await parsedCommit(raw)
            expect(forced.current?.key).toBe(m2)
            expect(forced.retained.map(entry => entry.key)).toEqual([m1, m0])
            clock.advance(MINUTE)
            const m3 = await commitNext(a)
            const plain = await parsedCommit(raw)
            expect(plain.current?.key).toBe(m3)
            expect(plain.retained.map(entry => entry.key)).toEqual([m1, m0])
            await expectInvariant(raw)
        })

        test('a pinned manifest survives rotation past the retained cap', async () => {
            const { raw, a, clock, m0 } = await setup()
            await commitNext(a)
            expect((await a.pin(await a.readCommit(), m0, 'keep')).status).toBe('committed')
            for (let i = 0; i < RETAINED_MAX + 5; i++) {
                clock.advance(ADMISSION_INTERVAL_MS + 1)
                await commitNext(a, 0, `r${i}`)
            }
            const key = await parsedCommit(raw)
            expect(key.retained).toHaveLength(RETAINED_MAX)
            expect(key.retained.map(entry => entry.key)).toContain(m0)
            expect(key.pins.map(pin => pin.key)).toEqual([m0])
            await expectInvariant(raw)
        })

        test('an unpinned oldest entry is rotated out', async () => {
            const { raw, a, clock, m0 } = await setup()
            await commitNext(a)
            for (let i = 0; i < RETAINED_MAX + 2; i++) {
                clock.advance(ADMISSION_INTERVAL_MS + 1)
                await commitNext(a, 0, `r${i}`)
            }
            const key = await parsedCommit(raw)
            expect(key.retained).toHaveLength(RETAINED_MAX)
            expect(key.retained.map(entry => entry.key)).not.toContain(m0)
        })

        test('a stale base is a conflict: one write call, nothing retried, the peer\'s key stays', async () => {
            const { raw, wrapped, a, b } = await setup()
            const staleRead = await a.readCommit()
            await commitNext(b)
            const peerBytes = (await raw.readCommit()).bytes
            wrapped.log.length = 0
            const result = await a.commit(staleRead, treeRequest(0))
            expect(result.status).toBe('conflict')
            expect(wrapped.log.filter(call => call === 'commitOrdinary')).toHaveLength(1)
            expect(wrapped.log).not.toContain('casCommit')
            const stored = (await raw.readCommit()).bytes
            expect(stored !== null && peerBytes !== null && sameBytes(stored, peerBytes)).toBe(true)
            if (result.status === 'conflict') {
                expect(result.current.bytes !== null && stored !== null && sameBytes(result.current.bytes, stored)).toBe(true)
            }
        })

        test('a peer that rewrote the key at the same seq with another epoch still conflicts', async () => {
            const { raw, a } = await setup()
            const staleRead = await a.readCommit()
            const stored = await parsedCommit(raw)
            await plantKey(raw, { ...stored, epoch: 'v'.repeat(26) })
            expect((await parsedCommit(raw)).seq).toBe(stored.seq)
            expect((await a.commit(staleRead, treeRequest(0))).status).toBe('conflict')
            await expectInvariant(raw)
        })

        test('a retry after a failed commit calls build again and offers only fresh unit keys', async () => {
            const { raw, hooks, a } = await setup()
            const record: BuildRecord[] = []
            hooks.before = (call) => {
                if (call === 'commitOrdinary' && record.length === 1) {
                    throw new Store2BackendFailureError('Injected failure.')
                }
            }
            const first = await a.commit(await a.readCommit(), treeRequest(1, { record }))
            expect(first.status).toBe('failed')
            const second = await a.commit(await a.readCommit(), treeRequest(1, { record }))
            committed(second)
            expect(record).toHaveLength(2)
            expect(record[0].keys.filter(key => record[1].keys.includes(key))).toEqual([])
            await expectInvariant(raw)
        })

        test('units under keys the attempt\'s mint did not issue are refused before any write', async () => {
            const { wrapped, a } = await setup()
            const record: BuildRecord[] = []
            committed(await a.commit(await a.readCommit(), treeRequest(0, { record })))
            wrapped.log.length = 0
            const reused = record[0].keys[0]
            const result = await a.commit(await a.readCommit(), {
                newUnits: 11,
                build: async (ctx) => {
                    const tree = await treeRequest(0).build(ctx)
                    return { units: tree.units.map((unit, i) => i === 0 ? { ...unit, key: reused } : unit), manifest: tree.manifest }
                },
            })
            expect(result.status).toBe('refused')
            expect(result.status === 'refused' && result.reason).toBe('bad-unit-set')
            expect(wrapped.log).not.toContain('commitOrdinary')
        })

        test('a declared unit count that differs from the build is refused', async () => {
            const { wrapped, a } = await setup()
            wrapped.log.length = 0
            const request = treeRequest(0)
            const result = await a.commit(await a.readCommit(), { ...request, newUnits: request.newUnits + 1 })
            expect(result.status === 'refused' && result.reason).toBe('bad-unit-set')
            expect(wrapped.log).not.toContain('commitOrdinary')
        })

        test('a lost response of an applied commit is decided by reading back, and a lost one that was not applied is a conflict', async () => {
            const { raw, hooks, a } = await setup()
            hooks.after = (call) => {
                if (call === 'commitOrdinary') {
                    throw new Store2UnknownOutcomeError('Injected lost response.')
                }
            }
            const applied = await a.commit(await a.readCommit(), treeRequest(0))
            expect(applied.status).toBe('committed')
            const stored = (await raw.readCommit()).bytes
            expect(applied.status === 'committed' && stored !== null && sameBytes(applied.bytes, stored)).toBe(true)

            hooks.after = undefined
            hooks.before = (call) => {
                if (call === 'commitOrdinary') {
                    throw new Store2UnknownOutcomeError('Injected lost request.')
                }
            }
            const before = (await raw.readCommit()).bytes
            const lost = await a.commit(await a.readCommit(), treeRequest(0))
            expect(lost.status).toBe('conflict')
            const after = (await raw.readCommit()).bytes
            expect(before !== null && after !== null && sameBytes(before, after)).toBe(true)
            await expectInvariant(raw)
        })
    })

    describe('restore', () => {
        async function twoCommits() {
            const context = await setup()
            const m1 = await commitNext(context.a, 1, 'one')
            context.clock.advance(MINUTE)
            const m2 = await commitNext(context.a, 1, 'two')
            return { ...context, m1, m2 }
        }

        test('always pushes the previous current, even inside the admission window, and is undoable', async () => {
            const { raw, a, m0, m2 } = await twoCommits()
            expect((await parsedCommit(raw)).retained.map(entry => entry.key)).toEqual([m0])
            const before = await parsedCommit(raw)
            const restored = await a.restore(await a.readCommit(), m0)
            expect(restored.status).toBe('committed')
            const key = await parsedCommit(raw)
            expect(key.current?.key).toBe(m0)
            expect(key.retained.map(entry => entry.key)).toEqual([m2])
            expect(key.seq).toBe(before.seq + 1)
            expect(key.epoch).not.toBe(before.epoch)
            await expectInvariant(raw)

            expect((await a.restore(await a.readCommit(), m2)).status).toBe('committed')
            const undone = await parsedCommit(raw)
            expect(undone.current?.key).toBe(m2)
            expect(undone.retained.map(entry => entry.key)).toEqual([m0])
            await expectInvariant(raw)
        })

        test('pushes the previous current when other retained entries keep the admission window closed', async () => {
            const { raw, a, clock, env, m0, m1, m2 } = await twoCommits()
            expect((await parsedCommit(raw)).retained.map(entry => entry.key)).toEqual([m0])
            await peerWrite(raw, env, { retained: [{ key: m0, at: clock.now }, { key: m1, at: clock.now - MINUTE }] })
            expect((await a.restore(await a.readCommit(), m1)).status).toBe('committed')
            const key = await parsedCommit(raw)
            expect(key.current?.key).toBe(m1)
            expect(key.retained.map(entry => entry.key)).toEqual([m2, m0])
            await expectInvariant(raw)
        })

        test('keeps the marker, the pins and the conversion record, and never touches the fence', async () => {
            const { raw, wrapped, a, env, m0, m1 } = await twoCommits()
            const planted = await peerWrite(raw, env, { staging: FOREIGN_MARKER, pins: [{ key: m1, reason: 'keep' }], convertedFrom: 'old', convertedAt: 77 })
            wrapped.log.length = 0
            expect((await a.restore(await a.readCommit(), m0)).status).toBe('committed')
            const key = await parsedCommit(raw)
            expect(key.staging).toEqual(planted.staging)
            expect(key.pins).toEqual(planted.pins)
            expect(key.convertedFrom).toBe('old')
            expect(key.convertedAt).toBe(77)
            expect(wrapped.log).not.toContain('casFence')
            expect(wrapped.log).not.toContain('readFence')
            expect((await raw.readFence()).bytes).toBeNull()
            await expectInvariant(raw)
        })

        test('refuses a manifest naming a missing unit, a missing leaf, or a missing manifest, and writes nothing', async () => {
            const { raw, a, clock, m0 } = await setup()
            const record: BuildRecord[] = []
            const m1 = committed(await a.commit(await a.readCommit(), treeRequest(1, { record, tag: 'one' }))).manifestKey
            clock.advance(ADMISSION_INTERVAL_MS + 1)
            committed(await a.commit(await a.readCommit(), treeRequest(0, { tag: 'two' })))
            const damage = async (key: string) => {
                await raw.removeBatch([key], (await raw.readCommit()).token, (await raw.readFence()).token)
            }
            const attempt = async (target: string, missing: string) => {
                await damage(missing)
                const beforeBytes = (await raw.readCommit()).bytes
                const result = await a.restore(await a.readCommit(), target)
                expect(result.status).toBe('refused')
                expect(result.status === 'refused' && result.reason).toBe('tree-incomplete')
                expect(result.status === 'refused' && result.missing).toContain(missing)
                const afterBytes = (await raw.readCommit()).bytes
                expect(beforeBytes !== null && afterBytes !== null && sameBytes(beforeBytes, afterBytes)).toBe(true)
            }
            await attempt(m1, keyOfTail(record[0].value))
            await attempt(m1, keyOfTail(record[0].preset as string))
            await attempt(m0, m0)
        })

        test('refuses a dropped manifest whose tree is complete, because it is neither retained nor pinned, and writes nothing', async () => {
            const { raw, wrapped, a, m0, m1, m2 } = await twoCommits()
            const key = await parsedCommit(raw)
            expect(key.retained.map(entry => entry.key)).toEqual([m0])
            expect(key.pins).toEqual([])
            expect(m1).not.toBe(m2)
            wrapped.log.length = 0
            const beforeBytes = (await raw.readCommit()).bytes
            const result = await a.restore(await a.readCommit(), m1)
            expect(result.status === 'refused' && result.reason).toBe('not-named')
            expect(wrapped.log).not.toContain('casCommit')
            const afterBytes = (await raw.readCommit()).bytes
            expect(beforeBytes !== null && afterBytes !== null && sameBytes(beforeBytes, afterBytes)).toBe(true)
            await expectInvariant(raw)
        })

        test('a pinned manifest that is no longer retained can be restored', async () => {
            const { raw, a, env, m0, m1 } = await twoCommits()
            await peerWrite(raw, env, { pins: [{ key: m1, reason: 'keep' }] })
            expect((await a.restore(await a.readCommit(), m1)).status).toBe('committed')
            const after = await parsedCommit(raw)
            expect(after.current?.key).toBe(m1)
            expect(after.retained.map(entry => entry.key)).toContain(m0)
            await expectInvariant(raw)
        })

        test('a garbage-collection batch at the base version landing before the restore write cannot delete what the restore installs', async () => {
            const { raw, clock, m1 } = await twoCommits()
            let fired = false
            const gc = async () => {
                fired = true
                const read = await raw.readCommit()
                const fence = await raw.readFence()
                await raw.removeBatch([m1], read.token, fence.token)
            }
            const wrapped = hooked(raw, {
                before: async (call) => {
                    if (call === 'casCommit' && !fired) {
                        await gc()
                    }
                },
            })
            const a = committerOf(wrapped.backend, clock, 400)
            const result = await a.restore(await a.readCommit(), m1)
            expect(result.status === 'refused' && result.reason).toBe('not-named')
            if (!fired) {
                await gc()
            }
            await expectInvariant(raw)
        })

        test('refuses a key that is not a manifest key and the manifest that is already current', async () => {
            const { raw, a, m2 } = await twoCommits()
            const notManifest = await a.restore(await a.readCommit(), `store2/u-${'0'.repeat(26)}`)
            expect(notManifest.status === 'refused' && notManifest.reason).toBe('bad-manifest-key')
            const already = await a.restore(await a.readCommit(), m2)
            expect(already.status === 'refused' && already.reason).toBe('already-current')
            await expectInvariant(raw)
        })
    })

    describe('save-mine', () => {
        test(name === 'node' ? 'is refused on Node and writes nothing' : 'rebuilds from the fresh read, pushes the peer\'s current inside the window and keeps marker, pins and conversion record', async () => {
            const { raw, wrapped, a, b, env, m0 } = await setup()
            const peer = await commitNext(b, 0, 'peer')
            await peerWrite(raw, env, { staging: FOREIGN_MARKER, pins: [{ key: m0, reason: 'keep' }], convertedFrom: 'old', convertedAt: 9 })
            const fresh = await a.readCommit()
            wrapped.log.length = 0
            const result = await a.saveMine(fresh, treeRequest(1, { tag: 'mine' }))
            if (name === 'node') {
                expect(result.status === 'refused' && result.reason).toBe('node-save-mine')
                expect(wrapped.log).not.toContain('commitOrdinary')
                return
            }
            const { manifestKey } = committed(result)
            const key = await parsedCommit(raw)
            expect(key.current?.key).toBe(manifestKey)
            expect(key.retained[0].key).toBe(peer)
            expect(key.staging).toEqual(FOREIGN_MARKER)
            expect(key.pins).toEqual([{ key: m0, reason: 'keep' }])
            expect(key.convertedFrom).toBe('old')
            expect(key.convertedAt).toBe(9)
            await expectInvariant(raw)
        })
    })

    describe('pins', () => {
        test('pin and unpin are commit-key writes that name only current or retained manifests', async () => {
            const { raw, a, m0 } = await setup()
            const m1 = await commitNext(a)
            const before = await parsedCommit(raw)
            expect((await a.pin(await a.readCommit(), m0, 'keep')).status).toBe('committed')
            const pinned = await parsedCommit(raw)
            expect(pinned.pins).toEqual([{ key: m0, reason: 'keep' }])
            expect(pinned.seq).toBe(before.seq + 1)
            expect(pinned.epoch).not.toBe(before.epoch)
            expect(pinned.current?.key).toBe(m1)

            const again = await a.pin(await a.readCommit(), m0, 'again')
            expect(again.status === 'refused' && again.reason).toBe('already-pinned')
            const unnamed = await a.pin(await a.readCommit(), `store2/m-${'1'.repeat(26)}`, 'x')
            expect(unnamed.status === 'refused' && unnamed.reason).toBe('not-named')

            expect((await a.unpin(await a.readCommit(), m0)).status).toBe('committed')
            expect((await parsedCommit(raw)).pins).toEqual([])
            const notPinned = await a.unpin(await a.readCommit(), m0)
            expect(notPinned.status === 'refused' && notPinned.reason).toBe('not-pinned')
            await expectInvariant(raw)
        })
    })

    describe('refusal on an unusable base', () => {
        const states: { reason: string, plant: (backend: Store2Backend) => Promise<void> }[] = [
            { reason: 'absent', plant: async () => {} },
            { reason: 'damaged', plant: async (backend) => plantCommit(backend, Uint8Array.from([1, 2, 3, 250, 251])) },
            { reason: 'too-new', plant: async (backend) => {
                const seed = firstCommitKey({ current: { key: `store2/m-${'0'.repeat(26)}`, at: 1 }, staging: null })
                await plantCommit(backend, encodeUnit(UNIT_TYPE.commit, { ...seed, fmt: 2 }))
            } },
            { reason: 'no-current', plant: async (backend) => plantCommit(backend, encodeUnit(UNIT_TYPE.commit, firstCommitKey({ current: null, staging: { ...FOREIGN_MARKER } }))) },
        ]

        test.each(states.map(state => [state.reason, state] as const))('%s: every operation is refused and nothing is written', async (_reason, state) => {
            const entry = await fixture.open()
            opened.push(entry)
            await state.plant(entry.backend)
            const wrapped = hooked(entry.backend)
            const clock = createClock()
            const committer = committerOf(wrapped.backend, clock, 100)
            const read = await committer.readCommit()
            wrapped.log.length = 0
            const results = [
                await committer.commit(read, treeRequest(0)),
                await committer.restore(read, `store2/m-${'0'.repeat(26)}`),
                await committer.saveMine(read, treeRequest(0)),
                await committer.pin(read, `store2/m-${'0'.repeat(26)}`, 'x'),
                await committer.unpin(read, `store2/m-${'0'.repeat(26)}`),
            ]
            for (const result of results) {
                expect(result.status).toBe('refused')
                expect(result.status === 'refused' && result.reason).toBe(state.reason)
            }
            expect(wrapped.log).toEqual([])
            const stored = (await entry.backend.readCommit()).bytes
            expect(stored === null ? null : Array.from(stored)).toEqual(read.bytes === null ? null : Array.from(read.bytes))
        })
    })
})

describe('the carry rule: a commit that carries units needs a base that names the manifest it was planned over', () => {
    async function ruleSetup(hooks: Hooks = {}) {
        const raw = createMemoryBackend()
        const clock = createClock()
        const m0 = await seedStore(raw, testEnv(clock, 1))
        const wrapped = hooked(raw, hooks)
        const env = testEnv(clock, 300)
        return { raw, wrapped, clock, m0, env, a: committerOf(wrapped.backend, clock, 100), b: committerOf(raw, clock, 200) }
    }

    /** A manifest key that no commit key names. */
    const unnamedKey = (env: KeyEnv): string => newManifestKey(env)

    function carrying(request: CommitRequest, from: string, units: number): CommitRequest {
        return { ...request, carry: { from, units } }
    }

    /** A request whose build records the legacy keep it was given. */
    function recording(extra: number, seen: Array<Manifest['fixed']['legacyKeep'] | undefined>, from: string, units: number): CommitRequest {
        const request = treeRequest(extra)
        return carrying({ ...request, build: (context) => { seen.push(context.legacyKeep); return request.build(context) } }, from, units)
    }

    /** A request whose manifest names a legacy keep, so a later base manifest holds one. */
    function keepingRequest(): CommitRequest {
        const request = treeRequest(0)
        return {
            ...request,
            build: (context) => {
                const built = request.build(context)
                if (built instanceof Promise) {
                    throw new Error('The fixture build is synchronous.')
                }
                const unit = built.units[0]
                built.manifest.body.fixed.legacyKeep = { unit: refOfFrame(unit.key, unit.bytes), v: 1, files: [] }
                return built
            },
        }
    }

    test('R7: an ordinary commit that carries units over a base that does not name its manifest is refused and writes nothing', async () => {
        const { raw, wrapped, a, env, m0 } = await ruleSetup()
        const before = await parsedCommit(raw)
        wrapped.log.length = 0
        const result = await a.commit(await a.readCommit(), carrying(treeRequest(0), unnamedKey(env), 5))
        expect(result.status === 'refused' && result.reason).toBe('base-unnamed')
        expect(wrapped.log).not.toContain('commitOrdinary')
        expect(await parsedCommit(raw)).toEqual(before)
        expect(before.current?.key).toBe(m0)
    })

    test('R7 and R14b: a save-mine that carries units is refused before any read, however damaged the base manifest is', async () => {
        const { raw, wrapped, a, env } = await ruleSetup()
        const ghost = newManifestKey(env)
        await peerWrite(raw, env, { current: { key: ghost, at: 1 } })
        await raw.putUnit(ghost, new Uint8Array([1, 2, 3]))
        wrapped.log.length = 0
        const result = await a.saveMine(await a.readCommit(), carrying(treeRequest(0), unnamedKey(env), 3))
        expect(result.status === 'refused' && result.reason).toBe('base-unnamed')
        expect(wrapped.log).not.toContain('readUnits')
        expect(wrapped.log).not.toContain('commitOrdinary')
    })

    test('G4: a base that names the manifest as current, retained or pinned lets the commit land; no carry and zero units over an unnamed base land too', async () => {
        const { raw, a, b, env, m0 } = await ruleSetup()
        expect((await a.commit(await a.readCommit(), carrying(treeRequest(0, { tag: 'cur' }), m0, 4))).status).toBe('committed')
        const m1 = (await parsedCommit(raw)).current?.key as string
        expect((await b.commit(await b.readCommit(), carrying(treeRequest(0, { tag: 'ret' }), m0, 4))).status).toBe('committed')
        expect((await parsedCommit(raw)).retained.map(entry => entry.key)).toContain(m0)
        const pinned = unnamedKey(env)
        await peerWrite(raw, env, { pins: [{ key: pinned, reason: 'keep' }] })
        expect((await a.commit(await a.readCommit(), carrying(treeRequest(0, { tag: 'pin' }), pinned, 4))).status).toBe('committed')
        expect((await a.commit(await a.readCommit(), carrying(treeRequest(0, { tag: 'zero' }), unnamedKey(env), 0))).status).toBe('committed')
        expect((await a.commit(await a.readCommit(), treeRequest(0, { tag: 'none' }))).status).toBe('committed')
        expect(m1).not.toBe(m0)
    })

    test('R14: a save-mine that carries nothing over an unnamed base refuses when the base manifest is absent, damaged or too new, and writes nothing', async () => {
        for (const state of ['absent', 'damaged', 'too-new'] as const) {
            const { raw, wrapped, a, env } = await ruleSetup()
            const ghost = newManifestKey(env)
            await peerWrite(raw, env, { current: { key: ghost, at: 1 } })
            if (state === 'damaged') {
                await raw.putUnit(ghost, new Uint8Array([1, 2, 3, 4]))
            }
            if (state === 'too-new') {
                await raw.putUnit(ghost, encodeUnit(UNIT_TYPE.manifest, { fmt: 99, req: [] }))
            }
            wrapped.log.length = 0
            const before = await parsedCommit(raw)
            const result = await a.saveMine(await a.readCommit(), carrying(treeRequest(0), unnamedKey(env), 0))
            expect(result.status === 'refused' && result.reason).toBe(state)
            expect(wrapped.log).not.toContain('commitOrdinary')
            expect(await parsedCommit(raw)).toEqual(before)
        }
    })

    test('R15: a backend failure during the keep read is a failed commit, not a refusal, and writes nothing', async () => {
        const hooks: Hooks = {}
        const { raw, wrapped, a, env } = await ruleSetup(hooks)
        hooks.before = (call) => {
            if (call === 'readUnits') {
                throw new Store2BackendFailureError('Injected read failure.')
            }
        }
        const before = await parsedCommit(raw)
        const result = await a.saveMine(await a.readCommit(), carrying(treeRequest(0), unnamedKey(env), 0))
        expect(result.status).toBe('failed')
        expect(wrapped.log).not.toContain('commitOrdinary')
        expect(await parsedCommit(raw)).toEqual(before)
    })

    test('R16: a save-mine that carries nothing over an unnamed base builds with the base manifest\'s keep, null or not', async () => {
        const { raw, a, b, env } = await ruleSetup()
        const seenNull: Array<Manifest['fixed']['legacyKeep'] | undefined> = []
        expect((await a.saveMine(await a.readCommit(), recording(0, seenNull, unnamedKey(env), 0))).status).toBe('committed')
        expect(seenNull).toEqual([null])

        expect((await b.commit(await b.readCommit(), keepingRequest())).status).toBe('committed')
        const baseManifest = (await parsedCommit(raw)).current?.key as string
        const stored = readUnit((await raw.readUnits([baseManifest])).get(baseManifest) as Uint8Array, UNIT_TYPE.manifest)
        const baseKeep = stored.status === 'ok' ? (stored.value.body as Manifest).fixed.legacyKeep : undefined
        expect(baseKeep).not.toBeNull()
        const seenKeep: Array<Manifest['fixed']['legacyKeep'] | undefined> = []
        expect((await a.saveMine(await a.readCommit(), recording(0, seenKeep, unnamedKey(env), 0))).status).toBe('committed')
        expect(seenKeep).toEqual([baseKeep])
    })

    test('G11: a save-mine over a base that names the manifest keeps the page\'s own keep: no read, no substitution', async () => {
        const { wrapped, a, m0 } = await ruleSetup()
        const seen: Array<Manifest['fixed']['legacyKeep'] | undefined> = []
        wrapped.log.length = 0
        expect((await a.saveMine(await a.readCommit(), recording(0, seen, m0, 6))).status).toBe('committed')
        expect(seen).toEqual([undefined])
        expect(wrapped.log).not.toContain('readUnits')
    })

    test('R8 and R13: a bulk commit that carries over a base that does not name its manifest is refused before the marker, whatever the unit count', async () => {
        for (const units of [0, 7]) {
            const { raw, wrapped, a, env } = await ruleSetup()
            const before = await parsedCommit(raw)
            wrapped.log.length = 0
            const result = await a.commit(await a.readCommit(), carrying(treeRequest(49), unnamedKey(env), units))
            expect(result.status === 'refused' && result.reason).toBe('base-unnamed')
            expect(wrapped.log).not.toContain('casCommit')
            expect(wrapped.log).not.toContain('putUnit')
            expect(await parsedCommit(raw)).toEqual(before)
        }
    })

    test('R9 and R13: a peer commit that drops the manifest during the upload refuses the final write, clears the own marker and leaves the peer\'s commit', async () => {
        for (const units of [0, 7]) {
            const hooks: Hooks = {}
            const { raw, a, env, m0 } = await ruleSetup(hooks)
            const ghost = newManifestKey(env)
            hooks.before = async (call, count) => {
                if (call === 'putUnit' && count === 2) {
                    await peerWrite(raw, env, { current: { key: ghost, at: 1 }, retained: [] })
                }
            }
            const result = await a.commit(await a.readCommit(), carrying(treeRequest(49), m0, units))
            expect(result.status === 'refused' && result.reason).toBe('base-unnamed')
            expect(result.status === 'refused' && result.cleared?.status).toBe('cleared')
            const key = await parsedCommit(raw)
            expect(key.current?.key).toBe(ghost)
            expect(key.staging).toBeNull()
        }
    })

    test('G3: a bulk commit lands when a peer commit made during the upload retains the manifest it carries from', async () => {
        const hooks: Hooks = {}
        const { raw, clock, m0 } = await ruleSetup(hooks)
        const peer = committerOf(raw, clock, 200)
        hooks.before = async (call, count) => {
            if (call === 'putUnit' && count === 2) {
                expect((await peer.commit(await peer.readCommit(), treeRequest(0, { tag: 'peer' }))).status).toBe('committed')
            }
        }
        const a = committerOf(hooked(raw, hooks).backend, clock, 100)
        const result = await a.commit(await a.readCommit(), carrying(treeRequest(49), m0, 9))
        expect(result.status).toBe('committed')
        expect((await parsedCommit(raw)).staging).toBeNull()
    })

    test('G7: save-mine on a Node token is refused as node-save-mine before the carry rule', async () => {
        const raw = createMemoryBackend()
        const clock = createClock()
        await seedStore(raw, testEnv(clock, 1))
        const committer = committerOf(raw, clock, 100)
        const read = await committer.readCommit()
        const result = await committer.saveMine({ ...read, token: { kind: 'revision', revision: 1, present: true } }, carrying(treeRequest(0), unnamedKey(testEnv(clock, 5)), 3))
        expect(result.status === 'refused' && result.reason).toBe('node-save-mine')
    })
})
