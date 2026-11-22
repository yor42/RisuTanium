/**
 * A `.rtb` restore clears the saved "always" tool approvals before it installs anything (MC-3415), on the page path
 * (`installRtbRestore`) and the start-up path (`runRtbBootRestore`), running the real stages with injected collaborators and
 * the real grants store over an in-memory byte store. A clear that fails stops the restore with nothing replaced; the
 * plugin-grant clear and the commit (page) or the installer (boot) never run. Nothing here says anything about native stores.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import type { BootBuiltRequest, BootBuiltResult, BootImportEnd, BootImportFinish, BootImportTarget } from 'src/ts/storage/store2/legacy/bootImport'
import type { CommitKey } from 'src/ts/storage/store2/format'
import type { CommitResult } from 'src/ts/storage/store2/commit'
import type { CopyEnd, RtbInstallFacts } from 'src/ts/drive/rtbRestoreCopy'
import { withCopiedKept } from 'src/ts/drive/rtbRestoreCopy'
import type { RestoreHold } from 'src/ts/drive/rtbRestoreHold'
import type { PickedRtb, RtbVerifyEnd, VerifiedRtb } from 'src/ts/drive/rtbRestorePlan'
import type { BusyHandle } from 'src/ts/process/memory/busyActions'
import { installRtbRestore, type RtbInstallDeps, type RtbInstallPlan } from 'src/ts/drive/rtbRestoreInstall'
import { runRtbBootRestore, type RtbBootDeps } from 'src/ts/drive/rtbBootRestore'
import { clearToolGrantsForRestore, hasToolGrant, addToolGrant, resetToolGrantsForTests } from 'src/ts/process/mcp/toolGrants'

const h = vi.hoisted(() => ({
    store: null as ByteStore | null,
    log: [] as string[],
}))

vi.mock('src/ts/storage/store/appStore', () => ({ getAppStore: async () => h.store }))
vi.mock('src/ts/alertPrompts', () => ({ queueNotice: () => { } }))
vi.mock('src/ts/alert', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/alert')>()),
    alertError: vi.fn(),
    alertWait: vi.fn(),
}))
vi.mock('src/ts/drive/rtbRestoreHold', () => ({
    checkAuthoritativeBase: () => ({ kind: 'ok' }),
    rtbGuardedCommitter: (committer: unknown) => committer,
    isRtbBusyAbort: () => false,
    acquireRestoreHold: vi.fn(),
}))
vi.mock('src/ts/drive/rtb/sideStores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/drive/rtb/sideStores')>()),
    applySideAction: vi.fn(async () => { h.log.push('plugin-clear'); return { id: 'side.plugin-permissions', status: 'cleared' } }),
    defaultSideBackends: {},
}))
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

const KEY = 'consent/workspace-tool-grants.json'
const FACTS: RtbInstallFacts = { assetsWritten: 0, assetsPresent: 0, skippedAssets: [], inlays: { written: 0, skipped: [], changed: false } }
let store: MemoryByteStore

beforeEach(() => {
    store = createMemoryByteStore()
    h.store = store
    h.log.length = 0
    resetToolGrantsForTests()
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

describe('the page restore (installRtbRestore)', () => {
    interface Rig {
        plan: RtbInstallPlan
        hold: RestoreHold
        errors: string[]
        releases: boolean[]
        commit: ReturnType<typeof vi.fn>
        deps: Partial<RtbInstallDeps>
    }

    function rig(options: { commit?: () => Promise<CommitResult>, deps?: Partial<RtbInstallDeps> } = {}): Rig {
        const errors: string[] = []
        const releases: boolean[] = []
        const commit = vi.fn(async (): Promise<CommitResult> => {
            h.log.push('commit')
            return options.commit === undefined ? { status: 'committed', flushed: true } as CommitResult : await options.commit()
        })
        const plan = {
            store2: { blocks: [], tails: new Map(), root: ['root', 1, 2] },
            manifest: { omitted: [] },
            target: { committer: { readCommit: async () => ({}), commit }, backend: {} },
            base: { seq: 1, at: 1, currentKey: 'k' },
            side: [],
            held: null,
        } as unknown as RtbInstallPlan
        const hold = {
            busy: {},
            guard: { check: async () => true },
            lock: 'write-lock',
            release: async (keep: boolean) => { releases.push(keep) },
        } as unknown as RestoreHold
        const deps: Partial<RtbInstallDeps> = {
            copy: async (): Promise<CopyEnd> => { h.log.push('copy'); return { kind: 'copied', facts: FACTS } },
            baseManifest: async () => ({ status: 'ok', manifest: { fixed: { legacyKeep: null }, req: [] } }) as never,
            planRestore: () => { h.log.push('plan'); return { newUnits: [], build: () => { throw new Error('not built') } } as never },
            error: (text) => { errors.push(text) },
            wait: () => { },
            ...options.deps,
        }
        return { plan, hold, errors, releases, commit, deps }
    }

    test('the clear runs after the plan and before the plugin-grant clear and the commit, and a landed restore keeps the seal', async () => {
        await addToolGrant('ws1', 'write_file')
        const r = rig()

        const end = await installRtbRestore(r.plan, r.hold, r.deps)

        expect(end.kind).toBe('landed')
        expect(h.log).toEqual(['copy', 'plan', 'plugin-clear', 'commit'])
        expect(JSON.parse(new TextDecoder().decode(store.files.get(KEY)!))).toEqual({ v: 1, grants: {} })
        expect(await hasToolGrant('ws1', 'write_file')).toBe(false)
        expect(await addToolGrant('ws1', 'write_file')).toBe(false)
    })

    test('a clear that fails stops with nothing replaced: no plugin clear, no commit, the cause and detail named, the hold released', async () => {
        await addToolGrant('ws1', 'write_file')
        store.failWrite = () => new Error('disk full')
        const r = rig()

        const end = await installRtbRestore(r.plan, r.hold, r.deps)

        expect(end).toMatchObject({ kind: 'stopped', outcome: 'nothing-replaced', cause: 'grants-unwritable' })
        expect(r.commit).not.toHaveBeenCalled()
        expect(h.log).not.toContain('plugin-clear')
        expect(r.errors).toEqual([withCopiedKept(language.toolGrantsClearFailed('disk full'))])
        expect(r.errors[0]).toContain('disk full')
        expect(r.releases).toEqual([false])
        store.failWrite = null
        expect(await hasToolGrant('ws1', 'write_file')).toBe(true)
    })

    test('a restore that stops after the clear lifts the seal; one whose commit is unconfirmed keeps it', async () => {
        const stopped = rig({ commit: async () => ({ status: 'refused', reason: 'too-new' }) as CommitResult })
        expect((await installRtbRestore(stopped.plan, stopped.hold, stopped.deps)).kind).toBe('stopped')
        expect(await addToolGrant('ws1', 'write_file')).toBe(true)

        resetToolGrantsForTests()
        const unconfirmed = rig({ commit: async () => ({ status: 'unknown' }) as CommitResult })
        expect((await installRtbRestore(unconfirmed.plan, unconfirmed.hold, unconfirmed.deps)).kind).toBe('unconfirmed')
        expect(await addToolGrant('ws1', 'write_file')).toBe(false)
    })

    test('the injected clear is called once, after the plan', async () => {
        const clearToolGrants = vi.fn(async () => { h.log.push('clear-tool-grants'); return { ok: true as const, release: () => { } } })
        const r = rig({ deps: { clearToolGrants } })
        await installRtbRestore(r.plan, r.hold, r.deps)
        expect(h.log).toEqual(['copy', 'plan', 'clear-tool-grants', 'plugin-clear', 'commit'])
        expect(clearToolGrants).toHaveBeenCalledTimes(1)
    })
})

describe('the start-up restore (runRtbBootRestore)', () => {
    const picked = { name: 'a.rtb', size: 1, lastModified: 1, source: null } as unknown as PickedRtb
    const PLAN = {
        store2: { root: ['root-tail', 1, 2] },
        manifest: { omitted: [] },
        notice: { unknownOptionalRows: [], outsideEntryCount: 0, omittedUnits: [], omittedEntries: [], unreadableLists: 0 },
        assets: { limit: 1_000_000 },
        side: [],
    } as unknown as VerifiedRtb
    const INSTALLED = { status: 'installed', manifestKey: 'm', value: null as unknown as CommitKey, flushed: true, repair: { dropped: 0, changed: 0, recovered: 0 } } as BootImportFinish

    function bootRig(deps: Partial<RtbBootDeps> = {}) {
        const errors: string[] = []
        const releases: boolean[] = []
        let installerStarted = false
        const hold = { busy: {}, release: async (keep: boolean) => { releases.push(keep) } } as unknown as RestoreHold
        const target: BootImportTarget = {
            install: async () => { throw new Error('unused') },
            readColdStorageItem: async () => ({ status: 'missing' }),
            installBuiltTree: async (request: BootBuiltRequest): Promise<BootBuiltResult> => {
                if (!await request.beforeFirstWrite()) {
                    return { entry: 'exit', outcome: { status: 'not-started' } }
                }
                installerStarted = true
                return { entry: 'exit', outcome: INSTALLED }
            },
        }
        const all: Partial<RtbBootDeps> = {
            beginBusy: () => ({ end: () => { } }) as unknown as BusyHandle,
            settled: async () => { },
            refuseOnReadOnlyPage: async () => false,
            refuseWhileBusy: () => false,
            acquireHold: async () => ({ kind: 'held', hold }),
            verify: async (): Promise<RtbVerifyEnd> => ({ kind: 'ok', verified: PLAN }),
            copy: async (): Promise<CopyEnd> => ({ kind: 'copied', facts: FACTS }),
            reread: async () => ({ kind: 'ok', frames: new Map() }),
            planRestore: () => ({ newUnits: 1, build: () => { throw new Error('not built') } }) as never,
            clearGrants: async () => { h.log.push('plugin-clear') },
            stageKeys: async () => { h.log.push('stage-keys'); return null },
            applySides: async () => [],
            notice: async () => { },
            error: (text) => { errors.push(text) },
            waitAlert: async () => { },
            wait: () => { },
            clearAlert: () => { },
            markReload: () => { },
            reload: () => { },
            ...deps,
        }
        return { run: () => runRtbBootRestore(picked, target, all), errors, releases, installerStarted: () => installerStarted }
    }

    test('a clear that fails keeps its text and ends cancelled: the installer never starts, nothing is staged, the plugin grants stay', async () => {
        await addToolGrant('ws1', 'write_file')
        store.failWrite = () => new Error('disk full')
        const r = bootRig()

        const end: BootImportEnd = await r.run()

        expect(end).toEqual({ kind: 'cancelled' })
        expect(r.errors).toEqual([withCopiedKept(language.toolGrantsClearFailed('disk full'))])
        expect(r.installerStarted()).toBe(false)
        expect(h.log).toEqual([])
        expect(r.releases).toEqual([false])
        store.failWrite = null
        expect(await hasToolGrant('ws1', 'write_file')).toBe(true)
    })

    test('a clear that works comes before the plugin clear and the staging, and the install proceeds', async () => {
        await addToolGrant('ws1', 'write_file')
        const clearToolGrants = vi.fn(async () => { h.log.push('clear-tool-grants'); return await clearToolGrantsForRestore() })
        const r = bootRig({ clearToolGrants })

        const end = await r.run()

        expect(end).toEqual({ kind: 'finished', result: INSTALLED })
        expect(h.log).toEqual(['clear-tool-grants', 'plugin-clear', 'stage-keys'])
        expect(r.installerStarted()).toBe(true)
        expect(JSON.parse(new TextDecoder().decode(store.files.get(KEY)!))).toEqual({ v: 1, grants: {} })
    })

    test('the seal is lifted on every end that returns', async () => {
        const r = bootRig()
        await r.run()
        expect(await addToolGrant('ws1', 'write_file')).toBe(true)
    })

    test('a busy refusal at the gate clears nothing', async () => {
        let calls = 0
        const clearToolGrants = vi.fn(async () => ({ ok: true as const, release: () => { } }))
        const r = bootRig({ clearToolGrants, refuseWhileBusy: () => { calls += 1; return calls === 2 } })
        await r.run()
        expect(clearToolGrants).not.toHaveBeenCalled()
        expect(r.errors).toEqual([withCopiedKept(language.backupLoadWorkInProgress)])
    })
})
