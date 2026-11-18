// @vitest-environment jsdom
/**
 * `exportLoreBook` on an Android page while the save picker is pending. The real `exportLoreBook`, the real
 * `downloadFile` (with its `TauriWriter`) and the real busy registry run; the operating-system plugin, the save dialog,
 * `invoke` and the alert module are replaced. A mocked picker is not evidence of the native one.
 *
 * Labels: (R) regression reproducer, fails before the change by assertion; (G) guard, passes with or without it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    os: 'android' as string,
    db: { characters: [] as unknown[], allowAllExtentionFiles: false },
    appended: 0,
    /** Runs at the first byte that reaches the picked document. */
    onFirstWrite: null as (() => void) | null,
    errors: [] as string[],
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.os }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: true,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async (_options?: unknown): Promise<string | null> => null),
}))

vi.mock('@tauri-apps/api/core', async (importOriginal) => {
    const original = await importOriginal<typeof import('@tauri-apps/api/core')>()
    return {
        ...original,
        invoke: vi.fn(async (_command: string, args: { data: string, last: boolean }) => {
            if (h.appended === 0) {
                h.onFirstWrite?.()
            }
            const written = Buffer.from(args.data, 'base64').byteLength
            h.appended += written
            return { written, ...(args.last ? { synced: true } : {}) }
        }),
    }
})

vi.mock('@tauri-apps/plugin-fs', async (importOriginal) => ({
    ...await importOriginal<typeof import('@tauri-apps/plugin-fs')>(),
    writeFile: vi.fn(async () => { }),
}))

vi.mock('../../stores.svelte', () => ({
    DBState: { db: h.db },
    selectedCharID: writable(0),
    alertStore: writable({ type: 'none', msg: '' }),
}))
vi.mock('../../storage/database.svelte', () => ({
    getDatabase: () => h.db,
}))
vi.mock('../../alert', () => ({
    alertError: vi.fn((message: unknown) => { h.errors.push(String(message)) }),
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => { }),
}))
vi.mock('../../exportNotice', () => ({ downloadNotice: (text: string) => text }))
// `downloadFile` is the real one from downloadFile.ts, reached the way the page reaches it.
vi.mock('../../globalApi.svelte', async () => ({
    downloadFile: (await import('../../downloadFile')).downloadFile,
}))
vi.mock('../../characters', () => ({ createBlankChar: vi.fn(), getCharImage: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))
vi.mock('../../parser/chatVar.svelte', () => ({ getChatVar: vi.fn(), setChatVar: vi.fn() }))
vi.mock('../../parser/parser.svelte', () => ({ risuChatParser: vi.fn() }))
vi.mock('../../tokenizer', () => ({ tokenize: vi.fn() }))
vi.mock('../modules', () => ({ getModuleLorebooks: vi.fn(() => []) }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))

import { save } from '@tauri-apps/plugin-dialog'
import { exportLoreBook } from '../lorebook.svelte'
import { busyKinds, isBusy, resetBusyActionsForTest } from '../memory/busyActions'
import { inFlightKinds } from '../inFlightWork'
import { refuseBackupLoadWhileBusy } from '../../drive/backupWorkGuard'

const URI = 'content://com.android.externalstorage.documents/document/primary%3ADownload%2Florebook_export.json'

/** Makes the next save dialog answer only when `deliver` is called. */
function holdSaveDialog(): { deliver: (path: string | null) => void } {
    let deliver: (path: string | null) => void = () => { }
    vi.mocked(save).mockImplementationOnce(() => new Promise<string | null>((resolve) => { deliver = resolve }))
    return { deliver: (path) => deliver(path) }
}

beforeEach(() => {
    h.os = 'android'
    h.appended = 0
    h.onFirstWrite = null
    h.errors = []
    h.db.characters = [{ chatPage: 0, globalLore: [{ key: 'kept' }], chats: [{ localLore: [] }] }]
    resetBusyActionsForTest()
    vi.mocked(save).mockClear()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('exportLoreBook waiting on the save picker', () => {
    // Regression reproducer (R9).
    test('(R) a pending Android picker does not refuse a backup Load; the write does', async () => {
        const dialog = holdSaveDialog()
        const atFirstWrite: { refused: boolean, kinds: string[] }[] = []
        h.onFirstWrite = () => { atFirstWrite.push({ refused: refuseBackupLoadWhileBusy(), kinds: busyKinds() }) }

        const exporting = exportLoreBook('global')
        await vi.waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })

        expect(refuseBackupLoadWhileBusy()).toBe(false)
        expect(h.errors).toEqual([])
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
        const exporting = exportLoreBook('global')
        await vi.waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })

        dialog.deliver(null)
        await exporting

        expect(h.appended).toBe(0)
        expect(isBusy()).toBe(false)
        expect(inFlightKinds()).not.toContain('busy')
    })
})
