/**
 * M6 fixture generator: `.rtb` containers built by the real writer for the archiver
 * interoperability check (7-Zip, Windows Explorer, tar, macOS Archive Utility, an
 * Android file manager).
 *
 * Writes only under a fresh directory in the OS temp folder, and only when
 * RTB_GENERATE=1, so a run of the whole save-gen folder generates nothing.
 *
 * Run (repository root):
 *   $env:RTB_GENERATE = '1'
 *   pnpm vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/rtbM6Fixture.harness.ts
 *
 * Two files are written, identical except for the local size fields of descriptor
 * entries: `m6-sentinel.rtb` writes 0xFFFFFFFF there (writer v1 default) and
 * `m6-zero.rtb` writes 0 (the M6 branch for an archiver that rejects the sentinel).
 * Each holds a stored 20 MiB descriptor entry, a deflated descriptor entry over the
 * 16 MiB buffer limit, a 1,024-byte name, and the manifest first in the central
 * directory. `expected.json` lists each entry's SHA-256 so an extraction can be
 * compared. When 7-Zip is installed (RTB_7Z or the default install path) the harness
 * also lists, tests and extracts each file with it and compares the bodies.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, test, expect } from 'vitest'
import { Zip64Writer, type ZipPiece, type ZipSink } from 'src/ts/drive/rtb/zip64Writer'

const GENERATE = process.env.RTB_GENERATE === '1'
const MIB = 1024 * 1024

class FileSink implements ZipSink {
    constructor(private readonly fd: number) {}
    write(chunk: Uint8Array): void {
        let done = 0
        while (done < chunk.length) {
            done += fs.writeSync(this.fd, chunk, done, chunk.length - done)
        }
    }
}

function randomBody(length: number, seed: number): Uint8Array {
    const out = new Uint8Array(length)
    let state = seed >>> 0
    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        out[i] = state >>> 24
    }
    return out
}

function textBody(length: number): Uint8Array {
    const line = new TextEncoder().encode('{"role":"user","data":"the quick brown fox jumps over the lazy dog"}\n')
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i += line.length) {
        out.set(line.subarray(0, Math.min(line.length, length - i)), i)
    }
    return out
}

async function* inMiB(body: Uint8Array): AsyncGenerator<ZipPiece> {
    for (let at = 0; at < body.length; at += MIB) {
        yield body.subarray(at, Math.min(body.length, at + MIB))
    }
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
}

interface Fixture {
    name: string
    method: 0 | 8
    body: Uint8Array
    descriptor: boolean
}

function fixtureEntries(): Fixture[] {
    const longName = 'u/' + 'n'.repeat(1022)
    return [
        { name: 'mimetype', method: 0, body: new TextEncoder().encode('application/vnd.risutanium.rtb'), descriptor: false },
        { name: 'u/small.txt', method: 8, body: textBody(5000), descriptor: false },
        { name: 'a/stored-20mib.bin', method: 0, body: randomBody(20 * MIB, 1), descriptor: true },
        { name: 'u/deflated-20mib.txt', method: 8, body: textBody(20 * MIB), descriptor: true },
        { name: longName, method: 0, body: randomBody(64, 2), descriptor: false },
        { name: 'manifest.json', method: 8, body: new TextEncoder().encode('{"rtb":1}'), descriptor: false },
    ]
}

async function writeFixture(file: string, zeroLocalSizes: boolean): Promise<void> {
    const fd = fs.openSync(file, 'wx')
    try {
        const writer = new Zip64Writer({ sink: new FileSink(fd), createdAt: Date.UTC(2026, 10, 7, 12, 0, 0), m6ZeroLocalSizes: zeroLocalSizes })
        for (const entry of fixtureEntries()) {
            if (entry.descriptor) {
                await writer.addStreamed(entry.name, entry.method, inMiB(entry.body), null)
            } else {
                await writer.addBuffered(entry.name, entry.method, entry.body, entry.body.length)
            }
        }
        await writer.finish({ firstCentral: 'manifest.json' })
    } finally {
        fs.closeSync(fd)
    }
}

function sevenZip(): string | null {
    const candidates = [process.env.RTB_7Z, 'C:\\Program Files\\7-Zip\\7z.exe'].filter((p): p is string => !!p)
    return candidates.find((p) => fs.existsSync(p)) ?? null
}

describe.skipIf(!GENERATE)('M6 fixture generation (RTB_GENERATE=1)', () => {
    test('writes the fixtures and checks them with 7-Zip when it is installed', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtb-m6-'))
        console.log(`M6 fixture directory: ${dir}`)
        const variants = [['m6-sentinel.rtb', false], ['m6-zero.rtb', true]] as const
        for (const [name, zero] of variants) {
            await writeFixture(path.join(dir, name), zero)
        }
        const expected = fixtureEntries().map((e) => ({ name: e.name, size: e.body.length, sha256: sha256(e.body) }))
        fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify(expected, null, 2))

        const exe = sevenZip()
        const report: string[] = []
        if (!exe) {
            report.push('7-Zip not found: open the fixtures in 7-Zip, Explorer, tar and the Android file manager by hand')
        } else {
            for (const [name] of variants) {
                const file = path.join(dir, name)
                const list = spawnSync(exe, ['l', '-slt', file], { encoding: 'utf8', timeout: 120000 })
                const test7z = spawnSync(exe, ['t', file], { encoding: 'utf8', timeout: 120000 })
                const out = path.join(dir, `extract-${name}`)
                const extract = spawnSync(exe, ['x', '-y', `-o${out}`, file], { encoding: 'utf8', timeout: 300000 })
                report.push(`${name}: list exit ${list.status}, test exit ${test7z.status}, extract exit ${extract.status}`)
                report.push(`${name}: test tail: ${(test7z.stdout ?? '').trim().split(/\r?\n/).slice(-4).join(' | ')}`)
                for (const entry of fixtureEntries()) {
                    const target = path.join(out, ...entry.name.split('/'))
                    const ok = fs.existsSync(target) && sha256(fs.readFileSync(target)) === sha256(entry.body)
                    report.push(`${name}: ${entry.name.length > 40 ? entry.name.slice(0, 20) + '...' + entry.name.length : entry.name} ${ok ? 'byte-exact' : 'MISMATCH'}`)
                    if (list.status === 0 && test7z.status === 0 && extract.status === 0) {
                        expect(ok).toBe(true)
                    }
                }
            }
        }
        fs.writeFileSync(path.join(dir, 'report.txt'), report.join('\n'))
        console.log(report.join('\n'))
    }, 600000)
})
