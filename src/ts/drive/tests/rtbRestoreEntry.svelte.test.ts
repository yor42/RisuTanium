/**
 * The shell of a `.rtb` restore (CHORE-128 S12b): `runRtbRestore` over stubbed preparation, install and finish stages, with
 * the real busy registry and the real CHORE-830 deletion hold slot. The stages' own behaviour is covered by their suites;
 * this file covers the order of the calls, the busy entry and the outcome each end maps to.
 *
 * Labels: every test is a compatibility guard of a new contract (no pre-fix base: main has no `.rtb` shell); each names the
 * scratch mutant it turns red on.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { holdAssetDeletion, resetAssetDeleteHoldForTests } from 'src/ts/storage/assetDeleteHold'
import { isBusy, type BusyHandle } from 'src/ts/process/memory/busyActions'
import type { RtbInstallEnd } from 'src/ts/drive/rtbRestoreInstall'
import type { RestoreHold } from 'src/ts/drive/rtbRestoreHold'
import { pickedRtbOf, runRtbRestore, type RtbRestoreDeps } from 'src/ts/drive/rtbRestoreEntry'
import type { PickedRtb, RestorePlan, RtbPrepareEnd } from 'src/ts/drive/rtbRestorePlan'

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

const picked: PickedRtb = { name: 'a.rtb', size: 1, lastModified: 1, source: pickedRtbOf(new File([new Uint8Array(1)], 'a.rtb')).source }
const plan = { kind: 'rtb-page' } as RestorePlan
const hold = { lock: 'write-lock' } as RestoreHold
const ready: RtbPrepareEnd = { kind: 'ready', plan, hold }
const facts = { assetsWritten: 0, assetsPresent: 0, skippedAssets: [], inlays: { written: 0, skipped: [], changed: false } }
const landed: RtbInstallEnd = { kind: 'landed', flushed: true, facts }

beforeEach(() => {
    resetAssetDeleteHoldForTests()
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    resetAssetDeleteHoldForTests()
    vi.restoreAllMocks()
})

interface Calls {
    log: string[]
    waits: string[]
    deps: Partial<RtbRestoreDeps>
}

/** Stubbed stages that log their call; `over` replaces any of them. */
function calls(over: Partial<RtbRestoreDeps> = {}): Calls {
    const log: string[] = []
    const waits: string[] = []
    const deps: Partial<RtbRestoreDeps> = {
        prepare: async () => { log.push(`prepare busy=${isBusy()}`); return ready },
        install: async () => { log.push('install'); return landed },
        finish: async () => { log.push('finish') },
        wait: (text) => { waits.push(text) },
        ...over,
    }
    return { log, waits, deps }
}

describe('the order of the calls (U1b)', () => {
    test('the busy entry is taken before the settle, and the preparation does not start until a pending deletion has settled (guard; MU1 fails it)', async () => {
        let finishRemove: () => void = () => { }
        const removing = holdAssetDeletion(() => new Promise<void>((resolve) => { finishRemove = resolve }))
        const run = calls()
        const settled = run.deps.prepare
        run.deps.prepare = async (...args) => { run.log.push('listing'); return await (settled as NonNullable<typeof settled>)(...args) }
        const result = runRtbRestore(picked, run.deps)
        await new Promise((resolve) => setTimeout(resolve, 30))
        expect(isBusy()).toBe(true)
        expect(run.log).toEqual([])
        finishRemove()
        await removing
        expect(await result).toEqual({ outcome: 'committed', cause: null })
        expect(run.log).toEqual(['listing', 'prepare busy=true', 'install', 'finish'])
    })

    test('a settle that rejects propagates after the busy entry ended, and nothing was prepared (guard; MB6 fails it)', async () => {
        const run = calls({ settled: async () => { throw new Error('settle failed') } })
        await expect(runRtbRestore(picked, run.deps)).rejects.toThrow('settle failed')
        expect(isBusy()).toBe(false)
        expect(run.log).toEqual([])
    })
})

describe('the outcome of each end (B6, B2)', () => {
    test.each([
        ['canceled', { kind: 'ended', outcome: 'canceled', cause: 'declined' } as RtbPrepareEnd, { outcome: 'canceled', cause: 'declined' }],
        ['nothing-replaced', { kind: 'ended', outcome: 'nothing-replaced', cause: 'busy' } as RtbPrepareEnd, { outcome: 'nothing-replaced', cause: 'busy' }],
        ['failed', { kind: 'ended', outcome: 'failed', cause: null } as RtbPrepareEnd, { outcome: 'failed', cause: null }],
    ])('a preparation that ended %s maps unchanged and installs nothing (guard)', async (_name, end, expected) => {
        const run = calls({ prepare: async () => end })
        expect(await runRtbRestore(picked, run.deps)).toEqual(expected)
        expect(run.log).toEqual([])
        expect(isBusy()).toBe(false)
    })

    test.each([
        ['stopped nothing-replaced', { kind: 'stopped', outcome: 'nothing-replaced', cause: 'busy', facts } as RtbInstallEnd, { outcome: 'nothing-replaced', cause: 'busy' }],
        ['stopped failed', { kind: 'stopped', outcome: 'failed', cause: 'write-failed', facts } as RtbInstallEnd, { outcome: 'failed', cause: 'write-failed' }],
        ['unconfirmed', { kind: 'unconfirmed', cause: 'unconfirmed', facts } as RtbInstallEnd, { outcome: 'unknown', cause: 'unconfirmed' }],
    ])('an install that ended %s maps to its outcome and the finish stage never runs (guard; MB2 fails it)', async (_name, end, expected) => {
        const run = calls({ install: async () => { run.log.push('install'); return end } })
        expect(await runRtbRestore(picked, run.deps)).toEqual(expected)
        expect(run.log).toEqual(['prepare busy=true', 'install'])
        expect(isBusy()).toBe(false)
    })

    test('a landed install runs the finish stage with the plan, the hold and the end, and ends committed (guard)', async () => {
        const finish = vi.fn(async () => { })
        const run = calls({ finish })
        expect(await runRtbRestore(picked, run.deps)).toEqual({ outcome: 'committed', cause: null })
        expect(finish).toHaveBeenCalledWith(plan, hold, landed)
        expect(isBusy()).toBe(false)
    })
})

describe('the shell never rejects once the install was called (B6 a, b, c)', () => {
    test('(a) a preparation that rejects propagates, the busy entry ended, and the install was never called (guard; MB6 fails it)', async () => {
        const run = calls({ prepare: async () => { throw new Error('prepare failed') } })
        const install = vi.fn(async () => landed)
        await expect(runRtbRestore(picked, { ...run.deps, install })).rejects.toThrow('prepare failed')
        expect(install).not.toHaveBeenCalled()
        expect(isBusy()).toBe(false)
    })

    test('(b) an install that rejects resolves unknown with the unconfirmed text, the busy entry ended, and the finish stage never runs (guard; MB7a fails it)', async () => {
        const run = calls({ install: async () => { throw new Error('install broke its contract') } })
        expect(await runRtbRestore(picked, run.deps)).toEqual({ outcome: 'unknown', cause: null })
        expect(run.waits).toEqual([language.store2ImportUnconfirmed])
        expect(run.log).toEqual(['prepare busy=true'])
        expect(isBusy()).toBe(false)
    })

    test('(c) a finish that rejects resolves committed with the reload-or-restart text, and the busy entry ended (guard; MB7b fails it)', async () => {
        const run = calls({ finish: async () => { throw new Error('finish broke its contract') } })
        expect(await runRtbRestore(picked, run.deps)).toEqual({ outcome: 'committed', cause: null })
        expect(run.waits).toEqual([language.restoreSavedReloadOrRestart])
        expect(isBusy()).toBe(false)
    })

    test('an alert that throws while reporting a contract break is swallowed and the outcome stays (guard)', async () => {
        const wait = () => { throw new Error('alert failed') }
        expect(await runRtbRestore(picked, calls({ install: async () => { throw new Error('x') }, wait }).deps)).toEqual({ outcome: 'unknown', cause: null })
        expect(await runRtbRestore(picked, calls({ finish: async () => { throw new Error('x') }, wait }).deps)).toEqual({ outcome: 'committed', cause: null })
    })

    test('a busy entry whose end throws does not mask the outcome (guard; an unwrapped end fails it)', async () => {
        const handle: BusyHandle = { kind: 'backupLoad', end: () => { throw new Error('end failed') } }
        const run = calls({ beginBusy: () => handle })
        expect(await runRtbRestore(picked, run.deps)).toEqual({ outcome: 'committed', cause: null })
    })
})

describe('pickedRtbOf', () => {
    test('describes the file by its own name, size and time whatever its extension (guard)', () => {
        const file = new File([new Uint8Array(7)], 'backup.bin', { lastModified: 1234 })
        const described = pickedRtbOf(file)
        expect(described).toMatchObject({ name: 'backup.bin', size: 7, lastModified: 1234 })
        expect(described.source).toBeDefined()
    })
})
