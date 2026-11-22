// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest'
import { language } from 'src/lang'
import { gcPass } from '../../store2/gc/pass'
import { checkTree } from '../../store2/commit'
import { keyOfRef, readUnit, UNIT_TYPE, type CommitKey, type Manifest, type WorkspaceRecord } from '../../store2/format'
import type { SkippedItem } from '../../store2/codec'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import { PARK_CHECK_MAX_MS, runStore2SaveLoop, type ModuleHold, type Store2LoopPort } from '../../store2/saveLoop'
import type { Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until as untilCondition } from '../saveLoopWorld'
import { createPeerDouble, peerCommit, startStore2, type PeerDouble, type Store2Kit, type Store2StartOptions } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

/**
 * The store2 save loop over a module, a preset list, a setting or a plugin-data key that cannot be stored as JSON:
 * the pass goes on without that item, the last saved copy is kept, and the item is told once and stays dirty. The loop
 * runs over a real memory backend and committer with a hand-built port; every bad value is a live mutation of a copy
 * of the seeded database. Labels in the titles: reproducer (the base pass throws on the bad value, so the edit next to
 * it never lands), guard (passes before and after).
 */

type Entry = Record<string, unknown>

const clone = (db: Database): Database => JSON.parse(JSON.stringify(db)) as Database
const chars = (db: Database): Entry[] => db.characters as unknown as Entry[]
const modules = (db: Database): Entry[] => db.modules as unknown as Entry[]
const presets = (db: Database): Entry[] => db.botPresets as unknown as Entry[]
const chaIdOf = (db: Database, index: number): string => String(chars(db)[index].chaId)
const cyclic = (): Entry => {
    const value: Entry = {}
    value.self = value
    return value
}

interface ItemCall {
    current: SkippedItem[]
    newly: SkippedItem[]
}

interface Loop {
    kit: Store2Kit
    db: Database
    tracker: toSaveType
    state: { dirty: boolean, saved: number, peerHeard: boolean, due: boolean }
    failures: Array<{ error: unknown, attempts: number }>
    uncounted: unknown[]
    sleeps: number[]
    /** The loop's own `requestPass` calls: a skipped item must never ask for another pass. */
    requested: number
    merges: number
    itemCalls: ItemCall[]
    /** The module hold each `saved` notice carried, with the plan request of the pass that reported it. */
    holds: Array<{ hold: ModuleHold, request: SavePassRequest | undefined }>
    /** Every plan request the loop made, in order. */
    requests: SavePassRequest[]
    /** Every call that named a newly standing item. */
    notices(): SkippedItem[][]
    /** While set, `markUnsaved` is counted but leaves the page clean: isolates a check from the dirty mark. */
    ignoreMarks: boolean
    /** The base reads so far: one per pass, a tick included. */
    passes(): number
    mark(chaId: string): void
    markModules(): void
    stop(): void
}

const loops: Loop[] = []

afterEach(() => {
    for (const loop of loops) {
        loop.stop()
    }
    loops.length = 0
})

function runLoop(kit: Store2Kit, db: Database): Loop {
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    let passes = 0
    const real = kit.committer
    kit.context.session = { ...kit.context.session, committer: { ...real, readCommit: () => { passes++; return real.readCommit() } } }
    const requests: SavePassRequest[] = []
    const inner = createSaveEncoder({ previous: kit.context.previous, lists: kit.context.lists, env: kit.context.env })
    const encoder: SaveEncoder = Object.create(inner) as SaveEncoder
    encoder.plan = async (planDb, request) => {
        requests.push(request)
        return inner.plan(planDb, request)
    }
    kit.context.encoder = encoder
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const loop: Loop = {
        kit, db, tracker,
        state: { dirty: false, saved: 0, peerHeard: false, due: false },
        failures: [],
        uncounted: [],
        sleeps: [],
        requested: 0,
        merges: 0,
        itemCalls: [],
        holds: [],
        requests,
        notices: () => loop.itemCalls.filter(call => call.newly.length > 0).map(call => call.newly),
        ignoreMarks: false,
        passes: () => passes,
        mark(chaId) {
            tracker.character.push(chaId)
            loop.state.dirty = true
            loop.state.due = true
        },
        markModules() {
            tracker.modules = true
            loop.state.dirty = true
            loop.state.due = true
        },
        stop() {
            stopped = true
        },
    }
    const idle = () => new Promise<void>((resolve) => {
        if (!stopped) {
            setTimeout(resolve, 2)
        }
    })
    const port: Store2LoopPort = {
        tracker,
        reloadFlag: { state: false },
        getDatabase: () => loop.db,
        mergeBack(live, snapshot) {
            loop.merges += 1
            for (const chaId of snapshot.character) {
                if (!live.character.includes(chaId)) {
                    live.character.push(chaId)
                }
            }
            live.modules ||= snapshot.modules
        },
        liveCheck: () => { },
        sweep: () => { },
        isDue: () => loop.state.due,
        isDirty: () => loop.state.dirty,
        hasDrafts: () => false,
        beginIteration() {
            loop.state.due = false
        },
        endIteration: () => { },
        snapshotTaken() {
            loop.state.dirty = false
        },
        requestPass() {
            loop.requested += 1
            loop.state.dirty = true
            loop.state.due = true
        },
        markUnsaved() {
            loop.state.dirty = !loop.ignoreMarks
        },
        unsavable: () => { },
        unsavableItems(current, newly) {
            loop.itemCalls.push({ current: [...current], newly: [...newly] })
        },
        saved(hold) {
            loop.holds.push({ hold, request: requests[requests.length - 1] })
            loop.state.saved += 1
        },
        broadcast: () => { },
        peerHeard() {
            const heard = loop.state.peerHeard
            loop.state.peerHeard = false
            return heard
        },
        setStopped: () => { },
        notifyTooLarge: () => { },
        reportFailure(error, attempts) {
            loop.failures.push({ error, attempts })
            return 1
        },
        reportUncountedFailure(error) {
            loop.uncounted.push(error)
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
        sleep(ms) {
            loop.sleeps.push(ms)
            if (ms === PARK_CHECK_MAX_MS) {
                return new Promise<void>(() => { })
            }
            return idle()
        },
        sleepForever: () => new Promise<never>(() => { }),
        now: () => Date.now(),
    }
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
        console.error(error)
    })
    loops.push(loop)
    return loop
}

interface Setup {
    /** Edits the seeded database before the first tree is made: what the acknowledged encoding holds. */
    seed?: (db: Database) => void
    /** Edits the live copy the loop runs over: the bad values go in here. */
    live?: (db: Database) => void
    options?: Partial<Store2StartOptions>
}

async function start(setup: Setup = {}): Promise<Loop> {
    const seeded = clone(buildSmall(4))
    setup.seed?.(seeded)
    const kit = await startStore2({ db: seeded, idleNet: { intervalMs: 1 }, ...setup.options })
    const live = clone(seeded)
    setup.live?.(live)
    return runLoop(kit, live)
}

/**
 * Waits for `condition`; a loop's reported save failure ends the wait at once and fails it with that error, so a pass
 * that throws on the bad value reads as the failure it is and not as a timeout.
 */
async function until(condition: () => boolean | Promise<boolean>, what: string, timeoutMs: number): Promise<void> {
    let failure: unknown = null
    await untilCondition(async () => {
        if (await condition()) {
            return true
        }
        const failed = loops.find(loop => loop.failures.length > 0)
        if (failed !== undefined) {
            failure = failed.failures[0].error
            return true
        }
        return false
    }, what, timeoutMs)
    if (failure !== null) {
        throw new Error(`a save pass failed while waiting for ${what}: ${failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure)}`)
    }
}

async function quietPasses(loop: Loop, count: number): Promise<void> {
    const before = loop.passes()
    await until(() => loop.passes() >= before + count, `${count} more passes`, 4000)
}

const labelsOf = (items: SkippedItem[]): Array<{ scope: string, key: string, label: string, saved: boolean }> =>
    items.map(({ scope, key, label, saved }) => ({ scope, key, label, saved }))

const MINUTE = 60 * 1000

function keeps(key: CommitKey, manifestKey: string): boolean {
    return key.current?.key === manifestKey || key.retained.some(entry => entry.key === manifestKey) || key.pins.some(pin => pin.key === manifestKey)
}

const raw = (db: Database): Entry => db as unknown as Entry
const pluginList = (db: Database, list: 'plugins' | 'pluginV2'): Entry[] => raw(db)[list] as Entry[]
const workspaceList = (db: Database): Entry[] => raw(db).utilityWorkspaces as Entry[]
const workspaceFiles = (db: Database, index: number): Entry[] => workspaceList(db)[index].files as Entry[]

/** A workspace file as `commitWorkspaceChange` produces it: the size is the UTF-8 byte length of the text. */
const workspaceFile = (id: string, path: string, text: string): Entry => ({
    id, path, text, size: new TextEncoder().encode(text).length, mtime: 1_700_000_000_000,
})
const workspaceOf = (id: string, name: string, files: Entry[]): Entry => ({ id, name, createdAt: 1, files })

/** What the acknowledged encoding of a page holds: one workspace, `Notes`. */
const seedNotes = (db: Database): void => {
    raw(db).utilityWorkspaces = [workspaceOf('w1', 'Notes', [workspaceFile('f1', 'a.md', 'alpha'), workspaceFile('f2', 'b.md', 'beta')])]
}

const refHead = (ref: readonly unknown[]): string => ref.slice(0, 3).join(':')

/**
 * The loop-level twin of the codec's index check: every `plugin:`, `ws:` and `wsf:` identity the encoder acknowledged is
 * named by the manifest the store currently holds (a plugin ref, a workspace ref, or a file ref of a named record).
 */
async function expectAcknowledgedFrontNamed(loop: Loop): Promise<void> {
    const entries = loop.kit.memory.snapshot()
    const key = (await loop.kit.commitKey()).current?.key as string
    const manifestRead = readUnit(entries.get(key) as Uint8Array, UNIT_TYPE.manifest)
    if (manifestRead.status !== 'ok') {
        throw new Error(`The current manifest is ${manifestRead.status}.`)
    }
    const manifest = manifestRead.value.body as Manifest
    const named = new Set<string>()
    for (const ref of manifest.fixed.plugins) {
        named.add(refHead(ref))
    }
    for (const ref of manifest.fixed.workspaces ?? []) {
        named.add(refHead(ref))
        const record = readUnit(entries.get(keyOfRef(ref)) as Uint8Array, UNIT_TYPE.workspace)
        if (record.status !== 'ok') {
            throw new Error(`A workspace record is ${record.status}.`)
        }
        for (const file of (record.value.body as WorkspaceRecord).files) {
            named.add(refHead(file.ref))
        }
    }
    for (const [identity, unit] of loop.kit.context.encoder.acknowledged().units) {
        if (/^(plugin|ws|wsf):/.test(identity)) {
            expect(named.has(refHead(unit.ref)), `${identity} is named by the manifest`).toBe(true)
        }
    }
}

describe('a module that cannot be stored is skipped and keeps its saved copy', () => {
    test('reproducer: the character edit lands, the module keeps its saved copy, one notice, and no failure, extra pass or wait', async () => {
        const loop = await start({ live: (db) => { modules(db)[1].cyc = cyclic() } })
        chars(loop.db)[2].personality = 'edited next to the skipped module'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        const saved = await loop.kit.saved()
        expect(saved.characters[2]).toMatchObject({ personality: 'edited next to the skipped module' })
        expect(saved.modules[1]).toEqual(loop.kit.seedDb.modules[1])
        expect(labelsOf(loop.itemCalls[0].newly)).toEqual([{ scope: 'module', key: String(modules(loop.db)[1].id), label: '"Module 1"', saved: true }])
        expect(loop.itemCalls[0].current).toHaveLength(1)

        await quietPasses(loop, 10)
        expect(loop.failures).toEqual([])
        expect(loop.uncounted).toEqual([])
        expect(loop.sleeps).toEqual([])
        expect(loop.requested).toBe(0)
        expect(loop.merges).toBe(0)
        expect(loop.notices()).toHaveLength(1)
    })

    test('reproducer: quiet ticks and a later marked pass over the same fault tell nothing again', async () => {
        const loop = await start({ live: (db) => { modules(db)[1].cyc = cyclic() } })
        chars(loop.db)[2].personality = 'first'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        await quietPasses(loop, 10)
        chars(loop.db)[3].personality = 'second'
        loop.mark(chaIdOf(loop.db, 3))
        await until(async () => (await loop.kit.saved()).characters[3].personality === 'second', 'the second edit', 4000)
        await quietPasses(loop, 4)
        expect(loop.notices()).toHaveLength(1)
        expect(loop.itemCalls).toHaveLength(1)
        expect(loop.failures).toEqual([])
        expect(loop.requested).toBe(0)
    })

    test('guard (new rule): a landed pass that did not encode modules keeps the standing module item, and a later marked pass adds no notice', async () => {
        const loop = await start({ live: (db) => { modules(db)[1].cyc = cyclic() } })
        chars(loop.db)[2].personality = 'first'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        const key = `module:${String(modules(loop.db)[1].id)}`
        expect(loop.itemCalls[0].current).toHaveLength(1)

        // No mark of any kind: only the idle net's character verdict can find and commit this edit, and that pass does not
        // encode modules.
        const marksBefore = [...loop.tracker.character]
        chars(loop.db)[3].personality = 'edited without a mark'
        await until(async () => (await loop.kit.saved()).characters[3].personality === 'edited without a mark', 'the unmarked edit to land', 6000)
        expect(loop.tracker.character).toEqual(marksBefore)
        expect(loop.requested).toBe(0)
        await quietPasses(loop, 4)
        expect(loop.itemCalls).toHaveLength(1)
        expect(loop.itemCalls[loop.itemCalls.length - 1].current.map(item => `${item.scope}:${item.key}`)).toEqual([key])

        chars(loop.db)[2].personality = 'second'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(async () => (await loop.kit.saved()).characters[2].personality === 'second', 'the marked edit', 4000)
        await quietPasses(loop, 4)
        expect(loop.itemCalls).toHaveLength(1)
        expect(loop.notices()).toHaveLength(1)
        expect(loop.failures).toEqual([])
    })

    test('reproducer: a fix clears the item and saves the module, and breaking it again is a new notice', async () => {
        const loop = await start({ live: (db) => { modules(db)[1].cyc = cyclic() } })
        chars(loop.db)[2].personality = 'first'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the first report', 4000)
        await quietPasses(loop, 6)

        delete modules(loop.db)[1].cyc
        modules(loop.db)[1].description = 'fixed module'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 2, 'the report that clears it', 4000)
        expect(loop.itemCalls[1].current).toEqual([])
        expect(loop.itemCalls[1].newly).toEqual([])
        expect((await loop.kit.saved()).modules[1]).toMatchObject({ description: 'fixed module' })

        modules(loop.db)[1].cyc = cyclic()
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 3, 'the second notice', 4000)
        expect(loop.notices().map(newly => labelsOf(newly))).toEqual([
            [{ scope: 'module', key: String(modules(loop.db)[1].id), label: '"Module 1"', saved: true }],
            [{ scope: 'module', key: String(modules(loop.db)[1].id), label: '"Module 1"', saved: true }],
        ])
        expect(loop.failures).toEqual([])
    })

    test('reproducer: a fix without a module mark still saves on the next marked pass (the skip keeps the module mark)', async () => {
        const loop = await start({ live: (db) => { modules(db)[1].cyc = cyclic() } })
        chars(loop.db)[2].personality = 'first'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the first report', 4000)

        delete modules(loop.db)[1].cyc
        modules(loop.db)[1].description = 'fixed without a module mark'
        chars(loop.db)[3].personality = 'only a character is marked'
        loop.mark(chaIdOf(loop.db, 3))
        await until(() => loop.itemCalls.length >= 2, 'the report that clears it', 4000)
        const saved = await loop.kit.saved()
        expect(saved.modules[1]).toMatchObject({ description: 'fixed without a module mark' })
        expect(saved.characters[3]).toMatchObject({ personality: 'only a character is marked' })
        expect(loop.itemCalls[1].current).toEqual([])
    })

    test('reproducer: a module the acknowledged encoding never held is left out, noticed as never saved, and stays out of the store', async () => {
        const loop = await start({
            live: (db) => {
                modules(db).push({ ...JSON.parse(JSON.stringify(modules(db)[0])) as Entry, id: 'never-saved-module', name: 'Never saved module', cyc: cyclic() })
            },
        })
        chars(loop.db)[2].personality = 'edited next to the new module'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        expect(labelsOf(loop.itemCalls[0].newly)).toEqual([{ scope: 'module', key: 'never-saved-module', label: '"Never saved module"', saved: false }])
        const saved = await loop.kit.saved()
        expect(saved.modules).toHaveLength(4)
        expect(saved.characters[2]).toMatchObject({ personality: 'edited next to the new module' })
        expect(loop.failures).toEqual([])
    })
})

describe('a module that cannot be told from another carries the whole acknowledged module set', () => {
    test('reproducer: a previous-index duplicate whose second copy faults keeps the committed module index as acknowledged, and says so once', async () => {
        const loop = await start({
            seed: (db) => { modules(db)[1].id = modules(db)[0].id },
            live: (db) => {
                modules(db).splice(0, 1)
                modules(db)[0].cyc = cyclic()
            },
        })
        chars(loop.db)[2].personality = 'edited next to the held modules'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        const saved = await loop.kit.saved()
        expect(saved.characters[2]).toMatchObject({ personality: 'edited next to the held modules' })
        expect(saved.modules).toEqual(loop.kit.seedDb.modules)
        expect(loop.itemCalls[0].newly).toHaveLength(1)
        expect(loop.itemCalls[0].newly[0]).toMatchObject({ scope: 'moduleSet', saved: true })
        expect(loop.failures).toEqual([])
        await quietPasses(loop, 10)
        expect(loop.notices()).toHaveLength(1)
        expect(loop.failures).toEqual([])
        expect(loop.requested).toBe(0)
    })
})

describe('a front item is skipped without a mark', () => {
    test('reproducer: a cyclic bot preset holds the whole list, the rest saves, and one notice names it', async () => {
        const loop = await start({ live: (db) => { presets(db)[1].temperature = cyclic() } })
        chars(loop.db)[2].personality = 'edited next to the held presets'
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        const saved = await loop.kit.saved()
        expect(saved.characters[2]).toMatchObject({ personality: 'edited next to the held presets' })
        expect(saved.botPresets).toEqual(loop.kit.seedDb.botPresets)
        expect(labelsOf(loop.itemCalls[0].newly)).toEqual([{ scope: 'presets', key: 'presets', label: '"Preset 1"', saved: true }])
        await quietPasses(loop, 10)
        expect(loop.notices()).toHaveLength(1)
        expect(loop.failures).toEqual([])
        expect(loop.requested).toBe(0)

        presets(loop.db)[1].temperature = 99
        chars(loop.db)[3].personality = 'edited after the fix'
        loop.mark(chaIdOf(loop.db, 3))
        await until(() => loop.itemCalls.length >= 2, 'the report that clears it', 4000)
        expect(loop.itemCalls[1].current).toEqual([])
        expect((await loop.kit.saved()).botPresets[1]).toMatchObject({ temperature: 99 })
    })

    test('reproducer: a setting that cannot be stored keeps its saved value while the rest saves', async () => {
        const loop = await start({
            seed: (db) => { (db as unknown as Entry).someSetting = 'kept' },
            live: (db) => { (db as unknown as Entry).someSetting = 10n },
        })
        chars(loop.db)[2].personality = 'edited next to the held setting'
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        const saved = await loop.kit.saved()
        expect(saved.characters[2]).toMatchObject({ personality: 'edited next to the held setting' })
        expect((saved as unknown as Entry).someSetting).toBe('kept')
        expect(labelsOf(loop.itemCalls[0].newly)).toEqual([{ scope: 'settings', key: 'someSetting', label: '"someSetting"', saved: true }])
        expect(loop.failures).toEqual([])
    })

    test('reproducer: a cyclic plugin holds its list, the character edit lands, and one notice names the plugin', async () => {
        const loop = await start({ live: (db) => { pluginList(db, 'pluginV2')[0].cycle = cyclic() } })
        chars(loop.db)[2].personality = 'edited next to the unstorable plugin'
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        const saved = await loop.kit.saved()
        expect(saved.characters[2]).toMatchObject({ personality: 'edited next to the unstorable plugin' })
        expect(saved.pluginV2).toEqual(loop.kit.seedDb.pluginV2)
        expect(labelsOf(loop.itemCalls[0].newly)).toEqual([{ scope: 'plugins', key: 'pluginV2', label: '"Plugin 99"', saved: true }])
        expect(loop.failures).toEqual([])
    })

    test('guard (passes before and after): a bad value in a part no skip rule covers still fails the pass and is reported', async () => {
        const loop = await start({ live: (db) => { raw(db).pluginCustomStorage = 10n } })
        chars(loop.db)[2].personality = 'edited next to the unstorable plugin storage root'
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.failures.length >= 1, 'the failure report', 4000)
        expect(loop.itemCalls).toEqual([])
        expect(loop.state.saved).toBe(0)
    })
})

describe('loadouts, statics and the character order that cannot be stored keep their saved value', () => {
    const assetPath = (n: number): string => `assets/${n.toString(16).padStart(64, '0')}.png`
    const loadoutEntry = (name: string, characterIds: string[], n: number): Entry => ({
        name, id: `l${n}`, lastUsed: 1_700_000_000_000 + n, favorite: false, characterIds, modules: [], globalVariables: {},
        presetName: 'Default', presetId: 'preset-1', personaId: 'persona-1', icons: [assetPath(n)],
    })
    const loadouts = (db: Database): Entry[] => (db as unknown as Entry).loadouts as Entry[]
    const order = (db: Database): unknown[] => (db as unknown as Entry).characterOrder as unknown[]

    /** Real-shaped loadouts and character-order folders in what the acknowledged encoding holds. */
    const seedFixed = (db: Database): void => {
        const raw = db as unknown as Entry
        raw.loadouts = [
            loadoutEntry('Loadout A', [chaIdOf(db, 0)], 1),
            loadoutEntry('Loadout B', [chaIdOf(db, 1)], 2),
            loadoutEntry('Loadout C', [chaIdOf(db, 2)], 3),
        ]
        raw.characterOrder = [chaIdOf(db, 0), { name: 'Folder', data: [chaIdOf(db, 1)], color: '', id: 'f1', imgFile: assetPath(9) }, chaIdOf(db, 2), chaIdOf(db, 3)]
        raw.statics = { messages: 12, imports: 3 }
    }

    test('L1 reproducer: a cyclic loadout keeps the saved list, the rest saves, one notice names it, and a fix saves the live list', async () => {
        const loop = await start({ seed: seedFixed, live: (db) => { loadouts(db)[1].cyc = cyclic() } })
        chars(loop.db)[2].personality = 'edited next to the held loadouts'
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        const saved = await loop.kit.saved()
        expect(saved.characters[2]).toMatchObject({ personality: 'edited next to the held loadouts' })
        expect(loop.failures).toEqual([])
        expect(saved.loadouts).toEqual(loop.kit.seedDb.loadouts)
        expect(labelsOf(loop.itemCalls[0].newly)).toEqual([{ scope: 'loadouts', key: 'loadouts', label: '"Loadout B"', saved: true }])
        await quietPasses(loop, 10)
        expect(loop.notices()).toHaveLength(1)
        expect(loop.failures).toEqual([])
        expect(loop.requested).toBe(0)

        delete loadouts(loop.db)[1].cyc
        loadouts(loop.db)[0].favorite = true
        chars(loop.db)[3].personality = 'edited after the fix'
        loop.mark(chaIdOf(loop.db, 3))
        await until(() => loop.itemCalls.length >= 2, 'the report that clears it', 4000)
        expect(loop.itemCalls[1].current).toEqual([])
        expect((await loop.kit.saved()).loadouts[0]).toMatchObject({ favorite: true })
    })

    test('L2 reproducer: a BigInt in the statics keeps the saved statics while the rest saves', async () => {
        const loop = await start({ seed: seedFixed, live: (db) => { ((db as unknown as Entry).statics as Entry).messages = 10n } })
        chars(loop.db)[2].personality = 'edited next to the held statics'
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        const saved = await loop.kit.saved()
        expect(saved.characters[2]).toMatchObject({ personality: 'edited next to the held statics' })
        expect(loop.failures).toEqual([])
        expect(saved.statics).toEqual(loop.kit.seedDb.statics)
        expect(labelsOf(loop.itemCalls[0].newly)).toEqual([{ scope: 'statics', key: 'statics', label: '"statics"', saved: true }])
    })

    test('L3 reproducer: a cyclic folder in the character order keeps the saved order while the rest saves', async () => {
        const loop = await start({ seed: seedFixed, live: (db) => { (order(db)[1] as Entry).cyc = cyclic() } })
        chars(loop.db)[2].personality = 'edited next to the held character order'
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        const saved = await loop.kit.saved()
        expect(saved.characters[2]).toMatchObject({ personality: 'edited next to the held character order' })
        expect(loop.failures).toEqual([])
        expect(saved.characterOrder).toEqual(loop.kit.seedDb.characterOrder)
        expect(labelsOf(loop.itemCalls[0].newly)).toEqual([{ scope: 'characterOrder', key: 'characterOrder', label: '"characterOrder"', saved: true }])
    })
})

describe('an item that stands keeps the page from reading clean', () => {
    /** A peer commits and this tab hears it: the loop parks and shows the clean prompt. */
    async function parkOnPeer(loop: Loop): Promise<void> {
        await peerCommit(loop.kit, (peerDb) => { chars(peerDb)[3].personality = 'the peer edit' })
        loop.state.peerHeard = true
        await until(() => loop.kit.peer.clean.length + loop.kit.peer.asked.length >= 1, 'a prompt', 8000)
    }

    test('reproducer: the Reload check answers dirty while an item stands', async () => {
        const loop = await start({ live: (db) => { modules(db)[1].cyc = cyclic() } })
        loop.ignoreMarks = true
        chars(loop.db)[2].personality = 'first'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        await parkOnPeer(loop)
        expect(loop.kit.peer.clean).toHaveLength(1)
        expect(await loop.kit.peer.requests[0]()).toBe('dirty')
        expect(loop.failures).toEqual([])
    })

    test('L4 reproducer: the Reload check answers dirty while a loadouts item stands', async () => {
        const loop = await start({
            seed: (db) => { (db as unknown as Entry).loadouts = [{ name: 'Loadout A', id: 'l1', icons: [] }, { name: 'Loadout B', id: 'l2', icons: [] }] },
            live: (db) => { ((db as unknown as Entry).loadouts as Entry[])[1].cyc = cyclic() },
        })
        loop.ignoreMarks = true
        chars(loop.db)[2].personality = 'first'
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        await parkOnPeer(loop)
        expect(loop.kit.peer.clean).toHaveLength(1)
        expect(await loop.kit.peer.requests[0]()).toBe('dirty')
        expect(loop.failures).toEqual([])
    })

    test('R5 reproducer: a lone cycle in a saved workspace, with no edit and no mark, is told once without a write and keeps the page dirty', async () => {
        const loop = await start({
            seed: seedNotes,
            live: (db) => { workspaceFiles(db, 0)[0].cycle = cyclic() },
            options: { idleNet: { intervalMs: 1, moduleIntervalMs: 1 } },
        })
        loop.ignoreMarks = true
        const before = (await loop.kit.commitKey()).current?.key
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        expect(labelsOf(loop.itemCalls[0].newly)).toEqual([{ scope: 'workspaces', key: 'ws:w1', label: '"Notes"', saved: true }])
        expect(loop.failures).toEqual([])
        await quietPasses(loop, 10)
        expect(loop.notices()).toHaveLength(1)
        expect((await loop.kit.commitKey()).current?.key).toBe(before)
        await parkOnPeer(loop)
        expect(loop.kit.peer.clean).toHaveLength(1)
        expect(await loop.kit.peer.requests[0]()).toBe('dirty')
        expect(loop.failures).toEqual([])
    })
})

describe('Save mine carries an item\'s saved copy only over a base that holds it', () => {
    async function dropSeedManifest(kit: Store2Kit, edit: (peerDb: Database) => void): Promise<void> {
        for (let round = 0; round < 22; round++) {
            kit.clock.advance(6 * MINUTE)
            await peerCommit(kit, (peerDb) => {
                chars(peerDb)[3].personality = `peer ${round}`
                edit(peerDb)
            }, 100 + round)
        }
        expect(keeps(await kit.commitKey(), kit.seeded.manifestKey)).toBe(false)
    }

    test('reproducer: a skipped saved module that a peer rewrote and the collector swept is not carried: nothing is written and the second prompt names it', async () => {
        const peer: PeerDouble = createPeerDouble('save-mine')
        const loop = await start({ options: { peer }, live: (db) => { modules(db)[1].cyc = cyclic() } })
        await dropSeedManifest(loop.kit, (peerDb) => { modules(peerDb)[1].description = 'a peer rewrote this module' })
        const collected = await gcPass({ backend: loop.kit.memory, kind: 'tauri', idleReason: () => null })
        expect(collected.status).toBe('done')
        const before = await loop.kit.commitKey()
        chars(loop.db)[0].personality = 'my edit'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 0))
        await until(() => loop.kit.peer.asked.length >= 2 || loop.state.saved >= 1, 'the second prompt or a landed save', 6000)
        expect(loop.state.saved).toBe(0)
        await until(() => loop.kit.peer.reloads === 1, 'the reload', 4000)
        expect(loop.kit.peer.asked[0]).toMatchObject({ reason: 'peer-commit', unsaved: true, offers: ['reload', 'save-mine'] })
        expect(loop.kit.peer.asked[1].offers).toEqual(['reload'])
        expect(loop.kit.peer.asked[1]).toMatchObject({ saveMineUnavailable: 'carries', blocked: { names: ['"Module 1"'], count: 1 } })
        const after = await loop.kit.commitKey()
        expect(after.current?.key).toBe(before.current?.key)
        expect(await checkTree(loop.kit.memory, after.current?.key as string)).toMatchObject({ status: 'complete' })
        expect(loop.failures).toEqual([])
    })
})

describe('the module hold that rides with each saved notice', () => {
    const setFault = (): Setup => ({
        seed: (db) => { modules(db)[1].id = modules(db)[0].id },
        live: (db) => {
            modules(db).splice(0, 1)
            modules(db)[0].cyc = cyclic()
        },
    })

    /** Edits a character without any mark, so only the idle net's verdict tick can find and commit it; returns the notice that commit reported. */
    async function unmarkedCommit(loop: Loop, index: number, text: string): Promise<{ hold: ModuleHold, request: SavePassRequest | undefined }> {
        const before = loop.holds.length
        const marksBefore = [...loop.tracker.character]
        chars(loop.db)[index].personality = text
        await until(() => loop.holds.length > before, 'the verdict tick to commit and report', 6000)
        expect(loop.tracker.character).toEqual(marksBefore)
        expect((await loop.kit.saved()).characters[index]).toMatchObject({ personality: text })
        return loop.holds[before]
    }

    test('reproducer T1b: a module set that cannot be told from another is reported carried whole, naming the module that faulted', async () => {
        const loop = await start(setFault())
        chars(loop.db)[2].personality = 'edited next to the held modules'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.holds.length >= 1, 'the saved notice', 4000)
        expect(loop.holds[0].hold).toEqual({ carriedWhole: true, faultIds: [String(modules(loop.db)[0].id)] })
    })

    test('reproducer T1d: a skipped module is reported by id without carrying the set whole; a clean pass reports nothing held; a fix returns to clean', async () => {
        const clean = await start()
        clean.markModules()
        clean.mark(chaIdOf(clean.db, 2))
        await until(() => clean.holds.length >= 1, 'the clean pass notice', 4000)
        expect(clean.holds[0].hold).toEqual({ carriedWhole: false, faultIds: [] })

        const loop = await start({ live: (db) => { modules(db)[1].cyc = cyclic() } })
        const skipped = String(modules(loop.db)[1].id)
        chars(loop.db)[2].personality = 'first'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.holds.length >= 1, 'the skip pass notice', 4000)
        expect(loop.holds[0].hold).toEqual({ carriedWhole: false, faultIds: [skipped] })

        delete modules(loop.db)[1].cyc
        modules(loop.db)[1].description = 'fixed module'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.holds.length >= 2, 'the fix pass notice', 4000)
        expect(loop.holds[loop.holds.length - 1].hold).toEqual({ carriedWhole: false, faultIds: [] })
    })

    test('reproducer T1e: a verdict tick that commits an unmarked edit reports the standing set fault, not a clean module state', async () => {
        const loop = await start(setFault())
        const faulted = String(modules(loop.db)[0].id)
        chars(loop.db)[2].personality = 'first'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.holds.length >= 1, 'the set fault pass notice', 4000)

        const tick = await unmarkedCommit(loop, 3, 'edited without a mark')
        expect(tick.request?.net).toBeDefined()
        expect(tick.request?.net?.modules).not.toBe(true)
        expect(tick.hold).toEqual({ carriedWhole: true, faultIds: [faulted] })
        expect(loop.failures).toEqual([])
    })

    test('reproducer T1e: a verdict tick that commits an unmarked edit reports the standing module skip', async () => {
        const loop = await start({ live: (db) => { modules(db)[1].cyc = cyclic() } })
        const skipped = String(modules(loop.db)[1].id)
        chars(loop.db)[2].personality = 'first'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.holds.length >= 1, 'the skip pass notice', 4000)

        const tick = await unmarkedCommit(loop, 3, 'edited without a mark')
        expect(tick.request?.net).toBeDefined()
        expect(tick.request?.net?.modules).not.toBe(true)
        expect(tick.hold).toEqual({ carriedWhole: false, faultIds: [skipped] })
        expect(loop.failures).toEqual([])
    })

    test('guard T1e (passes under a pass-own hold too): a marked character pass after a set fault re-plans the modules and reports the same fault', async () => {
        const loop = await start(setFault())
        const faulted = String(modules(loop.db)[0].id)
        chars(loop.db)[2].personality = 'first'
        loop.markModules()
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.holds.length >= 1, 'the set fault pass notice', 4000)

        chars(loop.db)[3].personality = 'marked second'
        loop.mark(chaIdOf(loop.db, 3))
        await until(() => loop.holds.length >= 2, 'the marked pass notice', 4000)
        expect(loop.holds[loop.holds.length - 1].hold).toEqual({ carriedWhole: true, faultIds: [faulted] })
    })
})

describe('plugins and workspaces that cannot be stored are held whole', () => {
    test('R1 reproducer: a bigint plugin and a cyclic workspace file are both held, the character edit lands, one call names both, and the fix saves both', async () => {
        const loop = await start({
            seed: seedNotes,
            live: (db) => {
                pluginList(db, 'pluginV2')[0].big = 10n
                workspaceFiles(db, 0)[0].cycle = cyclic()
            },
        })
        chars(loop.db)[2].personality = 'edited next to the held items'
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        const saved = await loop.kit.saved()
        expect(saved.characters[2]).toMatchObject({ personality: 'edited next to the held items' })
        expect(saved.pluginV2).toEqual(loop.kit.seedDb.pluginV2)
        expect(raw(saved).utilityWorkspaces).toEqual(raw(loop.kit.seedDb).utilityWorkspaces)
        expect(labelsOf(loop.itemCalls[0].newly)).toEqual([
            { scope: 'plugins', key: 'pluginV2', label: '"Plugin 99"', saved: true },
            { scope: 'workspaces', key: 'ws:w1', label: '"Notes"', saved: true },
        ])
        expect(loop.failures).toEqual([])
        expect(loop.requested).toBe(0)
        await quietPasses(loop, 10)
        expect(loop.notices()).toHaveLength(1)
        expect(await checkTree(loop.kit.memory, (await loop.kit.commitKey()).current?.key as string)).toMatchObject({ status: 'complete' })

        delete pluginList(loop.db, 'pluginV2')[0].big
        workspaceFiles(loop.db, 0)[0] = workspaceFile('f1', 'a.md', 'fixed text')
        chars(loop.db)[3].personality = 'edited after the fix'
        loop.mark(chaIdOf(loop.db, 3))
        await until(() => loop.itemCalls.length >= 2, 'the report that clears it', 4000)
        expect(loop.itemCalls[1].current).toEqual([])
        const fixed = await loop.kit.saved()
        expect((raw(fixed).utilityWorkspaces as Entry[])[0].files).toMatchObject([{ id: 'f1', text: 'fixed text' }, { id: 'f2', text: 'beta' }])
        expect(fixed.pluginV2).toEqual(pluginList(loop.db, 'pluginV2'))
        expect(loop.failures).toEqual([])
    })

    test('R2 reproducer: a workspace never saved is left out with the never-saved notice and stays in memory', async () => {
        const loop = await start({
            live: (db) => { raw(db).utilityWorkspaces = [workspaceOf('w9', 'Fresh', [{ ...workspaceFile('f1', 'a.md', 'x'), cycle: cyclic() }])] },
        })
        chars(loop.db)[2].personality = 'edited next to the new workspace'
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        expect(labelsOf(loop.itemCalls[0].newly)).toEqual([{ scope: 'workspaces', key: 'ws:w9', label: '"Fresh"', saved: false }])
        const saved = await loop.kit.saved()
        expect(saved.characters[2]).toMatchObject({ personality: 'edited next to the new workspace' })
        expect(raw(saved).utilityWorkspaces ?? []).toEqual([])
        expect(workspaceList(loop.db)).toHaveLength(1)
        expect(loop.failures).toEqual([])
    })

    test('R2b reproducer: a lone never-saved cyclic workspace, with no edit and no mark, is found by the idle net and told without a write', async () => {
        const loop = await start({
            live: (db) => { raw(db).utilityWorkspaces = [workspaceOf('w9', 'Fresh', [{ ...workspaceFile('f1', 'a.md', 'x'), cycle: cyclic() }])] },
            options: { idleNet: { intervalMs: 1, moduleIntervalMs: 1 } },
        })
        const before = (await loop.kit.commitKey()).current?.key
        await until(() => loop.itemCalls.length >= 1, 'the item report', 4000)
        expect(labelsOf(loop.itemCalls[0].newly)).toEqual([{ scope: 'workspaces', key: 'ws:w9', label: '"Fresh"', saved: false }])
        expect(loop.failures).toEqual([])
        expect((await loop.kit.commitKey()).current?.key).toBe(before)
    })

    test('G6 guard (new rule): after the seed manifest is evicted and collected, a restore of the collected content is complete and no front identity is unnamed', async () => {
        const loop = await start({
            seed: (db) => {
                raw(db).utilityWorkspaces = [
                    workspaceOf('w1', 'Notes', [workspaceFile('f1', 'a.md', 'alpha')]),
                    workspaceOf('w10', 'Other', [workspaceFile('g1', 'c.md', 'gamma'), workspaceFile('g2', 'd.md', 'delta')]),
                ]
            },
            live: (db) => {
                pluginList(db, 'pluginV2')[0].big = 10n
                workspaceFiles(db, 0)[0].cycle = cyclic()
                workspaceFiles(db, 1).splice(1, 1)
                pluginList(db, 'plugins').pop()
            },
        })
        const seed = loop.kit.seedDb
        const deletedKeys = ['wsf:w10:g2', 'plugin:plugins:2'].map(identity => loop.kit.seeded.tree.index.units.get(identity)?.key as string)
        for (const key of deletedKeys) {
            expect(typeof key).toBe('string')
            expect(await loop.kit.memory.listStore2()).toContain(key)
        }
        const editChar = async (text: string): Promise<void> => {
            chars(loop.db)[3].personality = text
            loop.mark(chaIdOf(loop.db, 3))
            await until(async () => (await loop.kit.saved()).characters[3].personality === text, `the edit ${text}`, 4000)
        }
        await editChar('own 0')
        expect(loop.itemCalls.length).toBeGreaterThanOrEqual(1)
        for (let round = 1; round <= 30 && keeps(await loop.kit.commitKey(), loop.kit.seeded.manifestKey); round++) {
            loop.kit.clock.advance(6 * MINUTE)
            await editChar(`own ${round}`)
        }
        expect(keeps(await loop.kit.commitKey(), loop.kit.seeded.manifestKey)).toBe(false)
        const collected = await gcPass({ backend: loop.kit.memory, kind: 'tauri', idleReason: () => null })
        expect(collected.status).toBe('done')
        const listed = await loop.kit.memory.listStore2()
        for (const key of deletedKeys) {
            expect(listed).not.toContain(key)
        }
        await expectAcknowledgedFrontNamed(loop)

        workspaceFiles(loop.db, 1).push(JSON.parse(JSON.stringify(workspaceFiles(seed as Database, 1)[1])) as Entry)
        pluginList(loop.db, 'plugins').push(JSON.parse(JSON.stringify(pluginList(seed, 'plugins')[2])) as Entry)
        await editChar('after the restore')
        expect(await checkTree(loop.kit.memory, (await loop.kit.commitKey()).current?.key as string)).toMatchObject({ status: 'complete' })
        const saved = await loop.kit.saved()
        expect(raw(saved).utilityWorkspaces).toEqual(raw(seed).utilityWorkspaces)
        expect(saved.plugins).toEqual(seed.plugins)
        expect(saved.pluginV2).toEqual(seed.pluginV2)
        await expectAcknowledgedFrontNamed(loop)
        expect(loop.failures).toEqual([])
    })
})

describe('the notice texts', () => {
    test('guard (new keys): each notice interpolates the label it is given, quoted by the caller', () => {
        expect(language.saveItemModuleLabel('Mod')).toBe('the module "Mod"')
        expect(language.saveItemSettingLabel('field')).toBe('the setting "field"')
        expect(language.saveItemPluginDataLabel('key')).toBe('the plugin data "key"')
        expect(language.saveItemUnsavedNotice('the module "Mod"')).toContain('the module "Mod"')
        expect(language.saveItemNeverSavedNotice('the module "Mod"')).toContain('the module "Mod"')
        expect(language.saveModulesHeldNotice('"Mod"')).toContain('"Mod"')
        expect(language.savePresetsHeldNotice('"Preset 1"')).toContain('"Preset 1"')
        expect(language.savePresetsHeldNotice('"Preset 1"')).toContain('kept as a new preset')
        expect(language.saveItemStaticsLabel).toBe('the usage statistics')
        expect(language.saveItemCharacterOrderLabel).toBe('the character order')
        expect(language.saveLoadoutsHeldNotice('"L"')).toContain('"L"')
        expect(language.savePluginsHeldNotice('"Plugin 99"')).toContain('"Plugin 99"')
        expect(language.saveItemWorkspaceLabel('Notes')).toBe('the workspace "Notes"')
        expect(language.saveItemWorkspaceFileLabel('a.md')).toBe('the workspace file "a.md"')
        for (const text of [
            language.saveItemUnsavedNotice('x'), language.saveItemNeverSavedNotice('x'), language.saveModulesHeldNotice('x'), language.savePresetsHeldNotice('x'),
            language.saveLoadoutsHeldNotice('x'), language.savePluginsHeldNotice('x'),
        ]) {
            expect(text).toContain('RisuTanium')
        }
    })
})
