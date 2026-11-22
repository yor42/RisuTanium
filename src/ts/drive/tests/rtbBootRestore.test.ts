/**
 * The start-up `.rtb` shell (CHORE-128 S14b): `runRtbBootRestore` over injected stages and a fake boot target. The stages'
 * own behaviour is covered by their suites and the real boot is covered by `rtbBootRestore.svelte.test.ts`; this file covers
 * the order of the calls, the message of every end and, above all, the release of the write lock on every end.
 *
 * The fake hold records every `release` call and does not dedupe. The real hold ignores every call after the first, which
 * would hide a wrong first call behind a correct later one.
 *
 * Labels: every test is a guard of a new rule (the shell is new: no pre-fix base); each names the scratch mutants it turns red on.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'
import { language } from 'src/lang'
import { alertStore } from 'src/ts/stores.svelte'
import type { BusyHandle } from 'src/ts/process/memory/busyActions'
import type { BootBuiltOutcome, BootBuiltRequest, BootBuiltResult, BootImportEnd, BootImportFinish, BootImportTarget } from 'src/ts/storage/store2/legacy/bootImport'
import type { CommitKey } from 'src/ts/storage/store2/format'
import type { RestorePlanInput } from 'src/ts/storage/store2/rtb/restoreBuild'
import { RtbRestoreError } from 'src/ts/storage/store2/rtb/restoreBuild'
import type { SideRestoreResult } from 'src/ts/drive/rtb/sideStores'
import type { CopyEnd, RtbInstallFacts } from 'src/ts/drive/rtbRestoreCopy'
import { withCopiedKept } from 'src/ts/drive/rtbRestoreCopy'
import { leftOutLines } from 'src/ts/drive/rtbRestoreFinish'
import type { RestoreHold } from 'src/ts/drive/rtbRestoreHold'
import type { PickedRtb, RtbVerifyEnd, VerifiedRtb } from 'src/ts/drive/rtbRestorePlan'
import { runRtbBootRestore, type RtbBootDeps } from 'src/ts/drive/rtbBootRestore'

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

const GENERIC = 'Failed, Is file corrupted?'
const picked = { name: 'a.rtb', size: 1, lastModified: 1, source: null } as unknown as PickedRtb
const PLAN = {
    store2: { root: ['root-tail', 1, 2] },
    manifest: { omitted: [] },
    notice: { unknownOptionalRows: [], outsideEntryCount: 0, omittedUnits: [], omittedEntries: [], unreadableLists: 0 },
    assets: { limit: 1_000_000 },
    side: [],
} as unknown as VerifiedRtb
const FACTS: RtbInstallFacts = { assetsWritten: 0, assetsPresent: 0, skippedAssets: [], inlays: { written: 0, skipped: [], changed: false } }
const INSTALLED = { status: 'installed', manifestKey: 'm', value: null as unknown as CommitKey, flushed: true, repair: { dropped: 0, changed: 0, recovered: 0 } } as BootImportFinish
const finished = (result: BootImportFinish): BootImportEnd => ({ kind: 'finished', result })
const RECLASSIFY = { status: 'reclassify' } as BootImportFinish
const BLOCKED = { status: 'blocked', reason: 'install-failed', detail: 'recorded' } as BootImportFinish
const EXIT_NO_WRITE = { status: 'exit', exit: { status: 'declined' } } as unknown as BootImportFinish
const CANCELLED: BootImportEnd = { kind: 'cancelled' }
const PENDING = 'pending'

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

interface Options {
    entry?: 'first-life' | 'exit'
    outcome?: BootBuiltOutcome
    /** Replaces the target's installer. */
    install?: (request: BootBuiltRequest) => Promise<BootBuiltResult>
    /** No `installBuiltTree` on the target (a test double only). */
    noInstall?: boolean
    deps?: Partial<RtbBootDeps>
    /** The answers of `refuseWhileBusy` by call: the first is B3, the second is the gate. */
    busy?: boolean[]
    holdResult?: 'held' | 'refused' | 'declined'
    releaseTrueRejects?: boolean
    /** Leaves `clearAlert` to the shell's own, which reads and writes the alert store of the mocked stores module. */
    realClearAlert?: boolean
    /** The result the gate's stageKeys returns. */
    staged?: SideRestoreResult | null
}

interface Rig {
    log: string[]
    releases: boolean[]
    errors: string[]
    waits: string[]
    notices: string[]
    planInputs: RestorePlanInput[]
    /** The staged argument of every `applySides` call. */
    stagedSeen: (SideRestoreResult | null)[]
    run(): Promise<BootImportEnd | typeof PENDING>
}

function rig(options: Options = {}): Rig {
    const entry = options.entry ?? 'first-life'
    const log: string[] = []
    const releases: boolean[] = []
    const errors: string[] = []
    const waits: string[] = []
    const notices: string[] = []
    const planInputs: RestorePlanInput[] = []
    const stagedSeen: (SideRestoreResult | null)[] = []
    let busyCalls = 0
    const hold = {
        busy: {},
        release: async (keep: boolean) => {
            releases.push(keep)
            log.push(`release:${keep}`)
            if (options.releaseTrueRejects === true && keep) {
                throw new Error('release failed')
            }
        },
    } as unknown as RestoreHold
    const installer = options.install ?? (async (request: BootBuiltRequest): Promise<BootBuiltResult> => {
        log.push('keep')
        log.push('snapshot')
        if (!await request.beforeFirstWrite()) {
            return { entry, outcome: { status: 'not-started' } }
        }
        log.push('commit-start')
        log.push('mark')
        return { entry, outcome: options.outcome ?? INSTALLED }
    })
    const target: BootImportTarget = options.noInstall === true
        ? { install: async () => { throw new Error('unused') }, readColdStorageItem: async () => ({ status: 'missing' }) }
        : { install: async () => { throw new Error('unused') }, readColdStorageItem: async () => ({ status: 'missing' }), installBuiltTree: installer }
    const deps: Partial<RtbBootDeps> = {
        beginBusy: () => { log.push('busy'); return { end: () => { log.push('busy-end') } } as unknown as BusyHandle },
        settled: async () => { log.push('settled') },
        refuseOnReadOnlyPage: async () => { log.push('read-only'); return false },
        refuseWhileBusy: () => {
            busyCalls += 1
            log.push(busyCalls === 1 ? 'busy-check' : 'gate:busy-check')
            return options.busy?.[busyCalls - 1] ?? false
        },
        acquireHold: async () => {
            log.push('hold')
            const result = options.holdResult ?? 'held'
            return result === 'held' ? { kind: 'held', hold } : { kind: result }
        },
        verify: async (): Promise<RtbVerifyEnd> => { log.push('verify'); return { kind: 'ok', verified: PLAN } },
        copy: async (): Promise<CopyEnd> => { log.push('copy'); return { kind: 'copied', facts: FACTS } },
        reread: async () => { log.push('reread'); return { kind: 'ok', frames: new Map() } },
        planRestore: (input) => { log.push('plan'); planInputs.push(input); return { newUnits: 1, build: () => { throw new Error('not built') } } },
        clearGrants: async () => { log.push('gate:clear-grants') },
        stageKeys: async () => { log.push('gate:stage-keys'); return options.staged ?? null },
        applySides: async (_plan, staged) => { log.push('sides'); stagedSeen.push(staged); return [] },
        notice: async (text) => { log.push('notice'); notices.push(text) },
        error: (text) => { log.push('error'); errors.push(text) },
        waitAlert: async () => { log.push('wait-alert') },
        wait: (text) => {
            waits.push(text)
            log.push(text === language.rtbRestoreInstalling ? 'wait:installing' : text === language.store2Boot.recoveryInstalledBody ? 'wait:reloading' : 'wait:other')
        },
        clearAlert: () => { log.push('clear-alert') },
        markReload: () => { log.push('mark-reload') },
        reload: () => { log.push('reload') },
        ...options.deps,
    }
    if (options.realClearAlert === true) {
        delete deps.clearAlert
    }
    return {
        log, releases, errors, waits, notices, planInputs, stagedSeen,
        run: () => Promise.race([
            runRtbBootRestore(picked, target, deps),
            new Promise<typeof PENDING>((resolve) => { setTimeout(() => resolve(PENDING), 30) }),
        ]),
    }
}

describe('the order of a successful restore (T-S1)', () => {
    test('first life: the hold comes before the verification, the gate before the marker, the hold is handed off before the reload, and nothing follows it (M7, M13, M19, M20, M27, M29, M32)', async () => {
        const r = rig()
        expect(await r.run()).toBe(PENDING)
        expect(r.log).toEqual(['busy', 'settled', 'read-only', 'busy-check', 'hold', 'verify', 'copy', 'reread', 'plan', 'wait:installing', 'keep', 'snapshot',
            'gate:busy-check', 'gate:clear-grants', 'gate:stage-keys', 'commit-start', 'mark', 'sides', 'wait:reloading', 'release:true', 'mark-reload', 'reload'])
        expect(r.planInputs).toHaveLength(1)
        expect(r.planInputs[0].target).toEqual({ legacyKeep: null, req: [] })
        expect(r.errors).toEqual([])
    })

    test('exit: the same up to the notices, then the single release, the alert clear and the busy end; the end is the installer\'s own result and nothing reloads (M12b, M13)', async () => {
        const r = rig({ entry: 'exit' })
        expect(await r.run()).toEqual(finished(INSTALLED))
        expect(r.log).toEqual(['busy', 'settled', 'read-only', 'busy-check', 'hold', 'verify', 'copy', 'reread', 'plan', 'wait:installing', 'keep', 'snapshot',
            'gate:busy-check', 'gate:clear-grants', 'gate:stage-keys', 'commit-start', 'mark', 'sides', 'release:false', 'clear-alert', 'busy-end'])
    })
})

describe('a settings-only file (T13)', () => {
    const SETTINGS_END = { kind: 'settings', settings: { values: [] }, file: { name: 'a.rtb', size: 1, lastModified: 1 } } as unknown as RtbVerifyEnd

    test('is refused with the hint and ends cancelled: nothing is copied, planned or installed, the hold is released false (guard; M7 fails it)', async () => {
        const r = rig({ deps: { verify: async () => { return SETTINGS_END } } })
        expect(await r.run()).toEqual(CANCELLED)
        expect(r.errors).toEqual([language.rtbRestoreSettingsAtStart])
        for (const step of ['copy', 'reread', 'plan', 'keep', 'snapshot', 'commit-start', 'mark', 'sides']) {
            expect(r.log, step).not.toContain(step)
        }
        expect(r.releases).toEqual([false])
        expect(r.log.at(-1)).toBe('busy-end')
    })
})
describe('the gate (T-S2)', () => {
    test('a busy refusal at the gate ends cancelled before the marker, with the copied-kept message and no grant cleared (M5, M21)', async () => {
        const r = rig({ busy: [false, true] })
        expect(await r.run()).toEqual(CANCELLED)
        expect(r.log).not.toContain('mark')
        expect(r.log).not.toContain('commit-start')
        expect(r.log).not.toContain('gate:clear-grants')
        expect(r.errors).toEqual([withCopiedKept(language.backupLoadWorkInProgress)])
    })

    test('G7: the connection keys are staged inside the gate after the busy re-check and the grant clear, and a busy refusal stages nothing (guard of a new rule; this rig runs its installer gate even for a blocked keep listing, which production never does)', async () => {
        const refused = rig({ busy: [false, true] })
        expect(await refused.run()).toEqual(CANCELLED)
        expect(refused.log).not.toContain('gate:stage-keys')

        const passed = rig({ entry: 'exit' })
        await passed.run()
        const gate = passed.log.filter((step) => step.startsWith('gate:'))
        expect(gate).toEqual(['gate:busy-check', 'gate:clear-grants', 'gate:stage-keys'])
        expect(passed.log.indexOf('gate:stage-keys')).toBeLessThan(passed.log.indexOf('commit-start'))
    })

    test('G7b: the result the gate staged is the one the after-install side restore receives, so it is not applied twice (guard of a new rule)', async () => {
        const staged: SideRestoreResult = { id: 'side.connection-keys', status: 'ok', written: 2, skipped: [] }
        const r = rig({ entry: 'exit', staged })
        await r.run()
        expect(r.stagedSeen).toEqual([staged])
    })
})

describe('the exits before the installer (T-S3)', () => {
    const rows: { name: string, options: Options, errors: string[], hold: boolean, verified: boolean }[] = [
        { name: 'B-1: no installBuiltTree on the target', options: { noInstall: true }, errors: [GENERIC], hold: false, verified: false },
        { name: 'B2: read-only page', options: { deps: { refuseOnReadOnlyPage: async () => true } }, errors: [], hold: false, verified: false },
        { name: 'B3: busy', options: { busy: [true] }, errors: [], hold: false, verified: false },
        { name: 'B4: refused by the other tabs', options: { holdResult: 'refused' }, errors: [], hold: false, verified: false },
        { name: 'B4: declined', options: { holdResult: 'declined' }, errors: [], hold: false, verified: false },
        { name: 'B5: the verification ended', options: { deps: { verify: async () => ({ kind: 'ended', outcome: 'nothing-replaced', cause: 'not-an-rtb' }) } }, errors: [], hold: true, verified: true },
        { name: 'B5: the verification throws', options: { deps: { verify: async () => { throw new Error('read') } } }, errors: [language.store2ImportReadFailed], hold: true, verified: true },
        { name: 'B6: the copy stopped and showed its own text', options: { deps: { copy: async () => ({ kind: 'stopped', outcome: 'failed', cause: 'write-failed', facts: FACTS, shown: true }) } }, errors: [], hold: true, verified: true },
        { name: 'B6: the copy stopped and could not show its text', options: { deps: { copy: async () => ({ kind: 'stopped', outcome: 'failed', cause: 'write-failed', facts: FACTS, shown: false }) } }, errors: [language.restoreWriteFailed], hold: true, verified: true },
        { name: 'B7: the file changed while it was read', options: { deps: { reread: async () => ({ kind: 'changed', detail: 'x' }) } }, errors: [language.backupFileChangedWhileReading], hold: true, verified: true },
        { name: 'B8: the plan is refused as damaged', options: { deps: { planRestore: () => { throw new RtbRestoreError('missing-frame', 'x', 't') } } }, errors: [withCopiedKept(language.rtbRestoreDamaged)], hold: true, verified: true },
        { name: 'B8: the plan throws otherwise', options: { deps: { planRestore: () => { throw new Error('x') } } }, errors: [language.restoreWriteFailed], hold: true, verified: true },
    ]
    test.each(rows)('$name ends cancelled with its own message, and the installer is not reached (M19, M25, M27)', async ({ options, errors, hold, verified }) => {
        const r = rig(options)
        expect(await r.run()).toEqual(CANCELLED)
        expect(r.errors).toEqual(errors)
        expect(r.log).not.toContain('keep')
        expect(r.log).not.toContain('mark')
        expect(r.log.includes('hold')).toBe(hold || options.holdResult !== undefined)
        if (!verified) {
            expect(r.log).not.toContain('verify')
        }
        if (options.noInstall !== true) {
            expect(r.log.at(-1)).toBe('busy-end')
        } else {
            expect(r.log).toEqual(['error'])
        }
    })
})

describe('the installer results and throws (T-S4)', () => {
    test('installed on first life restores the side data, reloads after the mark and never settles (M12, M29)', async () => {
        const r = rig()
        expect(await r.run()).toBe(PENDING)
        expect(r.log.slice(-4)).toEqual(['wait:reloading', 'release:true', 'mark-reload', 'reload'])
    })

    test('installed on the exit entry returns the installed result with the side data restored and no reload (M12b)', async () => {
        const r = rig({ entry: 'exit' })
        expect(await r.run()).toEqual(finished(INSTALLED))
        expect(r.log).toContain('sides')
        expect(r.log).not.toContain('reload')
        expect(r.log).not.toContain('mark-reload')
    })

    test.each(['first-life', 'exit'] as const)('blocked and reclassify return the installer\'s result with no side data (%s) (M11)', async (entry) => {
        for (const outcome of [BLOCKED, RECLASSIFY]) {
            const r = rig({ entry, outcome })
            expect(await r.run()).toEqual(finished(outcome))
            expect(r.log).not.toContain('sides')
            expect(r.log).not.toContain('reload')
        }
    })

    test('exit after the gate with no profile write: the grants were cleared, the result is the installer\'s, no side data (C3) (M11)', async () => {
        const r = rig({ entry: 'exit', outcome: EXIT_NO_WRITE })
        expect(await r.run()).toEqual(finished(EXIT_NO_WRITE))
        expect(r.log).toContain('gate:clear-grants')
        expect(r.log).not.toContain('sides')
    })

    test('a throw before the gate passed ends cancelled with the write-failed text and no gate step (M16b)', async () => {
        const r = rig({ install: async () => { throw new Error('before') } })
        expect(await r.run()).toEqual(CANCELLED)
        expect(r.errors).toEqual([language.restoreWriteFailed])
        expect(r.log.some((entry) => entry.startsWith('gate:'))).toBe(false)
    })

    test('a throw inside the gate (a mapping guard: the production grant clear never rejects) ends cancelled (M16b)', async () => {
        const r = rig({ deps: { clearGrants: async () => { throw new Error('clear') } } })
        expect(await r.run()).toEqual(CANCELLED)
        expect(r.errors).toEqual([language.restoreWriteFailed])
    })

    test('a throw after the gate passed ends reclassify with the unconfirmed text, awaited before the alert is cleared (M16)', async () => {
        const r = rig({ install: async (request) => { await request.beforeFirstWrite(); throw new Error('after') } })
        expect(await r.run()).toEqual(finished(RECLASSIFY))
        expect(r.errors).toEqual([language.store2ImportUnconfirmed])
        expect(r.log.indexOf('wait-alert')).toBeGreaterThan(-1)
        expect(r.log.indexOf('wait-alert')).toBeLessThan(r.log.indexOf('clear-alert'))
    })
})

describe('the real alert clear (T-X1)', () => {
    beforeEach(() => {
        alertStore.set({ type: 'none', msg: '' })
    })

    test('an error shown on a cancelled end is still on screen after the end (kills a clear that wipes every alert)', async () => {
        const r = rig({
            busy: [false, true],
            realClearAlert: true,
            deps: { error: (text) => { alertStore.set({ type: 'error', msg: text }) } },
        })
        expect(await r.run()).toEqual(CANCELLED)
        expect(get(alertStore)).toEqual({ type: 'error', msg: withCopiedKept(language.backupLoadWorkInProgress) })
    })

    test('the shell\'s own wait text on screen at the end is cleared (kills a clear that never runs)', async () => {
        const r = rig({
            outcome: BLOCKED,
            realClearAlert: true,
            deps: { wait: (text) => { alertStore.set({ type: 'wait', msg: text }) } },
        })
        expect(await r.run()).toEqual(finished(BLOCKED))
        expect(get(alertStore).type).toBe('none')
    })
})

describe('the notices (T-S5)', () => {
    const skipped: RtbInstallFacts = { ...FACTS, skippedAssets: [{ name: 'bad name', reason: 'invalidName' }] }
    const malformed: SideRestoreResult[] = [{ id: 'side.ui-prefs', status: 'malformed', reason: 'x', line: null, conflict: false }]

    test.each(['first-life', 'exit'] as const)('installed (%s): the skipped notice, then the left-out notice, each before any release; no done and no not-flushed text (M22)', async (entry) => {
        const r = rig({
            entry,
            outcome: { ...INSTALLED, flushed: false } as BootImportFinish,
            deps: { copy: async () => ({ kind: 'copied', facts: skipped }), applySides: async () => malformed },
        })
        await r.run()
        const firstRelease = r.log.findIndex((item) => item.startsWith('release:'))
        const noticeAt = r.log.map((item, at) => item === 'notice' ? at : -1).filter((at) => at >= 0)
        expect(r.notices).toHaveLength(2)
        expect(r.notices[0]).toContain('bad name')
        expect(r.notices[1]).toBe(language.rtbRestoreLeftOut(leftOutLines(PLAN, malformed)))
        expect(noticeAt.every((at) => at < firstRelease)).toBe(true)
        const shown = [...r.notices, ...r.waits, ...r.errors]
        expect(shown).not.toContain(language.store2ImportDone)
        expect(shown).not.toContain(language.store2ImportNotFlushed)
    })
})

describe('the failures after installed (T-S6)', () => {
    test('first life, reload throws: the restart text is the last alert, the alert is not cleared, busy is not ended, the page parks (M30)', async () => {
        const r = rig({ deps: { reload: () => { throw new Error('no reload') } } })
        expect(await r.run()).toBe(PENDING)
        expect(r.waits.at(-1)).toBe(language.restoreSavedReloadOrRestart)
        expect(r.log).not.toContain('clear-alert')
        expect(r.log).not.toContain('busy-end')
    })

    test('applySides throws: first life still reaches the reload; the exit still returns installed (M31)', async () => {
        const boom = { applySides: async () => { throw new Error('sides') } }
        const first = rig({ deps: boom })
        expect(await first.run()).toBe(PENDING)
        expect(first.log).toContain('reload')
        const exit = rig({ entry: 'exit', deps: boom })
        expect(await exit.run()).toEqual(finished(INSTALLED))
    })
})

describe('the write lock on every end (T-REL)', () => {
    // `releases` is the whole log of release calls, in order. The hold has one release site for every end that returns.
    const rows: { row: string, options: Options, end: BootImportEnd | typeof PENDING, releases: boolean[] }[] = [
        { row: 'R1 first-life installed', options: {}, end: PENDING, releases: [true] },
        { row: 'R2 first-life installed, applySides throws', options: { deps: { applySides: async () => { throw new Error('s') } } }, end: PENDING, releases: [true] },
        { row: 'R3 first-life installed, reload throws', options: { deps: { reload: () => { throw new Error('r') } } }, end: PENDING, releases: [true] },
        { row: 'R4 exit installed', options: { entry: 'exit' }, end: finished(INSTALLED), releases: [false] },
        { row: 'R5 exit installed, applySides throws', options: { entry: 'exit', deps: { applySides: async () => { throw new Error('s') } } }, end: finished(INSTALLED), releases: [false] },
        { row: 'R6 blocked', options: { outcome: BLOCKED }, end: finished(BLOCKED), releases: [false] },
        { row: 'R7 reclassify, not a throw', options: { outcome: RECLASSIFY }, end: finished(RECLASSIFY), releases: [false] },
        { row: 'R8 exit reclassify, not a throw', options: { entry: 'exit', outcome: RECLASSIFY }, end: finished(RECLASSIFY), releases: [false] },
        { row: 'R9 exit after the gate with no write', options: { entry: 'exit', outcome: EXIT_NO_WRITE }, end: finished(EXIT_NO_WRITE), releases: [false] },
        { row: 'R10 the gate refuses', options: { busy: [false, true] }, end: CANCELLED, releases: [false] },
        { row: 'R11 no installBuiltTree', options: { noInstall: true }, end: CANCELLED, releases: [] },
        { row: 'R12 a throw before the hold', options: { deps: { settled: async () => { throw new Error('t') } } }, end: CANCELLED, releases: [] },
        { row: 'R13 read-only', options: { deps: { refuseOnReadOnlyPage: async () => true } }, end: CANCELLED, releases: [] },
        { row: 'R14 busy before the hold', options: { busy: [true] }, end: CANCELLED, releases: [] },
        { row: 'R15 hold refused', options: { holdResult: 'refused' }, end: CANCELLED, releases: [] },
        { row: 'R16 hold declined', options: { holdResult: 'declined' }, end: CANCELLED, releases: [] },
        { row: 'R17 verify ended, not a .rtb', options: { deps: { verify: async () => ({ kind: 'ended', outcome: 'nothing-replaced', cause: 'not-an-rtb' }) } }, end: CANCELLED, releases: [false] },
        { row: 'R18 verify ended, a declined prompt', options: { deps: { verify: async () => ({ kind: 'ended', outcome: 'canceled', cause: 'declined' }) } }, end: CANCELLED, releases: [false] },
        { row: 'R19 verify throws', options: { deps: { verify: async () => { throw new Error('v') } } }, end: CANCELLED, releases: [false] },
        { row: 'R20 copy stopped', options: { deps: { copy: async () => ({ kind: 'stopped', outcome: 'failed', cause: 'write-failed', facts: FACTS, shown: true }) } }, end: CANCELLED, releases: [false] },
        { row: 'R21 file changed', options: { deps: { reread: async () => ({ kind: 'changed', detail: 'x' }) } }, end: CANCELLED, releases: [false] },
        { row: 'R22 plan damaged', options: { deps: { planRestore: () => { throw new RtbRestoreError('missing-frame', 'x', 't') } } }, end: CANCELLED, releases: [false] },
        { row: 'R23 plan throws', options: { deps: { planRestore: () => { throw new Error('p') } } }, end: CANCELLED, releases: [false] },
        { row: 'R24 throw before the gate', options: { install: async () => { throw new Error('b') } }, end: CANCELLED, releases: [false] },
        { row: 'R25 throw inside the gate', options: { deps: { clearGrants: async () => { throw new Error('c') } } }, end: CANCELLED, releases: [false] },
        { row: 'R26 throw after the gate', options: { install: async (request) => { await request.beforeFirstWrite(); throw new Error('a') } }, end: finished(RECLASSIFY), releases: [false] },
    ]
    test.each(rows)('$row: the release log is exactly $releases (M9, M10, M32-M36)', async ({ options, end, releases }) => {
        const r = rig(options)
        expect(await r.run()).toEqual(end)
        expect(r.releases).toEqual(releases)
        if (end !== PENDING) {
            expect(r.log).not.toContain('mark-reload')
            expect(r.log).not.toContain('reload')
        }
    })

    test('R1 and R2 reload once, after the mark; R3 attempts the reload and shows the restart text (M32)', async () => {
        const first = rig()
        await first.run()
        expect(first.log.filter((item) => item === 'reload')).toHaveLength(1)
        expect(first.log.indexOf('mark-reload')).toBeLessThan(first.log.indexOf('reload'))
        expect(first.log.indexOf('release:true')).toBeLessThan(first.log.indexOf('mark-reload'))
        const failed = rig({ deps: { reload: () => { throw new Error('r') } } })
        await failed.run()
        expect(failed.waits.at(-1)).toBe(language.restoreSavedReloadOrRestart)
    })

    test('R3b: release(true) itself rejects: the run never settles, the log is exactly [true], and the restart text is shown (M35b)', async () => {
        const r = rig({ releaseTrueRejects: true })
        expect(await r.run()).toBe(PENDING)
        expect(r.releases).toEqual([true])
        expect(r.waits.at(-1)).toBe(language.restoreSavedReloadOrRestart)
        expect(r.log).not.toContain('reload')
        expect(r.log).not.toContain('clear-alert')
    })
})
