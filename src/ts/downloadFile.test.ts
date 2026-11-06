// @vitest-environment jsdom
/**
 * `downloadFile` in `src/ts/downloadFile.ts`, with the real `TauriWriter`.
 *
 * The operating-system plugin, the save dialog, `invoke` and the file-system plugin's `writeFile` are replaced by
 * recorders; the `save` mock answers with a Storage Access Framework URI and the `invoke` mock answers
 * `export_append_b64` with the reply shape the native command sends. A mocked plugin is not evidence of native behaviour.
 *
 * Labels: (R) marks a test that fails against a `downloadFile` without the Android save-picker branch; (G) is a guard
 * that passes with or without it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { BaseDirectory } from '@tauri-apps/plugin-fs'
import { downloadFile } from 'src/ts/downloadFile'
import { language } from 'src/lang'

const box = vi.hoisted(() => ({
    os: 'android' as string,
    isTauri: true,
    savePath: null as string | null,
    invokeCalls: [] as Array<{ command: string, uri: string, data: string, create: boolean, last: boolean }>,
    invokeFails: false,
    saveCalls: [] as Array<unknown>,
    writeFileCalls: [] as Array<{ name: string, data: Uint8Array, options: unknown }>,
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => box.os }))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return box.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async (options: unknown) => {
        box.saveCalls.push(options)
        return box.savePath
    }),
}))

vi.mock('@tauri-apps/api/core', async (importOriginal) => {
    const original = await importOriginal<typeof import('@tauri-apps/api/core')>()
    return {
        ...original,
        invoke: vi.fn(async (command: string, args: { uri: string, data: string, create: boolean, last: boolean }) => {
            box.invokeCalls.push({ command, uri: args.uri, data: args.data, create: args.create, last: args.last })
            if (box.invokeFails) {
                throw new Error('disk')
            }
            const written = Buffer.from(args.data, 'base64').byteLength
            return { written, ...(args.last ? { synced: true } : {}) }
        }),
    }
})

vi.mock('@tauri-apps/plugin-fs', async (importOriginal) => {
    const original = await importOriginal<typeof import('@tauri-apps/plugin-fs')>()
    return {
        ...original,
        writeFile: vi.fn(async (name: string, data: Uint8Array, options: unknown) => {
            box.writeFileCalls.push({ name, data, options })
        }),
    }
})

vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormalWait: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/alert'))

const URI = 'content://com.android.externalstorage.documents/document/primary%3ADownload%2Florebook_export.json'
const INPUT = new Uint8Array([123, 34, 116, 121, 112, 101, 34, 58, 34, 114, 105, 115, 117, 34, 125])

function sentBytes(): Uint8Array {
    return new Uint8Array(Buffer.concat(box.invokeCalls.map((call) => Buffer.from(call.data, 'base64'))))
}

beforeEach(() => {
    box.os = 'android'
    box.isTauri = true
    box.savePath = URI
    box.invokeCalls.length = 0
    box.invokeFails = false
    box.saveCalls.length = 0
    box.writeFileCalls.length = 0
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('downloadFile on Android', () => {
    test('(R) T1: saves through the picker with the suggested name and an extension filter, and the bytes reach the picked document', async () => {
        const result = await downloadFile('lorebook_export.json', INPUT)
        expect(box.saveCalls).toEqual([{ defaultPath: 'lorebook_export.json', filters: [{ name: 'JSON', extensions: ['json'] }] }])
        expect(box.invokeCalls.length).toBeGreaterThan(0)
        expect(box.invokeCalls.every((call) => call.command === 'export_append_b64' && call.uri === URI)).toBe(true)
        expect(box.invokeCalls[0].create).toBe(true)
        expect(box.invokeCalls[box.invokeCalls.length - 1].last).toBe(true)
        expect(Array.from(sentBytes())).toEqual(Array.from(INPUT))
        expect(box.writeFileCalls).toEqual([])
        expect(result).toBe(true)
    })

    test('(R) T2: a cancelled picker writes nothing and resolves false', async () => {
        box.savePath = null
        const result = await downloadFile('lorebook_export.json', INPUT)
        expect(box.saveCalls.length).toBe(1)
        expect(box.invokeCalls).toEqual([])
        expect(box.writeFileCalls).toEqual([])
        expect(result).toBe(false)
    })

    test('(R) T3: a failed write rejects with the failure text and the incomplete sentence, with no further append', async () => {
        box.invokeFails = true
        const outcome = await downloadFile('lorebook_export.json', INPUT).then(() => null, (error: unknown) => error)
        expect(outcome).toBeInstanceOf(Error)
        const message = (outcome as Error).message
        expect(message).toContain('disk')
        expect(message).toContain(language.exportFailedFileIncomplete)
        expect(box.invokeCalls.length).toBe(1)
        expect(box.writeFileCalls).toEqual([])
    })

    test('(R) T6: the filter extension is whatever follows the last dot, and a name without one has no filter', async () => {
        await downloadFile('my.preset_preset.risup', INPUT)
        await downloadFile('README', INPUT)
        expect(box.saveCalls).toEqual([
            { defaultPath: 'my.preset_preset.risup', filters: [{ name: 'RISUP', extensions: ['risup'] }] },
            { defaultPath: 'README', filters: [] },
        ])
    })

    test('(R) T16: empty data still asks for a location and leaves an empty document, resolving true', async () => {
        const result = await downloadFile('empty.json', new Uint8Array(0))
        expect(box.saveCalls.length).toBe(1)
        expect(box.invokeCalls).toEqual([])
        expect(box.writeFileCalls).toEqual([])
        expect(result).toBe(true)
    })
})

describe('downloadFile off Android', () => {
    test('(G) T4: desktop writes into the Download folder with no picker, and resolves true', async () => {
        box.os = 'windows'
        const result = await downloadFile('lorebook_export.json', INPUT)
        expect(box.saveCalls).toEqual([])
        expect(box.invokeCalls).toEqual([])
        expect(box.writeFileCalls.length).toBe(1)
        expect(box.writeFileCalls[0].name).toBe('lorebook_export.json')
        expect(Array.from(box.writeFileCalls[0].data)).toEqual(Array.from(INPUT))
        expect(box.writeFileCalls[0].options).toEqual({ baseDir: BaseDirectory.Download })
        expect(result).toBe(true)
    })

    test('(G) T5: the web route downloads through an anchor with no Tauri call, and resolves true', async () => {
        box.isTauri = false
        box.os = 'android'
        const created = vi.fn(() => 'blob:synthetic')
        const revoked = vi.fn()
        Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: created })
        Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revoked })
        const clicked: string[] = []
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            clicked.push(this.download)
        })
        const result = await downloadFile('lorebook_export.json', 'text')
        expect(created).toHaveBeenCalledTimes(1)
        expect(clicked).toEqual(['lorebook_export.json'])
        expect(box.saveCalls).toEqual([])
        expect(box.invokeCalls).toEqual([])
        expect(box.writeFileCalls).toEqual([])
        expect(result).toBe(true)
    })
})
