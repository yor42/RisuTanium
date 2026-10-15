// @vitest-environment node
/**
 * Picking a recovery candidate and installing it, over the memory, IndexedDB
 * (fake-indexeddb) and Node (real server process) backends: the read-only closure
 * read after the marker, the MC-291 count of missing images and inlays, the staged
 * re-write under fresh keys, and the final compare-and-write at the marker's
 * token. Tauri is not run.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    Store2BackendFailureError, Store2CommitConflictError, Store2UnknownOutcomeError, type Store2Backend, type Store2Read,
} from 'src/ts/storage/store2/backend'
import { classifyCommitRead, nextCommitKey } from 'src/ts/storage/store2/commitKey'
import { isStagingPrefix, type CommitKey } from 'src/ts/storage/store2/format'
import {
    installPick, pickCandidate, unmappedRefPaths, type AssetsPresent, type InlayPrefixesPresent, type InlaysPresent, type PickReady, type PickResult,
} from 'src/ts/storage/store2/recoveryPick'
import { inlayIdFromMetaKey, inlayMetaKey } from 'src/ts/process/files/inlayKeys'
import { readTree } from 'src/ts/storage/store2/tree'
import { createClock, hooked, parsedCommit, plantKey, testEnv, type Hooks } from './commitFixtures'
import { FENCE_BACKENDS, plantCommit, traced, type OpenedBackend } from './fenceFixtures'
import {
    closureOf, hexOf, plantTree, treeFingerprint, type PlantOptions, type Planted,
} from './recoveryFixtures'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const opened: OpenedBackend[] = []

afterEach(async () => {
    await Promise.all(opened.splice(0).map(entry => entry.close()))
})

const DAMAGED_COMMIT = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63])
const ME = 'a'.repeat(26)

async function openBackend(index: number): Promise<Store2Backend> {
    const entry = await FENCE_BACKENDS[index].open()
    opened.push(entry)
    return entry.backend
}

interface Probes {
    assetsPresent: AssetsPresent
    inlaysPresent: InlaysPresent
    inlayPrefixesPresent: InlayPrefixesPresent
    assetCalls: string[][]
    inlayCalls: string[][]
    prefixCalls: string[][]
}

/** A metadata key with its id lower-cased: how a caller compares case-insensitively. */
function folded(key: string): string {
    const id = inlayIdFromMetaKey(key)
    return id === null ? key : inlayMetaKey(id.toLowerCase()) as string
}

/** Presence probes over fixed sets of stored inlay keys; a probe that is given `onCall` reports each call to it. */
function probes(present: { assets: ReadonlySet<string>, inlays: ReadonlySet<string> }, onCall?: (name: string) => void): Probes {
    const assetCalls: string[][] = []
    const inlayCalls: string[][] = []
    const prefixCalls: string[][] = []
    const foldedInlays = new Set([...present.inlays].map(folded))
    return {
        assetCalls,
        inlayCalls,
        prefixCalls,
        inlayPrefixesPresent: async (prefixes) => {
            onCall?.('probe:prefixes')
            prefixCalls.push([...prefixes])
            return new Set(prefixes.filter(prefix => [...present.inlays].some(key => key.startsWith(prefix))))
        },
        assetsPresent: async (keys) => {
            onCall?.('probe:assets')
            assetCalls.push([...keys])
            return new Set(keys.filter(key => present.assets.has(key)))
        },
        inlaysPresent: async (keys) => {
            onCall?.('probe:inlays')
            inlayCalls.push([...keys])
            return new Set(keys.filter(key => foldedInlays.has(key)))
        },
    }
}

function allPresent(planted: Planted): Parameters<typeof probes>[0] {
    return {
        assets: new Set([...planted.assetHexes, ...planted.assetNames]),
        inlays: new Set([...planted.inlayMetaKeys, ...planted.inlayPrefixes.map(prefix => `${prefix}png`)]),
    }
}

interface Scene {
    backend: Store2Backend
    planted: Planted
    read: Store2Read
    clock: ReturnType<typeof createClock>
    before: string[]
}

async function scene(index: number, plant: PlantOptions = {}, seed = 3): Promise<Scene> {
    const backend = await openBackend(index)
    const clock = createClock()
    const planted = await plantTree(backend, testEnv(clock, seed), plant)
    await plantCommit(backend, DAMAGED_COMMIT)
    return { backend, planted, read: await backend.readCommit(), clock, before: await backend.listStore2() }
}

function options(clock: ReturnType<typeof createClock>, p: Probes, seed = 77) {
    return { owner: ME, env: testEnv(clock, seed), assetsPresent: p.assetsPresent, inlaysPresent: p.inlaysPresent, inlayPrefixesPresent: p.inlayPrefixesPresent }
}

function expectReady(result: PickResult): PickReady {
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') {
        throw new Error(`The pick ended ${result.status}.`)
    }
    return result
}

async function installed(ready: PickReady): Promise<Extract<Awaited<ReturnType<typeof installPick>>, { status: 'installed' }>> {
    const result = await installPick(ready, { confirm: true })
    expect(result.status).toBe('installed')
    if (result.status !== 'installed') {
        throw new Error(`The install ended ${result.status}.`)
    }
    return result
}

/** The calls that a pick may not make after its marker landed: anything that writes. */
function writesAfterMarker(log: readonly string[]): string[] {
    const marker = log.indexOf('casCommit')
    return log.slice(marker + 1).filter(name => name === 'putUnit' || name === 'casFence' || name === 'casCommit' || name === 'commitOrdinary' || name === 'removeBatch')
}

describe('pick tables', () => {
    test('every reference position the walk descends has a unit type', () => {
        expect(unmappedRefPaths()).toEqual([])
    })
})

describe.each(FENCE_BACKENDS.map((fixture, index) => [fixture.name, index] as const))('recovery pick on the %s backend', (_name, index) => {
    describe('the pick up to the confirmation', () => {
        test('an m- candidate: the marker stands, the closure is read in full, the counts are zero when everything is present', async () => {
            const { backend, planted, read, clock } = await scene(index)
            const p = probes(allPresent(planted))
            const ready = expectReady(await pickCandidate(backend, read, planted.manifestKey, options(clock, p)))

            expect(ready.units).toBe(planted.written.length)
            expect(ready.manifestSeq).toBe(planted.body.seq)
            expect(ready.counts).toEqual({ missingImages: 0, missingInlays: 0, unknownLists: 0 })
            const stored = await parsedCommit(backend)
            expect(stored.current).toBeNull()
            expect(stored.staging).toMatchObject({ owner: ME, label: 'recovery', prefix: ready.marked.stagedPrefix })
            expect(stored.seq).toBe(planted.body.seq + 1)
            // Distinct keys, asked once: the asset names and hash stems the lists hold, and the inlay records of their ids.
            expect(p.assetCalls.flat().sort()).toEqual([...planted.assetHexes, ...planted.assetNames].sort())
            expect(p.inlayCalls.flat().sort()).toEqual([...planted.inlayMetaKeys].sort())
            // Nothing but the marker and the fence was written: the store holds exactly the planted units.
            expect((await backend.listStore2()).length).toBe(planted.written.length)
        })

        test('a completed staged candidate is picked like an ordinary one', async () => {
            const { backend, planted, read, clock } = await scene(index, { flavor: { stagingId: '0123456789abcdef' } })
            expect(planted.manifestKey.startsWith('store2/g-0123456789abcdef-m')).toBe(true)
            const p = probes(allPresent(planted))
            const ready = expectReady(await pickCandidate(backend, read, planted.manifestKey, options(clock, p)))
            expect(ready.marked.stagedPrefix).not.toBe('store2/g-0123456789abcdef-')
            expect(isStagingPrefix(ready.marked.stagedPrefix)).toBe(true)
            const result = await installed(ready)
            expect(result.manifestKey.startsWith(ready.marked.stagedPrefix)).toBe(true)
        })

        test('a manifest that is missing or not a manifest key fails before any write', async () => {
            const { backend, planted, read, clock } = await scene(index)
            const recorded = traced(backend)
            const p = probes(allPresent(planted))
            const missingKey = `store2/m-${'0'.repeat(26)}`
            const missing = await pickCandidate(recorded.backend, read, missingKey, options(clock, p))
            expect(missing).toMatchObject({ status: 'invalid', marked: null, problem: { kind: 'missing', keys: [missingKey] } })
            const notManifest = await pickCandidate(recorded.backend, read, planted.byRole.get('core')?.[0] as string, options(clock, p))
            expect(notManifest).toMatchObject({ status: 'invalid', marked: null, problem: { kind: 'damaged' } })
            expect(recorded.log.filter(name => name !== 'readUnits')).toEqual([])
            expect(p.assetCalls).toEqual([])
            expect((await backend.readCommit()).bytes).toEqual(DAMAGED_COMMIT)
        })

        test.each([
            ['chat chunk', 'chunk'], ['chat core', 'chatCore'], ['character core', 'core'], ['lore', 'lore'], ['scripts', 'scripts'],
            ['character asset list', 'charAl'], ['character inlay list', 'charIl'], ['module unit', 'module'], ['module asset list', 'modAl'],
            ['module inlay list', 'modIl'], ['plugin-storage value', 'value'], ['config', 'config'], ['preset', 'preset'], ['plugin', 'plugin'],
            ['legacy list', 'legacy'], ['config asset list', 'configAl'], ['statics', 'statics'], ['shard', 'shard'], ['module index', 'moduleIndex'],
            ['plugin-storage bucket', 'bucket'],
        ] as const)('a missing %s fails loudly with its key and writes nothing after the marker', async (_label, role) => {
            const { backend, planted, read, clock } = await scene(index, { omit: role })
            const recorded = traced(backend)
            const p = probes(allPresent(planted))
            const result = await pickCandidate(recorded.backend, read, planted.manifestKey, options(clock, p))
            expect(result.status).toBe('invalid')
            if (result.status !== 'invalid') {
                return
            }
            expect(result.problem.kind).toBe('missing')
            if (result.problem.kind === 'missing') {
                const wanted = planted.byRole.get(role) as string[]
                expect(result.problem.keys.length).toBeGreaterThan(0)
                for (const key of result.problem.keys) {
                    expect(wanted).toContain(key)
                }
            }
            expect(result.marked).not.toBeNull()
            expect(writesAfterMarker(recorded.log)).toEqual([])
            expect(p.assetCalls).toEqual([])
            expect(p.inlayCalls).toEqual([])
            // The marker stands; the screen returns and offers the pick again.
            expect((await parsedCommit(backend)).staging?.label).toBe('recovery')
        })

        test.each([['chunk'], ['value'], ['configAl'], ['core']] as const)('a damaged %s fails loudly with its key', async (role) => {
            const { backend, planted, read, clock } = await scene(index, { corrupt: role })
            const p = probes(allPresent(planted))
            const result = await pickCandidate(backend, read, planted.manifestKey, options(clock, p))
            expect(result).toMatchObject({ status: 'invalid', problem: { kind: 'damaged' } })
            if (result.status === 'invalid' && result.problem.kind === 'damaged') {
                expect(planted.byRole.get(role)).toContain(result.problem.key)
            }
        })

        test.each([['chunk', 'wrongSize'], ['chunk', 'wrongCrc'], ['value', 'wrongSize'], ['value', 'wrongCrc'], ['configAl', 'wrongCrc']] as const)('an intact %s whose referrer holds a wrong size or checksum (%s) is damaged', async (role, flaw) => {
            const { backend, planted, read, clock } = await scene(index, { [flaw]: role })
            const p = probes(allPresent(planted))
            const result = await pickCandidate(backend, read, planted.manifestKey, options(clock, p))
            expect(result).toMatchObject({ status: 'invalid', problem: { kind: 'damaged' } })
            if (result.status === 'invalid' && result.problem.kind === 'damaged') {
                expect(planted.byRole.get(role)).toContain(result.problem.key)
            }
        })

        test('a unit stored under another frame type than its position expects fails loudly with its key and writes nothing after the marker', async () => {
            const { backend, planted, read, clock } = await scene(index, { wrongType: 'lore' })
            const recorded = traced(backend)
            const p = probes(allPresent(planted))
            const result = await pickCandidate(recorded.backend, read, planted.manifestKey, options(clock, p))
            expect(result).toMatchObject({ status: 'invalid', problem: { kind: 'damaged' } })
            if (result.status === 'invalid' && result.problem.kind === 'damaged') {
                expect(planted.byRole.get('lore')).toContain(result.problem.key)
                expect(result.problem.reason).toContain('type')
            }
            expect(writesAfterMarker(recorded.log)).toEqual([])
        })

        test.each([['wrongSize'], ['wrongCrc']] as const)('a unit named twice by one parent with a different size or checksum (%s) is damaged', async (flaw) => {
            const { backend, planted, read, clock } = await scene(index, { duplicateRef: flaw })
            const recorded = traced(backend)
            const p = probes(allPresent(planted))
            const result = await pickCandidate(recorded.backend, read, planted.manifestKey, options(clock, p))
            expect(result).toMatchObject({ status: 'invalid', problem: { kind: 'damaged' } })
            if (result.status === 'invalid' && result.problem.kind === 'damaged') {
                expect(planted.byRole.get('preset')).toContain(result.problem.key)
            }
            expect(writesAfterMarker(recorded.log)).toEqual([])
        })

        test('a leaf of a newer frame format is too-new, never damaged or missing', async () => {
            const { backend, planted, read, clock } = await scene(index, { tooNew: 'chunk' })
            const p = probes(allPresent(planted))
            const result = await pickCandidate(backend, read, planted.manifestKey, options(clock, p))
            expect(result).toMatchObject({ status: 'invalid', problem: { kind: 'too-new' } })
        })

        test('a backend failure during the closure read is unreadable, and nothing more is written', async () => {
            const { backend, planted, read, clock } = await scene(index)
            // The first readUnits is the manifest; every later one fails.
            const failing = hooked(backend, {
                before: (name, count) => {
                    if (name === 'readUnits' && count >= 2) {
                        throw new Store2BackendFailureError('Injected read failure.')
                    }
                },
            })
            const p = probes(allPresent(planted))
            const result = await pickCandidate(failing.backend, read, planted.manifestKey, options(clock, p))
            expect(result).toMatchObject({ status: 'invalid', problem: { kind: 'unreadable' } })
            expect(writesAfterMarker(failing.log)).toEqual([])
        })

        test('an exit that does not end marked is passed through and nothing is read', async () => {
            const { backend, planted, read, clock } = await scene(index)
            const p = probes(allPresent(planted))
            const first = expectReady(await pickCandidate(backend, read, planted.manifestKey, options(clock, p)))
            expect(first.status).toBe('ready')
            // A second page with the same stale read meets the first page's marker.
            const second = await pickCandidate(backend, read, planted.manifestKey, { ...options(clock, p, 91), owner: 'b'.repeat(26) })
            expect(second).toMatchObject({ status: 'exit', exit: { status: 'conflict' } })
        })
    })

    describe('MC-291: images and inlays the lists name and the store lacks', () => {
        test('exact counts with some images and inlays absent', async () => {
            const { backend, planted, read, clock } = await scene(index)
            const present = {
                assets: new Set([hexOf(1), 'background.png', hexOf(10), hexOf(100), 'mod0.png']),
                inlays: new Set([planted.inlayMetaKeys[1]]),
            }
            const p = probes(present)
            const ready = expectReady(await pickCandidate(backend, read, planted.manifestKey, options(clock, p)))
            const named = planted.assetHexes.length + planted.assetNames.length
            expect(named).toBe(12)
            expect(ready.counts).toEqual({ missingImages: named - 5, missingInlays: planted.inlayMetaKeys.length - 1, unknownLists: 0 })
        })

        test('an inlay hash stem is probed by its asset-path prefix: an absent inlay counts missing', async () => {
            const { backend, planted, read, clock } = await scene(index, { extraInlays: { hexes: [7, 8] } })
            expect(planted.inlayPrefixes.length).toBe(2)
            expect(planted.inlayPrefixes[0]).toBe(`inlays/m-assets%2F${hexOf(7)}%2E`)
            const everything = allPresent(planted)
            const missingBoth = probes({ ...everything, inlays: new Set(planted.inlayMetaKeys) })
            const none = expectReady(await pickCandidate(backend, read, planted.manifestKey, options(clock, missingBoth)))
            expect(none.counts.missingInlays).toBe(2)
            expect(missingBoth.prefixCalls.flat().sort()).toEqual([...planted.inlayPrefixes].sort())
        })

        test('a present asset-path inlay is not counted missing', async () => {
            const { backend, planted, read, clock } = await scene(index, { extraInlays: { hexes: [7, 8] } })
            const oneThere = probes({ ...allPresent(planted), inlays: new Set([...planted.inlayMetaKeys, `${planted.inlayPrefixes[1]}webp`]) })
            const ready = expectReady(await pickCandidate(backend, read, planted.manifestKey, options(clock, oneThere)))
            expect(ready.counts.missingInlays).toBe(1)
        })

        test('an inlay stored under an upper-case id is not counted missing: ids are compared case-insensitively', async () => {
            const upperUuid = 'ABCDEF01-0000-4000-8000-000000000000'
            const { backend, planted, read, clock } = await scene(index, { extraInlays: { u: [upperUuid], o: ['Other-ID'] } })
            const assets = new Set([...planted.assetHexes, ...planted.assetNames])
            const others = planted.inlayMetaKeys.filter(key => !key.includes('abcdef01') && !key.includes('other-id'))
            const withUpper = probes({ assets, inlays: new Set([...others, inlayMetaKey(upperUuid) as string, inlayMetaKey('Other-ID') as string]) })
            const found = expectReady(await pickCandidate(backend, read, planted.manifestKey, options(clock, withUpper)))
            expect(found.counts.missingInlays).toBe(0)
            // The same tree with those two records absent: exactly the two count.
            const second = await scene(index, { extraInlays: { u: [upperUuid], o: ['Other-ID'] } }, 4)
            const without = probes({ assets, inlays: new Set(others) })
            const missing = expectReady(await pickCandidate(second.backend, second.read, second.planted.manifestKey, options(second.clock, without)))
            expect(missing.counts.missingInlays).toBe(2)
        })

        test('an overflow inlay list is unknown, and the ids it does list are still counted', async () => {
            const { backend, planted, read, clock } = await scene(index, { overflowIl: 'fixedIl' })
            const p = probes({ assets: new Set([...planted.assetHexes, ...planted.assetNames]), inlays: new Set() })
            const ready = expectReady(await pickCandidate(backend, read, planted.manifestKey, options(clock, p)))
            expect(ready.counts.unknownLists).toBe(1)
            expect(ready.counts.missingInlays).toBe(planted.inlayMetaKeys.length)
        })

        test('a newer-version list is unknown: its names are never probed and never counted missing', async () => {
            const { backend, planted, read, clock } = await scene(index, { newerList: 'charAl' })
            const p = probes({ assets: new Set(), inlays: new Set() })
            const ready = expectReady(await pickCandidate(backend, read, planted.manifestKey, options(clock, p)))
            const asked = p.assetCalls.flat()
            expect(asked).not.toContain(hexOf(10))
            expect(asked).not.toContain('char0.png')
            expect(asked).toContain(hexOf(11))
            expect(ready.counts.unknownLists).toBe(1)
            // Nothing present: every probed key is missing, and exactly the listed ones are probed.
            expect(ready.counts.missingImages).toBe(asked.length)
            expect(asked.length).toBe(planted.assetHexes.length + planted.assetNames.length - 2)
        })

        test('a list below this build\'s version is unknown too: its names are never probed', async () => {
            const { backend, planted, read, clock } = await scene(index, { staleList: 'charAl' })
            const p = probes({ assets: new Set(), inlays: new Set() })
            const ready = expectReady(await pickCandidate(backend, read, planted.manifestKey, options(clock, p)))
            const asked = p.assetCalls.flat()
            expect(asked).not.toContain(hexOf(10))
            expect(asked).not.toContain('char0.png')
            expect(ready.counts.unknownLists).toBe(1)
        })
        test('the count runs after the fence and the marker are written', async () => {
            const { backend, planted, read, clock } = await scene(index)
            const recorded = traced(backend)
            const p = probes(allPresent(planted), name => recorded.log.push(name))
            expectReady(await pickCandidate(recorded.backend, read, planted.manifestKey, options(clock, p)))
            const log = recorded.log
            expect(log.indexOf('casFence')).toBeGreaterThanOrEqual(0)
            expect(log.indexOf('probe:assets')).toBeGreaterThan(log.indexOf('casFence'))
            expect(log.indexOf('probe:assets')).toBeGreaterThan(log.indexOf('casCommit'))
            expect(log.indexOf('probe:inlays')).toBeGreaterThan(log.indexOf('casCommit'))
        })

        test('keys are asked in batches of at most 500 and each distinct key once', async () => {
            const { backend, planted, read, clock } = await scene(index, { extraAssetNames: 1200 })
            const p = probes(allPresent(planted))
            expectReady(await pickCandidate(backend, read, planted.manifestKey, options(clock, p)))
            expect(p.assetCalls.length).toBeGreaterThanOrEqual(3)
            for (const call of p.assetCalls) {
                expect(call.length).toBeLessThanOrEqual(500)
            }
            const asked = p.assetCalls.flat()
            expect(new Set(asked).size).toBe(asked.length)
            expect(asked.length).toBe(planted.assetHexes.length + planted.assetNames.length)
        })
    })

    describe('install', () => {
        test('every unit is re-written under a fresh staged key; nothing is deleted; the new tree reads back whole', async () => {
            const { backend, planted, read, clock, before } = await scene(index)
            const recorded = hooked(backend)
            const p = probes(allPresent(planted))
            const ready = expectReady(await pickCandidate(recorded.backend, read, planted.manifestKey, options(clock, p)))
            const fenceAfterPick = (await backend.readFence()).bytes
            const markerKey = await parsedCommit(backend)

            const result = await installed(ready)

            const after = await backend.listStore2()
            const beforeSet = new Set(before)
            for (const key of before) {
                expect(after, `${key} survives`).toContain(key)
            }
            const added = after.filter(key => !beforeSet.has(key))
            expect(added.length).toBe(planted.written.length)
            for (const key of added) {
                expect(key.startsWith(ready.marked.stagedPrefix)).toBe(true)
            }
            expect(recorded.count('removeBatch')).toBe(0)
            expect((await backend.readFence()).bytes).toEqual(fenceAfterPick)

            const stored = await parsedCommit(backend)
            expect(stored.current?.key).toBe(result.manifestKey)
            expect(stored.staging).toBeNull()
            expect(stored.retained).toEqual([])
            expect(stored.pins).toEqual([])
            expect(stored.seq).toBe(markerKey.seq + 1)
            expect(stored.seq).toBe(planted.body.seq + 2)
            expect(stored.epoch).not.toBe(markerKey.epoch)
            expect(result.value).toEqual(stored)

            const closure = await closureOf(backend, result.manifestKey)
            expect(closure.problems).toEqual([])
            expect(closure.keys.size).toBe(planted.written.length)
            for (const key of closure.keys) {
                expect(beforeSet.has(key)).toBe(false)
            }
            const tree = await readTree(backend, result.manifestKey)
            expect(tree.status).toBe('ok')
            const newManifest = (tree.status === 'ok' ? tree.manifest : null)
            expect(newManifest?.seq).toBe(stored.seq)
            expect(await treeFingerprint(backend, result.manifestKey)).toEqual(await treeFingerprint(backend, planted.manifestKey))
        })

        test('the newer list and its version element are carried unchanged', async () => {
            const { backend, planted, read, clock } = await scene(index, { newerList: 'charAl' })
            const p = probes(allPresent(planted))
            const ready = expectReady(await pickCandidate(backend, read, planted.manifestKey, options(clock, p)))
            const result = await installed(ready)
            expect(await treeFingerprint(backend, result.manifestKey)).toEqual(await treeFingerprint(backend, planted.manifestKey))
            expect((await closureOf(backend, result.manifestKey)).problems).toEqual([])
        })

        test('the install is refused without the confirmation', async () => {
            const { backend, planted, read, clock } = await scene(index)
            const recorded = traced(backend)
            const p = probes(allPresent(planted))
            const ready = expectReady(await pickCandidate(recorded.backend, read, planted.manifestKey, options(clock, p)))
            const calls = recorded.log.length
            // @ts-expect-error the confirmation is the literal true
            await expect(installPick(ready, { confirm: false })).rejects.toThrow(TypeError)
            expect(recorded.log.length).toBe(calls)
        })

        test('a unit that vanishes between the validation and the re-write stops the install with its key', async () => {
            const { backend, planted, read, clock } = await scene(index)
            const hidden = (planted.byRole.get('chunk') as string[])[2]
            let hide = false
            const blind = hooked(backend, {})
            const wrapped: Store2Backend = {
                ...blind.backend,
                readUnits: async (keys) => {
                    const units = await blind.backend.readUnits(keys)
                    if (hide && units.has(hidden)) {
                        units.set(hidden, null)
                    }
                    return units
                },
            }
            const p = probes(allPresent(planted))
            const ready = expectReady(await pickCandidate(wrapped, read, planted.manifestKey, options(clock, p)))
            hide = true
            const result = await installPick(ready, { confirm: true })
            expect(result).toMatchObject({ status: 'invalid', problem: { kind: 'missing', keys: [hidden] } })
            expect((await parsedCommit(backend)).current).toBeNull()
        })

        test('a refused put is retried under a fresh key', async () => {
            const { backend, planted, read, clock } = await scene(index)
            const probe = probes(allPresent(planted))
            let refused = 0
            const flaky: Store2Backend = {
                ...backend,
                putUnit: async (key, bytes) => {
                    if (refused === 0) {
                        refused++
                        await backend.putUnit(key, new Uint8Array([9]))
                    }
                    return backend.putUnit(key, bytes)
                },
            }
            const ready = expectReady(await pickCandidate(flaky, read, planted.manifestKey, options(clock, probe)))
            const result = await installed(ready)
            expect(refused).toBe(1)
            expect((await closureOf(backend, result.manifestKey)).problems).toEqual([])
        })

        test('a put that reports flushed false stops the install: no further upload, no commit-key write, and the marker stands', async () => {
            const { backend, planted, read, clock } = await scene(index)
            const probe = probes(allPresent(planted))
            const recorded = hooked(backend, {})
            let puts = 0
            const unflushed: Store2Backend = {
                ...recorded.backend,
                putUnit: async (key, bytes) => {
                    const written = await recorded.backend.putUnit(key, bytes)
                    puts++
                    return puts === 2 ? { flushed: false } : written
                },
            }
            const ready = expectReady(await pickCandidate(unflushed, read, planted.manifestKey, options(clock, probe)))
            const before = await parsedCommit(backend)
            recorded.log.length = 0
            const result = await installPick(ready, { confirm: true })
            expect(result.status).toBe('upload-failed')
            expect(result.status === 'upload-failed' && result.cause).toBeInstanceOf(Store2BackendFailureError)
            expect(puts).toBe(2)
            expect(recorded.log).not.toContain('casCommit')
            expect(recorded.log).not.toContain('commitOrdinary')
            const after = await parsedCommit(backend)
            expect(after).toEqual(before)
            expect(after.staging).not.toBeNull()
            expect(after.current).toBeNull()
        })
    })

    describe('the final compare-and-write', () => {
        async function readyWith(hooks: Hooks) {
            const s = await scene(index)
            const recorded = hooked(s.backend, hooks)
            const p = probes(allPresent(s.planted))
            const ready = expectReady(await pickCandidate(recorded.backend, s.read, s.planted.manifestKey, options(s.clock, p)))
            return { ...s, recorded, ready }
        }

        test('a peer that wrote the commit key meanwhile turns the final write into an abandoned install', async () => {
            const { backend, planted, ready, clock } = await readyWith({})
            const marker = await parsedCommit(backend)
            const peer: CommitKey = nextCommitKey(marker, { staging: null, current: { key: planted.manifestKey, at: 1 } }, testEnv(clock, 55))
            await plantKey(backend, peer)
            const result = await installPick(ready, { confirm: true })
            expect(result.status).toBe('abandoned')
            // The peer's key stands untouched; every old candidate and the staged copies remain.
            expect(await parsedCommit(backend)).toEqual(peer)
            expect((await backend.listStore2()).length).toBe(planted.written.length * 2)
        })

        test('a conflict whose re-read names this install as current is done', async () => {
            let landed = false
            const { backend, ready } = await readyWith({})
            // Applies the write itself, then reports a conflict: the re-read finds this manifest as `current`.
            const inner = ready.backend
            const wrapped: PickReady = {
                ...ready,
                backend: {
                    ...inner,
                    casCommit: async (expected, next) => {
                        await inner.casCommit(expected, next)
                        landed = true
                        throw new Store2CommitConflictError(await inner.readCommit())
                    },
                },
            }
            const result = await installPick(wrapped, { confirm: true })
            expect(landed).toBe(true)
            expect(result.status).toBe('installed')
            expect((await parsedCommit(backend)).current?.key).toBe(result.status === 'installed' ? result.manifestKey : '')
        })

        test('an unknown outcome that did land is read back and counts as installed', async () => {
            const { backend, ready } = await readyWith({
                after: (name, count) => {
                    if (name === 'casCommit' && count === 2) {
                        throw new Store2UnknownOutcomeError('Injected lost answer.')
                    }
                },
            })
            const result = await installPick(ready, { confirm: true })
            expect(result.status).toBe('installed')
            expect((await parsedCommit(backend)).current).not.toBeNull()
        })

        test('an unknown outcome that did not land is retried at the same token while the marker stands', async () => {
            const { backend, recorded, ready } = await readyWith({
                before: (name, count) => {
                    if (name === 'casCommit' && count === 2) {
                        throw new Store2UnknownOutcomeError('Injected lost request.')
                    }
                },
            })
            const result = await installPick(ready, { confirm: true })
            expect(result.status).toBe('installed')
            expect(recorded.count('casCommit')).toBe(3)
            expect((await parsedCommit(backend)).staging).toBeNull()
        })

        test('an unknown outcome followed by a peer write is abandoned', async () => {
            const s = await scene(index)
            let planted = false
            const recorded = hooked(s.backend, {
                before: async (name, count) => {
                    if (name === 'casCommit' && count === 2) {
                        const marker = await parsedCommit(s.backend)
                        await plantKey(s.backend, nextCommitKey(marker, { staging: null, current: { key: s.planted.manifestKey, at: 1 } }, testEnv(s.clock, 56)))
                        planted = true
                        throw new Store2UnknownOutcomeError('Injected lost request.')
                    }
                },
            })
            const p = probes(allPresent(s.planted))
            const ready = expectReady(await pickCandidate(recorded.backend, s.read, s.planted.manifestKey, options(s.clock, p)))
            const result = await installPick(ready, { confirm: true })
            expect(planted).toBe(true)
            expect(result.status).toBe('abandoned')
            expect((await parsedCommit(s.backend)).current?.key).toBe(s.planted.manifestKey)
        })

        test('a definite failure leaves the marker standing', async () => {
            const { backend, ready } = await readyWith({
                before: (name, count) => {
                    if (name === 'casCommit' && count === 2) {
                        throw new Store2BackendFailureError('Injected write failure.')
                    }
                },
            })
            const result = await installPick(ready, { confirm: true })
            expect(result.status).toBe('failed')
            const stored = await parsedCommit(backend)
            expect(stored.current).toBeNull()
            expect(stored.staging?.label).toBe('recovery')
        })

        test('the write compares at the marker token: a peer write between marker and final is never overwritten', async () => {
            const { backend, planted, ready, clock } = await readyWith({})
            const marker = await parsedCommit(backend)
            await plantKey(backend, nextCommitKey(marker, { staging: null, current: { key: planted.manifestKey, at: 2 } }, testEnv(clock, 57)))
            const result = await installPick(ready, { confirm: true })
            expect(result.status).toBe('abandoned')
            expect(classifyCommitRead(await backend.readCommit())).toMatchObject({ status: 'parsed', value: { current: { key: planted.manifestKey } } })
        })
    })
})
