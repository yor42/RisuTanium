// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest'
import type { Committer } from '../../store2/commit'
import { runStore2SaveLoop, type Store2LoopPort } from '../../store2/saveLoop'
import type { Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { beginBusy, resetBusyActionsForTest, type BusyHandle } from '../../../process/memory/busyActions'
import { until } from '../saveLoopWorld'
import { createPeerDouble, peerCommit, peerPin, startStore2, type PeerDouble, type Store2Kit, type Store2StartOptions } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

/**
 * The automatic export of a dirty Node tab that parks on a peer's commit: once per park lifetime, before the question,
 * never for a clean tab, a non-Node tab or a replaced tab. Labels in the titles: reproducer (red on the base without the
 * export), new behaviour, and 'also pins' (new behaviour whose guard property, such as no repeat or no export where it does
 * not belong, is paired with an exactly-once assertion, so it fails on the base too).
 */

type Entry = Record<string, unknown>

const clone = (db: Database): Database => JSON.parse(JSON.stringify(db)) as Database
const chars = (db: Database): Entry[] => db.characters as unknown as Entry[]
const chaIdOf = (db: Database, index: number): string => String(chars(db)[index].chaId)
const settle = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

interface MiniLoop {
    kit: Store2Kit
    db: Database
    dirty: boolean
    uncounted: Array<{ error: unknown, attempts: number }>
    failures: unknown[]
    crashed: unknown[]
    /** How many times the loop waited or slept: one per loop tick between two settles of the park. */
    ticks: number
    mark(chaId: string): void
    announce(): void
}

const loops: Array<{ stop: () => void }> = []
const busy: BusyHandle[] = []

afterEach(() => {
    for (const loop of loops) {
        loop.stop()
    }
    loops.length = 0
    busy.length = 0
    resetBusyActionsForTest()
})

function runMiniLoop(kit: Store2Kit, db: Database): MiniLoop {
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    let due = false
    let heard = false
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const reloadFlag = { state: false }
    const mini: MiniLoop = {
        kit, db, dirty: false, uncounted: [], failures: [], crashed: [], ticks: 0,
        mark(chaId) {
            tracker.character.push(chaId)
            mini.dirty = true
            due = true
        },
        announce() {
            heard = true
        },
    }
    loops.push({ stop: () => { stopped = true } })
    const idle = () => new Promise<void>((resolve) => {
        if (!stopped) {
            setTimeout(resolve, 2)
        }
    })
    const port: Store2LoopPort = {
        tracker,
        reloadFlag,
        getDatabase: () => mini.db,
        mergeBack(live, snapshot) {
            for (const chaId of snapshot.character) {
                if (!live.character.includes(chaId)) {
                    live.character.push(chaId)
                }
            }
        },
        liveCheck: () => {},
        sweep: () => {},
        isDue: () => due,
        isDirty: () => mini.dirty,
        hasDrafts: () => false,
        beginIteration() {
            due = false
        },
        endIteration: () => {},
        snapshotTaken() {
            mini.dirty = false
        },
        requestPass() {
            mini.dirty = true
            due = true
        },
        unsavable: () => {},
        saved: () => {},
        broadcast: () => {},
        peerHeard() {
            const was = heard
            heard = false
            return was
        },
        setStopped: () => {},
        reportFailure(error) {
            mini.failures.push(error)
            return 1
        },
        reportUncountedFailure(error, attempts) {
            mini.uncounted.push({ error, attempts })
            return 1
        },
        async withWriteLock(run) {
            const before = tail
            let release: () => void = () => {}
            tail = new Promise<void>((resolve) => { release = resolve })
            await before
            try {
                return await run()
            } finally {
                release()
            }
        },
        wait() {
            mini.ticks += 1
            return idle()
        },
        sleep() {
            mini.ticks += 1
            return idle()
        },
        sleepForever: () => new Promise<never>(() => {}),
        now: () => Date.now(),
    }
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
        mini.crashed.push(error)
    })
    return mini
}

/** A page with a peer commit already in the store and one local edit marked: the loop parks dirty and asks. */
async function parkedDirty(options: Partial<Store2StartOptions> = {}): Promise<MiniLoop> {
    const db = clone(buildSmall(4))
    const kit = await startStore2({ db, ...options })
    const mini = runMiniLoop(kit, db)
    await peerCommit(kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
    chars(db)[0].personality = 'my edit'
    mini.mark(chaIdOf(db, 0))
    await until(() => kit.peer.asked.length >= 1, 'the prompt', 4000)
    return mini
}

const nodePeer = (answer: 'reload' | 'export-first' = 'reload'): PeerDouble => createPeerDouble(answer)

describe('a dirty Node park exports this tab once, before the question', () => {
    // Reproducer: red on the base, where nothing calls the automatic export.
    test('reproducer: calls autoExport exactly once before decide, with this page\'s manifest key', async () => {
        const peer = nodePeer()
        const mini = await parkedDirty({ kind: 'node', peer })
        await settle(80)
        expect(peer.events).toEqual(['autoExport', 'decide'])
        expect(peer.autoExports).toEqual([mini.kit.seeded.manifestKey])
        expect(peer.exports).toEqual([])
        expect(mini.crashed).toEqual([])
    })

    // Reproducer: red on the base, where the prompt carries no automatic-export line.
    test('reproducer: a saved auto-export shows the saved line', async () => {
        const peer = nodePeer()
        await parkedDirty({ kind: 'node', peer })
        expect(peer.asked[0]).toMatchObject({ saveMineUnavailable: 'node', offers: ['reload', 'export-first'], autoExport: 'saved' })
        expect(peer.autoExports).toHaveLength(1)
    })

    test.each(['declined', 'failed'] as const)('new behaviour: a %s auto-export shows the did-not-finish line, once, with no failure report', async (result) => {
        const peer = nodePeer()
        peer.autoExportResult = result
        const mini = await parkedDirty({ kind: 'node', peer })
        expect(peer.asked[0]).toMatchObject({ offers: ['reload', 'export-first'], autoExport: 'not-finished' })
        expect(peer.autoExports).toHaveLength(1)
        expect(mini.uncounted).toEqual([])
        expect(mini.failures).toEqual([])
    })

    test('new behaviour: a throwing auto-export is reported once as an uncounted failure with attempts 5 and the prompt still shows the did-not-finish line', async () => {
        const peer = nodePeer()
        peer.autoExportFails = true
        const mini = await parkedDirty({ kind: 'node', peer })
        await settle(80)
        expect(mini.uncounted).toHaveLength(1)
        expect(mini.uncounted[0].attempts).toBe(5)
        expect(mini.failures).toEqual([])
        expect(peer.autoExports).toHaveLength(1)
        expect(peer.asked[0]).toMatchObject({ autoExport: 'not-finished' })
    })

    // Neither result resets `asked` in a loop: the question follows the export inside the same settle, with no loop tick between.
    test.each([
        ['saved', false, 'saved'],
        ['declined', false, 'not-finished'],
        ['failed', false, 'not-finished'],
        ['saved', true, 'not-finished'],
    ] as const)('new behaviour: a %s auto-export (throws: %s) is followed by the question with no loop tick between, and asks once', async (result, throws, line) => {
        const peer = nodePeer()
        peer.autoExportResult = result
        peer.autoExportFails = throws
        const db = clone(buildSmall(4))
        const kit = await startStore2({ db, kind: 'node', peer })
        const mini = runMiniLoop(kit, db)
        const ticksAt: Record<string, number> = {}
        const autoExport = peer.autoExport?.bind(peer)
        const decide = peer.decide.bind(peer)
        peer.autoExport = async (manifestKey) => {
            ticksAt.autoExport = mini.ticks
            return autoExport === undefined ? 'failed' : autoExport(manifestKey)
        }
        peer.decide = async (prompt) => {
            ticksAt.decide = mini.ticks
            return decide(prompt)
        }
        await peerCommit(kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
        chars(db)[0].personality = 'my edit'
        mini.mark(chaIdOf(db, 0))
        await until(() => peer.asked.length >= 1, 'the prompt', 4000)
        await settle(80)
        expect(ticksAt.decide).toBe(ticksAt.autoExport)
        expect(peer.asked).toHaveLength(1)
        expect(peer.asked[0].autoExport).toBe(line)
    })

    test('new behaviour: the question waits for a running auto-export and the park does not start a second one meanwhile', async () => {
        const peer = nodePeer()
        let release: () => void = () => {}
        peer.autoExportHold = new Promise<void>((resolve) => { release = resolve })
        const db = clone(buildSmall(4))
        const kit = await startStore2({ db, kind: 'node', peer })
        const mini = runMiniLoop(kit, db)
        await peerCommit(kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
        chars(db)[0].personality = 'my edit'
        mini.mark(chaIdOf(db, 0))
        await until(() => peer.autoExports.length === 1, 'the automatic export', 4000)
        await settle(80)
        expect(peer.asked).toEqual([])
        expect(peer.autoExports).toHaveLength(1)
        release()
        await until(() => peer.asked.length === 1, 'the prompt after the export', 4000)
        expect(peer.asked[0]).toMatchObject({ autoExport: 'saved' })
    })

    test('new behaviour: a busy action skips the auto-export, counts it as not finished and shows the did-not-finish line', async () => {
        const peer = nodePeer()
        busy.push(beginBusy('backupSave'))
        const mini = await parkedDirty({ kind: 'node', peer })
        await settle(80)
        expect(peer.autoExports).toEqual([])
        expect(peer.asked[0]).toMatchObject({ autoExport: 'not-finished' })
        expect(mini.uncounted).toEqual([])
        // The busy action ending later does not start the export: the park's one try is spent.
        busy[0].end()
        await settle(80)
        expect(peer.autoExports).toEqual([])
    })

    test.each(['imageAdd', 'import', 'hypaBulk'] as const)('new behaviour: any busy kind skips the auto-export, not only a backup save (%s)', async (kind) => {
        const peer = nodePeer()
        busy.push(beginBusy(kind))
        await parkedDirty({ kind: 'node', peer })
        await settle(80)
        expect(peer.autoExports).toEqual([])
        expect(peer.asked[0]).toMatchObject({ autoExport: 'not-finished' })
    })
})

describe('the auto-export is not repeated and not run where it does not belong', () => {
    // New behaviour that also pins a guard property: the manual export-first handling is unchanged and the automatic one is not repeated by its re-asking.
    test('also pins a guard: re-asking after a declined manual export, and a newer peer epoch, do not export again', async () => {
        const peer = nodePeer('export-first')
        peer.exportResult = 'declined'
        const mini = await parkedDirty({ kind: 'node', peer })
        expect(peer.autoExports).toHaveLength(1)
        await until(() => peer.asked.length >= 3, 'later questions on later ticks', 4000)
        expect(peer.autoExports).toHaveLength(1)
        expect(peer.exports.length).toBeGreaterThanOrEqual(2)
        // A newer commit on the base is a newer park of the same lifetime: asked about again, not exported again.
        const before = peer.asked.length
        await peerPin(mini.kit)
        mini.announce()
        await until(() => peer.asked.length >= before + 2, 'the questions after the newer epoch', 4000)
        expect(peer.autoExports).toHaveLength(1)
        expect(peer.asked[peer.asked.length - 1]).toMatchObject({ autoExport: 'saved' })
        expect(mini.failures).toEqual([])
        expect(mini.crashed).toEqual([])
    })

    test.each(['declined', 'failed'] as const)('also pins a guard: a %s auto-export is not retried on a newer peer epoch and the line stays did-not-finish', async (result) => {
        const peer = nodePeer('export-first')
        peer.exportResult = 'declined'
        peer.autoExportResult = result
        const mini = await parkedDirty({ kind: 'node', peer })
        expect(peer.autoExports).toHaveLength(1)
        await until(() => peer.asked.length >= 3, 'later questions on later ticks', 4000)
        const before = peer.asked.length
        await peerPin(mini.kit)
        mini.announce()
        await until(() => peer.asked.length >= before + 2, 'the questions after the newer epoch', 4000)
        expect(peer.autoExports).toHaveLength(1)
        expect(peer.asked[peer.asked.length - 1]).toMatchObject({ autoExport: 'not-finished' })
        expect(mini.failures).toEqual([])
        expect(mini.crashed).toEqual([])
    })

    test('also pins a guard: a clean Node park does not export (and a positive park exports exactly once)', async () => {
        const peer = nodePeer()
        const db = clone(buildSmall(4))
        const kit = await startStore2({ db, kind: 'node', peer })
        const mini = runMiniLoop(kit, db)
        await peerCommit(kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
        mini.announce()
        await until(() => peer.clean.length === 1, 'the clean notice', 4000)
        await settle(80)
        expect(peer.autoExports).toEqual([])
        expect(peer.asked).toEqual([])
        // The same page gaining an edit afterwards is a dirty Node park and exports exactly once.
        chars(db)[0].personality = 'late edit'
        mini.mark(chaIdOf(db, 0))
        await until(() => peer.asked.length === 1, 'the question', 4000)
        await settle(80)
        expect(peer.autoExports).toHaveLength(1)
        expect(peer.events).toEqual(['autoExport', 'decide'])
    })

    test('also pins a guard: a non-Node park, where Save mine is offered, does not export (and a Node park exports exactly once)', async () => {
        const peer = nodePeer()
        await parkedDirty({ kind: 'tauri', peer })
        await settle(80)
        expect(peer.autoExports).toEqual([])
        expect(peer.asked[0].offers).toEqual(['reload', 'save-mine'])
        expect(peer.asked[0].autoExport).toBeUndefined()
        const nodeOnly = nodePeer()
        await parkedDirty({ kind: 'node', peer: nodeOnly })
        expect(nodeOnly.autoExports).toHaveLength(1)
    })

    test('also pins a guard: a park that is replaced does not export (and a peer park exports exactly once)', async () => {
        const peer = nodePeer()
        const db = clone(buildSmall(4))
        const kit = await startStore2({ db, kind: 'node', peer })
        const real = kit.committer
        const replacing: Committer = {
            ...real,
            async commit() {
                return { status: 'refused', reason: 'absent', detail: 'the saved data was replaced' }
            },
        }
        kit.context.session = { ...kit.context.session, committer: replacing }
        const mini = runMiniLoop(kit, db)
        chars(db)[0].personality = 'my edit'
        mini.mark(chaIdOf(db, 0))
        await until(() => peer.asked.length >= 1, 'the replaced question', 4000)
        await settle(80)
        expect(peer.asked[0]).toMatchObject({ reason: 'replaced', saveMineUnavailable: 'replaced' })
        expect(peer.autoExports).toEqual([])
        expect(peer.asked[0].autoExport).toBeUndefined()
        const peerPark = nodePeer()
        await parkedDirty({ kind: 'node', peer: peerPark })
        expect(peerPark.autoExports).toHaveLength(1)
    })

    test('also pins a guard: a park after an unpark is a new park and exports again', async () => {
        const peer = nodePeer('export-first')
        peer.exportResult = 'declined'
        const db = clone(buildSmall(4))
        const kit = await startStore2({ db, kind: 'node', peer })
        const mini = runMiniLoop(kit, db)
        // The seed manifest enters `retained` only when the previous `current` is old enough.
        kit.clock.advance(6 * 60 * 1000)
        await peerCommit(kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
        chars(db)[0].personality = 'my edit'
        mini.mark(chaIdOf(db, 0))
        await until(() => peer.autoExports.length === 1 && peer.asked.length >= 2, 'the first park', 4000)
        const { createCommitter } = await import('../../store2/commit')
        const peerCommitter = createCommitter(kit.memory, { owner: 'peer-page' })
        const restored = await peerCommitter.restore(await peerCommitter.readCommit(), kit.seeded.manifestKey)
        expect(restored.status).toBe('committed')
        mini.announce()
        // The base is this page's again: the loop unparks and its next pass saves the edit.
        await until(() => peer.autoExports.length === 1 && !mini.dirty, 'the unpark', 4000)
        await settle(120)
        // A peer commits again: a second park of the same page.
        await peerCommit(kit, (peerDb) => { chars(peerDb)[2].personality = 'a second peer edit' }, 9001)
        chars(db)[1].personality = 'another edit'
        mini.mark(chaIdOf(db, 1))
        await until(() => peer.autoExports.length === 2, 'the second park\'s export', 4000)
        expect(mini.crashed).toEqual([])
    })
})
