/**
 * Test-only fixtures of the line and replaced-stamp suites: a peer page built from the committer and encoder APIs that
 * exist without the line feature (so a reproducer fails on its asserted content, never on a missing import), the
 * writers an older build or a forgotten writer would have been, and a hand-built save loop port over a dispatch-booted
 * page. Mocked storage here says nothing about a native backend.
 */
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { createCommitter, type Committer } from 'src/ts/storage/store2/commit'
import { classifyCommitRead, nextCommitKey } from 'src/ts/storage/store2/commitKey'
import type { MemoryBackend, Store2Backend } from 'src/ts/storage/store2/backend'
import { encodeUnit, newManifestKey, readUnit, UNIT_TYPE, type CommitKey, type KeyEnv, type Manifest } from 'src/ts/storage/store2/format'
import { finalWrite } from 'src/ts/storage/store2/recoveryPick'
import { runExit } from 'src/ts/storage/store2/recovery'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { createSaveEncoder, type SaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import type { Store2SaveContext } from 'src/ts/storage/store2/saveActive'
import { runStore2SaveLoop, type Store2LoopPort } from 'src/ts/storage/store2/saveLoop'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import type { Database } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { seedTree, testEnv, type TestClock } from '../store2SaveKit'
import { buildSmall, fakeLists } from './codecFixtures'
import { until } from '../saveLoopWorld'

export { until }

type Entry = Record<string, unknown>

export function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

export function chars(db: Database): Entry[] {
    return db.characters as unknown as Entry[]
}

export function chaIdOf(db: Database, index: number): string {
    return String(chars(db)[index].chaId)
}

/** The seed profile: every character resident, so a page edits and plans without stubs. */
export function seedProfile(count = 4): Database {
    const db = clone(buildSmall(count))
    db.archiveCharacters = false
    return db
}

export async function parsedKey(backend: Store2Backend): Promise<CommitKey> {
    const read = classifyCommitRead(await backend.readCommit())
    if (read.status !== 'parsed') {
        throw new Error(`The commit key is ${read.status}.`)
    }
    return read.value
}

/** The two additive fields of a commit key, read without the module that writes them. */
export function extrasOf(key: CommitKey): { line?: { id: string, tip: string }, replaced?: { kind: string, seq: number, epoch: string } } {
    return key as unknown as { line?: { id: string, tip: string }, replaced?: { kind: string, seq: number, epoch: string } }
}

export interface PeerPage {
    committer: Committer
    /** A descending ordinary commit: the page re-reads the current tree, applies `edit` and commits over a fresh read. */
    commitEdit(edit: (db: Database) => void): Promise<CommitKey>
    /** The page's view now, to be used later by `saveMine` as a stale plan. */
    freeze(): Promise<Frozen>
    /** The web Save mine of a page whose plan is stale: planned over `frozen`, committed over a fresh read. */
    saveMine(frozen: Frozen, edit: (db: Database) => void): Promise<CommitKey>
    restore(manifestKey: string): Promise<CommitKey>
}

export interface Frozen {
    db: Database
    encoder: SaveEncoder
}

/** A page that reads and writes the store through the committer and encoder only, as another tab does. */
export function peerPage(backend: Store2Backend, clock: TestClock, seed: number, owner = 'peer-page'): PeerPage {
    const committer = createCommitter(backend, { owner, env: testEnv(clock, seed) })
    let draws = 0
    const encoderEnv = (): KeyEnv => testEnv(clock, seed * 1000 + (draws += 1))

    async function freeze(): Promise<Frozen> {
        const key = await parsedKey(backend)
        if (key.current === null) {
            throw new Error('The store names no current manifest.')
        }
        const read = await readTreeBytes(backend, key.current.key)
        if (read.status !== 'ok') {
            throw new Error(`The tree read ${read.status}.`)
        }
        const db = assembleDatabase(read.tree.manifest, read.tree.source)
        return { db, encoder: createSaveEncoder({ previous: previousOfTree(read.tree), lists: fakeLists, env: encoderEnv() }) }
    }

    async function committed(result: Awaited<ReturnType<Committer['commit']>> | Awaited<ReturnType<Committer['restore']>>): Promise<CommitKey> {
        if (result.status !== 'committed') {
            throw new Error(`The peer commit came to ${result.status}.`)
        }
        return result.value
    }

    return {
        committer,
        async commitEdit(edit) {
            const frozen = await freeze()
            edit(frozen.db)
            const plan = await frozen.encoder.plan(frozen.db, { marked: new Set(), modules: true, whole: true })
            const value = await committed(await committer.commit(await committer.readCommit(), plan.commitRequest()))
            plan.acknowledge()
            return value
        },
        freeze,
        async saveMine(frozen, edit) {
            edit(frozen.db)
            const plan = await frozen.encoder.plan(frozen.db, { marked: new Set(), modules: true, whole: true })
            return committed(await committer.saveMine(await committer.readCommit(), plan.commitRequest()))
        },
        async restore(manifestKey) {
            return committed(await committer.restore(await committer.readCommit(), manifestKey))
        },
    }
}

/**
 * The kit seed plus, optionally, one real descending commit by a peer page: its base has no line, so the commit mints
 * one exactly as the first save of a build that has the line does.
 */
export async function lineSeededStore(memory: MemoryBackend, clock: TestClock, options: { mintLine: boolean, count?: number }): Promise<{ firstManifest: string, page: PeerPage }> {
    const seeded = await seedTree(memory, seedProfile(options.count), testEnv(clock, 4242), fakeLists)
    const page = peerPage(memory, clock, 7)
    if (options.mintLine) {
        // The seed's manifest enters the retained list (the admission window has passed), so a test can restore it later.
        clock.advance(10 * 60_000)
        await page.commitEdit((db) => { chars(db)[3].personality = 'line minting edit' })
    }
    return { firstManifest: seeded.manifestKey, page }
}

/**
 * A commit by a build that has no line writer: the same manifest and units a real commit lands, with a commit key made
 * the old way (`nextCommitKey` over the base, no line written), so the base's `line` is carried unchanged and its tip
 * goes stale.
 */
export async function olderBuildCommit(memory: MemoryBackend, page: PeerPage, edit: (db: Database) => void): Promise<CommitKey> {
    const base = await parsedKey(memory)
    const landed = await page.commitEdit(edit)
    if (landed.current === null) {
        throw new Error('The commit names no current manifest.')
    }
    const manifestBytes = (await memory.readUnits([landed.current.key])).get(landed.current.key)
    const manifest = readUnit(manifestBytes as Uint8Array, UNIT_TYPE.manifest)
    if (manifest.status !== 'ok') {
        throw new Error('The landed manifest does not read.')
    }
    const older = nextCommitKey(base, {
        current: landed.current,
        retained: landed.retained,
        manifests: [manifest.value.body as Manifest],
    }, testEnv({ now: 0, advance: () => { } }, base.seq + 9000))
    await plantBytes(memory, encodeUnit(UNIT_TYPE.commit, older))
    return older
}

/** Writes `bytes` as the commit key over whatever is stored, as a restored backup or a sync tool would. */
export async function plantBytes(memory: Store2Backend, bytes: Uint8Array): Promise<void> {
    await memory.casCommit((await memory.readCommit()).token, bytes)
}

/** Overwrites the commit key with bytes that fail the checksum. */
export async function damageCommitKey(memory: Store2Backend): Promise<void> {
    const current = (await memory.readCommit()).bytes
    const damaged = new Uint8Array(current === null ? 64 : current.length)
    damaged.fill(7)
    await plantBytes(memory, damaged)
}

/**
 * The recovery exit over a damaged key, then a final write made the old way: no line and no stamp (the `finalWrite`
 * of a build without the line feature). `copy` first copies the picked manifest under a fresh manifest key, as an
 * install does; `in-place` names the existing manifest, which stands for a writer that forgets the rule.
 */
export async function olderBuildRecovery(memory: MemoryBackend, clock: TestClock, manifestKey: string, mode: 'copy' | 'in-place', seqFloor: number): Promise<CommitKey> {
    const env = testEnv(clock, 555)
    const exit = await runExit(memory, await memory.readCommit(), { kind: 'pick', manifestSeq: 1, highestSeqRead: seqFloor }, { owner: 'peer-page', env })
    if (exit.status !== 'marked') {
        throw new Error(`The exit came to ${exit.status}.`)
    }
    const bytes = (await memory.readUnits([manifestKey])).get(manifestKey)
    const manifest = readUnit(bytes as Uint8Array, UNIT_TYPE.manifest)
    if (manifest.status !== 'ok') {
        throw new Error('The picked manifest does not read.')
    }
    let named = manifestKey
    if (mode === 'copy') {
        named = newManifestKey(env)
        await memory.putUnit(named, bytes as Uint8Array)
    }
    const next = nextCommitKey(exit.marker, {
        current: { key: named, at: env.now() },
        retained: [],
        pins: [],
        staging: null,
        manifests: [manifest.value.body as Manifest],
    }, env)
    await memory.casCommit(exit.markerRead.token, encodeUnit(UNIT_TYPE.commit, next))
    return next
}

/** The install a build that has the line feature writes over a damaged key: the real recovery exit and the real `finalWrite`. */
export async function recoveryInstall(memory: MemoryBackend, clock: TestClock, manifestKey: string, seqFloor: number): Promise<CommitKey> {
    const env = testEnv(clock, 556)
    const exit = await runExit(memory, await memory.readCommit(), { kind: 'pick', manifestSeq: 1, highestSeqRead: seqFloor }, { owner: 'peer-page', env })
    if (exit.status !== 'marked') {
        throw new Error(`The exit came to ${exit.status}.`)
    }
    const bytes = (await memory.readUnits([manifestKey])).get(manifestKey)
    const manifest = readUnit(bytes as Uint8Array, UNIT_TYPE.manifest)
    if (manifest.status !== 'ok') {
        throw new Error('The picked manifest does not read.')
    }
    const result = await finalWrite({ backend: memory, env, marked: exit }, manifestKey, manifest.value.body as Manifest)
    if (result.status !== 'installed') {
        throw new Error(`The install came to ${result.status}.`)
    }
    return result.value
}

export interface LoopHandle {
    tracker: toSaveType
    state: { due: boolean, dirty: boolean, saved: number, peerHeard: boolean, stopped: string }
    crashed: unknown[]
    mark(chaId: string): void
    stop(): void
}

const handles: LoopHandle[] = []

export function stopAllLoops(): void {
    for (const handle of handles) {
        handle.stop()
    }
    handles.length = 0
}

/** Runs the real save loop over `context` and `db` with a hand-built port; `idleNet` is switched off so the page reads the store only when told. */
export function runLoopOver(context: Store2SaveContext, db: Database): LoopHandle {
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const handle: LoopHandle = {
        tracker,
        state: { due: false, dirty: false, saved: 0, peerHeard: false, stopped: '' },
        crashed: [],
        mark(chaId) {
            tracker.character.push(chaId)
            handle.state.dirty = true
            handle.state.due = true
        },
        stop() {
            stopped = true
        },
    }
    context.idleNet = null
    const idle = () => new Promise<void>((resolve) => {
        if (!stopped) {
            setTimeout(resolve, 2)
        }
    })
    const port: Store2LoopPort = {
        tracker,
        reloadFlag: { state: false },
        getDatabase: () => db,
        mergeBack(live, snapshot) {
            for (const chaId of snapshot.character) {
                if (!live.character.includes(chaId)) {
                    live.character.push(chaId)
                }
            }
        },
        liveCheck: () => { },
        sweep: () => { },
        isDue: () => handle.state.due,
        isDirty: () => handle.state.dirty,
        hasDrafts: () => false,
        beginIteration() {
            handle.state.due = false
        },
        endIteration() { },
        snapshotTaken() {
            handle.state.dirty = false
        },
        requestPass() {
            handle.state.dirty = true
            handle.state.due = true
        },
        unsavable() { },
        saved() {
            handle.state.saved += 1
        },
        broadcast() { },
        peerHeard() {
            const heard = handle.state.peerHeard
            handle.state.peerHeard = false
            return heard
        },
        setStopped(reason) {
            handle.state.stopped = reason
        },
        notifyTooLarge() { },
        reportFailure() {
            return 1
        },
        reportUncountedFailure() {
            return 1
        },
        async withWriteLock(run) {
            const before = tail
            let release: () => void = () => { }
            tail = new Promise<void>((resolve) => { release = resolve })
            await before
            try {
                return await run()
            } finally {
                release()
            }
        },
        wait: idle,
        sleep: idle,
        sleepForever: () => new Promise<never>(() => { }),
        now: () => Date.now(),
    }
    runStore2SaveLoop(context, port).catch((error: unknown) => {
        handle.crashed.push(error)
    })
    handles.push(handle)
    return handle
}
