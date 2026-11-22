/**
 * The finish stage of a `.rtb` restore (CHORE-128 S12b): `finishRtbRestore` over a real writer file, verified and planned
 * by S11's own `verifyRtb`, with the side stores in memory and the alerts, the reload mark and the reload recorded. The
 * lock test models the hold's write-lock semantics over the real `dbWriteLock`; it does not run `acquireRestoreHold`.
 *
 * Labels: every test is a compatibility guard of a new contract (no pre-fix base: main has no `.rtb` finish stage) that
 * names the scratch mutant it turns red on, except the present-empty-section test, a regression reproducer whose pre-fix
 * base is the empty-entry shortcut (a present empty section cleared without being read). A fake store's success says nothing about a native store, and a stubbed reload
 * says nothing about a real navigation (the device rows cover those).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { SIDE_SECTION_IDS } from 'src/ts/drive/rtb/entryNames'
import type { SideInput, SideRecord } from 'src/ts/drive/rtb/rtbWriter'
import { GOOGLE_SEARCH_STORE, HYPA_VECTOR_STORE, IRIS_STORE, MCP_TOOL_CALLS_STORE, PLUGIN_PERMISSIONS_STORE, RESTORED_KEYS_STORE, UI_PREFS_KEYS } from 'src/ts/drive/rtb/sideStoreConfig'
import { applySideAction, type SideRestoreResult } from 'src/ts/drive/rtb/sideStores'
import { bodyReaderOf, finishRtbRestore, stageConnectionKeys, type RtbFinishDeps, type RtbFinishLanded } from 'src/ts/drive/rtbRestoreFinish'
import { tailOfKey, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { rtbWorld, type RtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'
import { repackRtb, withBrokenCrc, writeRtbFile, type RtbBuild } from './rtb/rtbRestoreFixtures'
import { finishPlanOf, sideFakes, type SideFakes } from './rtb/rtbInstallFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))
// The world fixture's Node-server helper resolves a file URL that the DOM environment's URL class refuses; this file never starts a server.
vi.mock('src/ts/storage/tests/nodeServerFixture', () => ({ startNodeServer: vi.fn() }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        loadedStore: writable(false),
        LoadingStatusState: { text: '' },
        ReloadGUIPointer: writable(0),
        bodyIntercepterStore: writable(null),
        savingStoppedReason: writable(''),
        frozenSaveKeysStore: writable([]),
    } as unknown as typeof import('src/ts/stores.svelte')
})

let world: RtbWorld

beforeAll(async () => {
    world = await rtbWorld({ layout: 1 })
})

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

async function* iterate<T>(items: readonly T[]): AsyncGenerator<T> {
    for (const item of items) {
        yield item
    }
}

const records = (...items: readonly [string, unknown][]): SideInput => ({ records: iterate<SideRecord>(items.map(([key, value]) => ({ key, value }))) })
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const noFacts = (): RtbFinishLanded => ({ flushed: true, facts: { assetsWritten: 0, assetsPresent: 0, skippedAssets: [], inlays: { written: 0, skipped: [], changed: false } }, staged: null })

interface Run {
    log: string[]
    notices: string[]
    waits: string[]
    releases: boolean[]
    fakes: SideFakes
}

/** Runs the finish over `bytes` with every outside call recorded in one ordered log; `deps` replaces any of them. */
async function finish(bytes: Uint8Array, options: { landed?: RtbFinishLanded, deps?: Partial<RtbFinishDeps>, seed?: (fakes: SideFakes) => void } = {}): Promise<Run> {
    const fakes = sideFakes()
    options.seed?.(fakes)
    const log: string[] = []
    const notices: string[] = []
    const waits: string[] = []
    const releases: boolean[] = []
    const hold = { release: async (keep: boolean) => { releases.push(keep); log.push(`release:${keep}`) } }
    await finishRtbRestore(await finishPlanOf(bytes), hold, options.landed ?? noFacts(), {
        sideBackends: fakes.backends,
        notice: async (text) => {
            log.push('notice:start')
            notices.push(text)
            await sleep(5)
            log.push('notice:end')
        },
        wait: (text) => { waits.push(text); log.push('wait') },
        markReload: () => { log.push('mark') },
        reload: async () => { log.push('reload') },
        ...options.deps,
    })
    return { log, notices, waits, releases, fakes }
}

async function fileOf(build: Partial<RtbBuild> = {}): Promise<Uint8Array> {
    return (await writeRtbFile({ world, ...build })).bytes
}

const allSides = (): Record<string, SideInput> => ({
    'side.iris': records(['k1', { a: 1 }], ['k2', 'two']),
    'side.mcp-tool-calls': records(['m1', { b: 2 }]),
    'side.plugin-permissions': records(['g1', true]),
})

describe('S.1 the side data (B1, B7)', () => {
    test('each section of a writer file is restored: records written, a present empty section cleared, other keys of the shared storage kept, the grants cleared (guard; MB1 and the S.1 loop fail it)', async () => {
        const run = await finish(await fileOf({ sides: allSides() }), {
            seed: (fakes) => {
                fakes.forage(IRIS_STORE).data.set('old', 1)
                fakes.forage(GOOGLE_SEARCH_STORE).data.set('old', 1)
                fakes.forage(PLUGIN_PERMISSIONS_STORE).data.set('old-grant', true)
                fakes.storage.data.set(UI_PREFS_KEYS[0], 'x')
                fakes.storage.data.set('unrelated', 'kept')
            },
        })
        const iris = run.fakes.forage(IRIS_STORE).data
        expect([...iris.keys()].sort()).toEqual(['k1', 'k2'])
        expect(iris.get('k1')).toEqual({ a: 1 })
        expect(iris.get('k2')).toBe('two')
        expect([...run.fakes.forage(MCP_TOOL_CALLS_STORE).data.keys()]).toEqual(['m1'])
        expect(run.fakes.forage(GOOGLE_SEARCH_STORE).data.size).toBe(0)
        expect(run.fakes.forage(PLUGIN_PERMISSIONS_STORE).data.size).toBe(0)
        expect(run.fakes.storage.data.has(UI_PREFS_KEYS[0])).toBe(false)
        expect(run.fakes.storage.data.get('unrelated')).toBe('kept')
        expect(run.notices).toEqual([])
    })

    test('a section with a broken checksum leaves its store alone and is named; the plugin grants are cleared all the same (guard; MB1 fails it)', async () => {
        const bytes = await withBrokenCrc(await fileOf({ sides: allSides() }), 's/plugin-permissions/data.jsonl')
        const broken = await withBrokenCrc(bytes, 's/mcp-tool-calls/data.jsonl')
        const run = await finish(broken, {
            seed: (fakes) => {
                fakes.forage(MCP_TOOL_CALLS_STORE).data.set('keep', 1)
                fakes.forage(PLUGIN_PERMISSIONS_STORE).data.set('old-grant', true)
            },
        })
        expect([...run.fakes.forage(MCP_TOOL_CALLS_STORE).data.keys()]).toEqual(['keep'])
        expect(run.fakes.forage(PLUGIN_PERMISSIONS_STORE).data.size).toBe(0)
        expect(run.notices).toEqual([language.rtbRestoreLeftOut([language.rtbRestoreLineSideNotRestored([language.rtbRestoreSideNames.mcpToolCalls])])])
    })

    test('a section the writer could not read is left alone and named as not restored once (guard; MB1 and a side action skipped by the loop fail it)', async () => {
        const run = await finish(await fileOf({ sides: { ...allSides(), 'side.hypa-vector': { unreadable: true } } }), {
            seed: (fakes) => { fakes.forage(HYPA_VECTOR_STORE).data.set('keep', 1) },
        })
        expect([...run.fakes.forage(HYPA_VECTOR_STORE).data.keys()]).toEqual(['keep'])
        expect(run.notices).toEqual([language.rtbRestoreLeftOut([language.rtbRestoreLineSideNotRestored([language.rtbRestoreSideNames.hypaVector])])])
    })

    test('B7: a section whose apply throws is named as not completely written, and the other sections still run (guard; a loop that stops at the throw fails it)', async () => {
        const run = await finish(await fileOf({ sides: allSides() }), {
            deps: {
                applySide: async (action, body, backends) => {
                    if (action.id === 'side.iris') {
                        throw new Error('apply failed')
                    }
                    return await applySideAction(action, body, backends)
                },
            },
        })
        expect([...run.fakes.forage(MCP_TOOL_CALLS_STORE).data.keys()]).toEqual(['m1'])
        expect(run.notices).toEqual([language.rtbRestoreLeftOut([language.rtbRestoreLineSideFailed([language.rtbRestoreSideNames.iris])])])
        expect(run.log.at(-1)).toBe('reload')
    })

    test('bodyReaderOf: an empty data entry reads as an ok empty body; a section with no data entry reads as a failure and never clears its store (guard)', async () => {
        const bytes = await fileOf({ sides: allSides() })
        const plan = await finishPlanOf(bytes)
        const empty = bodyReaderOf(plan, 'side.google-search')
        const chunks: Uint8Array[] = []
        expect(await empty((chunk) => { chunks.push(chunk) })).toEqual({ ok: true })
        expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBe(0)
        expect(bodyReaderOf(plan, 'side.iris')).not.toBeNull()
        const missing = await finishPlanOf(await repackRtb(bytes, { remove: ['s/iris/data.jsonl'] }))
        expect(await bodyReaderOf(missing, 'side.iris')(() => { })).toMatchObject({ ok: false })
    })

    test('a present empty section with a broken checksum leaves its store alone and is named; it is read and validated before any clear (regression reproducer: the empty-entry shortcut cleared the store silently)', async () => {
        const broken = await withBrokenCrc(await fileOf({ sides: allSides() }), 's/google-search/data.jsonl')
        const run = await finish(broken, {
            seed: (fakes) => { fakes.forage(GOOGLE_SEARCH_STORE).data.set('keep', 1) },
        })
        expect([...run.fakes.forage(GOOGLE_SEARCH_STORE).data.keys()]).toEqual(['keep'])
        expect(run.notices).toEqual([language.rtbRestoreLeftOut([language.rtbRestoreLineSideNotRestored([language.rtbRestoreSideNames.googleSearch])])])
    })

    test('a section whose data entry is missing from the file leaves its store alone and is named as not restored (guard; passing no reader when the entry is missing fails it)', async () => {
        const removed = await repackRtb(await fileOf({ sides: allSides() }), { remove: ['s/iris/data.jsonl'] })
        const run = await finish(removed, {
            seed: (fakes) => { fakes.forage(IRIS_STORE).data.set('keep', 1) },
        })
        expect([...run.fakes.forage(IRIS_STORE).data.keys()]).toEqual(['keep'])
        expect(run.notices).toEqual([language.rtbRestoreLeftOut([language.rtbRestoreLineSideNotRestored([language.rtbRestoreSideNames.iris])])])
    })

    test('a section written completely except for skipped records is named as not completely written, and the written records stay (guard; moving ok-with-skipped to not restored fails it)', async () => {
        const run = await finish(await fileOf({ sides: { ...allSides(), 'side.ui-prefs': records([UI_PREFS_KEYS[0], 'x'], ['not-an-allowlisted-key', 'y']) } }))
        expect(run.fakes.storage.data.get(UI_PREFS_KEYS[0])).toBe('x')
        expect(run.fakes.storage.data.has('not-an-allowlisted-key')).toBe(false)
        expect(run.notices).toEqual([language.rtbRestoreLeftOut([language.rtbRestoreLineSideFailed([language.rtbRestoreSideNames.uiPrefs])])])
    })
})

describe('S.2 and S.3 the notices and the reload (B3, B5, B8)', () => {
    test('B3: the skip notices, the .rtb notice, then done, then release(true), the mark and the reload, in that order, each notice awaited (guard; MB3 and MB4 fail it)', async () => {
        const preset = world.keysOfType(UNIT_TYPE.taskPreset)[0]
        const withUnknown = await repackRtb(
            await fileOf({
                sides: allSides(),
                replace: new Map([[preset, null]]),
                omitted: [{ kind: 'unit', name: tailOfKey(preset), reason: 'damaged' }, { kind: 'x-test', name: 'x-test.thing', reason: 'later' }],
            }),
            {
                manifest: (manifest) => {
                    const sections = manifest.sections as { id: string, v: number }[]
                    sections.push({ id: 'x-test.unknown', v: 1, required: false, prefix: 'x/unknown/', entries: 0, bytes: 0 } as { id: string, v: number })
                    ;(sections.find((row) => row.id === 'side.iris') as { v: number }).v = 2
                },
                add: [{ name: 'x/unknown/one', bytes: new TextEncoder().encode('unknown-entry-bytes'), method: 0 }],
            },
        )
        const landed: RtbFinishLanded = { flushed: true, facts: { ...noFacts().facts, skippedAssets: [{ name: 'bad:name', reason: 'invalidName' }] }, staged: null }
        const run = await finish(withUnknown, { landed })
        expect(run.notices).toEqual([
            language.restoreAssetsSkipped(1, ['bad:name']),
            language.rtbRestoreLeftOut([
                language.rtbRestoreLineNewerParts(['x-test.unknown (v1)']),
                language.rtbRestoreLineOmittedUnits(1),
                language.rtbRestoreLineOmittedEntries(['x-test.thing']),
                language.rtbRestoreLineSideNotRestored([language.rtbRestoreSideNames.iris]),
            ]),
        ])
        expect(run.log).toEqual(['notice:start', 'notice:end', 'notice:start', 'notice:end', 'wait', 'release:true', 'mark', 'reload'])
        expect(run.waits).toEqual([language.store2ImportDone])
        expect(run.fakes.forage(IRIS_STORE).data.size).toBe(0)
    })

    test('B3: the skipped asset and inlay notices carry the plan\'s asset limit and each inlay\'s own limit, in the shared order (guard; dropping the inlay skips or the asset limit fails it)', async () => {
        const plan = { node: { assetLimit: 12345, inlayLimit: 777 } }
        const landed: RtbFinishLanded = {
            flushed: true,
            facts: {
                ...noFacts().facts,
                skippedAssets: [{ name: 'huge.bin', reason: 'tooLarge' }],
                inlays: { written: 0, changed: false, skipped: [{ label: 'inlay-a', reason: 'notStored' }, { label: 'inlay-b', reason: 'tooLarge', limit: 777 }] },
            },
            staged: null,
        }
        const fakes = sideFakes()
        const notices: string[] = []
        await finishRtbRestore(await finishPlanOf(await fileOf(), plan), { release: async () => { } }, landed, {
            sideBackends: fakes.backends,
            notice: async (text) => { notices.push(text) },
            wait: () => { },
            markReload: () => { },
            reload: async () => { },
        })
        expect(notices).toEqual([
            language.restoreAssetsSkippedTooLarge(1, ['huge.bin'], 12345),
            language.restoreInlaysNotStored(1, ['inlay-a']),
            language.restoreInlaysTooLarge(1, ['inlay-b'], 777),
        ])
    })

    test('B5: a commit the device did not confirm is told as an awaited notice before the reload, and the done text is not shown (guard)', async () => {
        const run = await finish(await fileOf(), { landed: { ...noFacts(), flushed: false } })
        expect(run.notices).toEqual([language.store2ImportNotFlushed])
        expect(run.waits).toEqual([])
        expect(run.log).toEqual(['notice:start', 'notice:end', 'release:true', 'mark', 'reload'])
    })

    test('a file with nothing left out shows no .rtb notice at all (guard; a notice built for an empty list fails it)', async () => {
        const run = await finish(await fileOf())
        expect(run.notices).toEqual([])
        expect(run.log).toEqual(['wait', 'release:true', 'mark', 'reload'])
    })

    test('B8: file text reaches only the notices, cut to 100 characters (guard; an uncut name fails it)', async () => {
        const name = `<img src=x onerror=alert(1)>${'n'.repeat(200)}`
        const run = await finish(await fileOf({ omitted: [{ kind: 'x-test', name, reason: 'later' }] }))
        expect(run.notices).toHaveLength(1)
        expect(run.notices[0]).toContain(`${name.slice(0, 100)}...`)
        expect(run.notices[0]).not.toContain(name.slice(0, 101))
        expect(run.waits).toEqual([language.store2ImportDone])
    })
})

describe('a throw after the commit landed (B4)', () => {
    test('a throw before the release runs release(true) first and then shows the reload-or-restart text; it resolves and never calls release(false) (guard; the catch running the alert first, skipping the release, or releasing with false fails it)', async () => {
        const run = await finish(await fileOf(), {
            deps: { notice: async () => { throw new Error('notice failed') } },
            landed: { ...noFacts(), flushed: false },
        })
        expect(run.log).toEqual(['release:true', 'wait'])
        expect(run.waits).toEqual([language.restoreSavedReloadOrRestart])
        expect(run.releases).toEqual([true])
    })

    test('a rejecting release does not keep the alert from showing, and an alert that throws is swallowed (guard; one shared try fails it)', async () => {
        const bytes = await fileOf()
        const waits: string[] = []
        const hold = { release: vi.fn(async () => { throw new Error('release failed') }) }
        await expect(finishRtbRestore(await finishPlanOf(bytes), hold, noFacts(), {
            sideBackends: sideFakes().backends,
            wait: (text) => { waits.push(text) },
            markReload: () => { },
            reload: async () => { },
        })).resolves.toBeUndefined()
        expect(hold.release).toHaveBeenCalled()
        expect(waits).toContain(language.restoreSavedReloadOrRestart)
        const throwing = { release: vi.fn(async () => { }) }
        await expect(finishRtbRestore(await finishPlanOf(bytes), throwing, noFacts(), {
            sideBackends: sideFakes().backends,
            wait: () => { throw new Error('alert failed') },
            markReload: () => { },
            reload: async () => { },
        })).resolves.toBeUndefined()
    })

    test('a reload that throws shows the reload-or-restart text and the write lock stays closed (guard against a release(false) on the landed path; MB5 fails it)', async () => {
        // The write-lock hold of the desktop and Android apps: `release(false)` frees `dbWriteLock`, `release(true)` keeps it closed.
        const releaseLock = await dbWriteLock.acquire()
        const hold = { release: async (keepWriteLock: boolean) => { if (!keepWriteLock) { releaseLock() } } }
        const waits: string[] = []
        await expect(finishRtbRestore(await finishPlanOf(await fileOf()), hold, noFacts(), {
            sideBackends: sideFakes().backends,
            wait: (text) => { waits.push(text) },
            markReload: () => { },
            reload: async () => { throw new Error('no reload') },
        })).resolves.toBeUndefined()
        expect(waits.at(-1)).toBe(language.restoreSavedReloadOrRestart)
        const taken = dbWriteLock.acquire().then((release) => { release(); return true })
        expect(await Promise.race([taken, sleep(250).then(() => false)])).toBe(false)
    })
})

describe('the side ids', () => {
    test('every side section has a shown name (guard; a section added without one fails it)', () => {
        expect(SIDE_SECTION_IDS).toHaveLength(Object.keys(language.rtbRestoreSideNames).length)
    })
})

describe('the finish and the connection keys staged before the commit (G1, G1b, G3, G5)', () => {
    const CONNECTION_KEYS = 'side.connection-keys'
    const keyedSides = (): Record<string, SideInput> => ({ ...allSides(), [CONNECTION_KEYS]: records(['c1', { e: 'SYNTH-ENV-1', p: 'SYNTH-P1' }]) })
    const stagedOk: SideRestoreResult = { id: CONNECTION_KEYS, status: 'ok', written: 1, skipped: [] }
    const failedLine = (): string => language.rtbRestoreLeftOut([language.rtbRestoreLineSideFailed([language.rtbRestoreSideNames.connectionKeys])])

    test('G1: a staging that failed before the commit is named by the finish, and the other sections are still restored after the commit (guard of a new rule)', async () => {
        const staged: SideRestoreResult = { id: CONNECTION_KEYS, status: 'write-failed', phase: 'write', written: 0, key: 'SYNTH-ENV-1', message: 'disk full' }
        const run = await finish(await fileOf({ sides: keyedSides() }), { landed: { ...noFacts(), staged } })

        expect(run.notices).toEqual([failedLine()])
        expect([...run.fakes.forage(IRIS_STORE).data.keys()].sort()).toEqual(['k1', 'k2'])
        expect([...run.fakes.forage(MCP_TOOL_CALLS_STORE).data.keys()]).toEqual(['m1'])
    })

    test('G1b: a connection-keys restore with no staging result is named as failed and is not applied (guard of a new rule)', async () => {
        const run = await finish(await fileOf({ sides: keyedSides() }), { landed: { ...noFacts(), staged: null } })

        expect(run.notices).toEqual([failedLine()])
        expect(run.fakes.forage(RESTORED_KEYS_STORE).data.size).toBe(0)
    })

    test('G3: a staged connection-keys restore is never applied by the finish and is not named when it succeeded (guard of a new rule)', async () => {
        const applied: string[] = []
        const run = await finish(await fileOf({ sides: keyedSides() }), {
            landed: { ...noFacts(), staged: stagedOk },
            deps: {
                applySide: async (action, body, backends) => {
                    applied.push(`${action.id}:${action.kind}`)
                    return await applySideAction(action, body, backends)
                },
            },
        })

        expect(applied).not.toContain(`${CONNECTION_KEYS}:restore`)
        expect(applied).toContain('side.iris:restore')
        expect(run.fakes.forage(RESTORED_KEYS_STORE).data.size).toBe(0)
        expect(run.notices).toEqual([])
    })

    test('G2u: stageConnectionKeys never rejects: a throw is a named write-failed, and a section that is not a restore gives null (guard of a new rule)', async () => {
        const fakes = sideFakes()
        const keyed = await finishPlanOf(await fileOf({ sides: keyedSides() }))
        const staged = await stageConnectionKeys(keyed, { applySide: async () => { throw new Error('apply failed') }, sideBackends: fakes.backends })

        expect(staged).toMatchObject({ id: CONNECTION_KEYS, status: 'write-failed', phase: 'write', message: 'apply failed' })
        const without = await finishPlanOf(await fileOf({ sides: allSides() }))
        expect(await stageConnectionKeys(without, { applySide: applySideAction, sideBackends: fakes.backends })).toBeNull()
    })
    test('G5: a file without the section still clears the staging store in the finish and names nothing (compatibility guard: passes before and after)', async () => {
        const run = await finish(await fileOf({ sides: allSides() }), {
            seed: (fakes) => { fakes.forage(RESTORED_KEYS_STORE).data.set('SYNTH-ENV-LEFTOVER', { id: 'c9', p: 'SYNTH-STALE' }) },
        })

        expect(run.fakes.forage(RESTORED_KEYS_STORE).data.size).toBe(0)
        expect(run.notices).toEqual([])
    })
})
