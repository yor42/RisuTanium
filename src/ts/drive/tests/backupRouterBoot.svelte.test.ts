/**
 * The start-up picker and router (CHORE-128 S14b): the real `loadBackupAtBoot` input over `routeBootPickedBackup`, with the
 * restores injected where a test observes what is routed where. The files: a hand-made `.rtb` (the sealed-file magic and a
 * header stub, which is all the router reads), the committed `.bin` goldens and a plain text file. A mocked restore says
 * nothing about a real store.
 *
 * Labels: T-RB2 (off Android) and T-RB3 are regression reproducers (DESIGNED; on the base the picker accepts `.bin` only and a
 * text file reaches the `.bin` walk); T-RB1 and the Android half of T-RB2 guard a new rule; T-RB4 is a compatibility guard.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { language } from 'src/lang'
import { beginBusy, isBusy } from 'src/ts/process/memory/busyActions'
import type { BootImportEnd, BootImportTarget } from 'src/ts/storage/store2/legacy/bootImport'
import { routeBootPickedBackup, type BootRouterDeps } from 'src/ts/drive/backupRouter'
import { loadBackupAtBoot } from 'src/ts/drive/backuplocal'
import { alertError } from 'src/ts/alert'

const transport = vi.hoisted(() => ({ kind: 'web' }))
vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...await importOriginal<typeof import('src/ts/storage/tauriByteTransport')>(),
    transportKind: () => transport.kind,
}))

const GENERIC = 'Failed, Is file corrupted?'
const CANCELLED: BootImportEnd = { kind: 'cancelled' }
const GOLDEN_DIR = path.resolve(process.cwd(), 'src/ts/drive/tests/binGoldens')

let rtbBytes: Uint8Array
let binBytes: Uint8Array

beforeEach(async () => {
    void h
    transport.kind = 'web'
    vi.mocked(alertError).mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    // The router classifies by the first bytes only; a sealed `.rtb`'s magic and header are enough (the full-file classification
    // over a real writer file is covered by `backupRouter.test.ts`, and the restore itself by `rtbBootRestore.svelte.test.ts`).
    rtbBytes ??= new Uint8Array([0x52, 0x54, 0x42, 0x58, 0x0D, 0x0A, 0x1A, 0x0A, 1, 0, 9, 9, 9, 9, 9, 9])
    binBytes ??= new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, 'upstream-full.bin')))
})

afterEach(() => {
    vi.restoreAllMocks()
})

const fileOf = (bytes: Uint8Array, name: string): File => new File([bytes as unknown as Uint8Array<ArrayBuffer>], name)
const errors = (): unknown[] => vi.mocked(alertError).mock.calls.map((call) => call[0])

interface Observed {
    target: BootImportTarget
    install: ReturnType<typeof vi.fn>
    installBuiltTree: ReturnType<typeof vi.fn>
}

function observedTarget(): Observed {
    const install = vi.fn(async () => { throw new Error('the .bin install must not run') })
    const installBuiltTree = vi.fn(async () => { throw new Error('the .rtb install must not run') })
    return { target: { readColdStorageItem: async () => ({ status: 'missing' }), install, installBuiltTree } as unknown as BootImportTarget, install, installBuiltTree }
}

function deps(): { calls: BootRouterDeps, loadBin: ReturnType<typeof vi.fn>, loadRtb: ReturnType<typeof vi.fn> } {
    const loadBin = vi.fn(async (): Promise<BootImportEnd> => ({ kind: 'cancelled' }))
    const loadRtb = vi.fn(async (): Promise<BootImportEnd> => ({ kind: 'cancelled' }))
    return { calls: { loadBin, loadRtb }, loadBin, loadRtb }
}

/** The real picker: the created input, captured, and the promise of the flow. */
function openPicker(target: BootImportTarget): { input: HTMLInputElement | null, ended: Promise<BootImportEnd> } {
    const realCreateElement = document.createElement.bind(document)
    let input: HTMLInputElement | null = null
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = realCreateElement(tag)
        if (tag === 'input') {
            input = element as HTMLInputElement
        }
        return element
    })
    try {
        const ended = loadBackupAtBoot(target)
        return { input, ended }
    } finally {
        spy.mockRestore()
    }
}

describe('the boot picker (T-RB2)', () => {
    test('off Android the input accepts .bin and .rtb; on Android it has no accept attribute (reproducer off Android; M1)', async () => {
        const web = openPicker(observedTarget().target)
        expect(web.input?.accept).toBe('.bin,.rtb,application/vnd.risutanium.rtb')
        web.input?.dispatchEvent(new Event('cancel'))
        await web.ended
        transport.kind = 'android'
        const android = openPicker(observedTarget().target)
        expect(android.input?.hasAttribute('accept')).toBe(false)
        android.input?.dispatchEvent(new Event('cancel'))
        await android.ended
    })
})

describe('a text file picked at boot (T-RB3)', () => {
    test('is turned away with the not-recognised notice, ends cancelled, reaches no installer and leaves no busy entry (reproducer; M3)', async () => {
        const seen = observedTarget()
        const picker = openPicker(seen.target)
        const input = picker.input as HTMLInputElement
        Object.defineProperty(input, 'files', { value: [fileOf(new TextEncoder().encode('just some plain text, not a backup at all'), 'notes.bin')], configurable: true })
        await (input.onchange as unknown as () => Promise<void>)()
        expect(await picker.ended).toEqual(CANCELLED)
        expect(errors()).toEqual([language.backupFileNotRecognized])
        expect(seen.install).not.toHaveBeenCalled()
        expect(seen.installBuiltTree).not.toHaveBeenCalled()
        expect(isBusy()).toBe(false)
    })
})

describe('routeBootPickedBackup (T-RB1)', () => {
    test('a .bin goes to loadBin and a .rtb to loadRtb, each once, with the target (M2)', async () => {
        const seen = observedTarget()
        const bin = deps()
        expect(await routeBootPickedBackup(fileOf(binBytes, 'a.bin'), seen.target, bin.calls)).toEqual(CANCELLED)
        expect(bin.loadBin).toHaveBeenCalledTimes(1)
        expect(bin.loadBin.mock.calls[0][1]).toBe(seen.target)
        expect(bin.loadRtb).not.toHaveBeenCalled()
        const rtb = deps()
        await routeBootPickedBackup(fileOf(rtbBytes, 'a.rtb'), seen.target, rtb.calls)
        expect(rtb.loadRtb).toHaveBeenCalledTimes(1)
        expect(rtb.loadRtb.mock.calls[0][1]).toBe(seen.target)
        expect(rtb.loadBin).not.toHaveBeenCalled()
    })

    test('a file that is not a backup, a failed read and a rejecting loadRtb never reach loadBin (M3, M3b)', async () => {
        const seen = observedTarget()
        const junk = deps()
        expect(await routeBootPickedBackup(fileOf(new TextEncoder().encode('plain text, not a backup'), 'a.bin'), seen.target, junk.calls)).toEqual(CANCELLED)
        expect(errors()).toEqual([language.backupFileNotRecognized])
        expect(junk.loadBin).not.toHaveBeenCalled()
        expect(junk.loadRtb).not.toHaveBeenCalled()

        vi.mocked(alertError).mockClear()
        const unreadable = deps()
        const broken = fileOf(binBytes, 'a.bin')
        broken.slice = () => ({ arrayBuffer: async () => { throw new Error('read failed') } }) as unknown as Blob
        expect(await routeBootPickedBackup(broken, seen.target, unreadable.calls)).toEqual(CANCELLED)
        expect(errors()).toEqual([language.backupFileUnreadable])
        expect(unreadable.loadBin).not.toHaveBeenCalled()

        vi.mocked(alertError).mockClear()
        const rejecting = deps()
        rejecting.loadRtb.mockRejectedValue(new Error('import failed'))
        expect(await routeBootPickedBackup(fileOf(rtbBytes, 'a.rtb'), seen.target, rejecting.calls)).toEqual(CANCELLED)
        expect(errors()).toEqual([GENERIC])
        expect(rejecting.loadBin).not.toHaveBeenCalled()
    })

    test('no restore is called until the held prefix read resolves', async () => {
        const seen = observedTarget()
        const calls = deps()
        let release: () => void = () => { }
        const held = new Promise<void>((resolve) => { release = resolve })
        const file = fileOf(binBytes, 'a.bin')
        const realSlice = file.slice.bind(file)
        file.slice = (start, end) => {
            const part = realSlice(start, end)
            return { arrayBuffer: async () => { await held; return await part.arrayBuffer() } } as unknown as Blob
        }
        const routed = routeBootPickedBackup(file, seen.target, calls.calls)
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(calls.loadBin).not.toHaveBeenCalled()
        release()
        await routed
        expect(calls.loadBin).toHaveBeenCalledTimes(1)
    })
})

describe('the picker exits (T-RB4; compatibility guard, passes before and after)', () => {
    test('a busy entry held before the call opens no input and ends cancelled (M23)', async () => {
        const busy = beginBusy('backupLoad')
        try {
            const picker = openPicker(observedTarget().target)
            expect(picker.input).toBeNull()
            expect(await picker.ended).toEqual(CANCELLED)
        } finally {
            busy.end()
        }
    })

    test('a cancel event and an empty pick end cancelled', async () => {
        const cancelled = openPicker(observedTarget().target)
        cancelled.input?.dispatchEvent(new Event('cancel'))
        expect(await cancelled.ended).toEqual(CANCELLED)

        const empty = openPicker(observedTarget().target)
        const input = empty.input as HTMLInputElement
        Object.defineProperty(input, 'files', { value: [], configurable: true })
        await (input.onchange as unknown as () => Promise<void>)()
        expect(await empty.ended).toEqual(CANCELLED)
    })
})
