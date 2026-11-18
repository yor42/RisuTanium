// @vitest-environment jsdom
/**
 * `exportAsDataset` on an Android page while the save picker is pending. The real `exportAsDataset`, the real
 * `downloadFile` (with its `TauriWriter`) and the real busy registry run; the operating-system plugin, the save dialog,
 * `invoke` and the alert module are replaced. A mocked picker is not evidence of the native one.
 *
 * Labels: (R) regression reproducer, fails before the change by assertion; (G) guard, passes with or without it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const box = vi.hoisted(() => ({
    os: 'android' as string,
    isTauri: true,
    savePath: null as string | null,
    appended: 0,
    /** Runs at the first byte that reaches the picked document. */
    onFirstWrite: null as (() => void) | null,
    errors: [] as string[],
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => box.os }))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return box.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async (_options?: unknown): Promise<string | null> => box.savePath),
}))

vi.mock('@tauri-apps/api/core', async (importOriginal) => {
    const original = await importOriginal<typeof import('@tauri-apps/api/core')>()
    return {
        ...original,
        invoke: vi.fn(async (_command: string, args: { data: string, last: boolean }) => {
            if (box.appended === 0) {
                box.onFirstWrite?.()
            }
            const written = Buffer.from(args.data, 'base64').byteLength
            box.appended += written
            return { written, ...(args.last ? { synced: true } : {}) }
        }),
    }
})

vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))

vi.mock('@tauri-apps/plugin-fs', async (importOriginal) => ({
    ...await importOriginal<typeof import('@tauri-apps/plugin-fs')>(),
    writeFile: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
    DBState: { db: {} },
    selIdState: { selId: -1 },
    selectedCharID: writable(-1),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => { }),
    alertError: vi.fn((message: string) => { box.errors.push(String(message)) }),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ characters: [] })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/process/coldCharacterRestore'), () => ({
    readColdCharacterCopy: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldCharacterRestore'))

// `downloadFile` is the real one from downloadFile.ts, reached the way the page reaches it.
vi.mock('src/ts/globalApi.svelte', async () => ({
    downloadFile: (await import('src/ts/downloadFile')).downloadFile,
    // Kept so the page's other globalApi consumers load; `exportAsDataset` itself imports only the leaf busy helper.
    readImage: vi.fn(),
    LocalWriter: class { },
    TauriWriter: class { },
}))

import { save } from '@tauri-apps/plugin-dialog'
import { exportAsDataset } from 'src/ts/storage/exportAsDataset'
import { busyKinds, isBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { inFlightKinds } from 'src/ts/process/inFlightWork'
import { refuseBackupLoadWhileBusy } from 'src/ts/drive/backupWorkGuard'

const URI = 'content://com.android.externalstorage.documents/document/primary%3ADownload%2Fdataset.json'

/** Makes the next save dialog answer only when `deliver` is called. */
function holdSaveDialog(): { deliver: (path: string | null) => void } {
    let deliver: (path: string | null) => void = () => { }
    vi.mocked(save).mockImplementationOnce(() => new Promise<string | null>((resolve) => { deliver = resolve }))
    return { deliver: (path) => deliver(path) }
}

beforeEach(() => {
    box.os = 'android'
    box.isTauri = true
    box.appended = 0
    box.onFirstWrite = null
    box.errors = []
    resetBusyActionsForTest()
    vi.mocked(save).mockClear()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('exportAsDataset waiting on the save picker', () => {
    // Regression reproducer (R8).
    test('(R) a pending Android picker does not refuse a backup Load; the write does', async () => {
        const dialog = holdSaveDialog()
        const atFirstWrite: { refused: boolean, kinds: string[] }[] = []
        box.onFirstWrite = () => { atFirstWrite.push({ refused: refuseBackupLoadWhileBusy(), kinds: busyKinds() }) }

        const exporting = exportAsDataset()
        await vi.waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })

        expect(refuseBackupLoadWhileBusy()).toBe(false)
        expect(box.errors).toEqual([])
        expect(isBusy()).toBe(true)
        expect(busyKinds()).toContain('export')
        expect(inFlightKinds()).toContain('busy')

        dialog.deliver(URI)
        await exporting

        expect(atFirstWrite).toEqual([{ refused: true, kinds: ['export'] }])
        expect(isBusy()).toBe(false)
        expect(inFlightKinds()).not.toContain('busy')
    })

    // Compatibility guard (G1): a dismissed picker leaves nothing registered and writes nothing.
    test('(G) a dismissed Android picker leaves no entry or token', async () => {
        const dialog = holdSaveDialog()
        const exporting = exportAsDataset()
        await vi.waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })

        dialog.deliver(null)
        await exporting

        expect(box.appended).toBe(0)
        expect(isBusy()).toBe(false)
        expect(inFlightKinds()).not.toContain('busy')
    })

    // Compatibility guard: the desktop route has no picker, and its entry ends with the export.
    test('(G) a desktop export opens no picker and leaves no entry', async () => {
        box.os = 'windows'
        await exportAsDataset()

        expect(save).not.toHaveBeenCalled()
        expect(isBusy()).toBe(false)
    })
})
