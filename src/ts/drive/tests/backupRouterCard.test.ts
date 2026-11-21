// @vitest-environment node
/**
 * How the backup router carries the `card` route onto the two restores (RC1-RC3): `routePickedBackup` and
 * `loadBackupFromPicker` over a real `.rtb` (the product's `writeRtb`) and the committed `.bin` golden. The restores are
 * replaced by recorders, so this proves the call shape each route produces, not a restore.
 *
 * Labels: regression reproducers. The base router has no `card` route field, so every card assertion below fails there
 * (the base passes `[[file]]` and `[{}]`-shaped calls only); the no-route guards pass before and after.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { loadBackupFromPicker, routePickedBackup } from 'src/ts/drive/backupRouter'
import { LoadPickedLocalBackup } from 'src/ts/drive/backuplocal'
import { runRtbRestore } from 'src/ts/drive/rtbRestoreEntry'
import { rtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'
import { writeRtbFile } from './rtb/rtbRestoreFixtures'

vi.mock('src/ts/drive/backuplocal', () => ({ LoadPickedLocalBackup: vi.fn(async () => ({ outcome: 'committed' })), LoadLocalBackup: vi.fn(), backupPickerAccept: () => null }))
vi.mock('src/ts/drive/rtbRestoreEntry', () => ({
    runRtbRestore: vi.fn(async () => ({ outcome: 'committed', cause: null })),
    pickedRtbOf: (file: File) => ({ name: file.name, size: file.size, lastModified: file.lastModified, source: null }),
}))
vi.mock('src/ts/drive/backupWorkGuard', () => ({ refuseBackupLoadWhileBusy: vi.fn(() => false) }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }) as unknown as typeof import('src/ts/platform'))
vi.mock('src/ts/storage/tauriByteTransport', () => ({ transportKind: () => 'web' }))

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

const GOLDEN_DIR = path.resolve(process.cwd(), 'src/ts/drive/tests/binGoldens')

let rtbFile: File
let binFile: File

beforeAll(async () => {
    const world = await rtbWorld({ layout: 1 })
    rtbFile = new File([(await writeRtbFile({ world })).bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.rtb')
    binFile = new File([new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, 'fork-full.bin')))], 'fork-full.bin')
})

beforeEach(() => {
    vi.mocked(LoadPickedLocalBackup).mockClear()
    vi.mocked(runRtbRestore).mockClear()
})

describe('the card route', () => {
    // RC1
    test('a .bin goes to the .bin restore with the card option and never to the .rtb restore', async () => {
        await routePickedBackup(binFile, {}, { card: true })

        expect(vi.mocked(LoadPickedLocalBackup).mock.calls).toEqual([[binFile, undefined, { card: true }]])
        expect(runRtbRestore).not.toHaveBeenCalled()
    })

    // RC2
    test('a .rtb goes to the .rtb restore with the card run option and never to the .bin restore', async () => {
        await routePickedBackup(rtbFile, {}, { card: true })

        expect(vi.mocked(runRtbRestore)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(runRtbRestore).mock.calls[0].slice(1)).toEqual([{}, { card: true }])
        expect(LoadPickedLocalBackup).not.toHaveBeenCalled()
    })

    // RC2
    test('the Welcome route with the card passes both the first-run and the card option to either restore', async () => {
        await routePickedBackup(binFile, {}, { firstRun: true, card: true })
        await routePickedBackup(rtbFile, {}, { firstRun: true, card: true })

        expect(vi.mocked(LoadPickedLocalBackup).mock.calls).toEqual([[binFile, { completeFirstSetup: true }, { card: true }]])
        expect(vi.mocked(runRtbRestore).mock.calls[0].slice(1)).toEqual([{}, { firstRun: true, card: true }])
    })

    // RC3
    test('the picker forwards the card route (and the first-run route) to the routed restore', async () => {
        // The picker's file input, as far as the router drives it: no DOM is needed in this environment.
        interface PickerInput {
            files?: File[]
            onchange?: () => Promise<void>
            remove(): void
            addEventListener(): void
            click(): void
        }
        let captured: PickerInput | null = null
        vi.stubGlobal('document', {
            createElement: () => {
                const input: PickerInput = { remove() { }, addEventListener() { }, click() { } }
                captured = input
                return input
            },
        })
        try {
            for (const route of [{ card: true as const }, { firstRun: true, card: true as const }]) {
                vi.mocked(LoadPickedLocalBackup).mockClear()
                captured = null
                const loading = loadBackupFromPicker({}, route)
                const input = captured as PickerInput | null
                if (!input?.onchange) { throw new Error('the picker was not opened') }
                input.files = [binFile]
                await input.onchange()
                await loading
                expect(vi.mocked(LoadPickedLocalBackup).mock.calls).toEqual([
                    [binFile, route.firstRun === true ? { completeFirstSetup: true } : undefined, { card: true }],
                ])
            }
        } finally {
            vi.unstubAllGlobals()
        }
    })
})

describe('no route', () => {
    // CG: passes before and after. The plain calls carry no extra argument, also after a card route ran in the same module.
    test('the plain calls carry no extra argument after a card route ran', async () => {
        await routePickedBackup(binFile, {}, { card: true })
        await routePickedBackup(rtbFile, {}, { card: true })
        vi.mocked(LoadPickedLocalBackup).mockClear()
        vi.mocked(runRtbRestore).mockClear()

        await routePickedBackup(binFile)
        await routePickedBackup(rtbFile)

        expect(vi.mocked(LoadPickedLocalBackup).mock.calls).toEqual([[binFile]])
        expect(vi.mocked(runRtbRestore)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(runRtbRestore).mock.calls[0].length).toBe(1)
    })
})
