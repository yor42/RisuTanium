// @vitest-environment node
/**
 * How the backup router maps the Welcome route onto the two restores (CHORE-128 S14a): `routePickedBackup` over a real
 * `.rtb` (the product's `writeRtb`) and the committed `.bin` golden. The restores are replaced by recorders, so this
 * proves the call shape each route produces, not a restore.
 *
 * Labels: every test is a compatibility guard of a new route argument (no pre-fix base: the router had no route); each
 * names the scratch mutant it turns red on.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { routePickedBackup } from 'src/ts/drive/backupRouter'
import { LoadPickedLocalBackup } from 'src/ts/drive/backuplocal'
import { runRtbRestore } from 'src/ts/drive/rtbRestoreEntry'
import { rtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'
import { writeRtbFile } from './rtb/rtbRestoreFixtures'

vi.mock('src/ts/drive/backuplocal', () => ({ LoadPickedLocalBackup: vi.fn(async () => ({ outcome: 'committed' })), LoadLocalBackup: vi.fn() }))
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

describe('the first-run route', () => {
    test('a .bin goes to the .bin restore with the first-run option and never to the .rtb restore (guard; M6)', async () => {
        await routePickedBackup(binFile, {}, { firstRun: true })
        expect(vi.mocked(LoadPickedLocalBackup).mock.calls).toEqual([[binFile, { completeFirstSetup: true }]])
        expect(runRtbRestore).not.toHaveBeenCalled()
    })

    test('a .rtb goes to the .rtb restore with the first-run run option and never to the .bin restore (guard; M7)', async () => {
        await routePickedBackup(rtbFile, {}, { firstRun: true })
        expect(vi.mocked(runRtbRestore)).toHaveBeenCalledTimes(1)
        const call = vi.mocked(runRtbRestore).mock.calls[0]
        expect(call.slice(1)).toEqual([{}, { firstRun: true }])
        expect(LoadPickedLocalBackup).not.toHaveBeenCalled()
    })
})

describe('no route', () => {
    test('the plain calls carry no extra argument, also after a first-run route ran in the same module (guard; M8, and a first-run flag kept in module state)', async () => {
        await routePickedBackup(binFile, {}, { firstRun: true })
        await routePickedBackup(rtbFile, {}, { firstRun: true })
        vi.mocked(LoadPickedLocalBackup).mockClear()
        vi.mocked(runRtbRestore).mockClear()

        await routePickedBackup(binFile)
        await routePickedBackup(rtbFile)

        expect(vi.mocked(LoadPickedLocalBackup).mock.calls).toEqual([[binFile]])
        expect(vi.mocked(runRtbRestore)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(runRtbRestore).mock.calls[0].length).toBe(1)
    })
})
