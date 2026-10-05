/**
 * The production binding of the boot archive pass's crash-loop breaker
 * (`src/ts/storage/bootArchiveHost.ts`): the strike record the pass reads,
 * starts and resets, and the told record it reads with the notice memo, are the
 * ones `bootArchiveMemo.ts` keeps, with the same fail-closed answers. A binding
 * that wrapped them so a throw read as a zero count would let a crash loop run
 * unbounded on a device whose storage cannot be read.
 *
 * Every module the binding reaches for a real effect is mocked; nothing here
 * touches a server, a file system or a browser lock. `localStorage` is the
 * happy-dom one, or a stand-in that throws.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/plugin-os', () => ({ type: vi.fn(() => 'windows') }))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    readMainFile: vi.fn(),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    acquireExclusiveStorageMigrationLock: vi.fn(),
    forageStorage: { staleAccountProfile: false, getItem: vi.fn(), setItem: vi.fn() },
    locksSupported: true,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: vi.fn(),
    setColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/reloadGuard'), () => ({
    isAppInitiatedReload: vi.fn(() => false),
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    LoadingStatusState: { text: '' },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: true,
    isMobile: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

import { createProductionBootArchiveDeps } from 'src/ts/storage/bootArchiveHost'

const STRIKES_KEY = 'archivePassStrikes'

type MemoModule = typeof import('src/ts/storage/bootArchiveMemo')

async function memoModule(): Promise<MemoModule> {
    const memoModulePath = '/src/ts/storage/bootArchiveMemo'
    return await import(/* @vite-ignore */ memoModulePath) as MemoModule
}

/** A storage whose every access throws, as a blocked or full `localStorage` does. */
function throwingStorage(): Storage {
    const fail = (): never => { throw new Error('storage blocked') }
    return {
        get length(): number { return fail() },
        key: fail,
        getItem: fail,
        setItem: fail,
        removeItem: fail,
        clear: fail,
    } as unknown as Storage
}

beforeEach(() => {
    localStorage.clear()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('boot archive pass: the production binding of the strike record', () => {
    test('reads the strike state from the module that writes it', async () => {
        const memo = await memoModule()
        const deps = await createProductionBootArchiveDeps('web')
        expect(deps.readArchiveStrikes()).toBe('none')

        memo.recordArchiveStart()
        expect(deps.readArchiveStrikes()).toBe('one')

        memo.recordArchiveStart()
        expect(deps.readArchiveStrikes()).toBe('paused')
    })

    test('makes the start record in the module that reads it, and says it was written', async () => {
        const memo = await memoModule()
        const deps = await createProductionBootArchiveDeps('web')

        expect(deps.recordArchiveStart()).toBe(true)
        expect(memo.readArchiveStrikes()).toBe('one')
        expect(localStorage.getItem(STRIKES_KEY)).toBe('1')
    })

    test('resets the count in the module that reads it', async () => {
        const memo = await memoModule()
        const deps = await createProductionBootArchiveDeps('web')
        memo.recordArchiveStart()

        deps.resetArchiveStrikes()

        expect(memo.readArchiveStrikes()).toBe('none')
    })

    test('reads the told record with the notice memo, from the module that writes it', async () => {
        const memo = await memoModule()
        const deps = await createProductionBootArchiveDeps('web')
        expect(deps.readArchiveMemo().pausedTold).toBe(false)

        memo.rememberPausedTold()

        expect(deps.readArchiveMemo().pausedTold).toBe(true)
    })

    test('answers unreadable and writes nothing when localStorage throws', async () => {
        const deps = await createProductionBootArchiveDeps('web')
        vi.stubGlobal('localStorage', throwingStorage())

        expect(deps.readArchiveStrikes()).toBe('unreadable')
        expect(deps.recordArchiveStart()).toBe(false)
    })

    test('answers paused for a stored value that is not a count, and refuses to start on it', async () => {
        const deps = await createProductionBootArchiveDeps('web')
        localStorage.setItem(STRIKES_KEY, 'garbage')

        expect(deps.readArchiveStrikes()).toBe('paused')
        expect(deps.recordArchiveStart()).toBe(false)
        expect(localStorage.getItem(STRIKES_KEY)).toBe('garbage')
    })
})
