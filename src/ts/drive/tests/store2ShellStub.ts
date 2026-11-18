/**
 * Test-only support that puts a restore suite with module-level `vi.mock`s on a store2 page without the world kit, for
 * rows whose assertions end at or before the commit boundary. The page restore (`LoadLocalBackup`) asks
 * `checkStore2Import` for its target and ends in `commitStore2Import`; this stub replaces exactly those two and keeps
 * the rest of `storeImport.ts` real (`announceStore2Import`, `scanBinForImport`, `hasDatabaseEntry`,
 * `readBinDatabaseOmitted`, `confirmLeftOut`, `confirmImportScale`, `UnsavedGuard`, `binChangeText`,
 * `noteImportPhase`).
 *
 * What it does not prove: the real commit. Every `.bin` shape reaches the real store2 commit in the world-kit rows
 * (`binGoldens.test.ts`, `storeImportPorts.svelte.test.ts`, `storeImport*.svelte.test.ts`); a row on this stub proves
 * the restore reached the commit boundary in the right order and with the right inputs, nothing about what lands.
 *
 * Each suite declares its own hoisted box and its own `vi.mock` line, because a mock cannot live in the helper:
 *
 *     const box = vi.hoisted((): Store2ShellBox => ({ commits: [], events: [] }))
 *     vi.mock(import('src/ts/drive/storeImport'), (importOriginal) => store2ShellMock(box)(importOriginal))
 *
 * The factory is wrapped in an arrow because `vi.mock` is hoisted above the imports: passing `store2ShellMock(box)`
 * directly reads the import before it is initialized. Import this helper before the module under test, so it is
 * initialized when the mocked module is first loaded.
 *
 * A suite that mocks `src/ts/globalApi.svelte` must give it `isSaveClean: () => true`, `afterNextSaveCommit: vi.fn()` and
 * `requestSaveNow: vi.fn()`: `saveFirst` (`storeRestore.ts`) then returns at its clean check instead of waiting out
 * `SAVE_FIRST_BOUND_MS`. `isSaveLoopParked` and `isSaveLoopStopped` come from `store2/saveLoop`; when a suite mocks that
 * module, both must answer false. Each row on this stub asserts `alertWait` was never called with
 * `language.store2RestoreSaving`, which proves `saveFirst` did not wait.
 */
import { alertError } from 'src/ts/alert'
import { language } from 'src/lang'
import { BinFileChangedError } from 'src/ts/storage/store2/legacy/binReader'
import { setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import type { ByteStore } from 'src/ts/storage/store/contract'
import type { AppStoreKind } from 'src/ts/storage/store/appStore'
import type { Store2ImportCheck, Store2ImportEnd, Store2ImportRequest, Store2ImportTarget } from 'src/ts/drive/storeImport'
import { injectRestoreStore } from './restoreSupport'

/** One call of the stubbed `commitStore2Import`. */
export interface Store2StubCommit {
    /** How many events the box held when the commit was called; compare with an event a suite pushed itself. */
    order: number
    /** Whether `box.batchesSettled` answered true at the call (true when the suite gave no probe). */
    batchesSettled: boolean
    request: Store2ImportRequest
    /** The database the request decoded; null when the decode threw. */
    decoded: unknown
}

/** The state a suite shares with the stub; declare it with `vi.hoisted`. */
export interface Store2ShellBox {
    /** What `checkStore2Import` hands over; a typed fake the stub never dereferences when absent. */
    target?: Store2ImportTarget
    /** What the check answers instead of `ready`, for a row that needs a refusal. */
    check?: Store2ImportCheck
    /** The end the commit reports; `landed` with empty facts when absent. */
    end?: Store2ImportEnd
    /** Asked at each commit call: whether every asset batch had settled. */
    batchesSettled?: () => boolean
    /** Called synchronously at each commit call, before the decode; a suite records what it needs to know at that moment. */
    onCommit?: () => void
    /** Every call of the stubbed commit, in call order. */
    commits: Store2StubCommit[]
    /** Free-form ordering events; the stub appends `commit` on each call. */
    events: string[]
}

/** The empty facts of a landed import: no repair, nothing left incomplete. */
export const EMPTY_LANDED_END: Extract<Store2ImportEnd, { kind: 'landed' }> = {
    kind: 'landed',
    flushed: undefined,
    repairNotice: null,
    repair: { dropped: 0, changed: 0, recovered: 0 },
    incomplete: [],
}

/**
 * The one typed fake of the import target. Neither field is dereferenced by a row on this stub; the cast is the only one
 * in this helper and sits at that boundary.
 */
const FAKE_TARGET = { committer: {}, backend: {} } as unknown as Store2ImportTarget

/** Clears what a previous test left in `box`; call it from `beforeEach`. */
export function resetStore2ShellBox(box: Store2ShellBox): void {
    box.target = undefined
    box.check = undefined
    box.end = undefined
    box.batchesSettled = undefined
    box.onCommit = undefined
    box.commits.length = 0
    box.events.length = 0
}

/** Makes `store` the page's store of `kind` and the page's mode the real `store2` mode. */
export function useStore2RestorePage(store: ByteStore, kind: AppStoreKind = 'tauri'): void {
    injectRestoreStore(store, kind)
    setPageStorageMode({ kind: 'store2' })
}

/**
 * The module factory for `vi.mock(import('src/ts/drive/storeImport'), ...)`. The commit calls `request.decode()` as the
 * real one does, so a database that does not decode ends the import as it would (`decode-failed`, or `read-failed` for a
 * file that changed), then returns `box.end`. For `unconfirmed` it first sets the wait alert the real commit sets.
 */
export function store2ShellMock(box: Store2ShellBox) {
    return async (importOriginal: () => Promise<typeof import('src/ts/drive/storeImport')>) => {
        const original = await importOriginal()
        return {
            ...original,
            async checkStore2Import(): Promise<Store2ImportCheck> {
                return box.check ?? { kind: 'ready', target: box.target ?? FAKE_TARGET }
            },
            async commitStore2Import(request: Store2ImportRequest): Promise<Store2ImportEnd> {
                const call: Store2StubCommit = {
                    order: box.events.length,
                    batchesSettled: box.batchesSettled === undefined ? true : box.batchesSettled(),
                    request,
                    decoded: null,
                }
                box.events.push('commit')
                box.commits.push(call)
                box.onCommit?.()
                try {
                    call.decoded = await request.decode()
                } catch (error) {
                    if (error instanceof BinFileChangedError) {
                        alertError(original.binChangeText(error))
                        return { kind: 'refused', cause: 'read-failed' }
                    }
                    alertError(language.internalBackupUnreadable)
                    return { kind: 'refused', cause: 'decode-failed' }
                }
                const end = box.end ?? EMPTY_LANDED_END
                if (end.kind === 'unconfirmed') {
                    const { alertStore } = await import('src/ts/alert')
                    alertStore.set({ type: 'wait', msg: language.store2ImportUnconfirmed })
                }
                return end
            },
        }
    }
}
