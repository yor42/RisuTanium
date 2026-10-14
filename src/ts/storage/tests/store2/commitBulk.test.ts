// @vitest-environment node
/**
 * Bulk commit and the abandon-clear over the memory, IndexedDB (fake-indexeddb)
 * and Node (real server process) backends: the 59/60 threshold, the marker
 * written before any unit, the final compare-and-write judged on a fresh read
 * after every conflict or lost response, and the marker clear that needs this
 * owner's id and prefix. Tauri is not run here.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Store2BackendFailureError, Store2UnknownOutcomeError, sameBytes } from 'src/ts/storage/store2/backend'
import { Store2BulkAbortError, type CommitResult } from 'src/ts/storage/store2/commit'
import { firstCommitKey } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, stagingPrefix, UNIT_TYPE, type CommitKey } from 'src/ts/storage/store2/format'
import type { ForeignClearHook } from 'src/ts/storage/store2/owner'
import {
    COMMIT_BACKENDS, committerOf, createClock, expectInvariant, hooked, parsedCommit, peerWrite, plantCommit,
    seedStore, testEnv, treeRequest, treeUnitCount, type BuildRecord, type Hooks, type OpenedBackend,
} from './commitFixtures'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const opened: OpenedBackend[] = []
const OTHER_PREFIX = stagingPrefix('1'.repeat(16))
const ORDINARY_MAX = 48
const BULK_MIN = 49

afterEach(async () => {
    await Promise.all(opened.splice(0).map(entry => entry.close()))
})

function expectCommitted(result: CommitResult): Extract<CommitResult, { status: 'committed' }> {
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') {
        throw new Error(`Expected committed, got ${result.status}.`)
    }
    return result
}

describe.each(COMMIT_BACKENDS.map(fixture => [fixture.name, fixture] as const))('bulk commit and abandon-clear on the %s backend', (_name, fixture) => {
    async function setup(hooks: Hooks = {}, foreignClear?: ForeignClearHook) {
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
            a: committerOf(wrapped.backend, clock, 100, { foreignClear }),
            env: testEnv(clock, 300),
        }
    }

    function marker(owner: string, prefix = OTHER_PREFIX): NonNullable<CommitKey['staging']> {
        return { owner, prefix, startedAt: 5, label: 'bulk' }
    }

    describe('bulk commit', () => {
        test('59 new units commit ordinarily and 60 commit in bulk', async () => {
            const ordinary = await setup()
            expect(treeUnitCount(ORDINARY_MAX)).toBe(59)
            const first = expectCommitted(await ordinary.a.commit(await ordinary.a.readCommit(), treeRequest(ORDINARY_MAX)))
            expect(first.mode).toBe('ordinary')
            expect(ordinary.wrapped.log).toContain('commitOrdinary')
            expect(ordinary.wrapped.log).not.toContain('putUnit')
            await expectInvariant(ordinary.raw)

            const bulk = await setup()
            expect(treeUnitCount(BULK_MIN)).toBe(60)
            const second = expectCommitted(await bulk.a.commit(await bulk.a.readCommit(), treeRequest(BULK_MIN)))
            expect(second.mode).toBe('bulk')
            expect(bulk.wrapped.log).not.toContain('commitOrdinary')
            expect(bulk.wrapped.count('putUnit')).toBe(60)
            expect(bulk.wrapped.count('casCommit')).toBe(2)
            await expectInvariant(bulk.raw)
        })

        test('the marker with its label is on the commit key before the first unit, every unit lies under its prefix, and the final write clears it', async () => {
            const seen: { key: CommitKey, putKeys: string[] }[] = []
            const record: BuildRecord[] = []
            const hooks: Hooks = {}
            const { raw, a, m0 } = await setup(hooks)
            const before = await parsedCommit(raw)
            hooks.before = async (call) => {
                if (call === 'putUnit' && seen.length === 0) {
                    seen.push({ key: await parsedCommit(raw), putKeys: [] })
                }
            }
            const result = expectCommitted(await a.commit(await a.readCommit(), treeRequest(BULK_MIN, { record, label: 'import' })))
            expect(seen).toHaveLength(1)
            const mark = seen[0].key
            expect(mark.staging).toEqual({ owner: a.owner, prefix: expect.stringMatching(/^store2\/g-[0-9a-v]{16}-$/), startedAt: expect.any(Number), label: 'import' })
            expect(mark.current?.key).toBe(m0)
            expect(mark.seq).toBe(before.seq + 1)
            const prefix = mark.staging?.prefix as string
            expect(record[0].keys.every(key => key.startsWith(prefix))).toBe(true)
            const after = await parsedCommit(raw)
            expect(after.staging).toBeNull()
            expect(after.current?.key).toBe(result.manifestKey)
            expect(after.seq).toBe(before.seq + 2)
            expect(after.retained.map(entry => entry.key)).toEqual([m0])
            await expectInvariant(raw)
        })

        test('is refused while a marker stands, before anything is written', async () => {
            const { raw, wrapped, a, env } = await setup()
            await peerWrite(raw, env, { staging: marker('p'.repeat(26)) })
            wrapped.log.length = 0
            const result = await a.commit(await a.readCommit(), treeRequest(BULK_MIN))
            expect(result.status === 'refused' && result.reason).toBe('marker-present')
            expect(wrapped.log).not.toContain('putUnit')
            expect(wrapped.log).not.toContain('casCommit')
        })

        test('a stale base conflicts at the marker and uploads nothing', async () => {
            const { raw, wrapped, a, env } = await setup()
            const stale = await a.readCommit()
            await peerWrite(raw, env, { pins: [] })
            const result = await a.commit(stale, treeRequest(BULK_MIN))
            expect(result.status).toBe('conflict')
            expect(wrapped.log).not.toContain('putUnit')
            expect((await parsedCommit(raw)).staging).toBeNull()
        })

        test('a final write whose response was lost but applied is done: this owner\'s manifest is current and nothing is cleared', async () => {
            const hooks: Hooks = {}
            const { raw, wrapped, a } = await setup(hooks)
            hooks.after = (call, count) => {
                if (call === 'casCommit' && count === 2) {
                    throw new Store2UnknownOutcomeError('Injected lost response.')
                }
            }
            const result = expectCommitted(await a.commit(await a.readCommit(), treeRequest(BULK_MIN)))
            expect(wrapped.count('casCommit')).toBe(2)
            const key = await parsedCommit(raw)
            expect(key.current?.key).toBe(result.manifestKey)
            expect(key.staging).toBeNull()
            await expectInvariant(raw)
        })

        test('a final write that was lost before it applied is judged on a fresh read and made again', async () => {
            const hooks: Hooks = {}
            const { raw, wrapped, a } = await setup(hooks)
            hooks.before = (call, count) => {
                if (call === 'casCommit' && count === 2) {
                    throw new Store2UnknownOutcomeError('Injected lost request.')
                }
            }
            const result = expectCommitted(await a.commit(await a.readCommit(), treeRequest(BULK_MIN)))
            expect(wrapped.count('casCommit')).toBe(3)
            expect((await parsedCommit(raw)).current?.key).toBe(result.manifestKey)
            await expectInvariant(raw)
        })

        test('a marker cleared by another party during the upload abandons the commit: the manifest is not installed and the conflict is not retried', async () => {
            const hooks: Hooks = {}
            const { raw, wrapped, a, env, m0 } = await setup(hooks)
            hooks.before = async (call, count) => {
                if (call === 'putUnit' && count === 2) {
                    await peerWrite(raw, env, { staging: null })
                }
            }
            const result = await a.commit(await a.readCommit(), treeRequest(BULK_MIN))
            expect(result.status).toBe('abandoned')
            expect(result.status === 'abandoned' && result.reason).toBe('marker-lost')
            expect(wrapped.count('casCommit')).toBe(2)
            const key = await parsedCommit(raw)
            expect(key.current?.key).toBe(m0)
            expect(key.staging).toBeNull()
            await expectInvariant(raw)
        })

        test('a marker replaced by the same owner\'s marker under another prefix abandons the commit: the manifest is not installed', async () => {
            const hooks: Hooks = {}
            const { raw, wrapped, a, env, m0 } = await setup(hooks)
            hooks.before = async (call, count) => {
                if (call === 'putUnit' && count === 2) {
                    await peerWrite(raw, env, { staging: marker(a.owner) })
                }
            }
            const result = await a.commit(await a.readCommit(), treeRequest(BULK_MIN))
            expect(result.status === 'abandoned' && result.reason).toBe('marker-lost')
            expect(result.status === 'abandoned' && result.cleared).toBeNull()
            expect(wrapped.count('casCommit')).toBe(2)
            const key = await parsedCommit(raw)
            expect(key.current?.key).toBe(m0)
            expect(key.staging?.prefix).toBe(OTHER_PREFIX)
            await expectInvariant(raw)
        })

        test('a peer\'s ordinary commit made while the marker stands is kept in retained when the final write conflicts and is made again', async () => {
            const hooks: Hooks = {}
            const { raw, wrapped, clock, m0 } = await setup(hooks)
            const peer = committerOf(raw, clock, 200)
            let peerManifest = ''
            hooks.before = async (call, count) => {
                if (call === 'putUnit' && count === 2) {
                    const committed = expectCommitted(await peer.commit(await peer.readCommit(), treeRequest(0, { tag: 'peer' })))
                    peerManifest = committed.manifestKey
                }
            }
            const a = committerOf(wrapped.backend, clock, 100)
            const result = expectCommitted(await a.commit(await a.readCommit(), treeRequest(BULK_MIN)))
            expect(result.mode).toBe('bulk')
            expect(wrapped.count('casCommit')).toBe(3)
            const key = await parsedCommit(raw)
            expect(key.current?.key).toBe(result.manifestKey)
            expect(key.staging).toBeNull()
            expect(key.retained.map(entry => entry.key)).toEqual([peerManifest, m0])
            await expectInvariant(raw)
        })

        test('another party\'s pin during the upload changes the key but not the marker: the final write is made again on a fresh read and keeps the pin', async () => {
            const hooks: Hooks = {}
            const { raw, a, env, m0 } = await setup(hooks)
            hooks.before = async (call, count) => {
                if (call === 'putUnit' && count === 2) {
                    await peerWrite(raw, env, { pins: [{ key: m0, reason: 'keep' }] })
                }
            }
            const result = expectCommitted(await a.commit(await a.readCommit(), treeRequest(BULK_MIN)))
            const key = await parsedCommit(raw)
            expect(key.current?.key).toBe(result.manifestKey)
            expect(key.pins).toEqual([{ key: m0, reason: 'keep' }])
            expect(key.staging).toBeNull()
            await expectInvariant(raw)
        })

        test('a failed upload abandons the commit and clears this owner\'s marker, leaving current as it was', async () => {
            const hooks: Hooks = {}
            const { raw, a, m0 } = await setup(hooks)
            hooks.before = (call, count) => {
                if (call === 'putUnit' && count === 3) {
                    throw new Store2BackendFailureError('Injected failure.')
                }
            }
            const result = await a.commit(await a.readCommit(), treeRequest(BULK_MIN))
            expect(result.status === 'abandoned' && result.reason).toBe('upload-failed')
            expect(result.status === 'abandoned' && result.cleared?.status).toBe('cleared')
            const key = await parsedCommit(raw)
            expect(key.current?.key).toBe(m0)
            expect(key.staging).toBeNull()
            await expectInvariant(raw)
        })

        test('a build that throws clears the marker and rethrows with the clear result', async () => {
            const { raw, a } = await setup()
            const failure = await a.commit(await a.readCommit(), {
                newUnits: treeUnitCount(BULK_MIN),
                build: () => { throw new Error('codec failed') },
            }).catch((error: unknown) => error)
            expect(failure).toBeInstanceOf(Store2BulkAbortError)
            expect(failure).toHaveProperty('message', 'codec failed')
            expect((failure as Store2BulkAbortError).cleared?.status).toBe('cleared')
            expect((await parsedCommit(raw)).staging).toBeNull()
        })

        test('a build that throws while the own-marker clear also fails tells the caller the marker may still stand', async () => {
            const hooks: Hooks = {}
            const { raw, a } = await setup(hooks)
            hooks.before = (call, count) => {
                if (call === 'casCommit' && count === 2) {
                    throw new Store2BackendFailureError('Injected failure.')
                }
            }
            const failure = await a.commit(await a.readCommit(), {
                newUnits: treeUnitCount(BULK_MIN),
                build: () => { throw new Error('codec failed') },
            }).catch((error: unknown) => error)
            expect(failure).toBeInstanceOf(Store2BulkAbortError)
            expect((failure as Store2BulkAbortError).cleared?.status).toBe('failed')
            expect((await parsedCommit(raw)).staging?.owner).toBe(a.owner)
        })
    })

    describe('abandon-clear', () => {
        test('clears only a marker with this owner id and this prefix, and writes back exactly what it read', async () => {
            const { raw, wrapped, a, env, m0 } = await setup()
            await peerWrite(raw, env, { staging: marker(a.owner), pins: [{ key: m0, reason: 'keep' }], convertedFrom: 'old', convertedAt: 3 })
            const planted = await parsedCommit(raw)
            const plantedBytes = (await raw.readCommit()).bytes as Uint8Array
            wrapped.log.length = 0

            const foreign = await a.abandonClear(await a.readCommit(), 'z'.repeat(26), OTHER_PREFIX)
            expect(foreign.status === 'refused' && foreign.reason).toBe('not-mine')
            const wrongPrefix = await a.abandonClear(await a.readCommit(), a.owner, stagingPrefix('2'.repeat(16)))
            expect(wrongPrefix.status === 'refused' && wrongPrefix.reason).toBe('not-mine')
            expect(wrapped.log).not.toContain('casCommit')
            expect(sameBytes((await raw.readCommit()).bytes as Uint8Array, plantedBytes)).toBe(true)

            const cleared = await a.abandonClear(await a.readCommit(), a.owner, OTHER_PREFIX)
            expect(cleared.status).toBe('cleared')
            const key = await parsedCommit(raw)
            expect(key.staging).toBeNull()
            expect(key.current).toEqual(planted.current)
            expect(key.retained).toEqual(planted.retained)
            expect(key.pins).toEqual(planted.pins)
            expect(key.convertedFrom).toBe('old')
            expect(key.seq).toBe(planted.seq + 1)
            expect(key.epoch).not.toBe(planted.epoch)
            await expectInvariant(raw)
        })

        test('with no marker it writes nothing, and it clears a marker over a null current without making one up', async () => {
            const { raw, wrapped, a } = await setup()
            wrapped.log.length = 0
            expect((await a.abandonClear(await a.readCommit(), a.owner, OTHER_PREFIX)).status).toBe('nothing')
            expect(wrapped.log).not.toContain('casCommit')

            await plantCommit(raw, encodeUnit(UNIT_TYPE.commit, firstCommitKey({ current: null, staging: marker(a.owner) })))
            expect((await a.abandonClear(await a.readCommit(), a.owner, OTHER_PREFIX)).status).toBe('cleared')
            const key = await parsedCommit(raw)
            expect(key.current).toBeNull()
            expect(key.staging).toBeNull()
        })

        test('an applied clear whose response was lost is read back and is done without a second write', async () => {
            const hooks: Hooks = {}
            const { raw, wrapped, a, env } = await setup(hooks)
            await peerWrite(raw, env, { staging: marker(a.owner) })
            const read = await a.readCommit()
            wrapped.log.length = 0
            hooks.after = (call) => {
                if (call === 'casCommit') {
                    throw new Store2UnknownOutcomeError('Injected lost response.')
                }
            }
            const result = await a.abandonClear(read, a.owner, OTHER_PREFIX)
            expect(result.status).toBe('cleared')
            expect(wrapped.log.filter(call => call === 'casCommit')).toHaveLength(1)
            expect((await parsedCommit(raw)).staging).toBeNull()
        })

        test('a clear lost before it applied is judged on a fresh read and made again', async () => {
            const hooks: Hooks = {}
            const { raw, wrapped, a, env } = await setup(hooks)
            await peerWrite(raw, env, { staging: marker(a.owner) })
            const read = await a.readCommit()
            wrapped.log.length = 0
            hooks.before = (call, count) => {
                if (call === 'casCommit' && count === 1) {
                    throw new Store2UnknownOutcomeError('Injected lost request.')
                }
            }
            expect((await a.abandonClear(read, a.owner, OTHER_PREFIX)).status).toBe('cleared')
            expect(wrapped.log.filter(call => call === 'casCommit')).toHaveLength(2)
            expect((await parsedCommit(raw)).staging).toBeNull()
        })

        test('a conflict is judged again on a fresh read: a pin made meanwhile is kept, a marker replaced by another owner\'s is not cleared', async () => {
            const { raw, wrapped, a, env, m0 } = await setup()
            await peerWrite(raw, env, { staging: marker(a.owner) })
            const stale = await a.readCommit()
            await peerWrite(raw, env, { pins: [{ key: m0, reason: 'keep' }] })
            expect((await a.abandonClear(stale, a.owner, OTHER_PREFIX)).status).toBe('cleared')
            const key = await parsedCommit(raw)
            expect(key.pins).toEqual([{ key: m0, reason: 'keep' }])
            expect(key.staging).toBeNull()

            await peerWrite(raw, env, { staging: marker(a.owner) })
            const staleAgain = await a.readCommit()
            await peerWrite(raw, env, { staging: marker('p'.repeat(26)) })
            wrapped.log.length = 0
            const result = await a.abandonClear(staleAgain, a.owner, OTHER_PREFIX)
            expect(result.status === 'refused' && result.reason).toBe('not-mine')
            expect(wrapped.log.filter(call => call === 'casCommit')).toHaveLength(1)
            expect((await parsedCommit(raw)).staging?.owner).toBe('p'.repeat(26))
        })
    })

    describe('foreign-clear hook', () => {
        test('an own marker is cleared without a question, a foreign one only when the hook says yes', async () => {
            const questions: unknown[] = []
            let answer = false
            const { raw, a, env } = await setup({}, async (asked: unknown) => {
                questions.push(asked)
                return answer
            })
            await peerWrite(raw, env, { staging: marker(a.owner) })
            const own = await a.clearMarker(await a.readCommit())
            expect(own.decision).toEqual({ decision: 'clear', marker: marker(a.owner), own: true })
            expect(own.cleared?.status).toBe('cleared')
            expect(questions).toHaveLength(0)

            await peerWrite(raw, env, { staging: marker('p'.repeat(26)) })
            const declined = await a.clearMarker(await a.readCommit())
            expect(declined.decision.decision).toBe('leave')
            expect(declined.cleared).toBeNull()
            expect((await parsedCommit(raw)).staging?.owner).toBe('p'.repeat(26))
            expect(questions).toHaveLength(1)

            answer = true
            const agreed = await a.clearMarker(await a.readCommit())
            expect(agreed.decision).toEqual({ decision: 'clear', marker: marker('p'.repeat(26)), own: false })
            expect(agreed.cleared?.status).toBe('cleared')
            expect((await parsedCommit(raw)).staging).toBeNull()
        })

        test('without a hook a foreign marker is left', async () => {
            const { raw, a, env } = await setup()
            await peerWrite(raw, env, { staging: marker('p'.repeat(26)) })
            const result = await a.clearMarker(await a.readCommit())
            expect(result.decision.decision).toBe('leave')
            expect((await parsedCommit(raw)).staging?.owner).toBe('p'.repeat(26))
        })
    })
})
