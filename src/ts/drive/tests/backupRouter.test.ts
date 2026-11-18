// @vitest-environment node
/**
 * The content classifier of the backup router (CHORE-128 S12c): `backupKindOf` and `readBackupKind` over real `.rtb` files
 * (the product's `writeRtb`), the committed `.bin` goldens and `.bin` entries framed by the product's own
 * `writeBackupEntry`. A prefix is what the router reads: the first `min(size, BACKUP_PROBE_BYTES)` bytes.
 *
 * Labels: every test is a compatibility guard of a new module (no pre-fix base: main has no router); each names the scratch
 * mutant it turns red on.
 */
import { beforeAll, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { zipSync } from 'fflate'
import { writeBackupEntry } from 'src/ts/exportWriters'
import { BACKUP_PROBE_BYTES, BIN_FIRST_NAME_MAX_BYTES, backupKindOf, readBackupKind, routePickedBackup } from 'src/ts/drive/backupRouter'
import { alertError } from 'src/ts/alert'
import { language } from 'src/lang'
import { rtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'
import { writeRtbFile } from './rtb/rtbRestoreFixtures'

// The classifier needs none of the restores or dialogs the router's imports reach; they are replaced so the file loads alone.
vi.mock('src/ts/drive/backuplocal', () => ({ LoadPickedLocalBackup: vi.fn() }))
vi.mock('src/ts/drive/backupWorkGuard', () => ({ refuseBackupLoadWhileBusy: vi.fn(() => false) }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }) as unknown as typeof import('src/ts/platform'))
vi.mock('src/ts/storage/tauriByteTransport', () => ({ transportKind: () => 'web' }))

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

const encoder = new TextEncoder()
const GOLDEN_DIR = path.resolve(process.cwd(), 'src/ts/drive/tests/binGoldens')

const golden = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, name)))

/** Entries framed as every `.bin` writer frames them (`LocalWriter.writeBackup` calls this function). */
async function framed(entries: ReadonlyArray<readonly [string, Uint8Array]>): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    for (const [name, data] of entries) {
        await writeBackupEntry({ write: async (piece) => { parts.push(piece.slice()) } }, encoder.encode(name), data)
    }
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

function kindOf(bytes: Uint8Array): ReturnType<typeof backupKindOf> {
    return backupKindOf(bytes.subarray(0, Math.min(bytes.length, BACKUP_PROBE_BYTES)), bytes.length)
}

/** A header with the stated lengths and a body of zeros, in the real framing. */
function header(nameBytes: Uint8Array, dataLength: number, total: number): Uint8Array {
    const out = new Uint8Array(total)
    const view = new DataView(out.buffer)
    view.setUint32(0, nameBytes.length, true)
    out.set(nameBytes, 4)
    view.setUint32(4 + nameBytes.length, dataLength, true)
    return out
}

function seeded(length: number, seed: number): Uint8Array {
    const out = new Uint8Array(length)
    let state = seed
    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        out[i] = state >>> 24
    }
    return out
}

let rtb: Uint8Array
let notRtbZip: Uint8Array
let plainZip: Uint8Array

beforeAll(async () => {
    const world = await rtbWorld({ layout: 1 })
    rtb = (await writeRtbFile({ world })).bytes
    // The same real file with the first entry's name changed and every size kept: a ZIP that is not a RisuTanium backup.
    notRtbZip = rtb.slice()
    const at = new TextDecoder('latin1').decode(notRtbZip.subarray(0, 64)).indexOf('mimetype')
    notRtbZip[at + 7] = 'f'.charCodeAt(0)
    plainZip = zipSync({ 'hello.txt': encoder.encode('hello') })
})

describe('the probe constants', () => {
    test('the probe covers the longest first header and the sniff (guard; MR2 lowers it)', () => {
        expect(BIN_FIRST_NAME_MAX_BYTES).toBe(4096)
        expect(BACKUP_PROBE_BYTES).toBe(4104)
    })
})

describe('R1: a real .rtb routes rtb whatever its name', () => {
    test('the writer file, a sealed file and a broken-magic RTBX file are rtb (guard)', () => {
        expect(kindOf(rtb)).toBe('rtb')
        const sealed = new Uint8Array([0x52, 0x54, 0x42, 0x58, 0x0D, 0x0A, 0x1A, 0x0A, 1, 0, 9, 9, 9, 9, 9, 9])
        expect(kindOf(sealed)).toBe('rtb')
        const damaged = new Uint8Array([0x52, 0x54, 0x42, 0x58, 0x00, 0x0A, 0x1A, 0x0A, 1, 0, 9, 9, 9, 9, 9, 9])
        expect(kindOf(damaged)).toBe('rtb')
    })
})

describe('R2: every real .bin variant routes bin', () => {
    test.each([
        ['V1 upstream, legacy database', 'upstream-full.bin'],
        ['V2 upstream, block database; its first entry ends exactly at the end of the file', 'upstream-kv.bin'],
        ['V3 upstream, cold unit first', 'upstream-plugin-index.bin'],
        ['V4 fork, pre-store2', 'fork-full.bin'],
    ])('%s (guard; MR6)', (_label, file) => {
        expect(kindOf(golden(file))).toBe('bin')
    })

    test('V2 ends exactly at its first entry, so `<= size` is what admits it (guard; MR6)', () => {
        const bytes = golden('upstream-kv.bin')
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const nameLength = view.getUint32(0, true)
        expect(8 + nameLength + view.getUint32(4 + nameLength, true)).toBe(bytes.length)
    })

    test('V5 an asset first, V6 an inlay part first, V7 the account marker first (guard; MR1 inverse)', async () => {
        const asset = await framed([['assets/' + 'a1'.repeat(32) + '.png', encoder.encode('png')], ['database.risudat', encoder.encode('db')]])
        const inlay = await framed([['risu-inlay-' + 'b2'.repeat(16) + '-0.part', encoder.encode('part')], ['database.risudat', encoder.encode('db')]])
        const marker = await framed([['encryption.risudat', encoder.encode('{"time":1,"type":"account"}')], ['database.risudat', seeded(64, 5)]])
        expect(kindOf(asset)).toBe('bin')
        expect(kindOf(inlay)).toBe('bin')
        expect(kindOf(marker)).toBe('bin')
    })

    test('V8 a 255-byte first name is read in full, which a probe of the sniff size would refuse (guard; MR2)', async () => {
        const name = 'n'.repeat(250) + '.png'
        const bytes = await framed([[name, encoder.encode('png')], ['database.risudat', encoder.encode('db')]])
        expect(encoder.encode(name).length).toBeGreaterThan(68)
        expect(kindOf(bytes)).toBe('bin')
    })
})

describe('R3a: the strict no-fall-through rule (MC-2255): what is not a backup is not-a-backup', () => {
    test.each([
        ['a ZIP that is not a RisuTanium backup', () => notRtbZip],
        ['a plain ZIP', () => plainZip],
        ['an empty file', () => new Uint8Array(0)],
        ['a 7-byte file', () => new Uint8Array(7)],
        ['4 KiB of random bytes', () => seeded(4096, 11)],
        ['a header whose name and data pass the end by one byte', () => header(encoder.encode('a.png'), 4, 8 + 5 + 3)],
        ['a first name of 16 bytes 0xFF', () => header(new Uint8Array(16).fill(0xFF), 0, 8 + 16)],
        ['a V4 file cut inside its first entry', () => golden('fork-full.bin').subarray(0, 24)],
    ])('%s (guard; MR1, MR4, MR5)', (_label, make) => {
        const bytes = make()
        expect(kindOf(bytes)).toBe('not-a-backup')
    })

    test('a header that passes the end of the file by exactly one byte is refused, and fitting exactly is accepted (guard; MR5, MR6)', () => {
        const name = encoder.encode('a.png')
        const fits = header(name, 3, 8 + name.length + 3)
        const over = header(name, 4, 8 + name.length + 3)
        expect(kindOf(fits)).toBe('bin')
        expect(kindOf(over)).toBe('not-a-backup')
    })

    test('a file with a bad name that fits is still refused: the name decode is fatal (guard; MR4)', () => {
        expect(kindOf(header(new Uint8Array([0xC3, 0x28, 0xA0, 0xA1]), 0, 12))).toBe('not-a-backup')
    })
})

describe('R3b: the two magics never reach bin at any size', () => {
    test('a non-.rtb ZIP prefix at 2^33 bytes is not-a-backup and an RTBX prefix is rtb (guard; MR3)', () => {
        expect(backupKindOf(notRtbZip.subarray(0, BACKUP_PROBE_BYTES), 2 ** 33)).toBe('not-a-backup')
        const sealedDamaged = new Uint8Array(BACKUP_PROBE_BYTES)
        sealedDamaged.set([0x52, 0x54, 0x42, 0x58, 0x00])
        expect(backupKindOf(sealedDamaged, 2 ** 33)).toBe('rtb')
    })
})

describe('R3c: the probe bound', () => {
    function longName(nameLength: number): Uint8Array {
        return header(new Uint8Array(nameLength).fill(0x61), 0, 10 * 1024)
    }

    test('a first name of 4096 bytes is bin and 4097 is not-a-backup (guard; MR2, MR3)', () => {
        expect(kindOf(longName(4096))).toBe('bin')
        expect(kindOf(longName(4097))).toBe('not-a-backup')
    })

    test('the router reads exactly one slice of min(size, 4104) bytes from offset 0 (guard; MR2, MR3)', async () => {
        const bytes = longName(4096)
        const slices: Array<[number | undefined, number | undefined]> = []
        const blob = new Blob([bytes as unknown as Uint8Array<ArrayBuffer>])
        const spy = vi.spyOn(blob, 'slice').mockImplementation(function (this: Blob, start?: number, end?: number) {
            slices.push([start, end])
            return Blob.prototype.slice.call(this, start, end)
        })
        expect(await readBackupKind(blob)).toBe('bin')
        expect(slices).toEqual([[0, BACKUP_PROBE_BYTES]])
        spy.mockRestore()
        const small = new Blob([new Uint8Array(100)])
        const smallSlices: Array<[number | undefined, number | undefined]> = []
        vi.spyOn(small, 'slice').mockImplementation(function (this: Blob, start?: number, end?: number) {
            smallSlices.push([start, end])
            return Blob.prototype.slice.call(this, start, end)
        })
        await readBackupKind(small)
        expect(smallSlices).toEqual([[0, 100]])
    })
})

describe('R3d: a failed or short read is could-not-read, never bin', () => {
    test('a slice whose read rejects, and one that returns fewer bytes than asked (guard; MR9)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        const size = golden('fork-full.bin').length
        // A blob stand-in: only size and the prefix slice's `arrayBuffer` are what the router touches.
        const standIn = (read: () => Promise<ArrayBuffer>): Blob => ({ size, slice: () => ({ arrayBuffer: read }) }) as unknown as Blob
        const rejecting = standIn(async () => { throw new Error('read failed') })
        expect(await readBackupKind(rejecting)).toBe('could-not-read')
        const short = standIn(async () => golden('fork-full.bin').slice(0, 10).buffer)
        expect(await readBackupKind(short)).toBe('could-not-read')
    })
})

describe('routing by content through routePickedBackup (R1, R2, R3a, R3d)', () => {
    const loaded = (outcome: 'committed' | 'canceled' = 'committed') => vi.fn(async () => ({ outcome }))

    test('a real .rtb named backup.bin, and one with no extension, reaches the .rtb restore only (guard; MR8)', async () => {
        for (const name of ['backup.bin', 'backup']) {
            const loadBin = loaded()
            const loadRtb = loaded()
            const file = new File([rtb as unknown as Uint8Array<ArrayBuffer>], name, { lastModified: 7 })
            const end = await routePickedBackup(file, { loadBin, loadRtb })
            expect(end).toEqual({ outcome: 'committed' })
            expect(loadRtb).toHaveBeenCalledTimes(1)
            expect(loadRtb.mock.calls[0]).toEqual([file])
            expect(loadBin).not.toHaveBeenCalled()
        }
    })

    test.each(['upstream-full.bin', 'upstream-kv.bin', 'upstream-plugin-index.bin', 'fork-full.bin'])('%s, named x.rtb and with no extension, reaches the .bin restore with the same File (guard; MR8)', async (golden_) => {
        for (const name of ['x.rtb', 'x']) {
            const loadBin = loaded()
            const loadRtb = loaded()
            const file = new File([golden(golden_) as unknown as Uint8Array<ArrayBuffer>], name)
            await routePickedBackup(file, { loadBin, loadRtb })
            expect(loadBin.mock.calls).toEqual([[file]])
            expect(loadRtb).not.toHaveBeenCalled()
        }
    })

    test('a file that is not a backup shows the notice, replaces nothing and calls no restore (R3a, the strict rule; guard; MR1)', async () => {
        for (const bytes of [notRtbZip, plainZip, new Uint8Array(0), new Uint8Array(7), seeded(4096, 3), golden('fork-full.bin').subarray(0, 24)]) {
            vi.mocked(alertError).mockClear()
            const loadBin = loaded()
            const loadRtb = loaded()
            const end = await routePickedBackup(new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'x.bin'), { loadBin, loadRtb })
            expect(end).toEqual({ outcome: 'nothing-replaced' })
            expect(vi.mocked(alertError).mock.calls).toEqual([[language.backupFileNotRecognized]])
            expect(loadBin).not.toHaveBeenCalled()
            expect(loadRtb).not.toHaveBeenCalled()
        }
    })

    test('a file that cannot be read shows backupFileUnreadable and calls no restore (R3d; guard; MR9)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        vi.mocked(alertError).mockClear()
        const loadBin = loaded()
        const loadRtb = loaded()
        const file = new File([golden('fork-full.bin') as unknown as Uint8Array<ArrayBuffer>], 'x.bin')
        vi.spyOn(file, 'slice').mockImplementation(() => ({ arrayBuffer: async () => { throw new Error('read failed') } }) as unknown as Blob)
        const end = await routePickedBackup(file, { loadBin, loadRtb })
        expect(end).toEqual({ outcome: 'nothing-replaced' })
        expect(vi.mocked(alertError).mock.calls).toEqual([[language.backupFileUnreadable]])
        expect(loadBin).not.toHaveBeenCalled()
        expect(loadRtb).not.toHaveBeenCalled()
    })

    test('a rejection of the routed restore ends failed with the generic message and never reaches the other restore (guard)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => { })
        vi.mocked(alertError).mockClear()
        const loadRtb = vi.fn(async () => { throw new Error('import failed') })
        const loadBin = loaded()
        const file = new File([rtb as unknown as Uint8Array<ArrayBuffer>], 'a.rtb')
        const end = await routePickedBackup(file, { loadBin, loadRtb })
        expect(end).toEqual({ outcome: 'failed' })
        expect(vi.mocked(alertError).mock.calls).toEqual([['Failed, Is file corrupted?']])
        expect(loadBin).not.toHaveBeenCalled()
    })
})