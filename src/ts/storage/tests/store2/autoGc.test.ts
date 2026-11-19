// @vitest-environment node
/**
 * The clean-up pass's own seams (`gc/autoGc.ts`, `gc/gcMeter.ts`, and `shouldStop` in `gc/pass.ts`): the deps the runner
 * builds from a session and the page facts, the plain result line, the measurement build's mark timing, and the pass's
 * stop rule. The runner through the maintenance step is in `maintenanceRunner.test.ts`; the app wiring over the Tauri
 * semantic store is in `replay/autoGcRig.test.ts`.
 *
 * Labels: the deps cases are guards proven by their mutants (the spread of the session, `idleReason: () => null`, a copy of
 * the backend); the `shouldStop` cases are reproducers (the stop does not exist on the base). The mark timing exists only
 * in a measurement build, which Vitest is (`MEASURE` follows `import.meta.env.DEV`).
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { MEASURE } from 'src/ts/process/memory/measureFlag'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import type { ByteStore, GuardedOperations } from 'src/ts/storage/store/contract'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { encodeUnit, newUnitKey, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { STORAGE_TAB_LOCK_NAME } from 'src/ts/storage/storageTabLocks'
import { buildAutoGcDeps, formatGcResult, runAutoGc, soleTabAnswer, type AutoGcFacts } from 'src/ts/storage/store2/gc/autoGc'
import { formatGcMarkMs, meterGcBackend } from 'src/ts/storage/store2/gc/gcMeter'
import { gcPass } from 'src/ts/storage/store2/gc/pass'
import { Store2Session } from 'src/ts/storage/store2/session'
import { committerOf, createClock, seedStore, testEnv, treeRequest } from './commitFixtures'
import { flushConfirming, type FlushConfirming } from './flushConfirmBackend'

// The note of the export (`noteImportPhase`) is the established sink of the measurement builds; the real module needs a
// browser page and its ring and storage gate are covered where it lives. This file pins what the pass hands to it.
const notes = vi.hoisted(() => [] as string[])
vi.mock(import('src/ts/drive/storeImport'), () => ({
    noteImportPhase: (phase: string) => { notes.push(phase) },
}) as unknown as typeof import('src/ts/drive/storeImport'))

const clock = createClock()
const env = testEnv(clock, 11)
const CLEAN: AutoGcFacts = {
    isBusy: () => false,
    saveLoopParked: () => false,
    isSaveClean: () => true,
    restoreInProgress: () => false,
    peers: async () => 'alone',
    ownBase: () => null,
}

/** Guarded routes that answer nothing: enough to show which deps a node session is given. */
function guardedStub(over: Partial<GuardedOperations>): GuardedOperations {
    const refuse = async (): Promise<never> => {
        throw new Error('The stub answers no request.')
    }
    return {
        probe: async () => ({ checkOnly: true, retire: true, pieces: false }),
        serverNow: async () => Date.now(),
        writeChecked: refuse,
        removeChecked: refuse,
        retireChecked: refuse,
        ...over,
    }
}

beforeEach(() => {
    resetPageStorageModeForTests()
    setPageStorageMode({ kind: 'store2' })
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    resetPageStorageModeForTests()
})

interface Page {
    session: Store2Session
    memory: MemoryBackend
    over: FlushConfirming
    orphans: string[]
}

async function openTauri(orphanCount: number): Promise<Page> {
    const memory = createMemoryBackend()
    await seedStore(memory, env)
    const orphans: string[] = []
    for (let i = 0; i < orphanCount; i++) {
        const key = newUnitKey(env)
        await memory.putUnit(key, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan: key }))
        orphans.push(key)
    }
    const over = flushConfirming(memory)
    const session = await Store2Session.open(createMemoryByteStore(), { kind: 'tauri', backend: over.backend, upstreamMainFile: async () => false })
    over.calls.length = 0
    return { session, memory, over, orphans }
}

async function orphansLeft(page: Page): Promise<number> {
    const read = await page.memory.readUnits(page.orphans)
    return page.orphans.filter(key => read.get(key) !== null).length
}

describe('buildAutoGcDeps', () => {
    test('guard: the pass is given the session\'s own backend and reads the session\'s idle reason live', () => {
        let idle: string | null = null
        const backend = createMemoryBackend()
        const session = { kind: 'tauri' as const, backend, get idleReason() { return idle } }

        const deps = buildAutoGcDeps(session, CLEAN)

        expect(deps).not.toBeNull()
        expect(deps?.backend).toBe(backend)
        expect(deps?.kind).toBe('tauri')
        expect(deps?.idleReason()).toBeNull()
        idle = 'The commit key could not be flushed.'
        expect(deps?.idleReason(), 'a later unflushed write is seen: the session is not copied').toBe(idle)
        expect(deps?.pace).toBeTypeOf('function')
    })

    test('guard: a session with no backend gets no pass', () => {
        expect(buildAutoGcDeps({ kind: 'tauri', backend: null, idleReason: 'read-only' }, CLEAN)).toBeNull()
    })

    test.each<[string, AutoGcFacts, boolean]>([
        ['quiet', CLEAN, false],
        ['busy', { ...CLEAN, isBusy: () => true }, true],
        ['parked', { ...CLEAN, saveLoopParked: () => true }, true],
        ['unsaved', { ...CLEAN, isSaveClean: () => false }, true],
    ])('the stop rule on a %s page', (_name, facts, stops) => {
        const deps = buildAutoGcDeps({ kind: 'tauri', backend: createMemoryBackend(), idleReason: null }, facts)

        expect(deps?.shouldStop?.()).toBe(stops)
    })

    test('guard: the facts are read at every question, not once', () => {
        let busy = false
        const deps = buildAutoGcDeps({ kind: 'tauri', backend: createMemoryBackend(), idleReason: null }, { ...CLEAN, isBusy: () => busy })

        expect(deps?.shouldStop?.()).toBe(false)
        busy = true
        expect(deps?.shouldStop?.()).toBe(true)
    })
})

describe('runAutoGc pre-checks', () => {
    test('guard: a read-only session (no backend) and a page that is not on store2 run nothing', async () => {
        const page = await openTauri(5)
        const readOnly = Object.create(page.session, { backend: { value: null } }) as Store2Session

        expect(await runAutoGc(readOnly, CLEAN)).toBeNull()
        setPageStorageMode({ kind: 'unset' })
        expect(await runAutoGc(page.session, CLEAN)).toBeNull()
        expect(page.over.calls).toEqual([])
    })
})

describe('the result line', () => {
    test.each([
        [{ status: 'done' as const, deleted: 30, batches: 2 }, 'store2 clean-up: status=done deleted=30 batches=2'],
        [{ status: 'done' as const, deleted: 25, batches: 1, stopped: 'yielded' as const }, 'store2 clean-up: status=done deleted=25 batches=1 stopped=yielded'],
        [{ status: 'refused' as const, reason: 'idle' as const, detail: 'secret detail' }, 'store2 clean-up: status=refused reason=idle'],
    ])('prints the status and the counts, never a key or a detail', (result, line) => {
        expect(formatGcResult(result)).toBe(line)
    })
})

describe('the mark timing of a measurement build', () => {
    test('precondition: Vitest runs as a measurement build', () => {
        expect(MEASURE).toBe(true)
    })

    test('the formatter carries the marker text that util/checkReleaseDist.mjs forbids in a release build', () => {
        expect(formatGcMarkMs([12.4, 3.6])).toBe(' gcMarkMs=12,4')
        expect(formatGcMarkMs([])).toBe(' gcMarkMs=-')
    })

    test('the release check fails a bundle that carries the measured text and passes one that carries the plain line', () => {
        const script = resolve(process.cwd(), 'util/checkReleaseDist.mjs')
        const checked = (text: string): number | null => {
            const dir = mkdtempSync(join(tmpdir(), 'risu-release-dist-'))
            try {
                writeFileSync(join(dir, 'bundle.js'), `console.info(${JSON.stringify(text)})`)
                return spawnSync(process.execPath, [script, dir], { encoding: 'utf8' }).status
            } finally {
                rmSync(dir, { recursive: true, force: true })
            }
        }

        expect(checked(formatGcResult({ status: 'done', deleted: 1, batches: 1 }) + formatGcMarkMs([1]))).toBe(1)
        expect(checked(formatGcResult({ status: 'done', deleted: 1, batches: 1 }))).toBe(0)
    })

    test('a measurement run records the result line, the refused reason and the mark time through the export\'s note', async () => {
        const ring = (): string[] => notes.splice(0)
        notes.length = 0
        vi.spyOn(console, 'info').mockImplementation(() => {})
        const done = await openTauri(30)

        await runAutoGc(done.session, CLEAN)

        const idle = await openTauri(30)
        idle.over.flushed = false
        const backend = idle.session.backend as NonNullable<Store2Session['backend']>
        const read = await backend.readCommit()
        await backend.casCommit(read.token, read.bytes as Uint8Array)
        await runAutoGc(idle.session, CLEAN)

        const recorded = ring()
        expect(recorded).toHaveLength(2)
        expect(recorded[0]).toMatch(/^store2 clean-up: status=done deleted=30 batches=2 gcMarkMs=\d+$/)
        expect(recorded[1]).toMatch(/^store2 clean-up: status=refused reason=idle gcMarkMs=/)
    })

    test('a round\'s mark time runs from the commit-key read to the listing, once per round', async () => {
        const page = await openTauri(0)
        let now = 100
        const meter = meterGcBackend(page.over.backend, () => now)
        page.over.before = (name) => {
            if (name === 'readCommit') {
                now += 1
            }
            if (name === 'readUnits') {
                now += 10
            }
            if (name === 'listStore2') {
                now += 1000
            }
        }

        await meter.backend.readCommit()
        now += 5
        await meter.backend.readUnits([])
        await meter.backend.listStore2()
        await meter.backend.readCommit()
        await meter.backend.listStore2()
        await meter.backend.listStore2()

        // The listing's own time is not part of the mark; a listing without a preceding commit-key read adds nothing.
        expect(meter.markMs()).toEqual([1 + 5 + 10, 1])
    })

    test('the decorator wraps the session\'s backend, leaves the pass\'s result unchanged and the line carries one mark per round', async () => {
        const page = await openTauri(30)
        const info = vi.spyOn(console, 'info').mockImplementation(() => {})

        const result = await runAutoGc(page.session, CLEAN)

        expect(result).toEqual({ status: 'done', deleted: 30, batches: 2 })
        expect(await orphansLeft(page)).toBe(0)
        expect(String(info.mock.calls[0][0])).toMatch(/^store2 clean-up: status=done deleted=30 batches=2 gcMarkMs=\d+$/)
        expect(page.over.count('readCommit'), 'the pass read through the page\'s backend').toBe(1)
    })
})

describe('shouldStop in the pass', () => {
    test('reproducer: a stop before the first read leaves the store untouched and ends with yielded', async () => {
        const page = await openTauri(30)
        const deps = buildAutoGcDeps(page.session, { ...CLEAN, isBusy: () => true })

        const result = await gcPass(deps as NonNullable<typeof deps>)

        expect(result).toEqual({ status: 'done', deleted: 0, batches: 0, stopped: 'yielded' })
        expect(page.over.calls).toEqual([])
    })

    test('reproducer: a stop between batches keeps the batches already applied', async () => {
        const page = await openTauri(60)
        const deps = buildAutoGcDeps(page.session, { ...CLEAN, isBusy: () => page.over.count('removeBatch') >= 2 })

        const result = await gcPass(deps as NonNullable<typeof deps>)

        expect(result).toEqual({ status: 'done', deleted: 50, batches: 2, stopped: 'yielded' })
        expect(await orphansLeft(page)).toBe(10)
    })

    test('guard: a pass given no shouldStop runs to the end', async () => {
        const page = await openTauri(60)
        const deps = buildAutoGcDeps(page.session, CLEAN)

        const result = await gcPass({ ...(deps as NonNullable<typeof deps>), shouldStop: undefined })

        expect(result).toEqual({ status: 'done', deleted: 60, batches: 3 })
    })

    test('guard: a commit that lands under a batch still rebuilds once when the page stays quiet', async () => {
        const page = await openTauri(60)
        page.over.before = async (name, count) => {
            if (name === 'removeBatch' && count === 2) {
                page.over.before = null
                const peer = committerOf(page.memory, createClock(), 78)
                expect((await peer.commit(await page.memory.readCommit(), treeRequest(0, { tag: 'peer' }))).status).toBe('committed')
            }
        }
        const deps = buildAutoGcDeps(page.session, CLEAN)

        const result = await gcPass(deps as NonNullable<typeof deps>)

        expect(result).toEqual({ status: 'done', deleted: 60, batches: 3 })
        expect(page.over.count('listStore2'), 'the second round listed again').toBe(2)
    })

    test('reproducer: a restore run stops the pass on the app, before any read', async () => {
        const page = await openTauri(30)
        const facts = { ...CLEAN, restoreInProgress: () => true }
        const deps = buildAutoGcDeps(page.session, facts)

        expect(deps?.shouldStop?.()).toBe(true)
        expect(await gcPass(deps as NonNullable<typeof deps>)).toEqual({ status: 'done', deleted: 0, batches: 0, stopped: 'yielded' })
        expect(await orphansLeft(page)).toBe(30)
    })
})

describe('the web pass: sole-tab proof and own base', () => {
    interface WebPage extends Page {
        /** The manifest key the seeded commit key names as current. */
        base: string
    }

    async function currentKeyOf(memory: MemoryBackend): Promise<string> {
        const parsed = classifyCommitRead(await memory.readCommit())
        if (parsed.status !== 'parsed' || parsed.value.current === null) {
            throw new Error('the seeded store has no current manifest')
        }
        return parsed.value.current.key
    }

    async function openWeb(orphanCount: number): Promise<WebPage> {
        const memory = createMemoryBackend()
        await seedStore(memory, env)
        const orphans: string[] = []
        for (let i = 0; i < orphanCount; i++) {
            const key = newUnitKey(env)
            await memory.putUnit(key, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan: key }))
            orphans.push(key)
        }
        const over = flushConfirming(memory)
        const session = await Store2Session.open(createMemoryByteStore(), { kind: 'indexeddb', backend: over.backend, upstreamMainFile: async () => false })
        over.calls.length = 0
        return { session, memory, over, orphans, base: await currentKeyOf(memory) }
    }

    function webFacts(page: WebPage, overrides: Partial<AutoGcFacts> = {}): AutoGcFacts {
        return { ...CLEAN, ownBase: () => page.base, ...overrides }
    }

    const READS = ['readCommit', 'readUnits', 'listStore2']

    test('reproducer: an alone, own-based web page deletes its orphans', async () => {
        const page = await openWeb(30)
        vi.spyOn(console, 'info').mockImplementation(() => {})

        expect(await runAutoGc(page.session, webFacts(page))).toEqual({ status: 'done', deleted: 30, batches: 2 })
        expect(await orphansLeft(page)).toBe(0)
    })

    test('reproducer: another tab refuses in the first round with no store2 read', async () => {
        const page = await openWeb(30)
        vi.spyOn(console, 'info').mockImplementation(() => {})

        const result = await runAutoGc(page.session, webFacts(page, { peers: async () => 'others' }))

        expect(result).toMatchObject({ status: 'refused', reason: 'other-tab' })
        expect(page.over.calls.filter(call => READS.includes(call))).toEqual([])
        expect(await orphansLeft(page)).toBe(30)
    })

    test('reproducer: a host without Web Locks refuses no-web-locks with no read', async () => {
        const page = await openWeb(30)
        vi.spyOn(console, 'info').mockImplementation(() => {})

        const result = await runAutoGc(page.session, webFacts(page, { peers: async () => 'unsupported' }))

        expect(result).toMatchObject({ status: 'refused', reason: 'no-web-locks' })
        expect(page.over.calls.filter(call => READS.includes(call))).toEqual([])
        expect(await orphansLeft(page)).toBe(30)
    })

    test('reproducer: another tab after the first batch ends the pass with the applied batch kept', async () => {
        const page = await openWeb(60)
        vi.spyOn(console, 'info').mockImplementation(() => {})

        const result = await runAutoGc(page.session, webFacts(page, { peers: async () => page.over.count('removeBatch') >= 1 ? 'others' : 'alone' }))

        expect(result).toEqual({ status: 'done', deleted: 25, batches: 1, stopped: 'other-tab' })
        expect(await orphansLeft(page)).toBe(35)
    })

    test('reproducer: another tab after the listing ends the pass before the first batch', async () => {
        const page = await openWeb(30)
        vi.spyOn(console, 'info').mockImplementation(() => {})

        const result = await runAutoGc(page.session, webFacts(page, { peers: async () => page.over.count('listStore2') >= 1 ? 'others' : 'alone' }))

        expect(result).toEqual({ status: 'done', deleted: 0, batches: 0, stopped: 'other-tab' })
        expect(await orphansLeft(page)).toBe(30)
    })

    test('reproducer: a host that loses Web Locks after the listing ends the pass before the first batch', async () => {
        const page = await openWeb(30)
        vi.spyOn(console, 'info').mockImplementation(() => {})

        const result = await runAutoGc(page.session, webFacts(page, { peers: async () => page.over.count('listStore2') >= 1 ? 'unsupported' : 'alone' }))

        expect(result).toEqual({ status: 'done', deleted: 0, batches: 0, stopped: 'other-tab' })
        expect(await orphansLeft(page)).toBe(30)
    })

    test('guard: the proof is asked fresh at the round start and before each of three batches, never cached', async () => {
        const page = await openWeb(60)
        vi.spyOn(console, 'info').mockImplementation(() => {})
        const peers = vi.fn(async () => 'alone' as const)

        await runAutoGc(page.session, webFacts(page, { peers }))

        expect(peers).toHaveBeenCalledTimes(4)
    })

    test('guard: the proof is answered before the stop rule at each batch, so a page that turns busy in the proof stops yielded', async () => {
        const page = await openWeb(30)
        vi.spyOn(console, 'info').mockImplementation(() => {})
        let busy = false
        let asked = 0
        const peers = async () => {
            asked++
            if (asked === 2) {
                busy = true
            }
            return 'alone' as const
        }

        const result = await runAutoGc(page.session, webFacts(page, { peers, isBusy: () => busy }))

        expect(result).toEqual({ status: 'done', deleted: 0, batches: 0, stopped: 'yielded' })
    })

    test('guard: the app passes neither fact to the pass and never calls them', async () => {
        const page = await openTauri(30)
        vi.spyOn(console, 'info').mockImplementation(() => {})
        const peers = vi.fn(async () => 'others' as const)
        const ownBase = vi.fn(() => 'not-the-base')
        const deps = buildAutoGcDeps(page.session, { ...CLEAN, peers, ownBase })

        expect(deps?.peers).toBeUndefined()
        expect(deps?.ownBase).toBeUndefined()
        expect(await runAutoGc(page.session, { ...CLEAN, peers, ownBase })).toEqual({ status: 'done', deleted: 30, batches: 2 })
        expect(peers).not.toHaveBeenCalled()
        expect(ownBase).not.toHaveBeenCalled()
    })

    test('compatibility guard: an opfs-transitional session runs nothing, not even a read (passes before and after)', async () => {
        const page = await openWeb(30)
        const session = Object.create(page.session, { kind: { value: 'opfs-transitional' } }) as Store2Session

        expect(await runAutoGc(session, webFacts(page))).toBeNull()
        expect(page.over.calls).toEqual([])
    })

    test('guard: a node session without a byte store, or with a store lacking the guarded routes or the server clock, is refused capability-missing before any store2 read', async () => {
        const page = await openWeb(30)
        vi.spyOn(console, 'info').mockImplementation(() => {})
        const session = Object.create(page.session, { kind: { value: 'node' } }) as Store2Session
        const noClock: ByteStore = { ...createMemoryByteStore(), guarded: guardedStub({ serverNow: undefined }) }

        for (const store of [undefined, createMemoryByteStore(), noClock]) {
            expect(await runAutoGc(session, webFacts(page), store)).toMatchObject({ status: 'refused', reason: 'capability-missing' })
        }
        expect(page.over.calls).toEqual([])
    })

    test('guard: the node deps carry the probe, the aged deps, the peer proof and the own base; the web has no aged deps', async () => {
        const page = await openWeb(30)
        const facts = webFacts(page)
        const store: ByteStore = { ...createMemoryByteStore(), guarded: guardedStub({}) }

        const node = buildAutoGcDeps({ kind: 'node', backend: page.memory, idleReason: null }, facts, store)
        const web = buildAutoGcDeps({ kind: 'indexeddb', backend: page.memory, idleReason: null }, facts, store)

        expect(node?.probe).toBeTypeOf('function')
        expect(node?.age).toBeDefined()
        expect(node?.peers).toBeTypeOf('function')
        expect(node?.ownBase).toBeTypeOf('function')
        expect(web?.age).toBeUndefined()
        expect(web?.probe).toBeUndefined()
        expect(buildAutoGcDeps({ kind: 'node', backend: page.memory, idleReason: null }, facts)?.age, 'no store, no aged deps').toBeUndefined()
    })

    test('guard: an own base that is not the commit key\'s current refuses stale-base with exactly one read of the commit key', async () => {
        const page = await openWeb(30)
        vi.spyOn(console, 'info').mockImplementation(() => {})
        const peer = committerOf(page.memory, createClock(), 78)
        expect((await peer.commit(await page.memory.readCommit(), treeRequest(0, { tag: 'peer' }))).status).toBe('committed')
        const parsed = classifyCommitRead(await page.memory.readCommit())
        if (parsed.status !== 'parsed') {
            throw new Error('the commit key does not parse')
        }
        expect(parsed.value.retained.map(entry => entry.key), 'precondition: the own base is retained, not current').toContain(page.base)
        expect(parsed.value.current?.key, 'precondition: the own base is not the current').not.toBe(page.base)
        page.over.calls.length = 0

        const result = await runAutoGc(page.session, webFacts(page))

        expect(result).toMatchObject({ status: 'refused', reason: 'stale-base' })
        expect(page.over.count('readCommit')).toBe(1)
        expect(page.over.count('readUnits')).toBe(0)
        expect(page.over.count('listStore2')).toBe(0)
        expect(await orphansLeft(page)).toBe(30)
    })

    test('guard: no settled own base (null) refuses stale-base before any unit read', async () => {
        const page = await openWeb(30)
        vi.spyOn(console, 'info').mockImplementation(() => {})

        const result = await runAutoGc(page.session, webFacts(page, { ownBase: () => null }))

        expect(result).toMatchObject({ status: 'refused', reason: 'stale-base' })
        expect(page.over.count('readUnits')).toBe(0)
        expect(await orphansLeft(page)).toBe(30)
    })

    test('reproducer: a rebuild round that finds another tab ends other-tab with one read of the commit key', async () => {
        const page = await openWeb(60)
        vi.spyOn(console, 'info').mockImplementation(() => {})
        let peerWrote = false
        page.over.before = async (name, count) => {
            if (name === 'removeBatch' && count === 2) {
                page.over.before = null
                const peer = committerOf(page.memory, createClock(), 78)
                expect((await peer.commit(await page.memory.readCommit(), treeRequest(0, { tag: 'peer' }))).status).toBe('committed')
                peerWrote = true
            }
        }
        const readsBefore = (): number => page.over.count('readCommit')

        const result = await runAutoGc(page.session, webFacts(page, { peers: async () => peerWrote ? 'others' : 'alone' }))

        expect(result).toEqual({ status: 'done', deleted: 25, batches: 1, stopped: 'other-tab' })
        expect(readsBefore()).toBe(1)
    })

    test('reproducer: a rebuild round with a stale own base ends refused, after one more read of the commit key and no listing', async () => {
        const page = await openWeb(60)
        vi.spyOn(console, 'info').mockImplementation(() => {})
        page.over.before = async (name, count) => {
            if (name === 'removeBatch' && count === 2) {
                page.over.before = null
                const peer = committerOf(page.memory, createClock(), 78)
                expect((await peer.commit(await page.memory.readCommit(), treeRequest(0, { tag: 'peer' }))).status).toBe('committed')
            }
        }

        const result = await runAutoGc(page.session, webFacts(page))

        expect(result).toMatchObject({ status: 'done', deleted: 25, batches: 1, stopped: 'refused', refusal: { reason: 'stale-base' } })
        expect(page.over.count('readCommit')).toBe(2)
        expect(page.over.count('listStore2')).toBe(1)
    })
})

describe('soleTabAnswer', () => {
    const shared: LockInfo = { name: STORAGE_TAB_LOCK_NAME, mode: 'shared' }
    const own = (): boolean => true
    const aloneSnapshot = async (): Promise<LockManagerSnapshot> => ({ held: [shared], pending: [] })

    test.each<[string, Parameters<typeof soleTabAnswer>[0], string]>([
        ['no query', { query: undefined, holdsOwnPresence: own }, 'unsupported'],
        ['no query and no own claim: the missing API is named first', { query: undefined, holdsOwnPresence: () => false }, 'unsupported'],
        ['own claim false before the query', { query: aloneSnapshot, holdsOwnPresence: () => false }, 'others'],
        ['a rejecting query', { query: async () => { throw new Error('denied') }, holdsOwnPresence: own }, 'others'],
        ['two holders', { query: async () => ({ held: [shared, shared], pending: [] }), holdsOwnPresence: own }, 'others'],
        ['an exclusive pending request', { query: async () => ({ held: [shared], pending: [{ name: STORAGE_TAB_LOCK_NAME, mode: 'exclusive' }] }), holdsOwnPresence: own }, 'others'],
        ['an exclusive holder', { query: async () => ({ held: [{ name: STORAGE_TAB_LOCK_NAME, mode: 'exclusive' }], pending: [] }), holdsOwnPresence: own }, 'others'],
        ['no holder at all with the own claim true', { query: async () => ({ held: [], pending: [] }), holdsOwnPresence: own }, 'others'],
        ['an unrelated lock only', { query: async () => ({ held: [{ name: 'other', mode: 'shared' }], pending: [] }), holdsOwnPresence: own }, 'others'],
        ['exactly one holder and the own claim true', { query: aloneSnapshot, holdsOwnPresence: own }, 'alone'],
    ])('%s', async (_name, input, expected) => {
        expect(await soleTabAnswer(input)).toBe(expected)
    })

    test('a false own claim answers before the lock query is asked', async () => {
        const query = vi.fn(aloneSnapshot)

        expect(await soleTabAnswer({ query, holdsOwnPresence: () => false })).toBe('others')
        expect(query).not.toHaveBeenCalled()
    })

    test('the own claim is read again after the query: a claim that went false during it is not alone', async () => {
        let claim = true
        const answer = await soleTabAnswer({ query: async () => { claim = false; return { held: [shared], pending: [] } }, holdsOwnPresence: () => claim })

        expect(answer).toBe('others')
    })
})
