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
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { encodeUnit, newUnitKey, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { buildAutoGcDeps, formatGcResult, runAutoGc, type AutoGcFacts } from 'src/ts/storage/store2/gc/autoGc'
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
const CLEAN: AutoGcFacts = { isBusy: () => false, saveLoopParked: () => false, isSaveClean: () => true }

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
        setPageStorageMode({ kind: 'block' })
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
})
