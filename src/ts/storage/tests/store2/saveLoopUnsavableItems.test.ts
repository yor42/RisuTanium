// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest'
import { language } from 'src/lang'
import { gcPass } from '../../store2/gc/pass'
import { checkTree } from '../../store2/commit'
import type { CommitKey } from '../../store2/format'
import type { SkippedItem } from '../../store2/codec'
import { PARK_CHECK_MAX_MS, runStore2SaveLoop, type Store2LoopPort } from '../../store2/saveLoop'
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
        saved() {
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

    test('guard (passes before and after): a bad value in a part no skip rule covers still fails the pass and is reported', async () => {
        const loop = await start({ live: (db) => { (db as unknown as Entry).loadouts = [cyclic()] } })
        chars(loop.db)[2].personality = 'edited next to the unstorable loadout'
        loop.mark(chaIdOf(loop.db, 2))
        await until(() => loop.failures.length >= 1, 'the failure report', 4000)
        expect(loop.itemCalls).toEqual([])
        expect(loop.state.saved).toBe(0)
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
})

describe('Save mine carries an item\'s saved copy only over a base that holds it', () => {
    const MINUTE = 60 * 1000

    function keeps(key: CommitKey, manifestKey: string): boolean {
        return key.current?.key === manifestKey || key.retained.some(entry => entry.key === manifestKey) || key.pins.some(pin => pin.key === manifestKey)
    }

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
        const collected = await gcPass({ backend: loop.kit.memory, kind: 'indexeddb', idleReason: () => null })
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
        for (const text of [
            language.saveItemUnsavedNotice('x'), language.saveItemNeverSavedNotice('x'), language.saveModulesHeldNotice('x'), language.savePresetsHeldNotice('x'),
        ]) {
            expect(text).toContain('RisuTanium')
        }
    })
})
